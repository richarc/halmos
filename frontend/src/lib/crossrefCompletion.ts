/**
 * Picking a cross-reference target from a list: the completion source for
 * `@fig:`, `@tbl:` and `@eq:` (and for Insert → Cross-reference…, which lists
 * every kind at the cursor), and `planReference`, the edit that refers to the
 * chosen target and, when it has no label yet, writes one after it.
 *
 * Halmos writes a label at most once and never rewrites one: a target that
 * already has a label is referred to by it.
 */

import katex from 'katex'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import { pickedCompletion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { inFrontmatter, isInCode } from './markdownCommands'
import { inLocalMaths } from './citationCompletion'
import { collectTargets } from './crossrefTargets'
import { KIND_WORD, equationLabel, labelColumn, labelSuffix, slugLabel, type CrossrefKind, type CrossrefTarget } from './crossrefs'

export interface ReferenceChange {
  from: number
  to: number
  insert: string
}

/**
 * Why nothing was written: the target is gone or changed (`moved`), the
 * reference sits on the unlabelled target's own line, where the label would
 * land after it (`own-line`), or the equation name is unusable.
 */
export type ReferenceError = 'moved' | 'own-line' | 'taken' | 'invalid' | 'empty'

export type ReferencePlan = { changes: ReferenceChange[] } | { error: ReferenceError }

/** The target in the live text that `target` was, or null when it is gone. */
function refind(live: CrossrefTarget[], target: CrossrefTarget): CrossrefTarget | null {
  // A number alone can name another block once one is added or uncaptioned
  // above, so the caption has to agree too.
  if (target.kind !== 'eq' || target.number !== null) {
    return (
      live.find((t) => t.kind === target.kind && t.number === target.number && t.caption === target.caption) ?? null
    )
  }
  // An unnamed equation has no number, so it is known by its formula; of two
  // equal formulas, the one nearer where it was.
  let best: CrossrefTarget | null = null
  for (const t of live) {
    if (t.kind !== 'eq' || t.tex !== target.tex) continue
    if (!best || Math.abs(t.line - target.line) < Math.abs(best.line - target.line)) best = t
  }
  return best
}

/** Offset of the start of 1-based `line` of `text`. */
function lineStart(text: string, line: number): number {
  let start = 0
  for (let n = 1; n < line; n++) start = text.indexOf('\n', start) + 1
  return start
}

/** Offset of the label's place on 1-based `line` of `text`. */
function labelOffset(text: string, line: number): number {
  const start = lineStart(text, line)
  const end = text.indexOf('\n', start)
  return start + labelColumn(text.slice(start, end < 0 ? text.length : end))
}

// After these, or at a line start, an "@" reads as a reference.
const OPENS_REFERENCE = /[\s([]/

/**
 * `@label`, spaced off a word when nothing was typed: from the menu the
 * insertion can land right after one (`see|`), where it would not read as a
 * reference. A typed `@` is left where it is; the source checked it.
 */
function referenceText(text: string, from: number, to: number, label: string): string {
  const typedAt = text.startsWith('@', from) && from < to
  const prev = from > 0 ? text[from - 1] : '\n'
  return typedAt || OPENS_REFERENCE.test(prev) ? `@${label}` : ` @${label}`
}

/**
 * The edit that refers to `target` from `[from, to)` (what was typed, the
 * `@` included; empty from the menu). An unlabelled target is first found
 * again in `text` and labelled: a figure or table from its caption, an
 * equation from `eqName`. Pure; the changes are in `text`'s coordinates.
 */
export function planReference(
  text: string,
  target: CrossrefTarget,
  from: number,
  to: number,
  eqName?: string,
): ReferencePlan {
  const refer = (label: string): ReferenceChange => ({ from, to, insert: referenceText(text, from, to, label) })
  if (target.label !== null) return { changes: [refer(target.label)] }

  const live = collectTargets(text)
  const found = refind(live, target)
  if (!found) return { error: 'moved' }
  // Labelled since the list was drawn: refer to that label, never a second one.
  if (found.label !== null) return { changes: [refer(found.label)] }

  const taken = new Set(live.flatMap((t) => (t.label ? [t.label] : [])))
  let label: string
  if (found.kind === 'eq') {
    const named = equationLabel(eqName ?? '', taken)
    if (!named.ok) return { error: named.reason }
    label = named.label
  } else {
    label = slugLabel(found.kind, found.caption, taken)
  }
  // On the target's own line the label would follow the reference and no
  // longer attach to the block (a caption referring to its own table).
  const start = lineStart(text, found.line)
  const end = text.indexOf('\n', start)
  if (from >= start && (end < 0 || from <= end)) return { error: 'own-line' }
  const at = labelOffset(text, found.line)
  const write = { from: at, to: at, insert: labelSuffix(found.block, label) }
  return { changes: [write, refer(label)].sort((a, b) => a.from - b.from) }
}

const CROSSREF = 'crossref'
const TEX_MAX = 60

/** A suggestion carries its target, and an equation's formula. */
interface CrossrefCompletion extends Completion {
  target: CrossrefTarget
}

/** Row class for a cross-reference suggestion. */
export function crossrefOptionClass(c: Completion): string {
  return c.type === CROSSREF ? 'cm-crossref-option' : ''
}

/** An equation's formula, drawn by KaTeX after the label, for addToOptions. */
export const crossrefOptionFormula = {
  render(c: Completion): Node | null {
    const tex = c.type === CROSSREF ? (c as CrossrefCompletion).target.tex : undefined
    if (!tex) return null
    const cut = tex.length > TEX_MAX ? tex.slice(0, TEX_MAX) + '…' : tex
    const el = document.createElement('span')
    el.className = 'cm-crossref-formula'
    el.innerHTML = katex.renderToString(cut, { throwOnError: false })
    return el
  },
  position: 90,
}

// Same boundary as a bare citation: not after a word character, ".", "-",
// "@" or "[" is fine (the bracket form), and the kind in any case.
const TYPED = /@(fig|tbl|eq):([\w:.-]*)$/i
const NOT_BEFORE_BARE = /[\w.\-@]/
// What may be typed after the cursor to filter the menu's list.
const MENU_FILTER = /^[\w:.-]*$/
const ORDER: CrossrefKind[] = ['fig', 'tbl', 'eq']

/**
 * A target can be picked when it has a number, or is a top-level equation
 * still to be named; a nested one would stay unnumbered once labelled.
 */
function pickable(t: CrossrefTarget): boolean {
  return t.number !== null || (t.kind === 'eq' && t.label === null && !t.nested)
}

/**
 * `get` gives the targets of the last render; `all` is true while the list
 * was opened from the menu; `pick` receives a chosen target that has no label,
 * with the range to replace.
 */
export function crossrefCompletionSource(
  get: () => CrossrefTarget[],
  all: () => boolean,
  pick: (t: CrossrefTarget, from: number, to: number) => void,
): CompletionSource {
  // Where the menu's list was opened; what is typed after it filters the list.
  let anchor = -1
  return (cc: CompletionContext): CompletionResult | null => {
    const line = cc.state.doc.lineAt(cc.pos)
    const before = line.text.slice(0, cc.pos - line.from)
    let from: number
    let kinds: CrossrefKind[]
    let query: string
    const typed = TYPED.exec(before)
    if (typed) {
      from = cc.pos - typed[0].length
      if (NOT_BEFORE_BARE.test(before.slice(0, from - line.from).slice(-1))) return null
      kinds = [typed[1].toLowerCase() as CrossrefKind]
      query = typed[0].slice(1).toLowerCase()
    } else if (all()) {
      if (cc.explicit) anchor = cc.pos
      const filter = anchor >= line.from && anchor <= cc.pos ? cc.state.sliceDoc(anchor, cc.pos) : null
      if (filter === null || !MENU_FILTER.test(filter)) return null
      from = anchor
      kinds = ORDER
      query = filter.toLowerCase()
    } else {
      return null
    }

    if (inFrontmatter(cc.state, cc.pos) || isInCode(cc.state, cc.pos)) return null
    if (inLocalMaths(cc.state, from)) return null

    const targets = get().filter(pickable)
    const taken = new Set(targets.flatMap((t) => (t.label ? [t.label] : [])))
    const options: CrossrefCompletion[] = []
    for (const kind of kinds) {
      for (const t of targets) {
        if (t.kind !== kind) continue
        // What typing matches: the label, or the one a caption would make.
        const key = t.label ?? (t.kind === 'eq' ? 'eq:' : slugLabel(t.kind, t.caption, taken))
        if (query && !key.toLowerCase().includes(query)) continue
        options.push({
          label: key,
          displayLabel: t.number !== null ? `${KIND_WORD[t.kind]} ${t.number}` : 'Unnamed equation',
          detail: t.caption || undefined,
          type: CROSSREF,
          target: t,
          apply: (view: EditorView, c: Completion, from: number, to: number) => {
            if (t.label === null) return pick(t, from, to)
            const plan = planReference(view.state.doc.toString(), t, from, to)
            if ('error' in plan) return
            const [change] = plan.changes
            view.dispatch({
              changes: change,
              selection: { anchor: from + change.insert.length },
              annotations: pickedCompletion.of(c),
              userEvent: 'input.complete',
            })
          },
        })
      }
    }
    if (options.length === 0) return null
    // Filtered here, in document order, so CodeMirror must re-ask on every
    // keystroke rather than re-sort by its own match score.
    return { from, options, filter: false }
  }
}
