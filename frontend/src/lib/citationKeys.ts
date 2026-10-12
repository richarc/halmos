import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { citationPlugin, KEY_RE } from './citations'
import { parseFrontmatter } from './frontmatter'

export interface KeySpan {
  key: string
  /** Offset of the key's first character, after the `@`. */
  from: number
  to: number
}

// The recogniser runs the real citation rules, so it cannot disagree with the
// preview about what is a citation or where code, links and emails stop one.
// markdown-it records no source positions, but citationPlugin stamps each
// citation token's meta with the inline source it matched in and the range, so
// the tokens that survive backtracking carry their own positions.
const md = new MarkdownIt({ html: false }).use(citationPlugin)

/** Same as the trim in citations.ts `parseKey`: trailing . : # ? are prose. */
function keyAt(text: string): string {
  const m = text.match(KEY_RE)
  return m ? m[0].replace(/[.:#?]+$/, '') : ''
}

function isCitation(t: Token): boolean {
  return t.type === 'citation' || t.type === 'citation_narrative'
}

function collectCitations(tokens: Token[] | null, out: Token[] = []): Token[] {
  for (const t of tokens ?? []) {
    if (isCitation(t)) out.push(t)
    else collectCitations(t.children, out)
  }
  return out
}

/** Start offset of every line, split the way markdown-it splits them. */
function lineStarts(text: string): number[] {
  const starts = [0]
  const re = /\r\n?|\n/g
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push(m.index + m[0].length)
  return starts
}

const isBlank = (c: string) => c === ' ' || c === '\t'

/**
 * Maps each index of an inline token's content to its index in the document.
 * The content is the block's source with per-line prefixes removed (quote
 * markers, list indents, `#`, table pipes), so it is a subsequence of the
 * block's lines; walk both, skipping source characters that are not in it.
 */
function align(content: string, text: string, from: number, to: number): Int32Array {
  const map = new Int32Array(content.length + 1).fill(-1)
  let s = from
  for (let c = 0; c < content.length; c++) {
    while (s < to && text[s] !== content[c] && !(isBlank(text[s]) && isBlank(content[c]))) s++
    if (s >= to) break
    map[c] = s++
  }
  return map
}

interface Match {
  src: string
  start: number
  end: number
}

function keysIn(m: Match): { key: string; at: number }[] {
  if (m.src[m.start] === '@') {
    return [{ key: keyAt(m.src.slice(m.start + 1, m.end)), at: m.start + 1 }]
  }
  const out: { key: string; at: number }[] = []
  let offset = m.start + 1
  for (const part of m.src.slice(m.start + 1, m.end - 1).split(';')) {
    const at = part.indexOf('@')
    if (at !== -1) out.push({ key: keyAt(part.slice(at + 1)), at: offset + at + 1 })
    offset += part.length + 1
  }
  return out
}

/**
 * Every citation key in `text` with its exact offsets, as the preview reads
 * them (so none inside code, links' destinations, emails or frontmatter).
 * Parses the whole input with markdown-it: call it on a line or a visible
 * range, never per keystroke on a full document.
 */
export function findCitationKeys(text: string): KeySpan[] {
  const { body } = parseFrontmatter(text)
  if (!body.trim()) return []
  const shift = text.length - body.length
  const tokens = md.parse(body, {})
  const starts = lineStarts(body)
  const spans: KeySpan[] = []
  let map: [number, number] | null = null
  // Cells of one table row share a source line; each starts where the last
  // one ended, so a later cell cannot reuse characters an earlier one matched.
  let cursor = 0
  for (const token of tokens) {
    if (token.map && token.map !== map) {
      map = token.map
      cursor = starts[map[0]] ?? 0
    }
    if (token.type !== 'inline') continue
    if (!map) continue
    const hi = starts[map[1]] ?? body.length
    const where = align(token.content, body, cursor, hi)
    for (let c = token.content.length - 1; c >= 0; c--) {
      if (where[c] >= 0) {
        cursor = where[c] + 1
        break
      }
    }
    for (const t of collectCitations(token.children)) {
      const m = t.meta as Match
      // Image alt text is parsed on its own, so its positions are relative to
      // that substring rather than to the whole inline content.
      const base = m.src === token.content ? 0 : token.content.indexOf(m.src)
      if (base === -1) continue
      for (const { key, at } of keysIn(m)) {
        const from = where[base + at]
        if (key && from !== undefined && from >= 0) {
          spans.push({ key, from: shift + from, to: shift + from + key.length })
        }
      }
    }
  }
  return spans
}

/**
 * Citations whose key `has` rejects, in document order, one per occurrence,
 * with 1-based lines. Same cost as findCitationKeys: not for every keystroke
 * on a full document.
 */
export function unknownCitations(
  text: string,
  has: (key: string) => boolean,
): { key: string; line: number }[] {
  const out: { key: string; line: number }[] = []
  let line = 1
  let seen = 0
  for (const span of findCitationKeys(text)) {
    if (has(span.key)) continue
    for (; seen < span.from; seen++) if (text[seen] === '\n') line++
    out.push({ key: span.key, line })
  }
  return out
}
