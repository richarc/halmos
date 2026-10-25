// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('./rasterise', () => ({
  toPng: vi.fn(async (uri: string) => `png-of-${uri.slice(0, 26)}`),
  canvasToPng: vi.fn(() => 'png-of-canvas'),
}))

import { diagramImages, replaceDiagramFences } from './exportDiagrams'

function sheet(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('diagramImages', () => {
  it('gives one entry per chart or diagram, in document order', async () => {
    const root = sheet(`
      <div class="vega-lite-chart"><canvas></canvas></div>
      <figure><div class="mermaid-diagram" data-hydrated><svg xmlns="http://www.w3.org/2000/svg"></svg></div></figure>
      <div class="vega-lite-chart chart-error">Bad spec</div>`)
    const got = await diagramImages(root)
    expect(got).toHaveLength(3)
    expect(got[0]).toBe('png-of-canvas')
    expect(got[1]).toMatch(/^png-of-data:image\/svg\+xml/)
    expect(got[2]).toBeNull()
  })

  it('keeps fence order when a chart failed', async () => {
    const root = sheet(`
      <div class="vega-lite-chart chart-error"></div>
      <div class="vega-lite-chart"><canvas></canvas></div>
      <div class="mermaid-diagram mermaid-error"></div>
      <div class="mermaid-diagram"></div>`)
    expect(await diagramImages(root)).toEqual([null, 'png-of-canvas', null, null])
  })
})

const CHART = '```vega-lite\n{"title": "Growth", "mark": "bar"}\n```'
const CHART_OBJ_TITLE = '```vega-lite\n{"title": {"text": "Rates"}, "mark": "line"}\n```'
const MERMAID = '```mermaid\n---\ntitle: Flow\n---\ngraph TD; A-->B\n```'

describe('replaceDiagramFences', () => {
  it('turns each rendered diagram into an image with its caption', () => {
    const md = `# T\n\n${CHART}\n\nText\n\n${MERMAID}\n`
    const { markdown, images } = replaceDiagramFences(md, ['AAA', 'BBB'])
    expect(markdown).toBe('# T\n\n![Growth](diagrams/1.png)\n\nText\n\n![Flow](diagrams/2.png)\n')
    expect(images).toEqual({ 'diagrams/1.png': 'AAA', 'diagrams/2.png': 'BBB' })
  })

  it('leaves a fence whose diagram did not render', () => {
    const md = `${CHART}\n\n${CHART_OBJ_TITLE}\n`
    const { markdown, images } = replaceDiagramFences(md, ['AAA', null])
    expect(markdown).toBe(`![Growth](diagrams/1.png)\n\n${CHART_OBJ_TITLE}\n`)
    expect(images).toEqual({ 'diagrams/1.png': 'AAA' })
  })

  it('uses a title object’s text, and leaves other code blocks alone', () => {
    const md = '```js\nlet x = 1\n```\n\n' + CHART_OBJ_TITLE + '\n'
    const { markdown } = replaceDiagramFences(md, ['AAA'])
    expect(markdown).toBe('```js\nlet x = 1\n```\n\n![Rates](diagrams/1.png)\n')
  })

  it('finds a fence whose opening line carries a label', () => {
    const md = '```vega-lite {#fig:a}\n{"title": "Growth", "mark": "bar"}\n```\n'
    const { markdown, images } = replaceDiagramFences(md, ['AAA'])
    expect(markdown).toBe('![Growth](diagrams/1.png)\n')
    expect(images).toEqual({ 'diagrams/1.png': 'AAA' })
  })

  it('sends no pictures when the preview and the text disagree on how many there are', () => {
    const md = `${CHART}\n\n${MERMAID}\n`
    expect(replaceDiagramFences(md, ['AAA'])).toEqual({ markdown: md, images: {} })
  })

  it('counts a fence inside a list item in order', () => {
    const md = `- item\n\n  ${CHART.replace(/\n/g, '\n  ')}\n\n${MERMAID}\n`
    const { images, markdown } = replaceDiagramFences(md, ['AAA', 'BBB'])
    expect(Object.keys(images)).toEqual(['diagrams/1.png', 'diagrams/2.png'])
    expect(markdown).toContain('  ![Growth](diagrams/1.png)')
    expect(markdown).toContain('![Flow](diagrams/2.png)')
  })
})
