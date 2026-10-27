// The command palette's matching and order. Go lists the menu's commands
// (CommandService); this decides which of them a query finds, which come
// first, and how a row reads: "Insert: Table…" with its shortcut as "⇧⌘T".

import type { Command } from '../../bindings/hermes/models'

export interface Match {
  command: Command
  text: string
  // Matched character spans in text, [start, end), for bold.
  ranges: [number, number][]
}

// The menu name, then any submenus and the label: "Insert: Code Block › Python".
export function commandText(c: Pick<Command, 'path' | 'label'>): string {
  const path = c.path ?? []
  if (path.length === 0) return c.label
  return path[0] + ': ' + [...path.slice(1), c.label].join(' › ')
}

// macOS writes modifiers in a fixed order whatever order the chord names them.
const MODIFIERS: [string, string][] = [
  ['Ctrl', '⌃'],
  ['Option', '⌥'],
  ['Shift', '⇧'],
  ['Cmd', '⌘'],
]

// Wails' display form ("Cmd+Shift+T") as the menu shows it ("⇧⌘T"). The key
// is the last part, so "Cmd+Option+[" keeps its bracket.
export function formatAccelerator(acc: string): string {
  if (acc === '') return ''
  const parts = acc.split('+')
  const key = parts.pop() ?? ''
  const mods = MODIFIERS.filter(([name]) => parts.includes(name)).map(([, symbol]) => symbol)
  return mods.join('') + key
}

// Score weights, in the spec's order of importance: starting a word beats
// matching inside one, the label part beats the menu name, and each gap
// between matched characters costs a little.
const WORD_START = 8
const IN_LABEL = 4
const PER_CHAR = 1
const GAP = 2

const WORD_CHAR = /[\p{L}\p{N}]/u

// The best placement of query's characters, in order, in text, or null when
// they do not all appear. A greedy left-to-right placement would put the t of
// "tab" in "Insert"; this keeps, for every query character and position, the
// best score of any placement ending there.
function matchText(text: string, query: string[], labelStart: number): { score: number; ranges: [number, number][] } | null {
  const n = text.length
  const lower = Array.from({ length: n }, (_, j) => text[j].toLowerCase())

  let k = 0
  for (let j = 0; j < n && k < query.length; j++) if (lower[j] === query[k]) k++
  if (k < query.length) return null

  const charScore = (j: number) =>
    PER_CHAR + (j === 0 || !WORD_CHAR.test(text[j - 1]) ? WORD_START : 0) + (j >= labelStart ? IN_LABEL : 0)

  const rows: Float64Array[] = []
  const back: Int32Array[] = []
  for (let i = 0; i < query.length; i++) {
    const row = new Float64Array(n).fill(-Infinity)
    const from = new Int32Array(n).fill(-1)
    const prev = rows[i - 1]
    // Best score in the previous row at or before j-2: a placement with a gap.
    let far = -Infinity
    let farAt = -1
    for (let j = i; j < n; j++) {
      if (i > 0 && j >= 2 && prev[j - 2] > far) {
        far = prev[j - 2]
        farAt = j - 2
      }
      if (lower[j] !== query[i]) continue
      if (i === 0) {
        row[j] = charScore(j)
        continue
      }
      const adjacent = prev[j - 1]
      const gapped = far - GAP
      if (adjacent === -Infinity && gapped === -Infinity) continue
      if (adjacent >= gapped) {
        row[j] = adjacent + charScore(j)
        from[j] = j - 1
      } else {
        row[j] = gapped + charScore(j)
        from[j] = farAt
      }
    }
    rows.push(row)
    back.push(from)
  }

  const last = rows[query.length - 1]
  let end = -1
  for (let j = 0; j < n; j++) if (last[j] > -Infinity && (end < 0 || last[j] > last[end])) end = j
  if (end < 0) return null

  const positions: number[] = []
  for (let i = query.length - 1, j = end; i >= 0; j = back[i][j], i--) positions.push(j)
  positions.reverse()

  const ranges: [number, number][] = []
  for (const p of positions) {
    const r = ranges[ranges.length - 1]
    if (r && r[1] === p) r[1] = p + 1
    else ranges.push([p, p + 1])
  }
  return { score: last[end], ranges }
}

// What the palette lists for query. Case and spaces in the query are
// ignored. An empty query lists the recent commands that still exist, newest
// first, then the rest in menu order; Go sends recent ids unfiltered, so one
// whose item is gone is skipped here. The welcome window has no document, so
// commands that need one are left out.
export function rankCommands(commands: Command[], query: string, recent: string[], opts: { welcome: boolean }): Match[] {
  const usable = opts.welcome ? commands.filter((c) => !c.needsDocument) : commands
  const q = Array.from(query.replace(/\s+/g, ''), (ch) => ch.toLowerCase())

  if (q.length === 0) {
    const byId = new Map(usable.map((c) => [c.id, c]))
    const first: Command[] = []
    for (const id of recent) {
      const c = byId.get(id)
      if (c && !first.includes(c)) first.push(c)
    }
    const rest = usable.filter((c) => !first.includes(c))
    return [...first, ...rest].map((command) => ({ command, text: commandText(command), ranges: [] }))
  }

  const scored: { match: Match; score: number; order: number }[] = []
  usable.forEach((command, order) => {
    const text = commandText(command)
    const path = command.path ?? []
    const labelStart = path.length === 0 ? 0 : path[0].length + 2
    const m = matchText(text, q, labelStart)
    if (m) scored.push({ match: { command, text, ranges: m.ranges }, score: m.score, order })
  })
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.map((s) => s.match)
}
