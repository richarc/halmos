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

export function equationPlugin(md: MarkdownIt): void {
  md.core.ruler.push('equation_labels', numberEquations)
}

function numberEquations(state: StateCore): boolean {
  const lines = state.src.split('\n')
  let count = 0
  for (const token of state.tokens) {
    if (token.type !== 'math_block' || !token.map) continue
    // The KaTeX plugin drops a label on the closing line, so read it from the
    // source. A one-line `$$ a $$ {#eq:x}` leaves it inside `content`, and its
    // map runs one line past the text, so `content` is where to look then.
    const label =
      EQUATION_LABEL.exec(lines[token.map[1] - 1] ?? '')?.[1] ?? EQUATION_LABEL.exec(token.content)?.[1] ?? null
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
