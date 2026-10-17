// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, flushSync, type ComponentProps } from 'svelte'
import Preview from './Preview.svelte'
import type { Anchor } from './lib/scrollSync'

vi.mock('@wailsio/runtime', () => ({
  Browser: { OpenURL: vi.fn() },
  Clipboard: { SetText: vi.fn(() => Promise.resolve()) },
}))

const ANCHORS: Anchor[] = [
  { line: 10, top: 500 },
  { line: 20, top: 1500 },
]

interface PreviewApi {
  syncToLine(line: number, docLines: number): void
}

// A minimal stand-in for @testing-library/svelte's render(), which this
// project does not depend on: mount into a body-attached target, flush, and
// hand back the target as `container` — the one piece of its API the tests
// below need.
function render(Component: typeof Preview, options: { props: ComponentProps<typeof Preview> }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const cmp = mount(Component, { target: container, props: options.props })
  flushSync()
  return { container, cleanup: () => unmount(cmp as never) }
}

function mountPreview(html: string, anchors: Anchor[] = ANCHORS) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(Preview, {
    target,
    props: { html, collectAnchorsFn: () => anchors },
  }) as unknown as PreviewApi
  flushSync()
  const pane = target.querySelector('.preview-pane') as HTMLElement
  // jsdom reports scrollHeight as 0, so stub the one measurement the mapper
  // needs. scrollTop itself is stored and returned faithfully by jsdom.
  Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true })
  return { target, pane, preview: cmp, cleanup: () => unmount(cmp as never) }
}

describe('Preview.syncToLine', () => {
  it('scrolls to the interpolated offset for a line', () => {
    const { pane, preview, cleanup } = mountPreview('<p data-source-line="10">x</p>')
    preview.syncToLine(15, 40)
    expect(pane.scrollTop).toBe(1000)
    cleanup()
  })

  it('lands exactly on an anchor when the line matches one', () => {
    const { pane, preview, cleanup } = mountPreview('<p data-source-line="10">x</p>')
    preview.syncToLine(20, 40)
    expect(pane.scrollTop).toBe(1500)
    cleanup()
  })

  it('does not scroll when the document has no anchors', () => {
    const { pane, preview, cleanup } = mountPreview('<p>x</p>', [])
    preview.syncToLine(15, 40)
    expect(pane.scrollTop).toBe(0)
    cleanup()
  })
})

describe('Preview figure alignment', () => {
  it('publishes the alignment on the pane, in CSS spelling', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(Preview, {
      target,
      props: { html: '<p>x</p>', figureAlign: 'centre', collectAnchorsFn: () => [] },
    })
    flushSync()
    const pane = target.querySelector('.preview-pane') as HTMLElement
    // `centre` is Hermes' spelling; the stylesheet can only match `center`.
    expect(pane.dataset.figureAlign).toBe('center')
    unmount(cmp)
    target.remove()
  })

  it('defaults to centre when no alignment is supplied', () => {
    const { pane, cleanup } = mountPreview('<p>x</p>')
    expect(pane.dataset.figureAlign).toBe('center')
    cleanup()
  })

  it('renders the markdown into a sheet inside the scrolling pane', () => {
    const { container } = render(Preview, { props: { html: '<p>hello</p>' } })
    const pane = container.querySelector('.preview-pane')!
    const sheet = pane.querySelector('.sheet')!
    expect(sheet).not.toBeNull()
    expect(sheet.innerHTML).toBe('<p>hello</p>')
    // The pane is the scroller and must stay empty of document content of its
    // own, so scroll offsets keep meaning what scrollSync assumes.
    expect(pane.firstElementChild).toBe(sheet)
  })

  it('sizes the sheet from the paper and orientation', () => {
    const { container } = render(Preview, {
      props: { html: '', paperSize: 'a4', orientation: 'portrait' },
    })
    const sheet = container.querySelector('.sheet') as HTMLElement
    expect(sheet.style.getPropertyValue('--sheet-width')).toBe('210mm')
    expect(sheet.style.getPropertyValue('--sheet-margin')).toBe('11.905%')
    // The absolute cap travels with the percentage: percentage padding
    // resolves against the PANE, so on a pane wider than the paper the
    // percentage alone drew margins that grew with the window. See paper.ts.
    expect(sheet.style.getPropertyValue('--sheet-margin-max')).toBe('25mm')
  })

  it('resizes the sheet for landscape', () => {
    const { container } = render(Preview, {
      props: { html: '', paperSize: 'a4', orientation: 'landscape' },
    })
    const sheet = container.querySelector('.sheet') as HTMLElement
    expect(sheet.style.getPropertyValue('--sheet-width')).toBe('297mm')
    // Not the portrait percentage: a fixed one would print 25mm and draw 35mm.
    expect(sheet.style.getPropertyValue('--sheet-margin')).toBe('8.418%')
    // The cap does not vary with paper or orientation — it is the page
    // margin itself, which is one number for all four combinations.
    expect(sheet.style.getPropertyValue('--sheet-margin-max')).toBe('25mm')
  })

  it('keeps the alignment attribute on the pane, not the sheet', () => {
    // style.css matches .preview-pane[data-figure-align="…"] .sheet figure.
    // Moving the attribute would silently stop all three alignments working.
    const { container } = render(Preview, { props: { html: '', figureAlign: 'centre' } })
    expect(container.querySelector('.preview-pane')!.getAttribute('data-figure-align')).toBe('center')
    expect(container.querySelector('.sheet')!.hasAttribute('data-figure-align')).toBe(false)
  })
})

describe('in-document links', () => {
  it('scrolls the pane to the fragment target instead of navigating', async () => {
    const { target, pane, cleanup } = mountPreview(
      '<nav class="toc"><a href="#methods">Methods</a></nav><h1 id="methods">Methods</h1>',
    )
    const { Browser } = await import('@wailsio/runtime')
    const link = target.querySelector('a')!
    const heading = target.querySelector('#methods') as HTMLElement
    // jsdom has no layout: stand in for the two rects the scroll needs.
    heading.getBoundingClientRect = () => ({ top: 300 }) as DOMRect
    pane.getBoundingClientRect = () => ({ top: 100 }) as DOMRect

    const notPrevented = link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )

    expect(notPrevented).toBe(false) // handled, not left to navigate
    expect(Browser.OpenURL).not.toHaveBeenCalled()
    expect(pane.scrollTop).toBe(200)
    cleanup()
  })

  it('ignores a fragment with no matching id', async () => {
    const { target, pane, cleanup } = mountPreview('<a href="#missing">gone</a>')
    const { Browser } = await import('@wailsio/runtime')
    pane.scrollTop = 40
    target.querySelector('a')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(Browser.OpenURL).not.toHaveBeenCalled()
    expect(pane.scrollTop).toBe(40)
    cleanup()
  })
})

describe('code block copy button', () => {
  const PY = '<pre><code class="language-python" data-source-line="1">print(1)</code></pre>'

  afterEach(() => vi.useRealTimers())

  it('adds a Copy button to highlighted code blocks only', () => {
    const { target, cleanup } = mountPreview(
      PY +
        '<div class="vega-lite-chart" data-spec="{}"></div>' +
        '<div class="mermaid-diagram" data-source="graph TD"></div>',
    )
    const buttons = target.querySelectorAll('button.code-copy')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe('Copy')
    expect(buttons[0].closest('pre')).not.toBeNull()
    cleanup()
  })

  it('copies the source text, not highlighted HTML', async () => {
    const { Clipboard } = await import('@wailsio/runtime')
    const { target, cleanup } = mountPreview(
      '<pre><code class="language-html">&lt;script&gt;a &amp;&amp; b&lt;/script&gt;</code></pre>',
    )
    // Simulate the hydrator's output: spans around the same text.
    const code = target.querySelector('code')!
    code.innerHTML = '<span class="tok-keyword">&lt;script&gt;</span>a &amp;&amp; b&lt;/script&gt;'
    target.querySelector<HTMLButtonElement>('button.code-copy')!.click()
    expect(Clipboard.SetText).toHaveBeenLastCalledWith('<script>a && b</script>')
    cleanup()
  })

  it('shows Copied then reverts after 1500 ms', async () => {
    vi.useFakeTimers()
    const { target, cleanup } = mountPreview(PY)
    const btn = target.querySelector<HTMLButtonElement>('button.code-copy')!
    btn.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(btn.textContent).toBe('Copied')
    await vi.advanceTimersByTimeAsync(1499)
    expect(btn.textContent).toBe('Copied')
    await vi.advanceTimersByTimeAsync(1)
    expect(btn.textContent).toBe('Copy')
    cleanup()
  })
})

describe('Preview body font', () => {
  async function sheetStyle(props: Record<string, unknown>) {
    const { BODY_FONTS } = await import('./lib/bodyFont')
    const r = render(Preview, { props: { html: '<p>x</p>', ...props } as never })
    const sheet = r.container.querySelector('.sheet') as HTMLElement
    const value = sheet.style.getPropertyValue('--doc-font-body')
    r.cleanup()
    return { value, BODY_FONTS }
  }

  it('sets --doc-font-body from the BodyFont setting', async () => {
    const { value, BODY_FONTS } = await sheetStyle({ bodyFont: 'charter' })
    expect(value).toBe(BODY_FONTS.charter)
  })

  it('defaults to the New York stack', async () => {
    const { value } = await sheetStyle({})
    expect(value).toBe("ui-serif, 'New York', Georgia, serif")
  })

  it('falls back to the default for an unknown key', async () => {
    const { value, BODY_FONTS } = await sheetStyle({ bodyFont: 'comic' })
    expect(value).toBe(BODY_FONTS['new-york'])
  })
})
