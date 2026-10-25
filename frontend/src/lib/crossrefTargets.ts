/**
 * The document's cross-reference targets and the references that miss them.
 *
 * figures.ts, tableCaptions.ts and equations.ts each stamp a `TargetMeta` on
 * the token of a block that can be referred to; this collects those stamps in
 * document order, with the line a label is appended to, and checks every
 * `crossref` token (citations.ts) against them. The renderer reads the result
 * back out of `env` to write `Figure 2`; `collectTargets` gives the same list
 * without a render, for the editor and export.
 */

import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import type { CrossrefKind, CrossrefTarget, TargetMeta } from './crossrefs'
import { isCrossrefKey, referenceKind } from './crossrefs'
import { fenceLanguage, figurePlugin } from './figures'
import { tableCaptionPlugin } from './tableCaptions'
import { equationPlugin } from './equations'
import { createMarkdownParser } from './markdownParser'
import { parseFrontmatter } from './frontmatter'

export interface MissingReference {
  key: string
  /** 1-based document line of the block holding the reference. */
  line: number
}

export interface CrossrefEnv {
  sourceLineOffset?: number
  crossrefTargets?: CrossrefTarget[]
  crossrefMissing?: MissingReference[]
  /** Numbered, labelled targets by label; what a reference resolves against. */
  crossrefLookup?: Map<string, { kind: CrossrefKind; number: number }>
  footnotes?: { list?: { tokens?: Token[] }[] }
}

export interface CrossrefMeta {
  keys: string[]
  mixed: boolean
}

/** The label a key names: its prefix lower-cased, its id as written. */
export function keyLabel(key: string): string {
  const kind = referenceKind(key)
  return kind ? kind + key.slice(kind.length) : key
}

/** Pushed after the figure, table and equation rules, whose stamps it reads. */
export function crossrefPlugin(md: MarkdownIt): void {
  md.core.ruler.push('crossrefs', collect)
}

function collect(state: StateCore): boolean {
  const env = state.env as CrossrefEnv
  const offset = env.sourceLineOffset ?? 0
  const lines = state.src.split('\n')
  const targets: CrossrefTarget[] = []
  for (const token of state.tokens) {
    const target = targetOf(token, lines)
    if (target) targets.push({ ...target, line: target.line + offset })
  }
  const lookup = new Map<string, { kind: CrossrefKind; number: number }>()
  for (const t of targets) {
    if (t.label !== null && t.number !== null) lookup.set(t.label, { kind: t.kind, number: t.number })
  }
  const missing: MissingReference[] = []
  for (const { token, line } of references(state.tokens, env)) {
    for (const key of (token.meta as CrossrefMeta).keys) {
      if (isCrossrefKey(key) && !lookup.has(keyLabel(key))) missing.push({ key, line: line + 1 + offset })
    }
  }
  env.crossrefTargets = targets
  env.crossrefLookup = lookup
  env.crossrefMissing = missing
  return true
}

/** A stamped block as a target, its line body-relative and 1-based. */
function targetOf(token: Token, lines: string[]): CrossrefTarget | null {
  const meta = token.meta as { target?: TargetMeta; tex?: string; captionLastLine?: number } | null
  const target = meta?.target
  if (!target || !token.map) return null
  const [start, end] = token.map
  if (token.type === 'fence') {
    const block = fenceLanguage(token.info) === 'mermaid' ? 'mermaid' : 'chart'
    return { ...target, block, line: start + 1 }
  }
  // An image figure: the paragraph, retagged.
  if (token.type === 'paragraph_open') return { ...target, block: 'image', line: end }
  if (token.type === 'table_open') {
    if (meta.captionLastLine == null) return null
    return { ...target, block: 'table', line: meta.captionLastLine + 1 }
  }
  if (token.type === 'math_block') {
    return { ...target, block: 'equation', line: closingLine(lines, start, end) + 1, tex: (meta.tex ?? '').trim() }
  }
  return null
}

/**
 * The 0-based line of an equation's closing `$$`. A one-line `$$ a $$` has a
 * map running one line past it, so the opening line is checked for a second
 * `$$` before looking further down.
 */
function closingLine(lines: string[], start: number, end: number): number {
  const first = lines[start] ?? ''
  const open = first.indexOf('$$')
  if (open >= 0 && first.indexOf('$$', open + 2) >= 0) return start
  for (let i = start + 1; i < end; i++) if ((lines[i] ?? '').includes('$$')) return i
  return end - 1
}

/**
 * Every `crossref` token with the 0-based line of the block it sits in. An
 * inline footnote is visited where its reference is, and its copy at the end
 * (footnote_tail's) skipped; a footnote definition is visited at the end,
 * where its own paragraphs still carry their lines.
 */
function references(tokens: Token[], env: CrossrefEnv): { token: Token; line: number }[] {
  const out: { token: Token; line: number }[] = []
  const inlineNote = (id: number) => env.footnotes?.list?.[id]?.tokens
  const visit = (children: Token[], line: number) => {
    for (const t of children) {
      if (t.type === 'crossref') out.push({ token: t, line })
      else if (t.type === 'footnote_ref') {
        const note = inlineNote(t.meta.id)
        if (note) visit(note, line)
      } else if (t.children) visit(t.children, line)
    }
  }
  let line = 0
  let skipping = false
  for (const t of tokens) {
    if (t.type === 'footnote_open' && inlineNote(t.meta.id)) skipping = true
    else if (t.type === 'footnote_close') skipping = false
    if (skipping) continue
    if (t.map) line = t.map[0]
    if (t.type === 'inline' && t.children) visit(t.children, line)
  }
  return out
}

// The parser the editor and export use: the citation rules and the three
// stamping plugins, and nothing that only matters to rendering.
const parser = createMarkdownParser().use(figurePlugin).use(tableCaptionPlugin).use(equationPlugin).use(crossrefPlugin)

/** The document's targets, in document order, with 1-based document lines. */
export function collectTargets(markdown: string): CrossrefTarget[] {
  const { body, bodyStartLine } = parseFrontmatter(markdown)
  const env: CrossrefEnv = { sourceLineOffset: bodyStartLine - 1 }
  parser.parse(body, env)
  return env.crossrefTargets ?? []
}
