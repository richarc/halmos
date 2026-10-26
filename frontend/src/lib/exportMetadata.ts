// The copy of a document sent to Pandoc for Word or LaTeX. Pandoc's default
// templates expect each author to be text, so an author written as a
// `name`/`affiliation` map is flattened to "name, affiliation" here. The
// editor's document is never changed.

import { isMap, isSeq, parseDocument } from 'yaml'
import { BLOCK_RE } from './frontmatter'

/**
 * authorsForExport rewrites map authors in the frontmatter as strings. Every
 * other byte of the document is kept; a document with nothing to flatten, no
 * frontmatter, or a block that is not valid YAML comes back as the same string.
 */
export function authorsForExport(markdown: string): string {
  const match = BLOCK_RE.exec(markdown)
  const inner = match?.[1]
  if (!match || !inner) return markdown

  const doc = parseDocument(inner, { schema: 'core' })
  if (doc.errors.length || !isMap(doc.contents)) return markdown

  const node = doc.get('author', true)
  const flat = (item: unknown): string => {
    const plain = (item as { toJSON(): { name?: unknown; affiliation?: unknown } }).toJSON()
    return [plain.name, plain.affiliation]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim())
      .join(', ')
  }

  if (isMap(node)) {
    // A single author written as a map.
    doc.set('author', flat(node))
  } else if (isSeq(node) && node.items.some((item) => isMap(item))) {
    node.items = node.items.map((item) => (isMap(item) ? doc.createNode(flat(item)) : item))
  } else {
    return markdown
  }

  const crlf = markdown.includes('\r\n')
  let block = doc.toString().replace(/\n$/, '')
  if (crlf) block = block.replace(/\n/g, '\r\n')
  const start = match[0].indexOf('\n') + 1
  return markdown.slice(0, start) + block + markdown.slice(start + inner.length)
}
