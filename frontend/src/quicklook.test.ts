// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountQuickLook } from './quicklook'
import { createChartHydrator, type EmbedFn } from './lib/charts'
import { createMermaidHydrator } from './lib/mermaid'
import { createCodeHydrator } from './lib/codeHighlight'
import { markdown as markdownLanguage } from '@codemirror/lang-markdown'
import type { Hydrator } from './lib/quicklookPreview'

// The page Quick Look loads, driven the way PreviewViewController.swift drives
// it: window.renderMarkdown(text, info). Mermaid and Vega need real layout,
// which jsdom lacks, so those two get the injected render/embed the hydrators
// already accept; everything else is the real pipeline.

const noEmbed: EmbedFn = async () => null

function mount(hydrators: Hydrator[] = [createChartHydrator(noEmbed)]): HTMLElement {
  const sheet = document.createElement('div')
  document.body.replaceChildren(sheet)
  mountQuickLook(sheet, hydrators)
  return sheet
}

afterEach(() => vi.restoreAllMocks())

describe('the Quick Look page', () => {
  it('sizes the sheet as a page', () => {
    const sheet = mount()
    expect(sheet.getAttribute('style')).toContain('width')
  })

  it('renders headings', async () => {
    const sheet = mount()
    await window.renderMarkdown('# Title\n\n## Section\n\nText')
    expect(sheet.querySelector('h1')?.textContent).toBe('Title')
    expect(sheet.querySelector('h2')?.textContent).toBe('Section')
  })

  it('renders maths with KaTeX', async () => {
    const sheet = mount()
    await window.renderMarkdown('Inline $x^2$ and\n\n$$\\int_0^1 f$$\n')
    expect(sheet.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2)
  })

  it('renders task lists as disabled checkboxes', async () => {
    const sheet = mount()
    await window.renderMarkdown('- [ ] open\n- [x] done\n')
    const boxes = sheet.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')
    expect(boxes).toHaveLength(2)
    expect(boxes[1].checked).toBe(true)
    expect(boxes[0].disabled).toBe(true)
  })

  it('renders alerts', async () => {
    const sheet = mount()
    await window.renderMarkdown('> [!WARNING]\n> Careful.\n')
    expect(sheet.querySelector('.markdown-alert-warning .markdown-alert-title')?.textContent).toBe(
      'Warning',
    )
  })

  it('highlights a fenced code block', async () => {
    const sheet = mount([createCodeHydrator(async () => markdownLanguage().language.parser)])
    await window.renderMarkdown('```markdown\n[text](url "title")\n```\n')
    const code = sheet.querySelector('pre code')!
    expect(code.querySelectorAll('span').length).toBeGreaterThan(0)
    expect(code.textContent).toContain('[text](url "title")')
  })

  it('leaves a vega-lite placeholder for the chart hydrator', async () => {
    const embedded: string[] = []
    const embed: EmbedFn = async (_el, spec) => (embedded.push(spec), null)
    const sheet = mount([createChartHydrator(embed)])
    await window.renderMarkdown('```vega-lite\n{"mark":"bar"}\n```\n')
    expect(sheet.querySelector('.vega-lite-chart')).not.toBeNull()
    expect(embedded).toHaveLength(1)
    expect(JSON.parse(embedded[0]).mark).toBe('bar')
  })

  it('shows a broken chart as the same error card the app shows', async () => {
    // The real embedChart: invalid JSON fails before vega-embed is imported.
    const sheet = mount([createChartHydrator()])
    await window.renderMarkdown('```vega-lite\n{not json\n```\n')
    const card = sheet.querySelector('.vega-lite-chart.chart-error')
    expect(card?.textContent).toMatch(/^Chart error: Invalid JSON/)
  })

  it('shows a broken diagram as the same error card the app shows', async () => {
    const failing = async () => Promise.reject(new Error('Parse error on line 1'))
    const sheet = mount([createMermaidHydrator(failing)])
    await window.renderMarkdown('```mermaid\nflowchart ->\n```\n')
    const card = sheet.querySelector('.mermaid-diagram.mermaid-error')
    expect(card?.textContent).toBe('Diagram error: Parse error on line 1')
  })

  it('shows citations as their raw keys', async () => {
    const sheet = mount()
    await window.renderMarkdown('---\nbibliography: refs.bib\n---\n\nAs shown [@smith2020].\n')
    expect(sheet.textContent).toContain('@smith2020')
    expect(sheet.querySelector('#references, .references, .csl-bib-body')).toBeNull()
  })

  it('never fetches anything and never requests a local image', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network')))
    vi.stubGlobal('fetch', fetchSpy)
    const sheet = mount([
      createChartHydrator(noEmbed),
      createMermaidHydrator(async () => '<svg></svg>'),
      createCodeHydrator(async () => markdownLanguage().language.parser),
    ])
    // Every <img> with a source that was ever attached to the page — an
    // image is requested as soon as it is, so stripping it afterwards would
    // be too late. Records are collected synchronously at the end.
    const loaded: string[] = []
    const collect = (records: MutationRecord[]) => {
      for (const r of records)
        for (const n of Array.from(r.addedNodes)) {
          if (!(n instanceof Element)) continue
          for (const img of [n, ...Array.from(n.querySelectorAll('img'))]) {
            if (img instanceof HTMLImageElement && img.hasAttribute('src')) loaded.push(img.src)
          }
        }
    }
    const seen = new MutationObserver(collect)
    seen.observe(sheet, { childList: true, subtree: true })

    await window.renderMarkdown(
      '![Figure](figure.png)\n\n![Remote](https://example.com/a.png)\n\n```mermaid\nflowchart LR\n```\n',
    )
    collect(seen.takeRecords())
    seen.disconnect()
    vi.unstubAllGlobals()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(loaded).toEqual([])
    // Stood in for by its file name, so the reader knows something is there.
    expect(sheet.textContent).toContain('figure.png')
    expect(sheet.textContent).toContain('a.png')
  })
})
