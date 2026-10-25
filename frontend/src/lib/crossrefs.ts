/**
 * The cross-reference vocabulary: which keys are references, how a trailing
 * `{#kind:id}` label is read, how a label is made from a caption, and what a
 * reference reads as. Pure functions only; the markdown-it rules, the editor
 * commands and the exporters all import their rules from here so they agree.
 *
 * The syntax is Pandoc / pandoc-crossref's, so a document written here also
 * exports correctly.
 */

export type CrossrefKind = 'fig' | 'tbl' | 'eq'
export type ReferenceKind = CrossrefKind | 'sec'

export const KIND_WORD: Record<ReferenceKind, string> = {
  fig: 'Figure',
  tbl: 'Table',
  eq: 'Equation',
  sec: 'Section',
}

const PLURAL_WORD: Record<ReferenceKind, string> = {
  fig: 'Figures',
  tbl: 'Tables',
  eq: 'Equations',
  sec: 'Sections',
}

const NBSP = ' '

/** A reference key, as opposed to a citation key: one of four prefixes, any case. */
const KEY_PREFIX = /^(fig|tbl|eq|sec):/i

export function isCrossrefKey(key: string): boolean {
  return KEY_PREFIX.test(key)
}

export function referenceKind(key: string): ReferenceKind | null {
  const m = KEY_PREFIX.exec(key)
  return m ? (m[1].toLowerCase() as ReferenceKind) : null
}

/**
 * Strips one trailing `{#<kind>:id}` (further attributes after a space are
 * allowed and dropped) and the whitespace before it. A label of another kind
 * is left in the text.
 */
export function trailingLabel(
  text: string,
  kind: CrossrefKind,
): { text: string; label: string | null } {
  const re = new RegExp(`\\s*\\{#(${kind}:[A-Za-z0-9_][A-Za-z0-9_:.-]*)(?:\\s[^}]*)?\\}\\s*$`)
  const m = re.exec(text)
  if (!m) return { text: text.trimEnd(), label: null }
  return { text: text.slice(0, m.index).trimEnd(), label: m[1] }
}

const SLUG_MAX = 40

/** A label for a caption: `fig:yield-by-group`, numbered `-2`, `-3`… if taken. */
export function slugLabel(
  kind: 'fig' | 'tbl',
  caption: string,
  taken: ReadonlySet<string>,
): string {
  let slug = caption
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > SLUG_MAX) {
    const cut = slug.lastIndexOf('-', SLUG_MAX)
    slug = slug.slice(0, cut > 0 ? cut : SLUG_MAX)
  }
  if (!slug) slug = kind === 'fig' ? 'figure' : 'table'
  let label = `${kind}:${slug}`
  for (let n = 2; taken.has(label); n++) label = `${kind}:${slug}-${n}`
  return label
}

/** The label an author's name for an equation becomes, or why it cannot. */
export function equationLabel(
  name: string,
  taken: ReadonlySet<string>,
): { ok: true; label: string } | { ok: false; reason: 'empty' | 'invalid' | 'taken' } {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  const id = trimmed.replace(/^eq:/i, '')
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(id)) return { ok: false, reason: 'invalid' }
  const label = `eq:${id}`
  return taken.has(label) ? { ok: false, reason: 'taken' } : { ok: true, label }
}

export interface TargetMeta {
  kind: CrossrefKind
  /** Null below the top level, and for an unlabelled equation. */
  number: number | null
  caption: string
  label: string | null
}

export interface CrossrefTarget extends TargetMeta {
  block: 'image' | 'chart' | 'mermaid' | 'table' | 'equation'
  /** The 1-based document line a label is appended to. */
  line: number
  /** The formula, for equations. */
  tex?: string
  /** Below the top level (in a list or quote), where nothing is numbered. */
  nested?: boolean
}

/** `{#label}` as written after a block; an image's must touch the `)` for Pandoc. */
export function labelSuffix(block: CrossrefTarget['block'], label: string): string {
  return block === 'image' ? `{#${label}}` : ` {#${label}}`
}

/** Where on a target's line its label goes: before any trailing whitespace, which includes a CR line ending. */
export function labelColumn(line: string): number {
  return line.trimEnd().length
}

/**
 * What a reference reads as: `Figure 2`, `Figures 1, 2`, `Figure 1, Table 1`.
 * Lookup is by the lower-cased prefix and the id as written. Adjacent keys of
 * one kind form a run; a missing key prints `??` and sets `missing`.
 */
export function referenceText(
  keys: string[],
  lookup: (label: string) => { kind: CrossrefKind; number: number } | undefined,
): { text: string; missing: boolean } {
  const runs: { kind: ReferenceKind; numbers: string[] }[] = []
  let missing = false
  for (const key of keys) {
    const kind = referenceKind(key) ?? 'sec'
    const label = kind + key.slice(kind.length)
    const found = lookup(label)
    if (!found) missing = true
    const shown = found ? String(found.number) : '??'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.numbers.push(shown)
    else runs.push({ kind, numbers: [shown] })
  }
  const text = runs
    .map((r) => `${r.numbers.length > 1 ? PLURAL_WORD[r.kind] : KIND_WORD[r.kind]}${NBSP}${r.numbers.join(', ')}`)
    .join(', ')
  return { text, missing }
}
