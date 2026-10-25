/**
 * Equation labels, Pandoc style: `$$ … $$ {#eq:id}` with the label after the
 * closing `$$`. A labelled top-level equation is numbered `(n)` at the right
 * and gets the label as its id; an unlabelled one renders as it always did.
 */

import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type { TargetMeta } from './crossrefs'

/** `$$ {#eq:id}` at the end of a line; group 1 is the label. */
export const EQUATION_LABEL = /\$\$\s*\{#(eq:[A-Za-z0-9_][A-Za-z0-9_:.-]*)\}\s*$/

/** A whole line `$$ tex $$ {#eq:id}`; group 1 is the TeX, group 2 the label. */
const ONE_LINE_LABELLED = /^\s*\$\$(.+?)\$\$\s*\{#(eq:[A-Za-z0-9_][A-Za-z0-9_:.-]*)\}\s*$/

export function equationPlugin(md: MarkdownIt): void {
  // The KaTeX plugin takes a one-line `$$ a $$ {#eq:x}` for an opening
  // delimiter and swallows the lines after it, so claim that form first.
  md.block.ruler.before('math_block', 'math_block_labelled', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
    const m = ONE_LINE_LABELLED.exec(line)
    if (!m) return false
    if (silent) return true
    const token = state.push('math_block', 'math', 0)
    token.block = true
    token.content = m[1].trim() + '\n'
    token.map = [start, start + 1]
    token.markup = '$$'
    token.meta = { label: m[2] }
    state.line = start + 1
    return true
  })
  md.core.ruler.push('equation_labels', numberEquations)
}

function numberEquations(state: StateCore): boolean {
  const lines = state.src.split('\n')
  let count = 0
  for (const token of state.tokens) {
    if (token.type !== 'math_block' || !token.map) continue
    // The KaTeX plugin drops a label on a multi-line equation's closing line,
    // so read it from the source; a one-line one was labelled by its own rule.
    const label =
      (token.meta?.label as string | undefined) ?? EQUATION_LABEL.exec(lines[token.map[1] - 1] ?? '')?.[1] ?? null
    const tex = token.content.replace(EQUATION_LABEL, '')
    token.content = tex
    // Only top-level equations are numbered; a nested one keeps its id.
    if (token.level === 0 && label !== null) count += 1
    const target: TargetMeta = {
      kind: 'eq',
      number: token.level === 0 && label !== null ? count : null,
      caption: '',
      label,
    }
    token.meta = { ...token.meta, target, tex }
  }
  return true
}
