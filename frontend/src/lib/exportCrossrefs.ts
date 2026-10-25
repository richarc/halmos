// The copy of a document sent to Pandoc for Word or LaTeX. pandoc-crossref
// numbers only labelled figures and tables, while the preview numbers every
// captioned top-level one, so each unlabelled numbered target gets a
// generated label here and both numberings agree. pandoc-crossref would also
// number a labelled target in a list or quote, which the preview does not, so
// that label is taken off. The editor's document is never changed.

import { collectTargets } from './crossrefTargets'
import { labelColumn, labelSuffix } from './crossrefs'

/** `{#label …}` at the end of a line, with the spaces before it. */
function labelPattern(label: string): RegExp {
  const id = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`[ \\t]*\\{#${id}(?:\\s[^}]*)?\\}(?=\\s*$)`)
}

/**
 * labelForExport appends `{#fig:halmos-<n>}` or `{#tbl:halmos-<n>}` to each
 * unlabelled numbered target, and removes the label of each nested one.
 */
export function labelForExport(markdown: string): string {
  const targets = collectTargets(markdown)
  const taken = new Set<string>()
  for (const t of targets) if (t.label) taken.add(t.label)
  const next = { fig: 0, tbl: 0, eq: 0 }
  const additions = new Map<number, string>()
  const removals = new Map<number, string>()
  for (const t of targets) {
    if (t.nested && t.label !== null) {
      removals.set(t.line, t.label)
      continue
    }
    if (t.label !== null || t.number === null) continue
    let label: string
    do label = `${t.kind}:halmos-${++next[t.kind]}`
    while (taken.has(label))
    additions.set(t.line, labelSuffix(t.block, label))
  }
  if (additions.size === 0 && removals.size === 0) return markdown
  return markdown
    .split('\n')
    .map((line, i) => {
      const remove = removals.get(i + 1)
      if (remove !== undefined) return line.replace(labelPattern(remove), '')
      const add = additions.get(i + 1)
      if (add === undefined) return line
      const end = labelColumn(line)
      return line.slice(0, end) + add + line.slice(end)
    })
    .join('\n')
}
