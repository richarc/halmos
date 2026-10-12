import { Decoration, hoverTooltip, ViewPlugin, type DecorationSet, type EditorView, type Tooltip, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, type EditorState, type Extension } from '@codemirror/state'
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

/** Dispatched to re-evaluate the unknown-key marks when the bibliography changes. */
export const refreshCitationsEffect = StateEffect.define<null>()

const unknownMark = Decoration.mark({ class: 'cm-cite-unknown' })

function buildUnknownMarks(view: EditorView, ctx: CitationContext | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  if (!ctx) return builder.finish()
  const { state } = view
  let scanned = -1
  for (const range of view.visibleRanges) {
    // Whole lines, so the range edge cannot split a key.
    const start = Math.max(state.doc.lineAt(range.from).from, scanned)
    const end = state.doc.lineAt(range.to).to
    if (start >= end) continue
    scanned = end
    for (const span of findCitationKeys(state.sliceDoc(start, end))) {
      const from = start + span.from
      if (ctx.has(span.key) || inFrontmatter(state, from) || isInCode(state, from)) continue
      builder.add(from, start + span.to, unknownMark)
    }
  }
  return builder.finish()
}

/** Underlines citation keys that are absent from the loaded bibliography. */
export function unknownKeyMarks(get: () => CitationContext | null): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildUnknownMarks(view, get())
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshCitationsEffect))))
          this.decorations = buildUnknownMarks(u.view, get())
      }
    },
    { decorations: (v) => v.decorations },
  )
}
