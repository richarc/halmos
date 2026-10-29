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
// A task is done when its area — everything after its marker, up to the
// next heading — holds the result. That takes in text typed straight under
// the last task with no blank line (Markdown makes it part of that task) and
// a new `- [ ]` line made by pressing Return; the finished example sits above
// the task list, so it never counts. Only the preview's checkbox changes: the
// document keeps `- [ ]`.

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

function tickTasks(state: StateCore): boolean {
  const tokens = state.tokens
  const env = state.env as CrossrefEnv
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open' || !tokens[i].attrGet('class')?.includes('task-list-item')) continue
    const inline = i + 2
    const kids = tokens[inline]?.children
    if (!kids) continue
    // The first text token that ends in a marker: a softbreak ends a token,
    // so a marker on the task's first line is found with text typed after it.
    const at = kids.findIndex((t) => t.type === 'text' && MARKER.test(t.content))
    if (at === -1) continue
    const m = MARKER.exec(kids[at].content)!
    kids[at].content = kids[at].content.slice(0, m.index)
    // makeTasks closed its label at the end of the item; close it at the
    // marker instead, so a tick strikes through the task and not the work.
    const shut = kids.findLastIndex((t) => t.type === 'html_inline' && t.content === '</label>')
    if (shut > at) kids.splice(at + 1, 0, ...kids.splice(shut, 1))
    const check = m[1] as Check
    if (!CHECKS.includes(check)) continue

    let to = inline + 1
    while (to < tokens.length && tokens[to].type !== 'heading_open') to++
    let done = kids.slice(at + 2).some((t) => found(check, t, env))
    for (const t of done ? [] : area(tokens, inline + 1, to)) {
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
