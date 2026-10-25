// Charts and Mermaid diagrams for a Word export. Pandoc would print a
// `vega-lite` or `mermaid` block as its source, so each one the preview drew
// is sent as a PNG instead, with its caption as the image's alt text, which
// Pandoc makes the figure caption. LaTeX gets no images, so for it the
// blocks stay as code.

import { parseFrontmatter } from './frontmatter'
import { createMarkdownParser } from './markdownParser'
import { chartCaption, fenceLanguage } from './figures'
import { parseMermaidSource } from './mermaidSource'
import { canvasToPng, toPng } from './rasterise'

const md = createMarkdownParser()
const DIAGRAM_INFO = new Set(['vega-lite', 'mermaid'])

/**
 * diagramImages returns one entry per chart and diagram in the preview, in
 * document order — the order of the fences replaceDiagramFences walks — as
 * base64 PNG, or null for one that failed or has not drawn, so a broken
 * chart never shifts a later picture onto the wrong block.
 */
export async function diagramImages(root: HTMLElement): Promise<(string | null)[]> {
  const out: (string | null)[] = []
  for (const el of root.querySelectorAll<HTMLElement>('.vega-lite-chart, .mermaid-diagram')) {
    if (el.classList.contains('chart-error') || el.classList.contains('mermaid-error')) {
      out.push(null)
      continue
    }
    const canvas = el.querySelector('canvas')
    const svg = el.querySelector('svg')
    try {
      if (canvas) out.push(canvasToPng(canvas))
      else if (svg) {
        const xml = new XMLSerializer().serializeToString(svg)
        out.push(await toPng('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)))
      } else out.push(null)
    } catch {
      out.push(null)
    }
  }
  return out
}

function caption(info: string, content: string): string {
  const text = info === 'vega-lite' ? chartCaption(content) : parseMermaidSource(content).title
  return text.replace(/[[\]\\]/g, '\\$&')
}

/**
 * replaceDiagramFences swaps the nth chart or diagram block for its picture,
 * keyed `diagrams/<n>.png`. A null leaves the block as it is.
 */
export function replaceDiagramFences(
  markdown: string,
  images: (string | null)[],
): { markdown: string; images: Record<string, string> } {
  const { body } = parseFrontmatter(markdown)
  const head = markdown.slice(0, markdown.length - body.length)
  const fences = md
    .parse(body, {})
    .filter((t) => t.type === 'fence' && t.map && DIAGRAM_INFO.has(fenceLanguage(t.info)))
  // One picture per block, matched by position. If the preview drew a
  // different number than the text has — it was edited and has not caught
  // up — no picture can be trusted to land on its own block.
  if (images.length !== fences.length) return { markdown, images: {} }
  const lines = body.split('\n')
  const keyed: { key: string; png: string }[] = []
  // Last first, so earlier line numbers still hold while splicing.
  for (let n = fences.length - 1; n >= 0; n--) {
    const png = images[n]
    if (!png) continue
    const t = fences[n]
    const [start, end] = t.map!
    const indent = /^\s*/.exec(lines[start])?.[0] ?? ''
    const key = `diagrams/${n + 1}.png`
    lines.splice(start, end - start, `${indent}![${caption(fenceLanguage(t.info), t.content)}](${key})`)
    keyed.unshift({ key, png })
  }
  return {
    markdown: head + lines.join('\n'),
    images: Object.fromEntries(keyed.map(({ key, png }) => [key, png])),
  }
}
