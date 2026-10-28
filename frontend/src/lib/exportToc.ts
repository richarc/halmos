// The copy of a document sent to Pandoc for Word or LaTeX. The preview turns
// the first top-level [[toc]] paragraph into the contents when the
// frontmatter says `toc: true`; Pandoc knows no such marker and would print
// it as text, so that paragraph is taken out. Pandoc places its own contents
// from the same `toc` key. The editor's document is never changed.

import { createMarkdownParser } from './markdownParser'
import { parseFrontmatter } from './frontmatter'

/** The document without the [[toc]] paragraph the preview would replace. */
export function tocMarkerForExport(markdown: string): string {
  const fm = parseFrontmatter(markdown)
  if (fm.toc !== 'true') return markdown
  // The same rule as toc.ts: a level-0 paragraph whose whole text is the
  // marker, ignoring case. A fence's marker is never a paragraph.
  const tokens = createMarkdownParser().parse(fm.body, {})
  for (let i = 0; i + 2 < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== 'paragraph_open' || open.level !== 0 || !open.map) continue
    if (tokens[i + 1].content.trim().toLowerCase() !== '[[toc]]') continue
    const lines = markdown.split('\n')
    const offset = fm.bodyStartLine - 1
    lines.splice(offset + open.map[0], open.map[1] - open.map[0])
    return lines.join('\n')
  }
  return markdown
}
