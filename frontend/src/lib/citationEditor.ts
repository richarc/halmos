import { hoverTooltip, type Tooltip } from '@codemirror/view'
import type { EditorState, Extension } from '@codemirror/state'
import { findCitationKeys, type KeySpan } from './citationKeys'
import { inFrontmatter, isInCode } from './markdownCommands'
import type { CitationContext } from './citationCompletion'

/**
 * The citation key under `pos`, in document coordinates. Only the line holding
 * `pos` is parsed, and keys inside code or frontmatter are ignored.
 */
export function keyAt(state: EditorState, pos: number): KeySpan | null {
  const line = state.doc.lineAt(pos)
  for (const span of findCitationKeys(line.text)) {
    const from = line.from + span.from
    const to = line.from + span.to
    if (pos < from || pos > to) continue
    if (inFrontmatter(state, from) || isInCode(state, from)) return null
    return { key: span.key, from, to }
  }
  return null
}

/** The tooltip for the key at `pos`, or null with no bibliography or no key. */
export function citationTooltip(
  get: () => CitationContext | null,
  state: EditorState,
  pos: number,
): Tooltip | null {
  const ctx = get()
  if (!ctx) return null
  const span = keyAt(state, pos)
  if (!span) return null
  return {
    pos: span.from,
    end: span.to,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'cm-citation-tooltip'
      // citeproc HTML-escapes entry fields and emits only formatting tags, so
      // the reference is set as HTML (citationEditor.test.ts pins this).
      const html = ctx.has(span.key) ? ctx.reference(span.key) : null
      if (html) dom.innerHTML = html
      else dom.textContent = `Not in ${ctx.bibName}`
      return { dom }
    },
  }
}

export function citationHover(get: () => CitationContext | null): Extension {
  return hoverTooltip((view, pos) => citationTooltip(get, view.state, pos))
}
