// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderPreview, HYDRATE_TIMEOUT_MS, type Hydrator } from './quicklookPreview'

function sheet(): HTMLElement {
  return document.createElement('div')
}

const settled: Hydrator = { hydrate: async () => {} }

describe('renderPreview', () => {
  it('renders the markdown into the sheet', async () => {
    const el = sheet()
    await renderPreview(el, '# Title\n\nSome *text*.', [settled])
    expect(el.querySelector('h1')?.textContent).toBe('Title')
    expect(el.querySelector('em')?.textContent).toBe('text')
  })

  it('leaves the frontmatter out of the preview', async () => {
    const el = sheet()
    await renderPreview(el, '---\ntitle: Paper\n---\n\nBody', [settled])
    expect(el.textContent).not.toContain('title: Paper')
    expect(el.textContent).toContain('Body')
  })

  it('hands every hydrator the sheet after the HTML is in it', async () => {
    const el = sheet()
    const seen: string[] = []
    const a = { hydrate: vi.fn(async (root: HTMLElement) => void seen.push(root.innerHTML)) }
    const b = { hydrate: vi.fn(async () => {}) }
    await renderPreview(el, '```vega-lite\n{"mark":"bar"}\n```', [a, b])
    expect(a.hydrate).toHaveBeenCalledWith(el)
    expect(b.hydrate).toHaveBeenCalledWith(el)
    expect(seen[0]).toContain('vega-lite-chart')
  })

  it('waits for the hydrators before resolving', async () => {
    const el = sheet()
    let release!: () => void
    const slow = { hydrate: () => new Promise<void>((r) => (release = r)) }
    let done = false
    const p = renderPreview(el, 'x', [slow]).then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await p
    expect(done).toBe(true)
  })

  it('still resolves when a hydrator fails', async () => {
    const el = sheet()
    const failing = { hydrate: async () => Promise.reject(new Error('no vega')) }
    await expect(renderPreview(el, 'x', [failing, settled])).resolves.toBeUndefined()
    expect(el.textContent).toContain('x')
  })

  it('gives up waiting on a hydrator that never settles, keeping what rendered', async () => {
    vi.useFakeTimers()
    try {
      const el = sheet()
      const stuck = { hydrate: () => new Promise<void>(() => {}) }
      let done = false
      const p = renderPreview(el, '# Kept', [stuck], { timeoutMs: 5000 }).then(() => (done = true))
      await vi.advanceTimersByTimeAsync(4999)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await p
      expect(done).toBe(true)
      expect(el.querySelector('h1')?.textContent).toBe('Kept')
    } finally {
      vi.useRealTimers()
    }
  })

  it('defaults the wait to five seconds', () => {
    expect(HYDRATE_TIMEOUT_MS).toBe(5000)
  })

  it('says so when only the start of a large file is shown', async () => {
    const el = sheet()
    const mb = 1024 * 1024
    await renderPreview(el, '# Start', [settled], { totalBytes: 12.5 * mb, shownBytes: 5 * mb })
    const note = el.querySelector('.quicklook-truncated')
    expect(note?.textContent).toBe(
      'This file is 12.5 MB. Quick Look shows the first 5 MB; open it in Halmos Editor to see the rest.',
    )
    expect(el.firstElementChild).toBe(note)
    expect(el.querySelector('h1')?.textContent).toBe('Start')
  })

  it('adds no note when the whole file is shown', async () => {
    const el = sheet()
    await renderPreview(el, '# All', [settled], { totalBytes: 100, shownBytes: 100 })
    await renderPreview(el, '# All', [settled])
    expect(el.querySelector('.quicklook-truncated')).toBeNull()
  })

  it('stands an image in by its file name instead of loading it', async () => {
    const el = sheet()
    await renderPreview(el, '![](images/my%20plot.png)', [settled])
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('.quicklook-image')?.textContent).toBe('[Image: my plot.png]')
  })

  it('keeps an inline data image, which loads nothing', async () => {
    const el = sheet()
    const src = 'data:image/png;base64,iVBORw0KGgo='
    await renderPreview(el, `![dot](${src})`, [settled])
    expect(el.querySelector('img')?.getAttribute('src')).toBe(src)
  })
})
