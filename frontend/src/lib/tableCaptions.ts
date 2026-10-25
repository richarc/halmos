/**
 * Table captions, Pandoc style: a paragraph `: Caption {#tbl:id}` one blank
 * line after a GFM table becomes a `<caption>` inside the table, numbered
 * `Table n: ` in document order. Tables count separately from figures.
 *
 * Like figures, a caption is what makes a table: without one the table
 * renders exactly as it did before this module existed.
 */

import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import { trailingLabel, type TargetMeta } from './crossrefs'

/** `: Caption`, with an optional trailing `{#tbl:id}`; null if `line` is not one. */
export function parseCaptionLine(line: string): { caption: string; label: string | null } | null {
  if (!/^: +\S/.test(line)) return null
  const { text, label } = trailingLabel(line.replace(/^: +/, ''), 'tbl')
  if (text === '') return null
  return { caption: text, label }
}

export function tableCaptionPlugin(md: MarkdownIt): void {
  // Before `inline`, so the caption text is still the paragraph's raw
  // content and the inline rule parses it (emphasis, maths) in its new home.
  md.core.ruler.before('inline', 'table_caption_move', moveCaptions)
  md.core.ruler.after('inline', 'table_caption_number', numberTables)
  md.renderer.rules.table_caption_open = (tokens, idx) => {
    const target = tokens[idx - 1]?.meta?.target as TargetMeta | undefined
    const prefix = target?.number != null ? `Table ${target.number}: ` : ''
    return `<caption>${md.utils.escapeHtml(prefix)}`
  }
}

function moveCaptions(state: StateCore): boolean {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const close = tokens[i]
    if (close.type !== 'table_close') continue
    const open = tokens.findLastIndex((t, j) => j < i && t.type === 'table_open' && t.level === close.level)
    const para = tokens[i + 1]
    const inline = tokens[i + 2]
    if (open < 0 || para?.type !== 'paragraph_open' || para.level !== close.level) continue
    if (para.hidden || inline?.type !== 'inline' || tokens[i + 3]?.type !== 'paragraph_close') continue
    // Exactly one blank line: the paragraph starts at most one line past the
    // table's end (an adjacent line would have been a table row instead).
    const table = tokens[open]
    if (!table.map || !para.map || para.map[0] - table.map[1] > 1) continue
    const parsed = parseCaptionLine(inline.content)
    if (!parsed) continue

    const caption = [
      new state.Token('table_caption_open', 'caption', 1),
      inline,
      new state.Token('table_caption_close', 'caption', -1),
    ]
    caption[0].block = caption[2].block = true
    caption[0].level = caption[2].level = table.level + 1
    inline.level = table.level + 2
    inline.content = parsed.caption
    inline.map = null
    // The caption's last line, where its label sits, for crossrefTargets.ts:
    // the inline's map is cleared above and the paragraph tokens are dropped
    // below, so this is the only record of where the caption was.
    table.meta = { ...(table.meta ?? {}), captionLastLine: para.map[1] - 1 }
    if (parsed.label !== null) table.meta.label = parsed.label
    tokens.splice(i + 1, 3)
    tokens.splice(open + 1, 0, ...caption)
  }
  return true
}

function numberTables(state: StateCore): boolean {
  let count = 0
  for (const [i, token] of state.tokens.entries()) {
    if (token.type !== 'table_open') continue
    const caption = state.tokens[i + 1]
    if (caption?.type !== 'table_caption_open') continue
    const label = (token.meta?.label as string | undefined) ?? null
    // Only top-level tables are numbered, as with figures; a quoted table
    // keeps its caption text but takes no number, and no id.
    const nested = token.level !== 0
    if (!nested) count += 1
    const target: TargetMeta = {
      kind: 'tbl',
      number: nested ? null : count,
      caption: state.tokens[i + 2].content,
      label,
    }
    token.meta = { ...token.meta, target }
    if (label !== null && !nested) token.attrSet('id', label)
  }
  return true
}
