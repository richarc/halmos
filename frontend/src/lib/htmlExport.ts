// Export → Export HTML…: the rendered preview as one self-contained page.
//
// App.svelte imports this module dynamically, only when exporting, so neither
// it nor the KaTeX stylesheet and fonts it pulls in lazily are part of the
// startup bundle.
import { LOCAL_IMAGE_ROUTE } from './renderer'

export interface StandaloneOptions {
  /** Used when the document has no heading to take a title from. */
  title: string
  /** The body font's CSS stack, written as --doc-font-body on the sheet. */
  bodyFont: string
  /** The document's own rules; see documentCss. */
  css: string
  /** KaTeX's stylesheet with its fonts already embedded; see embedKatexFonts. */
  katexCss: string
  /** A local image as a data: URI, or null to leave its original source. */
  inlineImage: (src: string) => Promise<string | null>
}

/**
 * Appended after every other rule, so they win whatever the stylesheet says.
 * The page is always white paper in the light palette: the sepia tint and the
 * desk are on-screen chrome, not part of the document. Code blocks take the
 * print padding, since the copy button the screen padding makes room for is
 * not in the export.
 */
const EXPORT_RULES = `
html, body { margin: 0; background: #ffffff; }
.preview-pane { overflow: visible; background: none; }
.sheet { background: var(--doc-bg); box-shadow: none; }
.sheet pre { padding: 12px; }`

/**
 * Builds a complete HTML page from the preview's sheet. The live sheet is
 * cloned, never changed. Interactive UI and anything executable are removed;
 * local images become data: URIs; chart and diagram SVG stays inline.
 */
export async function buildStandaloneHTML(
  root: HTMLElement,
  opts: StandaloneOptions,
): Promise<string> {
  const sheet = root.cloneNode(true) as HTMLElement

  sheet.querySelectorAll('button, .code-copy, script').forEach((el) => el.remove())
  for (const el of [sheet, ...sheet.querySelectorAll('*')]) stripActiveAttributes(el)

  // fitMath's factor was measured against the preview pane's width, not the
  // page this will be read at; without it a wide formula scrolls instead.
  sheet.querySelectorAll<HTMLElement>('[style*="--math-fit"]').forEach((el) => {
    el.setAttribute('style', removeDeclaration(el.getAttribute('style') ?? '', '--math-fit'))
  })

  await Promise.all(
    [...sheet.querySelectorAll('img')].map(async (img) => {
      const original = localImageSource(img.getAttribute('src') ?? '')
      if (original === null) return
      const data = await opts.inlineImage(original).catch(() => null)
      img.setAttribute('src', data ?? original)
    }),
  )

  const style = removeDeclaration(sheet.getAttribute('style') ?? '', '--doc-font-body')
  sheet.setAttribute(
    'style',
    `${style}${style && !style.trimEnd().endsWith(';') ? '; ' : ''}--doc-font-body: ${opts.bodyFont}`,
  )

  const title = headingTitle(sheet) || opts.title
  const align = root.closest('[data-figure-align]')?.getAttribute('data-figure-align') ?? 'center'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
<style>
${opts.katexCss}
${opts.css}
${EXPORT_RULES}
</style>
</head>
<body>
<div class="preview-pane" data-figure-align="${escapeText(align)}">
${sheet.outerHTML}
</div>
</body>
</html>
`
}

const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])

/**
 * The title block's title, else the first real heading's text, as a title: not the contents list's own
 * "Contents" heading, maths as its TeX source (KaTeX renders it twice, once as
 * MathML and once as HTML, so plain textContent repeats it), and no footnote
 * markers.
 */
function headingTitle(sheet: HTMLElement): string {
  // The metadata title wins; the title block's own "Abstract" heading never
  // counts as a document heading.
  const heading =
    sheet.querySelector('.title-block-title') ??
    [...sheet.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(
      (h) => !h.closest('nav.toc') && !h.closest('.title-block'),
    )
  if (!heading) return ''
  const copy = heading.cloneNode(true) as Element
  copy.querySelectorAll('.footnote-ref').forEach((el) => el.remove())
  copy.querySelectorAll('.katex').forEach((el) => {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    el.replaceWith(tex ?? el.querySelector('.katex-html')?.textContent ?? '')
  })
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Removes inline event handlers and javascript: URLs. */
function stripActiveAttributes(el: Element): void {
  for (const { name, value } of [...el.attributes]) {
    const lower = name.toLowerCase()
    if (lower.startsWith('on') || (URL_ATTRIBUTES.has(lower) && /^\s*javascript:/i.test(value))) {
      el.removeAttribute(name)
    }
  }
}

/** A style attribute with every declaration of `prop` removed. */
function removeDeclaration(style: string, prop: string): string {
  return style
    .split(';')
    .filter((d) => d.trim() !== '' && d.split(':')[0].trim() !== prop)
    .map((d) => d.trim())
    .join('; ')
}

/**
 * The source as the document wrote it, for an image the preview rewrote onto
 * the local image route; null for any other image.
 */
function localImageSource(src: string): string | null {
  if (!src.startsWith(`${LOCAL_IMAGE_ROUTE}?`)) return null
  return new URLSearchParams(src.slice(src.indexOf('?') + 1)).get('src') ?? ''
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Selectors whose rules style the document rather than the app around it. */
const DOCUMENT_SELECTOR = /\.(sheet|preview-pane|chart-error|mermaid-error|cite-error)(?![\w-])/

/**
 * The rules from style.css an exported page needs: the reset, the light
 * palette, every rule that styles the sheet, and the whole print block (so the
 * page also prints like the PDF export; the chrome it hides is not in the
 * page, so those rules are inert). The dark and sepia palettes and the app's
 * own chrome are left out. Comments are dropped.
 */
export function documentCss(styleCss: string): string {
  return selectRules(styleCss.replace(/\/\*[\s\S]*?\*\//g, '')).join('\n')
}

function selectRules(css: string): string[] {
  const kept: string[] = []
  for (const { prelude, body } of splitRules(css)) {
    if (
      prelude === '@media print' ||
      prelude === '*' ||
      prelude === ':root' ||
      DOCUMENT_SELECTOR.test(prelude)
    ) {
      kept.push(`${prelude} {${body}}`)
    }
  }
  return kept
}

/** Top-level `prelude { body }` pairs, with nested braces kept in the body. */
function splitRules(css: string): { prelude: string; body: string }[] {
  const rules: { prelude: string; body: string }[] = []
  let start = 0
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    rules.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, j - 1) })
    start = i = j
  }
  return rules
}

/**
 * KaTeX's stylesheet with each @font-face pointing at its embedded WOFF2
 * (every browser that can open the page reads WOFF2), keyed by file name. A
 * face whose font is not supplied loses its src rather than keeping a
 * `url(fonts/…)` that would resolve against wherever the page is saved.
 */
export function embedKatexFonts(css: string, fonts: Record<string, string>): string {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (face) =>
    face.replace(/src:[^;}]*;?/, (src) => {
      const name = /url\(fonts\/([^)]+\.woff2)\)/.exec(src)?.[1]
      const data = name ? fonts[name] : undefined
      if (!data) return ''
      return `src:url(${data}) format("woff2")${src.endsWith(';') ? ';' : ''}`
    }),
  )
}

/**
 * The two stylesheets an export needs. KaTeX's CSS and fonts come from the
 * bundle through Vite (`?raw`, `?inline`), loaded here on first export only.
 * style.css lives in public/, which Vite will not import, so it is read from
 * the app's own asset server.
 */
export async function loadExportStyles(): Promise<{ css: string; katexCss: string }> {
  const fontModules = import.meta.glob<string>('../../node_modules/katex/dist/fonts/*.woff2', {
    query: '?inline',
    import: 'default',
  })
  const [katexRaw, fonts, styleCss] = await Promise.all([
    import('katex/dist/katex.min.css?raw').then((m) => m.default),
    Promise.all(
      Object.entries(fontModules).map(
        async ([path, load]) => [path.slice(path.lastIndexOf('/') + 1), await load()] as const,
      ),
    ).then(Object.fromEntries),
    fetch('/style.css').then((r) => {
      if (!r.ok) throw new Error(`could not read style.css (${r.status})`)
      return r.text()
    }),
  ])
  return { css: documentCss(styleCss), katexCss: embedKatexFonts(katexRaw, fonts) }
}
