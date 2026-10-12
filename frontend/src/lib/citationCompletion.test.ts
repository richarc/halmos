import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { citationCompletionSource, MAX_OPTIONS, type CitationContext } from './citationCompletion'
import type { CSLEntry } from './bibliography'

const smith: CSLEntry = {
  id: 'smith2020',
  type: 'article-journal',
  title: 'Neural networks for text',
  author: [{ family: 'Smith', given: 'Jo' }],
  issued: { 'date-parts': [[2020]] },
}
const jones: CSLEntry = { id: 'jones2019', type: 'book', title: 'Gardens', author: [{ family: 'Jones' }], issued: { 'date-parts': [[2019]] } }

function ctxOf(entries: CSLEntry[]): CitationContext {
  const ids = new Set(entries.map((e) => e.id))
  return { entries, has: (k) => ids.has(k), reference: () => null, bibName: 'refs.bib' }
}

/** `doc` has a "|" marking the cursor. */
function run(doc: string, context: CitationContext | null = ctxOf([smith, jones])): CompletionResult | null {
  const pos = doc.indexOf('|')
  const state = EditorState.create({ doc: doc.replace('|', ''), extensions: [markdown()] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const result = citationCompletionSource(() => context)(new CompletionContext(state, pos, false))
  return result as CompletionResult | null
}

describe('citationCompletionSource', () => {
  it('offers keys after "[@" and a bare "@"', () => {
    for (const doc of ['see [@|', 'see @|', 'see [@smith2020; @|']) {
      const r = run(doc)
      expect(r?.options.map((o) => o.label)).toEqual(['smith2020', 'jones2019'])
    }
    const o = run('[@|')!.options[0]
    expect(o.detail).toBe('Smith 2020')
    expect(o.info).toBe('Neural networks for text')
  })

  it('filters by key, author and title words', () => {
    expect(run('[@smi|')!.options.map((o) => o.label)).toEqual(['smith2020'])
    expect(run('[@neural|')!.options.map((o) => o.label)).toEqual(['smith2020'])
    expect(run('[@jon|')!.options.map((o) => o.label)).toEqual(['jones2019'])
    expect(run('[@zzz|')).toBeNull()
  })

  it('does not trigger after a word character (email)', () => {
    expect(run('a@|')).toBeNull()
    expect(run('mail me@exa|')).toBeNull()
  })

  it('does not trigger inside code, maths or frontmatter', () => {
    expect(run('`code @|`')).toBeNull()
    expect(run('```\n@|\n```')).toBeNull()
    expect(run('$x @|$')).toBeNull()
    expect(run('---\ntitle: @|\n---\n\ntext')).toBeNull()
  })

  it('returns null when no bibliography is loaded', () => {
    expect(run('[@|', null)).toBeNull()
  })

  it('caps options at MAX_OPTIONS for a 5000-entry library', () => {
    const many = Array.from({ length: 5000 }, (_, i): CSLEntry => ({ id: `key${i}`, type: 'book' }))
    expect(run('[@|', ctxOf(many))!.options).toHaveLength(MAX_OPTIONS)
    expect(run('[@key49|', ctxOf(many))!.options.length).toBeLessThanOrEqual(MAX_OPTIONS)
  })

  it('replaces only the typed key, not the brackets', () => {
    const r = run('see [@smi|')!
    expect(r.from).toBe('see [@'.length)
  })
})
