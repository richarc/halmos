// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderPreview, type Hydrator } from './quicklookPreview'

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
})
