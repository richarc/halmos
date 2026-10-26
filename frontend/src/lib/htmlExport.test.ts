// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStandaloneHTML, documentCss, embedKatexFonts } from './htmlExport'

const here = fileURLToPath(import.meta.url)
const STYLE_CSS = readFileSync(join(here, '../../../public/style.css'), 'utf8')
const KATEX_CSS = readFileSync(join(here, '../../../node_modules/katex/dist/katex.min.css'), 'utf8')

/** A preview pane and sheet as Preview.svelte renders them, holding `body`. */
function previewSheet(body: string): HTMLElement {
  const pane = document.createElement('div')
  pane.className = 'preview-pane'
  pane.setAttribute('data-figure-align', 'center')
  const sheet = document.createElement('div')
  sheet.className = 'sheet'
  sheet.setAttribute(
    'style',
    "--sheet-width: 210mm; --doc-font-body: ui-serif, 'New York', Georgia, serif",
  )
  sheet.innerHTML = body
  pane.appendChild(sheet)
  document.body.appendChild(pane)
  return sheet
}

const noImages = async () => null

function opts(over: Partial<Parameters<typeof buildStandaloneHTML>[1]> = {}) {
  return {
    title: 'paper',
    bodyFont: 'Charter, Georgia, serif',
    css: '.sheet { color: var(--doc-fg); }',
    katexCss: '.katex { font: normal 1.21em KaTeX_Main; }',
    inlineImage: noImages,
    ...over,
  }
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('buildStandaloneHTML', () => {
  it('produces a full document with a title from the first heading', async () => {
    const root = previewSheet('<p>intro</p><h2 id="a">On <em>Things</em> &amp; Stuff</h2><h1>Later</h1>')
    const html = await buildStandaloneHTML(root, opts())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    const doc = parse(html)
    expect(doc.querySelector('meta[charset]')?.getAttribute('charset')).toBe('utf-8')
    expect(doc.title).toBe('On Things & Stuff')
    expect(doc.querySelectorAll('style')).toHaveLength(1)
    expect(doc.querySelector('.sheet h2')?.textContent).toBe('On Things & Stuff')
    // The figure alignment travels with the page.
    expect(doc.querySelector('.preview-pane')?.getAttribute('data-figure-align')).toBe('center')
  })

  it('takes the title from the first real heading, not the contents list', async () => {
    const root = previewSheet(
      '<nav class="toc"><h2>Contents</h2><ul><li><a href="#r">Results</a></li></ul></nav><h1 id="r">Results</h1>',
    )
    expect(parse(await buildStandaloneHTML(root, opts())).title).toBe('Results')
  })

  it('titles a heading with inline maths by its TeX, once', async () => {
    const root = previewSheet(
      '<h1>Energy <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow>' +
        '<annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span>' +
        '<span class="katex-html" aria-hidden="true"><span class="base">E=mc2</span></span></span> bound</h1>',
    )
    expect(parse(await buildStandaloneHTML(root, opts())).title).toBe('Energy E=mc^2 bound')
  })

  it('titles the page by the title block, not a later heading or the abstract heading', async () => {
    const root = previewSheet(
      '<header class="title-block"><h1 class="title-block-title">My Paper</h1>' +
        '<section class="title-block-abstract"><h2 class="title-block-abstract-heading">Abstract</h2><p>x</p></section></header>' +
        '<h1>Intro</h1>',
    )
    expect(parse(await buildStandaloneHTML(root, opts())).title).toBe('My Paper')
  })

  it('titles the metadata title with maths by its TeX', async () => {
    const root = previewSheet(
      '<header class="title-block"><h1 class="title-block-title">Energy <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow>' +
        '<annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span>' +
        '<span class="katex-html" aria-hidden="true"><span class="base">E=mc2</span></span></span></h1></header>',
    )
    expect(parse(await buildStandaloneHTML(root, opts())).title).toBe('Energy E=mc^2')
  })

  it('leaves footnote markers out of the title', async () => {
    const root = previewSheet(
      '<h1>Method<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup></h1>',
    )
    const doc = parse(await buildStandaloneHTML(root, opts()))
    expect(doc.title).toBe('Method')
    // Only the title is cleaned; the heading itself keeps its marker.
    expect(doc.querySelector('.sheet h1 .footnote-ref')).not.toBeNull()
  })

  it('falls back to the given title when there is no heading', async () => {
    const root = previewSheet('<p>just prose</p>')
    const doc = parse(await buildStandaloneHTML(root, opts({ title: 'notes <draft>' })))
    expect(doc.title).toBe('notes <draft>')
  })

  it('contains no <script> and no on* attributes', async () => {
    const root = previewSheet(
      '<p onclick="steal()">x</p><script>alert(1)</script>' +
        '<div class="mermaid-diagram"><svg onload="x()"><script>y()</script><g></g></svg></div>' +
        '<a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a>' +
        '<img alt="javascript: the good parts" src="https://example.com/cover.png">',
    )
    const html = await buildStandaloneHTML(root, opts())
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/\son[a-z]+=/i)
    expect(html).not.toMatch(/href="javascript:/i)
    // Only URLs are checked for javascript:, so prose in an alt survives.
    expect(parse(html).querySelector('img')?.getAttribute('alt')).toBe('javascript: the good parts')
    expect(parse(html).querySelector('a[href="https://example.com"]')).not.toBeNull()
  })

  it('inlines local images as data URIs and keeps remote URLs', async () => {
    const root = previewSheet(
      '<p><img alt="a" src="/_hermes/image?doc=%2Fp%2Fpaper.md&amp;src=images%2Fmy%20fig.png"></p>' +
        '<p><img alt="b" src="https://example.com/remote.png"></p>',
    )
    const inlineImage = vi.fn(async (src: string) => `data:image/png;base64,${btoa(src)}`)
    const doc = parse(await buildStandaloneHTML(root, opts({ inlineImage })))
    expect(inlineImage).toHaveBeenCalledTimes(1)
    expect(inlineImage).toHaveBeenCalledWith('images/my fig.png')
    const [local, remote] = doc.querySelectorAll('img')
    expect(local.getAttribute('src')).toBe(`data:image/png;base64,${btoa('images/my fig.png')}`)
    expect(remote.getAttribute('src')).toBe('https://example.com/remote.png')
  })

  it('keeps the original src when a local image cannot be read', async () => {
    const root = previewSheet('<img alt="a" src="/_hermes/image?doc=%2Fp%2Fpaper.md&amp;src=fig.png">')
    const doc = parse(await buildStandaloneHTML(root, opts()))
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('fig.png')
  })

  it('contains no /_hermes/image URLs', async () => {
    const root = previewSheet(
      '<img src="/_hermes/image?doc=%2Fp%2Fa.md&amp;src=a.png">' +
        '<img src="/_hermes/image?doc=%2Fp%2Fa.md&amp;src=b.png">',
    )
    const inlineImage = async (src: string) => (src === 'a.png' ? 'data:image/png;base64,AA==' : null)
    const html = await buildStandaloneHTML(root, opts({ inlineImage }))
    expect(html).not.toContain('/_hermes/image')
  })

  it('keeps chart SVG inline', async () => {
    const root = previewSheet(
      '<div class="vega-lite-chart" data-spec="{}"><svg class="marks" width="10" height="10"><rect width="5" height="5"></rect></svg></div>',
    )
    const doc = parse(await buildStandaloneHTML(root, opts()))
    expect(doc.querySelector('.vega-lite-chart svg rect')).not.toBeNull()
  })

  it('removes copy buttons', async () => {
    const root = previewSheet(
      '<pre><code>let x = 1</code><button type="button" class="code-copy">Copy</button></pre>' +
        '<span class="code-copy">Copy</span>',
    )
    const html = await buildStandaloneHTML(root, opts())
    expect(html).not.toContain('code-copy"')
    expect(html).not.toMatch(/<button/i)
    expect(parse(html).querySelector('pre code')?.textContent).toBe('let x = 1')
  })

  it('leaves the live preview untouched', async () => {
    const root = previewSheet('<pre><code>x</code><button class="code-copy">Copy</button></pre>')
    await buildStandaloneHTML(root, opts())
    expect(root.querySelector('button.code-copy')).not.toBeNull()
  })

  it('embeds KaTeX fonts as data URIs (no url(fonts/…) left)', async () => {
    const fonts = { 'KaTeX_Main-Regular.woff2': 'data:font/woff2;base64,TUFJTg==' }
    const katexCss = embedKatexFonts(KATEX_CSS, fonts)
    expect(katexCss).not.toContain('url(fonts/')
    expect(katexCss).toContain('url(data:font/woff2;base64,TUFJTg==) format("woff2")')
    // The rest of KaTeX's stylesheet survives.
    expect(katexCss).toContain('.katex{')
    const html = await buildStandaloneHTML(previewSheet('<p>x</p>'), opts({ katexCss }))
    expect(html).not.toContain('url(fonts/')
    expect(html).toContain('data:font/woff2;base64,TUFJTg==')
  })

  it('uses the chosen body font and white paper', async () => {
    const root = previewSheet('<p>x</p>')
    const html = await buildStandaloneHTML(root, opts({ css: documentCss(STYLE_CSS) }))
    const doc = parse(html)
    const style = doc.querySelector('.sheet')?.getAttribute('style') ?? ''
    expect(style).toContain('--doc-font-body: Charter, Georgia, serif')
    expect(style).not.toContain('New York')
    const css = doc.querySelector('style')?.textContent ?? ''
    expect(css).toMatch(/\.sheet\s*\{[^}]*background:\s*var\(--doc-bg\)/)
    expect(css).toMatch(/body\s*\{[^}]*background:\s*#ffffff/)
  })

  it('gives code blocks the print padding, after the screen rule', async () => {
    const html = await buildStandaloneHTML(previewSheet('<pre><code>x</code></pre>'), opts({ css: documentCss(STYLE_CSS) }))
    const css = parse(html).querySelector('style')?.textContent ?? ''
    const screen = css.indexOf('padding: 12px 4.5em 12px 12px')
    // The print block restores 12px too, but only for print; the page needs
    // it on screen, so a rule must follow the whole print block.
    const flats = [...css.matchAll(/\.sheet pre\s*\{\s*padding:\s*12px;?\s*\}/g)]
    const flat = flats.at(-1)?.index ?? -1
    expect(screen).toBeGreaterThan(-1)
    expect(flat).toBeGreaterThan(css.indexOf('@page'))
  })
})

describe('documentCss', () => {
  const css = documentCss(STYLE_CSS)

  it('keeps the light palette and the sheet rules', () => {
    expect(css).toContain('--sheet-paper: #ffffff')
    expect(css).toContain('--doc-alert-note:')
    expect(css).toContain('.sheet .markdown-alert-note')
    expect(css).toContain('.sheet ul.task-list-container')
    expect(css).toContain('.sheet .vega-lite-chart svg')
    expect(css).toContain('[data-figure-align="center"] figure')
    expect(css).toContain('.cite-error')
  })

  it('drops the dark and sepia palettes and the app chrome', () => {
    expect(css).not.toContain('data-theme')
    expect(css).not.toContain('.toolbar {')
    expect(css).not.toContain('.chart-builder')
    expect(css).not.toMatch(/^dialog/m)
    expect(css).not.toMatch(/^button/m)
  })

  it('keeps the print rules', () => {
    expect(css).toMatch(/@media print\s*\{/)
    expect(css).toContain('@page')
    expect(css).toMatch(/h1, h2, h3 \{ break-after: avoid; \}/)
  })

  it('carries no comments', () => {
    expect(css).not.toContain('/*')
  })
})
