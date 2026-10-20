// Builds and checks the body of a Word or LaTeX export (POST
// /services/convert on the Halmos portal; hermesportal
// docs/api/device-flow.md §3). Everything the service would refuse is caught
// here first where it can be, because a refusal the document caused is
// charged to the person's seat.

import { parseFrontmatter } from './frontmatter'
import { createMarkdownParser } from './markdownParser'
import { findCitationKeys } from './citationKeys'
import { trimBibliography } from './bibTrim'

export type ExportFormat = 'docx' | 'latex'

export interface ImageRef {
  src: string
  key: string
}

export interface ResolvedImage {
  key: string
  src: string
  ext: 'png' | 'jpg' | 'gif' | null
}

export type ExportProblem = {
  code:
    | 'markdown_size' | 'bibliography_size' | 'csl_size' | 'csl_dtd'
    | 'image_count' | 'image_size' | 'images_total' | 'body_size' | 'nesting'
  line?: number
}

export interface ConvertBody {
  format: ExportFormat
  markdown: string
  bibliography?: string
  csl?: string
  images?: Record<string, string>
}

const MiB = 1024 * 1024
const LIMITS = {
  markdown: 2 * MiB,
  bibliography: 2 * MiB,
  csl: 256 * 1024,
  imageCount: 50,
  image: 8 * MiB,
  imagesTotal: 16 * MiB,
  body: 25 * MiB,
  nesting: 6,
}

// Marks a planned key until finalizeImages knows the image's real type: the
// key's extension must match the bytes, which only Go can read.
const PENDING = '.halmos-pending'

const md = createMarkdownParser()

const IMAGE_RE = /!\[((?:[^\]\\\n]|\\.)*)\]\(\s*(<[^>\n]*>|[^)\s]+)((?:\s+"[^"\n]*")?)\s*\)/g

function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

// isLocal is a path beside the document: not a URL, not data:, not absolute.
function isLocal(src: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/') && !src.startsWith('#')
}

/**
 * planImages rewrites the document's local image references for an export.
 * For Word, each distinct image gets a key the service accepts
 * (`images/<n>`, finished by finalizeImages once its type is known): real
 * file names may hold spaces or accents, which the service refuses. For
 * LaTeX, which gets no images, references keep their paths so the .tex
 * saved beside the document finds the files; only a leading `./` goes.
 * Images in code and in front matter are never touched, and nothing is read
 * for a document that has never been saved, since its paths resolve nowhere.
 */
export function planImages(
  markdown: string,
  format: ExportFormat,
  hasDocPath: boolean,
): { markdown: string; refs: ImageRef[] } {
  if (format === 'docx' && !hasDocPath) return { markdown, refs: [] }
  const { body } = parseFrontmatter(markdown)
  const head = markdown.slice(0, markdown.length - body.length)
  const tokens = md.parse(body, {})
  const codeLines = new Set<number>()
  const sources = new Set<string>()
  for (const t of tokens) {
    if ((t.type === 'fence' || t.type === 'code_block') && t.map) {
      for (let l = t.map[0]; l < t.map[1]; l++) codeLines.add(l)
    }
    for (const c of t.children ?? []) {
      if (c.type === 'image') sources.add(safeDecode(c.attrGet('src') ?? ''))
    }
  }
  const keys = new Map<string, string>()
  const refs: ImageRef[] = []
  const lines = body.split('\n').map((line, i) => {
    if (codeLines.has(i)) return line
    return line.replace(IMAGE_RE, (whole, alt: string, dest: string, title: string) => {
      const bracketed = dest.startsWith('<')
      const raw = bracketed ? dest.slice(1, -1) : dest
      if (!sources.has(safeDecode(raw)) && !sources.has(safeDecode(encodeURI(raw)))) return whole
      if (!isLocal(raw)) return whole
      const path = raw.replace(/^\.\//, '')
      if (format === 'latex') {
        return `![${alt}](${bracketed ? `<${path}>` : path}${title})`
      }
      let key = keys.get(path)
      if (!key) {
        key = `images/${keys.size + 1}`
        keys.set(path, key)
        refs.push({ src: path, key })
      }
      return `![${alt}](${key}${PENDING}${title})`
    })
  })
  return { markdown: head + lines.join('\n'), refs }
}

/**
 * finalizeImages gives each planned key its extension, or, for an image
 * that could not be read, puts the original reference back: the service
 * renders an image it was not sent as its caption.
 */
export function finalizeImages(markdown: string, resolved: ResolvedImage[]): string {
  let out = markdown
  for (const r of resolved) {
    const original = /\s/.test(r.src) ? `<${r.src}>` : r.src
    const target = r.ext ? `${r.key}.${r.ext}` : original
    out = out.split(`(${r.key}${PENDING}`).join(`(${target}`)
  }
  return out
}

/**
 * bracketDepthProblem finds the first paragraph whose `[` nest deeper than
 * the service allows, by its rule: only a line of nothing but spaces and
 * tabs starts afresh, `\[` does not count, and brackets in code do. Its
 * citation parser costs exponentially in nesting, so it refuses the rest.
 */
export function bracketDepthProblem(markdown: string): { line: number } | null {
  let depth = 0
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^[ \t]*$/.test(line)) {
      depth = 0
      continue
    }
    for (let j = 0; j < line.length; j++) {
      const c = line[j]
      if (c === '\\') {
        j++
      } else if (c === '[') {
        depth++
        if (depth > LIMITS.nesting) return { line: i + 1 }
      } else if (c === ']') {
        depth = Math.max(0, depth - 1)
      }
    }
  }
  return null
}

const encoder = new TextEncoder()
const bytes = (s: string) => encoder.encode(s).length

function decodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}

/** checkRequest returns the first limit the body breaks, or null. */
export function checkRequest(body: ConvertBody): ExportProblem | null {
  if (bytes(body.markdown) > LIMITS.markdown) return { code: 'markdown_size' }
  if (body.bibliography && bytes(body.bibliography) > LIMITS.bibliography) return { code: 'bibliography_size' }
  if (body.csl && bytes(body.csl) > LIMITS.csl) return { code: 'csl_size' }
  if (body.csl && /<!(DOCTYPE|ENTITY)/i.test(body.csl)) return { code: 'csl_dtd' }
  const images = Object.values(body.images ?? {})
  if (images.length > LIMITS.imageCount) return { code: 'image_count' }
  let total = 0
  for (const b64 of images) {
    const n = decodedLength(b64)
    if (n > LIMITS.image) return { code: 'image_size' }
    total += n
  }
  if (total > LIMITS.imagesTotal) return { code: 'images_total' }
  if (bytes(JSON.stringify(body)) > LIMITS.body) return { code: 'body_size' }
  const nesting = bracketDepthProblem(body.markdown)
  if (nesting) return { code: 'nesting', line: nesting.line }
  return null
}

/**
 * buildBibliography cuts the .bib down to the entries the document cites,
 * as the service recommends. Undefined when there is nothing to send.
 */
export function buildBibliography(markdown: string, bibText: string): string | undefined {
  if (!bibText) return undefined
  const keys = new Set(findCitationKeys(markdown).map((k) => k.key))
  const trimmed = trimBibliography(bibText, keys)
  return trimmed || undefined
}

/**
 * withReferencesHeading ends the document with the References heading the
 * preview draws: Pandoc puts the reference list at the end with no heading
 * of its own. A document that places the list itself with a `{#refs}` div
 * is left alone, since Pandoc fills that div instead.
 */
export function withReferencesHeading(markdown: string): string {
  if (/\{\s*#refs\s*\}/.test(markdown)) return markdown
  return `${markdown.replace(/\s*$/, '')}\n\n## References {.unnumbered}\n`
}
