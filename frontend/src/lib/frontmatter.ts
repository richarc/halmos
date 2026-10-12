export interface Frontmatter {
  body: string
  bibliography?: string
  csl?: string
  /** Raw values; lib/toc.ts owns their interpretation. */
  toc?: string
  'toc-depth'?: string
  /**
   * 1-based line of the original document on which `body` starts. The renderer
   * passes markdown-it only the body, so its line numbers are body-relative;
   * scroll-sync anchors must be document-absolute to line up with the editor.
   */
  bodyStartLine: number
}

const KNOWN_KEYS = ['bibliography', 'csl', 'toc', 'toc-depth'] as const

// A leading block fenced by lines of exactly ---, accepting either line ending
// so documents authored on Windows parse the same as ones authored on Unix.
// Requiring the closing fence to end its own line keeps a longer rule such as
// ---- from terminating the block early. The inner group is optional so an
// empty block still parses.
const BLOCK_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

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
  return result
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
  if (quoted) return quoted[2]
  return raw.replace(/\s+#.*$/, '').trim()
}

/**
 * The edit that sets `key: value` in a document's frontmatter, as a
 * CodeMirror-style change against `doc`: the key's line is replaced, or a new
 * line goes before the closing fence, or a block is created at the top. The
 * document's own line ending (CRLF or LF) is used for anything inserted.
 *
 * The value is double-quoted only when plain YAML would misread it: it
 * contains `:` or `#`, starts or ends with a space, or is empty. Quotes and
 * backslashes inside are escaped.
 */
export function frontmatterKeyChange(
  doc: string,
  key: string,
  value: string,
): { from: number; to: number; insert: string } {
  const eol = doc.includes('\r\n') ? '\r\n' : '\n'
  const needsQuotes = value === '' || /[:#]/.test(value) || /^\s|\s$/.test(value)
  const text = needsQuotes ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value
  const line = `${key}: ${text}`

  const match = BLOCK_RE.exec(doc)
  if (!match) return { from: 0, to: 0, insert: `---${eol}${line}${eol}---${eol}` }

  // Walk the block's lines by offset; the closing fence is the last line the
  // match consumed (its trailing line ending, if any, stays outside the line).
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  let offset = 0
  const lines = match[0].split(/(?<=\n)/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const content = raw.replace(/\r?\n$/, '')
    if (i > 0 && i < lines.length - 1 && keyRe.test(content)) {
      return { from: offset, to: offset + content.length, insert: line }
    }
    offset += raw.length
  }
  // No such key: insert before the closing fence line.
  const closing = lines[lines.length - 1]
  return { from: match[0].length - closing.length, to: match[0].length - closing.length, insert: line + eol }
}
