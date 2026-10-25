import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { CSLEntry } from './bibliography'
import type { EditorState } from '@codemirror/state'
import { inFrontmatter, isInCode } from './markdownCommands'
import { mathRangesIn } from './spellcheck'
import { isCrossrefKey } from './crossrefs'

/** What the editor needs to know about the loaded bibliography. */
export interface CitationContext {
  entries: CSLEntry[]
  has(key: string): boolean
  reference(key: string): string | null
  bibName: string
}

export const MAX_OPTIONS = 100

/** A suggestion carries its entry's title, drawn as the row's second line. */
interface CitationCompletion extends Completion {
  title?: string
}

const CITATION = 'citation'

/** Row class for a citation suggestion, so its two-line layout leaves other completions alone. */
export function citationOptionClass(c: Completion): string {
  return c.type === CITATION ? 'cm-citation-option' : ''
}

/**
 * The title line of a citation suggestion, for autocompletion's addToOptions.
 * Position 90 puts it after the label (50) and the author-year detail (80).
 */
export const citationOptionTitle = {
  render(c: Completion): Node | null {
    const title = c.type === CITATION ? (c as CitationCompletion).title : undefined
    if (!title) return null
    const el = document.createElement('span')
    el.className = 'cm-citation-title'
    el.textContent = title
    return el
  },
  position: 90,
}

// The key characters Pandoc allows, plus "." (which can sit inside a key).
const TYPED_KEY = /@([\w:#$%&\-+?<>~/.]*)$/
// Same boundary as narrativeRule in citations.ts: a bare "@" must not follow
// a word character, ".", "-", "@" or "[" (the last belongs to the bracket form).
const NOT_BEFORE_BARE = /[\w.\-@[]/
// Inside an open bracket group, after a ";" separator.
const AFTER_SEPARATOR = /\[[^[\]]*;\s*$/
// The text before the "@" is a URL or path being typed (https://x.social/@me,
// medium.com/@me): the preview reads those as links, so offering keys there
// is noise.
const IN_URL = /(?:\/|[a-z][\w+.-]*:\/\/\S*|www\.\S*)$/i

function names(entry: CSLEntry): string[] {
  return (entry.author ?? entry.editor ?? []).map((n) => n.family ?? n.literal ?? '').filter(Boolean)
}

function label(entry: CSLEntry): string {
  const first = names(entry)[0] ?? ''
  const year = entry.issued?.['date-parts']?.[0]?.[0]
  return [first, year].filter((p) => p !== '' && p !== undefined).join(' ')
}

interface Searchable {
  entry: CSLEntry
  key: string
  words: string[]
}

// Lower-cased key and author/title words, built once per entries array rather
// than on every keystroke.
const searchable = new WeakMap<CSLEntry[], Searchable[]>()

/**
 * Bibliography ids that read as cross-references (`fig:old`), so the preview
 * can never cite them. Completion leaves them out; a warning can name them.
 */
export function shadowedKeys(entries: CSLEntry[]): string[] {
  return entries.filter((e) => isCrossrefKey(e.id)).map((e) => e.id)
}

function index(entries: CSLEntry[]): Searchable[] {
  let list = searchable.get(entries)
  if (!list) {
    list = entries.filter((e) => !isCrossrefKey(e.id)).map((entry) => ({
      entry,
      key: entry.id.toLowerCase(),
      words: [...(entry.author ?? entry.editor ?? []).flatMap((n) => [n.family, n.given, n.literal]), entry.title]
        .filter((w): w is string => !!w)
        .join(' ')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    }))
    searchable.set(entries, list)
  }
  return list
}

function rank(item: Searchable, q: string): number {
  if (!q) return 2
  if (item.key.startsWith(q)) return 0
  if (item.key.includes(q)) return 1
  return item.words.some((w) => w.startsWith(q)) ? 1 : -1
}

// Protection checks are local: a typing keystroke must not scan the document.
const MAX_BLOCK_LINES = 40

/** True when `at` sits inside a maths span found in the blank-line-bounded block around it. */
function inLocalMaths(state: EditorState, at: number): boolean {
  const { doc } = state
  const here = doc.lineAt(at).number
  let first = here
  while (first > 1 && here - first < MAX_BLOCK_LINES && doc.line(first - 1).text.trim() !== '') first--
  let last = here
  while (last < doc.lines && last - here < MAX_BLOCK_LINES && doc.line(last + 1).text.trim() !== '') last++
  const from = doc.line(first).from
  const text = doc.sliceString(from, doc.line(last).to)
  return mathRangesIn(text, from).some((r) => at >= r.from && at < r.to)
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
    const inBracket = (p: string) => p.endsWith('[') || AFTER_SEPARATOR.test(p)
    // "-@key" is the author-suppressed form, valid only inside a bracket group.
    const ok = inBracket(prefix) || (prev === '-' && inBracket(prefix.slice(0, -1))) || !NOT_BEFORE_BARE.test(prev)
    if (!ok || IN_URL.test(prefix)) return null

    if (inFrontmatter(cc.state, cc.pos) || isInCode(cc.state, cc.pos)) return null
    if (inLocalMaths(cc.state, at)) return null

    // `@fig:` and friends belong to the cross-reference source, not citations.
    if (isCrossrefKey(typed[1])) return null

    const q = typed[1].toLowerCase()
    const ranked: { entry: CSLEntry; rank: number }[] = []
    for (const item of index(ctx.entries)) {
      const r = rank(item, q)
      if (r >= 0) ranked.push({ entry: item.entry, rank: r })
    }
    ranked.sort((a, b) => a.rank - b.rank)

    const options: CitationCompletion[] = ranked.slice(0, MAX_OPTIONS).map(({ entry }) => ({
      label: entry.id,
      detail: label(entry),
      title: entry.title,
      type: CITATION,
    }))
    if (options.length === 0) return null

    // Filtering is done here (author and title words, not just the label), so
    // CodeMirror must re-ask on every keystroke rather than re-filter.
    return { from: at + 1, options, filter: false }
  }
}
