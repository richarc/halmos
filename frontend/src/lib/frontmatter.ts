import { isMap, isScalar, parseDocument, Scalar } from 'yaml'

// The reference formatting keys (lib/styleOptions.ts). Listed here as
// literals, not imported, so this module stays free of DOM code; a test
// checks the two lists agree.
const STYLE_OPTION_KEYS_LIST = [
  'citation-et-al-min',
  'citation-et-al-use-first',
  'citation-et-al-subsequent-min',
  'citation-et-al-subsequent-use-first',
  'citation-et-al-use-last',
  'bibliography-et-al-min',
  'bibliography-et-al-use-first',
  'bibliography-et-al-use-last',
] as const

export interface Author {
  name: string
  affiliation?: string
}

export interface Frontmatter {
  body: string
  bibliography?: string
  csl?: string
  /** Raw values; lib/toc.ts owns their interpretation. */
  toc?: string
  'toc-depth'?: string
  /** Export PDF's running header and footer; lib/pageFurniture.ts. */
  header?: string
  footer?: string
  /** Raw values; lib/styleOptions.ts owns their interpretation. */
  'citation-et-al-min'?: string
  'citation-et-al-use-first'?: string
  'citation-et-al-subsequent-min'?: string
  'citation-et-al-subsequent-use-first'?: string
  'citation-et-al-use-last'?: string
  'bibliography-et-al-min'?: string
  'bibliography-et-al-use-first'?: string
  'bibliography-et-al-use-last'?: string
  /** Title block, with Pandoc's meanings (`author` is read as `authors`). */
  title?: string
  /** Shown exactly as written. */
  date?: string
  authors?: Author[]
  abstract?: string
  /** 1-based document line of the abstract's first text line. */
  abstractLine?: number
  /**
   * 1-based line of the original document on which `body` starts. The renderer
   * passes markdown-it only the body, so its line numbers are body-relative;
   * scroll-sync anchors must be document-absolute to line up with the editor.
   */
  bodyStartLine: number
}

const KNOWN_KEYS = [
  'bibliography',
  'csl',
  'toc',
  'toc-depth',
  'header',
  'footer',
  ...STYLE_OPTION_KEYS_LIST,
] as const

// A leading block fenced by lines of exactly ---, accepting either line ending
// so documents authored on Windows parse the same as ones authored on Unix.
// Requiring the closing fence to end its own line keeps a longer rule such as
// ---- from terminating the block early. The inner group is optional so an
// empty block still parses.
export const BLOCK_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

export function parseFrontmatter(markdown: string): Frontmatter {
  const match = BLOCK_RE.exec(markdown)
  if (!match) return { body: markdown, bodyStartLine: 1 }

  const result: Frontmatter = {
    body: markdown.slice(match[0].length),
    // match[0] ends with the newline after the closing fence, so the number of
    // complete lines it consumes is its newline count.
    bodyStartLine: match[0].split('\n').length,
  }
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    const key = m[1] as (typeof KNOWN_KEYS)[number]
    if (!KNOWN_KEYS.includes(key)) continue
    result[key] = unquote(m[2])
  }
  readMetadata(match[1] ?? '', result)
  return result
}

/** True when the document asks for a title block: any of the four keys is set. */
export function hasTitleBlock(fm: Pick<Frontmatter, 'title' | 'authors' | 'date' | 'abstract'>): boolean {
  return fm.title !== undefined || fm.authors !== undefined || fm.date !== undefined || fm.abstract !== undefined
}

/**
 * Reads title, author, date and abstract from the block as YAML. The six keys
 * above stay on the line parser, which accepts text that is not valid YAML
 * (`footer: Page {page}: draft`); a block that does not parse as YAML loses
 * only this metadata. The `core` schema keeps `date: 2026-10-26` a string.
 */
function readMetadata(text: string, out: Frontmatter): void {
  const doc = parseDocument(text, { schema: 'core' })
  if (doc.errors.length || !isMap(doc.contents)) return

  const str = (key: string): string | undefined => {
    const node = doc.get(key, true)
    if (!isScalar(node)) return undefined
    const v: unknown = node.value
    if (typeof v === 'string') return v.trim() || undefined
    // A number is shown as typed: String(2026.10) would say "2026.1".
    if (typeof v === 'number' && node.range) return text.slice(node.range[0], node.range[1]).trim() || undefined
    return undefined
  }
  const title = str('title')
  if (title) out.title = title
  const date = str('date')
  if (date) out.date = date

  const author: unknown = doc.get('author')
  const plain = (author as { toJSON?: () => unknown } | null)?.toJSON?.() ?? author
  const items: unknown[] = Array.isArray(plain) ? plain : [plain]
  const authors: Author[] = []
  for (const item of items) {
    const name = typeof item === 'string' ? item : (item as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || !name.trim()) continue
    const affiliation = typeof item === 'object' && item ? (item as { affiliation?: unknown }).affiliation : undefined
    authors.push(
      typeof affiliation === 'string' && affiliation.trim()
        ? { name: name.trim(), affiliation: affiliation.trim() }
        : { name: name.trim() },
    )
  }
  if (authors.length) out.authors = authors

  const node = doc.get('abstract', true)
  if (isScalar(node) && typeof node.value === 'string' && (node.value as string).trim()) {
    out.abstract = node.value as string
    if (node.range) {
      // Lines in the block start at document line 2; a block scalar's text
      // begins on the line after its `|` or `>` header.
      const before = text.slice(0, node.range[0]).split('\n').length - 1
      const header = node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED
      out.abstractLine = before + 2 + (header ? 1 : 0)
    }
  }
}

/**
 * A value with its surrounding quotes removed, or, when it is not quoted,
 * with a trailing YAML comment removed. YAML's rule: `#` starts a comment
 * only after whitespace, so `refs#2.bib` is a name and `true  # note` is
 * `true`. The new-document template relies on this — its guidance for
 * `toc:` sits on the same line as the value, and the line has to work as
 * soon as its leading `#` is deleted (issue #8).
 */
function unquote(raw: string): string {
  const quoted = raw.match(/^(["'])(.*)\1$/)
  // Inside double quotes `\\` and `\"` are escapes (what frontmatterKeyChange
  // writes); single-quoted text is taken literally, as before.
  if (quoted) return quoted[1] === '"' ? quoted[2].replace(/\\(["\\])/g, '$1') : quoted[2]
  return raw.replace(/\s+#.*$/, '').trim()
}

/**
 * The edit that sets `key: value` in a document's frontmatter, as a
 * CodeMirror-style change against `doc`: the key's line is replaced, or a new
 * line goes before the closing fence, or a block is created at the top. The
 * document's own line ending (CRLF or LF) is used for anything inserted.
 *
 * The value is double-quoted only when plain YAML would misread it: it
 * contains `:` or `#`, starts or ends with a space, starts or ends with a
 * quote character (parseFrontmatter would strip it), or is empty. Quotes and
 * backslashes inside are escaped, and parseFrontmatter unescapes them, so the
 * value reads back unchanged.
 */
export function frontmatterKeyChange(
  doc: string,
  key: string,
  value: string,
): { from: number; to: number; insert: string } {
  const eol = doc.includes('\r\n') ? '\r\n' : '\n'
  const needsQuotes = value === '' || /[:#]/.test(value) || /^\s|\s$/.test(value) || /^["']|["']$/.test(value)
  const text = needsQuotes ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value
  const line = `${key}: ${text}`

  const match = BLOCK_RE.exec(doc)
  if (!match) return { from: 0, to: 0, insert: `---${eol}${line}${eol}---${eol}` }

  // Walk the block's lines by offset; the closing fence is the last line the
  // match consumed (its trailing line ending, if any, stays outside the line).
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  // The LAST matching line, because that is the one parseFrontmatter reads.
  let offset = 0
  let found: { from: number; to: number } | null = null
  const lines = match[0].split(/(?<=\n)/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const content = raw.replace(/\r?\n$/, '')
    if (i > 0 && i < lines.length - 1 && keyRe.test(content)) found = { from: offset, to: offset + content.length }
    offset += raw.length
  }
  if (found) return { ...found, insert: line }
  // No such key: insert before the closing fence line.
  const closing = lines[lines.length - 1]
  return { from: match[0].length - closing.length, to: match[0].length - closing.length, insert: line + eol }
}
