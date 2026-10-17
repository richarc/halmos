import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'

// GitHub task-list items (`- [ ] a`, `- [x] b`) and alerts (`> [!NOTE]`),
// written as a core rule over the finished block tokens instead of a plugin.
// The published plugins want markdown-it 15 and this app is on 14, so a plain
// `npm install` could not resolve them.
//
// Both transforms edit `children` only and leave each inline token's
// `content` alone. citationKeys.ts aligns `content` against the source to get
// exact offsets and matches a citation's `meta.src` to it, so the marker text
// has to stay in `content` even though it is not rendered.

const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution']
const MARKER = /^\[!([A-Za-z]+)\]$/
const TASK_MARK = /^\[([ xX])\](?=\s|$)\s*/

function closeIndex(tokens: Token[], open: number, type: string): number {
  for (let i = open + 1; i < tokens.length; i++) {
    if (tokens[i].type === type && tokens[i].level === tokens[open].level) return i
  }
  return -1
}

function makeAlerts(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open') continue
    const para = tokens[i + 1]
    const inline = tokens[i + 2]
    if (para?.type !== 'paragraph_open' || inline?.type !== 'inline' || !inline.children) continue

    // The marker is the first line of the first paragraph: text up to a
    // softbreak (or the end of the paragraph).
    const kids = inline.children
    let end = kids.findIndex((t) => t.type === 'softbreak')
    if (end === -1) end = kids.length
    if (!kids.slice(0, end).every((t) => t.type === 'text')) continue
    const m = MARKER.exec(kids.slice(0, end).map((t) => t.content).join(''))
    const type = m?.[1].toLowerCase()
    if (!type || !ALERT_TYPES.includes(type)) continue
    const close = closeIndex(tokens, i, 'blockquote_close')
    if (close === -1) continue

    tokens[i].tag = 'div'
    tokens[i].attrJoin('class', `markdown-alert markdown-alert-${type}`)
    tokens[close].tag = 'div'

    const title = new state.Token('html_block', '', 0)
    title.content = `<p class="markdown-alert-title">${type[0].toUpperCase()}${type.slice(1)}</p>\n`
    title.level = tokens[i].level + 1

    if (end >= kids.length) {
      // Only the marker: drop its paragraph.
      tokens.splice(i + 1, 3, title)
    } else {
      inline.children = kids.slice(end + 1)
      tokens.splice(i + 1, 0, title)
    }
  }
}

function makeTasks(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'list_item_open') continue
    const inline = tokens[i + 2]
    if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline' || !inline.children?.length) continue
    const first = inline.children[0]
    const m = first.type === 'text' ? TASK_MARK.exec(first.content) : null
    if (!m) continue

    first.content = first.content.slice(m[0].length)
    const checked = m[1] !== ' ' ? ' checked="checked"' : ''
    const open = new state.Token('html_inline', '', 0)
    // The checkbox sits inside its label, so no id is needed to pair them and
    // adding a task does not change the markup of the ones after it.
    open.content = `<label class="task-list-item-label"><input type="checkbox" class="task-list-item-checkbox"${checked} disabled="disabled"> `
    const shut = new state.Token('html_inline', '', 0)
    shut.content = '</label>'
    inline.children.unshift(open)
    inline.children.push(shut)

    tokens[i].attrJoin('class', 'task-list-item')
    for (let j = i - 1; j >= 0; j--) {
      const t = tokens[j]
      if ((t.type === 'bullet_list_open' || t.type === 'ordered_list_open') && t.level === tokens[i].level - 1) {
        if (!t.attrGet('class')) t.attrSet('class', 'task-list-container')
        break
      }
    }
  }
}

export function taskAlertsPlugin(md: MarkdownIt): void {
  md.core.ruler.push('task_alerts', (state) => {
    makeAlerts(state)
    makeTasks(state)
    return true
  })
}
