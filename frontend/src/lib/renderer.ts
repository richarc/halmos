import katex from 'katex'
import Token from 'markdown-it/lib/token.mjs'
import { outlinePlugin, type OutlineEntry } from './outline'
import { tocPlugin, tocNavHtml, tocDepth, type TocEnv, DEFAULT_TOC_DEPTH } from './toc'
import { parseFrontmatter, hasTitleBlock } from './frontmatter'
import { titleBlockHtml } from './titleBlock'
import type { CitationFormatter, CitationCluster } from './citations'
import { createMarkdownParser } from './markdownParser'
import {
  chartWidthPx,
  fenceLanguage,
  figureLabel,
  figureOf,
  figurePlugin,
  type ChartWidth,
  type FigureMeta,
} from './figures'
import { parseMermaidSource } from './mermaidSource'
import { createKatexCache } from './katexCache'
import { tableCaptionPlugin } from './tableCaptions'
import { equationPlugin } from './equations'
import { referenceText, type CrossrefTarget, type TargetMeta } from './crossrefs'
import { crossrefPlugin, keyLabel, type CrossrefEnv, type CrossrefMeta, type DuplicateLabel, type MissingReference } from './crossrefTargets'
import { tutorialTasksPlugin } from './tutorialTasks'

/**
 * The per-render environment markdown-it threads through to the rules. Typed
 * once here rather than cast at each use: the fence renderer reads the chart
 * width out of it, and the source_line rule reads the frontmatter offset.
 */
interface RenderEnv extends TocEnv, CrossrefEnv {
  citations?: CitationCluster[]
  outline?: OutlineEntry[]
  sourceLineOffset: number
  chartWidthPx: number
  /** Absolute path of the open document; '' when it has never been saved. */
  docPath: string
  /** markdown-it-footnote's prefix for footnote ids. */
  docId?: string
}

// Everything that decides what is a citation (linkify, KaTeX, footnotes, the
// citation rules) comes from createMarkdownParser, which the editor's
// recognisers share; only rendering concerns are added here.
//
// errorColor only decides the .katex-error class exists — KaTeX writes it as
// an inline `color` style, which style.css's `.sheet .katex-error` rule
// overrides with !important so the document palette still wins.
//
// `katex` is the plugin's hook for the renderer it calls: a memoising front
// (katexCache.ts) so a formula is typeset once and every later render of the
// unchanged document reads it back. Module-level like `md` itself, so the
// cache lives as long as the app.
const md = createMarkdownParser({
  throwOnError: false,
  errorColor: '#cc0000',
  katex: createKatexCache(katex),
})

// Stamp every top-level block with the document line it starts on, for scroll
// sync to anchor against. Only level-0 tokens carry a `map`; inline tokens do
// not, which is what keeps this off spans and emphasis.
//
// `env.sourceLineOffset` corrects for the frontmatter that render() strips
// before markdown-it ever sees the text — without it every anchor in a
// document with frontmatter is short by that block's length.
md.core.ruler.push('source_line', (state) => {
  const offset = (state.env as RenderEnv).sourceLineOffset
  for (const token of state.tokens) {
    if (token.level === 0 && token.map) {
      token.attrSet('data-source-line', String(token.map[0] + 1 + offset))
    }
  }
  return true
})

// Pushed after source_line so a paragraph that becomes a <figure> already
// carries its anchor, and the retag carries it along.
md.use(figurePlugin)
md.use(tableCaptionPlugin)
md.use(equationPlugin)
// After the three rules above, whose stamps it collects.
md.use(crossrefPlugin)
// After crossrefPlugin: a ref-* task ticks only when its reference resolves.
md.use(tutorialTasksPlugin)
md.use(outlinePlugin)
// After outlinePlugin, so a future consumer of both sees consistent data;
// after source_line always, since it reads the stamps.
md.use(tocPlugin)

/**
 * A document-relative image source is rewritten onto the local-image route.
 *
 * The webview loads the embedded frontend bundle, so `![](fig1.png)` would
 * otherwise fetch fig1.png from that bundle rather than from beside the
 * document — which is precisely what it did until this existed. The route
 * carries the document and the source separately so Go resolves the pair with
 * resolveAgainstDoc, the same rule `bibliography:` uses.
 *
 * The token's attribute is rewritten and the default renderer still does the
 * rendering, so markdown-it's own attribute escaping continues to apply.
 */
const defaultImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src') ?? ''
  const doc = (env as RenderEnv).docPath
  // No document means nothing to resolve against — an unsaved document is in
  // the same position as one naming a `bibliography:` before it is saved.
  if (doc && isDocumentRelative(src)) {
    token.attrSet(
      'src',
      `${LOCAL_IMAGE_ROUTE}?doc=${encodeURIComponent(doc)}&src=${encodeURIComponent(decodePath(src))}`,
    )
  }
  return defaultImage(tokens, idx, options, env, self)
}

/**
 * The real filesystem path behind a markdown link destination.
 *
 * markdown-it percent-encodes destinations before a renderer ever sees them,
 * so `my figure.png` arrives as `my%20figure.png`. Encoding that again for the
 * query string would send `%2520` and have Go look for a file literally named
 * `my%20figure.png` — which is what the first version of this did. Decoding
 * first restores the name on disk. A malformed escape is left as written
 * rather than throwing; it will simply fail to resolve, like any other bad
 * path.
 */
function decodePath(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

/** Kept in step with `localImageRoute` in localimages.go. */
export const LOCAL_IMAGE_ROUTE = '/_hermes/image'

/**
 * Whether a source names a file on disk rather than somewhere else entirely.
 *
 * Anything carrying a scheme (`https:`, `data:`, `file:`), a protocol-relative
 * `//host`, or a bare fragment is left exactly as written — remote images
 * already worked and are the only kind the test corpus had before this.
 */
function isDocumentRelative(src: string): boolean {
  if (src === '') return false
  if (src.startsWith('//') || src.startsWith('#')) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(src)
}

/**
 * A reference reads as `Figure 2`, linked to the first label it names.
 * Rendering runs after every core rule, so a reference above its target
 * resolves. A group mixing references and citations shows its raw text.
 */
md.renderer.rules.crossref = (tokens, idx, _options, env) => {
  const token = tokens[idx]
  const meta = token.meta as CrossrefMeta
  const lookup = (env as RenderEnv).crossrefLookup
  if (meta.mixed) return `<span class="crossref-error">${md.utils.escapeHtml(token.content)}</span>`
  const { text, missing } = referenceText(meta.keys, (label) => lookup?.get(label))
  if (missing) return `<span class="crossref-error">${md.utils.escapeHtml(text)}</span>`
  const href = md.utils.escapeHtml(`#${keyLabel(meta.keys[0])}`)
  return `<a class="crossref" href="${href}">${md.utils.escapeHtml(text)}</a>`
}

const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const info = fenceLanguage(tokens[idx].info)
  if (info === 'vega-lite') return renderChartFence(tokens[idx], env as RenderEnv)
  if (info === 'mermaid') return renderMermaidFence(tokens[idx])
  return defaultFence(tokens, idx, options, env, self)
}

/**
 * Wraps a chart's or diagram's child markup in a <figure>, with the anchor
 * moved onto the figure and a numbered caption appended.
 *
 * The anchor moves ONTO the <figure> and must not stay on the child:
 * collectAnchors takes every [data-source-line] as an anchor, and two at
 * different offsets for one source line is a degenerate segment for
 * previewOffsetForLine to interpolate across.
 */
function wrapAsFigure(anchor: string, child: string, figure: FigureMeta): string {
  const caption = md.utils.escapeHtml(figureLabel(figure.number, figure.caption))
  const id = figure.label ? ` id="${md.utils.escapeHtml(figure.label)}"` : ''
  return `<figure${anchor}${id}>` + child + `<figcaption>${caption}</figcaption>` + `</figure>\n`
}

function renderChartFence(token: Token, env: RenderEnv): string {
  // This branch builds its own HTML and never calls renderAttrs, so the
  // anchor the core rule set on the token has to be written out by hand.
  // Charts are the largest source of height divergence — the very reason
  // anchors beat a scroll ratio — so losing theirs would gut the feature.
  const anchor = ` data-source-line="${md.utils.escapeHtml(token.attrGet('data-source-line') ?? '')}"`
  const figure = figureOf(token)
  const spec = md.utils.escapeHtml(
    rewriteChartSpec(token.content.trim(), env.chartWidthPx, figure !== null),
  )
  if (!figure) return `<div class="vega-lite-chart"${anchor} data-spec="${spec}"></div>\n`

  return wrapAsFigure(anchor, `<div class="vega-lite-chart" data-spec="${spec}"></div>`, figure)
}

/**
 * A mermaid fence becomes a placeholder for the hydrator to fill.
 *
 * The source is stamped in with its frontmatter title removed: Mermaid draws
 * a title into the SVG, and the caption below is where Hermes wants it.
 */
function renderMermaidFence(token: Token): string {
  const anchor = ` data-source-line="${md.utils.escapeHtml(token.attrGet('data-source-line') ?? '')}"`
  const source = md.utils.escapeHtml(parseMermaidSource(token.content).body)
  const figure = figureOf(token)
  if (!figure) return `<div class="mermaid-diagram"${anchor} data-source="${source}"></div>\n`

  return wrapAsFigure(anchor, `<div class="mermaid-diagram" data-source="${source}"></div>`, figure)
}

/**
 * Render-time only: the document's text is never touched, so the chart
 * builder still reads the block's raw spec out of the editor. `title` and
 * `width` are both in chartSpec.ts's passthrough allowlist, which is what
 * makes a builder round trip preserve them and an author's own `"width": 300`
 * keep beating the document default.
 *
 * The title TEXT is removed when the caption is being drawn below the chart —
 * otherwise Vega-Lite draws it inside the SVG as well and it appears twice.
 * Only `text` comes out: a title object can also carry a `subtitle` (and
 * styling properties), and captionFromTitle only ever reads `text` for the
 * figure caption, so deleting the whole key would silently take the subtitle
 * with it — it would appear neither in the SVG nor in the caption, with
 * nothing to tell the author. Vega-Lite's own schema marks `text` required on
 * a title object, so a bare `{"subtitle":...}` is not strictly schema-valid —
 * but this project's bundled Vega-Lite (checked against its compile step)
 * does not validate specs against that schema and does not draw a title group
 * at all when `text` is absent, subtitle included, so this cannot regress a
 * working chart into a visible error card. It is the least-bad option: the
 * subtitle at least survives into data-spec instead of being destroyed
 * outright, even though it goes undrawn until the author gives the title back
 * a `text`.
 *
 * An object left with nothing but `text` collapses to `delete spec.title`,
 * same as a bare string title, rather than emitting an empty `{}`.
 *
 * Anything that is not a JSON object is returned verbatim, so a malformed
 * spec still reaches the hydrator's error card unchanged.
 */
function rewriteChartSpec(text: string, widthPx: number, stripTitle: boolean): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return text
  const spec = { ...(parsed as Record<string, unknown>) }
  if (stripTitle) {
    const title = spec.title
    if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
      const rest = { ...(title as Record<string, unknown>) }
      delete rest.text
      if (Object.keys(rest).length > 0) spec.title = rest
      else delete spec.title
    } else {
      delete spec.title
    }
  }
  // `{"width":null}` reads as the author explicitly setting a width — an
  // author's own choice always wins over the document default, `null`
  // included — even though it is the one input where that produces a spec
  // Vega-Lite may not accept. Deliberate, not an oversight.
  if (!('width' in spec)) spec.width = widthPx
  return JSON.stringify(spec)
}

// Same problem, same fix, for display math (`$$…$$`): @vscode/markdown-it-katex
// installs its own `math_block` renderer that builds a `<p class="katex-block">`
// from tokens[idx].content by hand and never calls renderAttrs, so the anchor
// the core rule set above is silently dropped. Captured after the KaTeX plugin was applied
// so this wraps whatever renderer the plugin actually installed, not a guess at
// its name — this project doesn't pass enableFencedBlocks or enableBareBlocks,
// so math_block is the only katex renderer that ever emits block-level output.
const defaultMathBlock = md.renderer.rules.math_block!
md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
  const line = tokens[idx].attrGet('data-source-line')
  const rendered = defaultMathBlock(tokens, idx, options, env, self)
  // A labelled equation gets a wrapper that carries the id, the number and
  // the anchor, so the anchor appears once and the inner <p> stays bare.
  const target = tokens[idx].meta?.target as TargetMeta | undefined
  if (target?.label) {
    const anchor = line ? ` data-source-line="${md.utils.escapeHtml(line)}"` : ''
    const number = target.number != null ? `<span class="equation-number">(${target.number})</span>` : ''
    return `<div class="equation" id="${md.utils.escapeHtml(target.label)}"${anchor}>${rendered}${number}</div>\n`
  }
  if (!line) return rendered
  return rendered.replace(/^<p /, `<p data-source-line="${md.utils.escapeHtml(line)}" `)
}

export interface RenderOptions {
  formatter?: CitationFormatter
  /** Document-wide default width; a spec's own `width` still wins. */
  chartWidth?: ChartWidth
  /**
   * Absolute path of the open document. Image sources are resolved against
   * its folder; an unsaved document has none, so they are left as written.
   */
  docPath?: string | null
}

export interface RenderResult {
  html: string
  /** The document's headings, for the outline panel. */
  outline: OutlineEntry[]
  /**
   * Cross-reference targets in document order, references that miss, and
   * targets whose label an earlier one already has.
   */
  crossrefs: { targets: CrossrefTarget[]; missing: MissingReference[]; duplicates: DuplicateLabel[] }
}

/** render() for callers that only want the HTML — every test and most rules. */
export function render(markdown: string, opts?: RenderOptions): string {
  return renderDocument(markdown, opts).html
}

export function renderDocument(markdown: string, opts?: RenderOptions): RenderResult {
  const fm = parseFrontmatter(markdown)
  const { body, bodyStartLine } = fm
  const env: RenderEnv = {
    sourceLineOffset: bodyStartLine - 1,
    chartWidthPx: chartWidthPx(opts?.chartWidth),
    docPath: opts?.docPath ?? '',
    tocEnabled: fm.toc === 'true',
    tocDepth: tocDepth(fm['toc-depth']),
  }
  // The abstract is parsed apart from the body, so its headings, footnotes,
  // contents entries and figures stay out of the body's. Only the citation
  // list is shared, and the abstract is parsed first, so its clusters are
  // numbered ahead of the body's in reading order. Its tokens are rendered
  // after the body, once the body's targets are known: references resolve at
  // render time from crossrefLookup, which each parse overwrites.
  const titled = hasTitleBlock(fm)
  let abstract: { tokens: Token[]; env: RenderEnv } | null = null
  if (titled && fm.abstract !== undefined) {
    env.citations = []
    const absEnv: RenderEnv = {
      sourceLineOffset: (fm.abstractLine ?? 1) - 1,
      chartWidthPx: env.chartWidthPx,
      docPath: env.docPath,
      citations: env.citations,
      // Prefixes the abstract's footnote ids, which would otherwise repeat
      // the body's fn1, fn2.
      docId: 'abstract',
    }
    abstract = { tokens: md.parse(fm.abstract, absEnv), env: absEnv }
  }
  let html = md.render(body, env)
  // A ToC asked for but not placed by a [[toc]] marker goes at the top.
  if (env.tocEnabled && !env.tocPlaced) {
    const depth = env.tocDepth ?? DEFAULT_TOC_DEPTH
    const listed = (env.tocItems ?? []).filter((it) => it.entry.level <= depth)
    html = tocNavHtml(listed, 1) + html
  }
  const outline = env.outline ?? []
  let abstractHtml: string | undefined
  let abstractMissing: MissingReference[] = []
  if (abstract) {
    // The abstract's own parse checked its references against the abstract
    // alone; one that the body's targets satisfy is not a miss.
    const lookup = env.crossrefLookup
    abstractMissing = (abstract.env.crossrefMissing ?? []).filter((m) => !lookup?.has(keyLabel(m.key)))
    abstract.env.crossrefLookup = lookup
    abstractHtml = md.renderer.render(abstract.tokens, md.options, abstract.env)
  }
  const crossrefs = {
    targets: env.crossrefTargets ?? [],
    missing: [...abstractMissing, ...(env.crossrefMissing ?? [])],
    duplicates: env.crossrefDuplicates ?? [],
  }
  const clusters = env.citations ?? []
  const formatter = opts?.formatter
  // markdown-it-footnote appends its block to the end of the body. Cut it off
  // so References can go between the text and the notes, and anchor it to the
  // document's last line the way the References heading is.
  const docLines = markdown.split(/\r\n?|\n/).length
  const sepAt = html.indexOf('<hr class="footnotes-sep">')
  let notes = ''
  if (sepAt >= 0) {
    notes = html
      .slice(sepAt)
      .replace('<section class="footnotes"', `<section class="footnotes" data-source-line="${docLines}"`)
    html = html.slice(0, sepAt)
  }
  // Prepended after the footnotes are cut off, so the abstract's own notes
  // (which end the abstract) are not mistaken for the body's.
  if (titled) {
    html =
      titleBlockHtml(
        { title: fm.title, authors: fm.authors, date: fm.date, abstractHtml },
        // A citation in the title is left as written. The citation rule
        // still emits a placeholder, numbered from 0 in this throwaway env,
        // so it is unwrapped here; formatCitations would otherwise fill it
        // with the body's first citation. The placeholder's text is already
        // escaped.
        (s) => md.renderInline(s, {}).replace(/<span class="citation" data-cite-index="\d+">(.*?)<\/span>/gs, '$1'),
        md.utils.escapeHtml,
      ) + html
  }
  if (!formatter || clusters.length === 0) return { html: html + notes, outline, crossrefs }

  const { texts, bibliographyHtml } = formatter.format(
    clusters.map((c) => (resolvable(formatter, c) ? c : { items: [] })),
  )
  // Citations inside a footnote are formatted too, so the replacement runs
  // over the notes as well as the body.
  const formatCitations = (fragment: string) => fragment.replace(
    // The s flag matters: a hard-wrapped citation group keeps its newline in
    // the placeholder, and without it the group renders as raw markup.
    /<span class="citation" data-cite-index="(\d+)">(.*?)<\/span>/gs,
    (whole, idx: string, raw: string) => {
      const i = Number(idx)
      const cluster = clusters[i]
      if (!cluster || !resolvable(formatter, cluster)) {
        const marked = cluster
          ? cluster.items
              .map(
                (it) =>
                  `[@${md.utils.escapeHtml(it.key)}${formatter.has(it.key) ? '' : '?'}]`,
              )
              .join(' ')
          : md.utils.escapeHtml(raw)
        return `<span class="cite-error">${marked}</span>`
      }
      return `<span class="citation">${texts[i]}</span>`
    },
  )
  html = formatCitations(html)
  notes = formatCitations(notes)
  if (clusters.some((c) => resolvable(formatter, c))) {
    // Anchor the appended heading to the document's last line, so the
    // bibliography's height (often substantial) doesn't collapse into a
    // single interpolated interval hanging off the last real anchor.
    html += `<h2 data-source-line="${docLines}">References</h2>\n${bibliographyHtml}\n`
  }
  return { html: html + notes, outline, crossrefs }
}

/**
 * The title as plain text, for places that cannot show markup: emphasis is
 * flattened to its words and maths reads as its TeX source.
 */
export function plainTitle(title: string): string {
  const tokens = md.parseInline(title, {})[0]?.children ?? []
  // renderInlineAsText skips token types it does not know, maths among them.
  const flat = tokens.map((t) => {
    if (!t.type.startsWith('math_inline')) return t
    const text = new Token('text', '', 0)
    text.content = t.content
    return text
  })
  return md.renderer.renderInlineAsText(flat, md.options, {})
}

function resolvable(f: CitationFormatter, c: CitationCluster): boolean {
  return c.items.length > 0 && c.items.every((it) => f.has(it.key))
}
