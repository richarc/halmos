import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import { fenceLanguage } from './figures'
import type { CrossrefKind } from './crossrefs'
import { keyLabel, type CrossrefEnv, type CrossrefMeta } from './crossrefTargets'

// The Getting Started tutorial's tasks tick themselves. A task is a task-list
// item ending in a marker, `- [ ] Add an equation. <!-- check: display-math -->`:
// an HTML comment, so every other renderer hides it. This renderer has
// `html: false`, so the rule removes the marker from what is rendered (the
// children only; `content` keeps it, as taskAlerts.ts requires).
//
// A task is done when its area — everything after its list, up to the next
// heading — holds the result. The finished example sits above the list, so
// it never counts. Only the preview's checkbox changes: the document keeps
// `- [ ]`.

export const CHECKS = [
  'inline-math',
  'display-math',
  'chart',
  'citation',
  'table-caption',
  'ref-fig',
  'ref-tbl',
  'ref-eq',
] as const

type Check = (typeof CHECKS)[number]

const MARKER = /\s*<!--\s*check:\s*([a-z-]*)\s*-->\s*$/

/** Every token in `tokens[from, to)`, with inline children flattened in. */
function* area(tokens: Token[], from: number, to: number): Generator<Token> {
  for (let k = from; k < to; k++) {
    yield tokens[k]
    if (tokens[k].type === 'inline' && tokens[k].children) yield* tokens[k].children!
  }
}

function resolves(token: Token, kind: CrossrefKind, env: CrossrefEnv): boolean {
  const meta = token.meta as CrossrefMeta | undefined
  if (!meta || meta.mixed) return false
  return meta.keys.some((key) => env.crossrefLookup?.get(keyLabel(key))?.kind === kind)
}

function found(check: Check, token: Token, env: CrossrefEnv): boolean {
  switch (check) {
    case 'inline-math':
      return token.type === 'math_inline'
    case 'display-math':
      return token.type.startsWith('math_block') || token.type === 'math_inline_bare_block'
    case 'chart':
      return token.type === 'fence' && fenceLanguage(token.info) === 'vega-lite'
    case 'citation':
      return token.type === 'citation'
    case 'table-caption':
      return token.type === 'table_caption_open'
    case 'ref-fig':
      return token.type === 'crossref' && resolves(token, 'fig', env)
    case 'ref-tbl':
      return token.type === 'crossref' && resolves(token, 'tbl', env)
    case 'ref-eq':
      return token.type === 'crossref' && resolves(token, 'eq', env)
  }
}

function closeOf(tokens: Token[], open: number): number {
  const type = tokens[open].type.replace('_open', '_close')
  for (let k = open + 1; k < tokens.length; k++) {
    if (tokens[k].type === type && tokens[k].level === tokens[open].level) return k
  }
  return tokens.length
}

function tickTasks(state: StateCore): boolean {
  const tokens = state.tokens
  const env = state.env as CrossrefEnv
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open' || !tokens[i].attrGet('class')?.includes('task-list-item')) continue
    const kids = tokens[i + 2]?.children
    if (!kids) continue
    // makeTasks wraps the item's text in a label, so the marker is in the
    // last text token before the closing one.
    const last = kids.findLastIndex((t) => t.type === 'text')
    const m = last === -1 ? null : MARKER.exec(kids[last].content)
    if (!m) continue
    kids[last].content = kids[last].content.slice(0, m.index)
    const check = m[1] as Check
    if (!CHECKS.includes(check)) continue

    let list = i - 1
    while (list >= 0 && !(tokens[list].type.endsWith('_list_open') && tokens[list].level === tokens[i].level - 1)) list--
    if (list < 0) continue
    const from = closeOf(tokens, list) + 1
    let to = from
    while (to < tokens.length && tokens[to].type !== 'heading_open') to++

    let done = false
    for (const t of area(tokens, from, to)) {
      if (found(check, t, env)) {
        done = true
        break
      }
    }
    if (!done) continue
    tokens[i].attrJoin('class', 'tutorial-task-done')
    const box = kids.find((t) => t.type === 'html_inline' && t.content.includes('task-list-item-checkbox'))
    if (box && !box.content.includes('checked=')) {
      box.content = box.content.replace('<input type="checkbox"', '<input type="checkbox" checked="checked"')
    }
  }
  return true
}

/** Pushed after crossrefPlugin, whose lookup the ref-* checks read. */
export function tutorialTasksPlugin(md: MarkdownIt): void {
  md.core.ruler.push('tutorial_tasks', tickTasks)
}
