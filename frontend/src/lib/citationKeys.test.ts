import { describe, it, expect } from 'vitest'
import { findCitationKeys, unknownCitations } from './citationKeys'
import { extractCitationKeys } from './citationFeedback'

const CORPUS = [
  'As shown [@smith2020].',
  '[@a2020; @b2021]',
  '[see @smith2020, pp. 33-35]',
  'Smith said blah [-@smith2020].',
  '@smith2020 shows the effect.',
  'mail me at test@example.com',
  '[a link](https://x.y) and [plain brackets]',
  '`[@smith2020]`',
  '[@a1] then @b2 then [@c3]',
  '[my @cite here](https://example.com)',
  '[a [@cite] link](https://example.com)',
  '[see @smith][ref]\n\n[ref]: https://example.com',
  'Note [@key\nsome [text] after',
  '[@a2020][@b2021]',
  'See [@smith2020][TODO check]',
  'As @smith2020. said',
  '[see @a, p. 3; -@b]',
  'mail a@b.org `@x`\n\n```\n@y\n```',
  '@a\n\n[@b; @a]',
  '> quoted @a and [@b]\n> more @c',
  '- item @a\n- item [@b, p. 2]\n  continued @c',
  '1. numbered [@a; @b]',
  '# Heading @a\n\nSetext @b\n========',
  '| h | h2 |\n|---|---|\n| @a | [@b] |',
  '![figure @a](x.png) and @b',
  '*@a* and **[@b]** and _@c_',
  'line one @a\r\nline two [@b]\r\n',
  '    indented code @a\n\ntext @b',
  '@a @b @c: @d? @e# [@f:]',
  '[@a.b-c_d:e/f]',
  'a `code` @x then `[@y]` then [@z]',
  '',
  '   ',
  '[ @a ]',
  '[-@a; -@b, p. 3]',
]

describe('findCitationKeys', () => {
  it('agrees with the preview rule on a corpus', () => {
    for (const text of CORPUS)
      expect(findCitationKeys(text).map((s) => s.key), JSON.stringify(text)).toEqual(
        extractCitationKeys(text),
      )
  })

  it('reports exact offsets on a corpus', () => {
    for (const text of CORPUS)
      for (const s of findCitationKeys(text))
        expect(text.slice(s.from, s.to), JSON.stringify(text)).toBe(s.key)
  })

  it('spans exclude trailing sentence punctuation', () => {
    const t = 'As @smith2020. said'
    const [s] = findCitationKeys(t)
    expect(t.slice(s.from, s.to)).toBe('smith2020')
  })

  it('finds every key in a group with offsets', () => {
    const t = '[see @a, p. 3; -@b]'
    expect(findCitationKeys(t).map((s) => t.slice(s.from, s.to))).toEqual(['a', 'b'])
  })

  it('ignores emails, code spans, fenced code and frontmatter', () => {
    expect(findCitationKeys('mail a@b.org `@x`\n\n```\n@y\n```')).toEqual([])
    expect(findCitationKeys('---\nauthor: "@z"\n---\n@k').map((s) => s.key)).toEqual(['k'])
  })

  it('offsets are document-absolute after frontmatter', () => {
    const t = '---\nbibliography: r.bib\n---\n\nSee [@k1; @k2].\n'
    expect(findCitationKeys(t).map((s) => t.slice(s.from, s.to))).toEqual(['k1', 'k2'])
  })

  it('works on a lone line slice', () => {
    const t = '  - note @abc, then [@d]'
    expect(findCitationKeys(t).map((s) => t.slice(s.from, s.to))).toEqual(['abc', 'd'])
  })
})

describe('unknownCitations', () => {
  it('lists unknown keys with lines', () => {
    expect(unknownCitations('@a\n\n[@b; @a]', (k) => k === 'a')).toEqual([{ key: 'b', line: 3 }])
  })
  it('counts lines from the top of the document including frontmatter', () => {
    expect(unknownCitations('---\nx: y\n---\n@q', () => false)).toEqual([{ key: 'q', line: 4 }])
  })
})
