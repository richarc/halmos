import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { CSLEntry } from './bibliography'
import { isProtected } from './markdownCommands'
import { mathRanges } from './spellcheck'

/** What the editor needs to know about the loaded bibliography. */
export interface CitationContext {
  entries: CSLEntry[]
  has(key: string): boolean
  reference(key: string): string | null
  bibName: string
}

export const MAX_OPTIONS = 100

// The key characters Pandoc allows, plus "." (which can sit inside a key).
const TYPED_KEY = /@([\w:#$%&\-+?<>~/.]*)$/
// Same boundary as narrativeRule in citations.ts: a bare "@" must not follow
// a word character, ".", "-", "@" or "[" (the last belongs to the bracket form).
const NOT_BEFORE_BARE = /[\w.\-@[]/
// Inside an open bracket group, after a ";" separator.
const AFTER_SEPARATOR = /\[[^[\]]*;\s*$/

function names(entry: CSLEntry): string[] {
  return (entry.author ?? entry.editor ?? []).map((n) => n.family ?? n.literal ?? '').filter(Boolean)
}

function label(entry: CSLEntry): string {
  const first = names(entry)[0] ?? ''
  const year = entry.issued?.['date-parts']?.[0]?.[0]
  return [first, year].filter((p) => p !== '' && p !== undefined).join(' ')
}

function matches(entry: CSLEntry, q: string): number {
  if (!q) return 2
  const key = entry.id.toLowerCase()
  if (key.startsWith(q)) return 0
  if (key.includes(q)) return 1
  const words = [
    ...(entry.author ?? entry.editor ?? []).flatMap((n) => [n.family, n.given, n.literal]),
    entry.title,
  ]
    .filter((w): w is string => !!w)
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
  return words.some((w) => w.startsWith(q)) ? 1 : -1
}

export function citationCompletionSource(get: () => CitationContext | null): CompletionSource {
  return (cc: CompletionContext): CompletionResult | null => {
    const ctx = get()
    if (!ctx) return null

    const line = cc.state.doc.lineAt(cc.pos)
    const before = line.text.slice(0, cc.pos - line.from)
    const typed = TYPED_KEY.exec(before)
    if (!typed) return null

    const at = cc.pos - typed[1].length - 1 // position of the "@"
    const prefix = before.slice(0, at - line.from)
    const prev = prefix.slice(-1)
    const ok = prev === '[' || AFTER_SEPARATOR.test(prefix) || !NOT_BEFORE_BARE.test(prev)
    if (!ok) return null

    if (isProtected(cc.state, cc.pos)) return null
    if (mathRanges(cc.state).some((r) => at >= r.from && at < r.to)) return null

    const q = typed[1].toLowerCase()
    const ranked: { entry: CSLEntry; rank: number }[] = []
    for (const entry of ctx.entries) {
      const rank = matches(entry, q)
      if (rank >= 0) ranked.push({ entry, rank })
    }
    ranked.sort((a, b) => a.rank - b.rank)

    const options: Completion[] = ranked.slice(0, MAX_OPTIONS).map(({ entry }) => ({
      label: entry.id,
      detail: label(entry),
      info: entry.title,
      type: 'text',
    }))
    if (options.length === 0) return null

    // Filtering is done here (author and title words, not just the label), so
    // CodeMirror must re-ask on every keystroke rather than re-filter.
    return { from: at + 1, options, filter: false }
  }
}
