// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { keyAt, citationTooltip } from './citationEditor'
import { createCitationFormatter } from './citations'
import type { CitationContext } from './citationCompletion'
import type { CSLEntry } from './bibliography'

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown()] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

const ctx = (over: Partial<CitationContext> = {}): CitationContext => ({
  entries: [],
  has: (k) => k === 'smith2020',
  reference: (k) => (k === 'smith2020' ? '<div class="csl-entry">Smith (2020). <i>A study</i>.</div>' : null),
  bibName: 'refs.bib',
  ...over,
})

describe('keyAt', () => {
  const doc = 'See [@smith2020] here.'

  it('finds the key under the position', () => {
    const state = stateOf(doc)
    const from = doc.indexOf('smith2020')
    expect(keyAt(state, from + 3)).toEqual({ key: 'smith2020', from, to: from + 'smith2020'.length })
  })

  it('returns null off the key, including on the bracket', () => {
    const state = stateOf(doc)
    expect(keyAt(state, doc.indexOf('['))).toBeNull()
    expect(keyAt(state, doc.indexOf('here'))).toBeNull()
  })

  it('uses document coordinates on later lines', () => {
    const text = 'first line\nsee @smith2020'
    const from = text.indexOf('smith2020')
    expect(keyAt(stateOf(text), from + 1)?.from).toBe(from)
  })

  it('ignores keys inside code and frontmatter', () => {
    const inline = '`[@smith2020]`'
    expect(keyAt(stateOf(inline), inline.indexOf('smith') + 1)).toBeNull()
    const fenced = '```\n[@smith2020]\n```'
    expect(keyAt(stateOf(fenced), fenced.indexOf('smith') + 1)).toBeNull()
    const fm = '---\nnote: [@smith2020]\n---\n\ntext'
    expect(keyAt(stateOf(fm), fm.indexOf('smith') + 1)).toBeNull()
  })
})

describe('citationTooltip', () => {
  const doc = 'See [@smith2020] and [@nobody].'
  const at = (key: string) => doc.indexOf(key) + 1

  function dom(c: CitationContext | null, pos: number): HTMLElement | null {
    const tip = citationTooltip(() => c, stateOf(doc), pos)
    return tip ? (tip.create({} as never).dom as HTMLElement) : null
  }

  it('shows the formatted reference', () => {
    const el = dom(ctx(), at('smith2020'))!
    expect(el.innerHTML).toContain('Smith (2020).')
    expect(el.querySelector('i')?.textContent).toBe('A study')
  })

  it('says "Not in refs.bib" for an unknown key', () => {
    expect(dom(ctx(), at('nobody'))!.textContent).toBe('Not in refs.bib')
  })

  it('shows nothing without a bibliography', () => {
    expect(dom(null, at('smith2020'))).toBeNull()
  })

  it('shows nothing off a key', () => {
    expect(dom(ctx(), 1)).toBeNull()
  })

  it('renders markup in entry fields literally (citeproc escapes them)', async () => {
    const entry: CSLEntry = {
      id: 'evil2020',
      type: 'article-journal',
      title: '<script>alert(1)</script> & more',
      author: [{ family: 'Evil', given: 'E' }],
      issued: { 'date-parts': [[2020]] },
    }
    const f = await createCitationFormatter([entry], 'apa')
    const c = ctx({ has: () => true, reference: (k) => f.reference(k) })
    const text = 'x [@evil2020]'
    const tip = citationTooltip(() => c, stateOf(text), text.indexOf('evil') + 1)!
    const el = tip.create({} as never).dom as HTMLElement
    expect(el.querySelector('script')).toBeNull()
    expect(el.textContent).toContain('<script>alert(1)</script> & more')
  })
})
