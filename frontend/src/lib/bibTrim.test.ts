import { describe, it, expect } from 'vitest'
import { trimBibliography } from './bibTrim'

const BIB = `% exported by Zotero
@string{nat = {Nature}}

@article{smith2020,
  title = {A {Nested} title},
  journal = nat,
}

@Book{jones2019,
  title = "Quoted {brace} value",
  note = "an unmatched } inside quotes",
}

@misc{unused2001, title = {Never cited}}
`

describe('trimBibliography', () => {
  it('keeps only the cited entries and the @string macros', () => {
    const out = trimBibliography(BIB, new Set(['smith2020', 'jones2019']))
    expect(out).toContain('@string{nat = {Nature}}')
    expect(out).toContain('@article{smith2020,')
    expect(out).toContain('title = {A {Nested} title},')
    expect(out).toContain('@Book{jones2019,')
    expect(out).toContain('an unmatched } inside quotes')
    expect(out).not.toContain('unused2001')
  })

  it('matches entry types in any case', () => {
    expect(trimBibliography(BIB, new Set(['jones2019']))).toContain('@Book{jones2019,')
  })

  it('returns nothing when nothing is cited', () => {
    expect(trimBibliography(BIB, new Set())).toBe('')
  })

  it('keeps @preamble and @comment blocks with the cited entries', () => {
    const bib = '@preamble{"\\newcommand{\\x}{y}"}\n@comment{note}\n@article{a, title={T}}\n@article{b, title={U}}\n'
    const out = trimBibliography(bib, new Set(['a']))
    expect(out).toContain('@preamble')
    expect(out).toContain('@comment{note}')
    expect(out).toContain('@article{a,')
    expect(out).not.toContain('@article{b,')
  })

  it('returns the text unchanged when it finds no entries it can read', () => {
    const odd = 'not really bibtex {{{'
    expect(trimBibliography(odd, new Set(['a']))).toBe(odd)
  })
})
