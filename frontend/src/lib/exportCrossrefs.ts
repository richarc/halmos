// The copy of a document sent to Pandoc for Word or LaTeX. pandoc-crossref
// numbers only labelled figures and tables, while the preview numbers every
// captioned top-level one, so each unlabelled numbered target gets a
// generated label here and both numberings agree. pandoc-crossref would also
// number a labelled target in a list or quote, which the preview does not, so
// that label is taken off. The editor's document is never changed.

import { isScalar, parseDocument } from 'yaml'
import { collectTargets } from './crossrefTargets'
import { labelColumn, labelSuffix, referenceText, type CrossrefKind } from './crossrefs'
import { BLOCK_RE } from './frontmatter'

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

// A reference key as the citation parser reads one, after the kind's prefix;
// a sentence's closing full stop is not part of it.
const KEY = String.raw`[\w][\w:#$%&\-+?<>~/]*(?:\.[\w][\w:#$%&\-+?<>~/]*)*`
const REF = String.raw`@((?:[Ff]ig|[Tt]bl|[Ee]q):${KEY})`
// A bracketed group of references only, `[@fig:a; @fig:b]`, or a bare one.
// A group that also cites a source is left for Pandoc.
const REFERENCES = new RegExp(
  String.raw`\[\s*${REF}((?:\s*;\s*@(?:[Ff]ig|[Tt]bl|[Ee]q):${KEY})*)\s*\]|(?<![\w@\[])${REF}`,
  'g',
)

/**
 * abstractReferencesForExport writes each cross-reference in the
 * frontmatter's `abstract` as the text the preview shows ("Figure 2",
 * "Figures 1, 2"). pandoc-crossref resolves references in the body only, so
 * one left in the abstract reached Word and LaTeX as "fig:a?". A reference
 * to a label the document does not have is left as written, and so is
 * everything outside the abstract.
 */
export function abstractReferencesForExport(markdown: string): string {
  const block = BLOCK_RE.exec(markdown)
  if (!block || block[1] === undefined) return markdown
  const doc = parseDocument(block[1], { schema: 'core' })
  if (doc.errors.length) return markdown
  const node = doc.get('abstract', true)
  if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return markdown

  const lookup = new Map<string, { kind: CrossrefKind; number: number }>()
  for (const t of collectTargets(markdown)) {
    if (t.label && t.number !== null && !lookup.has(t.label)) lookup.set(t.label, { kind: t.kind, number: t.number })
  }
  const start = markdown.indexOf('\n') + 1 + node.range[0]
  const end = markdown.indexOf('\n') + 1 + node.range[1]
  const text = markdown.slice(start, end)
  const written = text.replace(REFERENCES, (whole, first?: string, rest?: string, bare?: string) => {
    const keys = bare ? [bare] : [first!, ...(rest ?? '').split(';').filter((k) => k.trim()).map((k) => k.trim().slice(1))]
    // `@Fig:a` is a capital at a sentence start; the label is lower case.
    const { text: shown, missing } = referenceText(
      keys.map((k) => k[0].toLowerCase() + k.slice(1)),
      (label) => lookup.get(label),
    )
    return missing ? whole : shown
  })
  return written === text ? markdown : markdown.slice(0, start) + written + markdown.slice(end)
}
