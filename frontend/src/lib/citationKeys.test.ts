import { describe, it, expect } from 'vitest'
import { findCitationKeys, unknownCitations } from './citationKeys'
import { renderDocument } from './renderer'
import type { CitationCluster, CitationFormatter } from './citations'

/**
 * The keys the preview itself finds, in order: the renderer hands every
 * cluster it parsed to the formatter, so a recording formatter that knows
 * every key captures exactly what `renderer.ts` treats as a citation.
 */
function previewKeys(text: string): string[] {
  let seen: CitationCluster[] = []
  const recorder: CitationFormatter = {
    format(clusters) {
      seen = clusters
      return { texts: clusters.map(() => ''), bibliographyHtml: '' }
    },
    has: () => true,
    reference: () => null,
  }
  renderDocument(text, { formatter: recorder })
  return seen.flatMap((c) => c.items.map((it) => it.key))
}

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
  '| @a1 | @a2 |\n|---|---|\n| x | y |',
  '| h1 | h2 |\n|---|---|\n| @b1 | [@b2; @b3] |\n| @b4 | @b5 |',
  '[text with [@a] inside](https://x.y) then @b',
  '![alt @a](x.png "t") and [@b]',
  '![[@a]](x.png)',
  '[see @a][undefined] and [@b][also undefined]',
  '[outer [inner [@a] deep] @b] tail @c',
  '[x](<@a>) [@b](https://z) @c',
  '[[@a]]',
  // Footnotes: definitions with and without trailing text, and the inline form.
  'Text.[^2]\n\n[^2]: [@smith2020]',
  'Text.[^2]\n\n[^2]: [@smith2020].',
  'Text.[^2]\n\n[^2]: @smith2020',
  '[^1]: [@a]\n[^2]: see @b',
  'A claim.^[see @a] And @b.',
  'A ^[first @a] and ^[second [@b; @c]] then @d',
  // Bare URLs are links in the preview, not citations.
  'See https://mastodon.social/@alice',
  'Follow medium.com/@x for more',
  'Watch https://youtube.com/@channel and cite @a',
  // Maths is maths, not a citation.
  'Inline $f(@a)$ maths and @b',
  '$$\ng(@a)\n$$\n\nthen @b',
  // Alerts and task items change the first line of their block.
  '> [!NOTE]\n> See [@a] and @b.',
  '> [!warning]\n> Careful @a\n> more [@b; @c]',
  '- [ ] read @a\n- [x] cite [@b]',
  '> [!TIP]\n> - [ ] task [@a]\n> - plain @b',
]

describe('findCitationKeys', () => {
  it('agrees with the preview rule on a corpus', () => {
    for (const text of CORPUS)
      expect(findCitationKeys(text).map((s) => s.key), JSON.stringify(text)).toEqual(previewKeys(text))
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

describe('table cells', () => {
  it('gives each cell its own offsets in header and body rows', () => {
    const t = '| @a1 | @a2 |\n|---|---|\n| @b1 | @b2 |'
    const spans = findCitationKeys(t)
    expect(spans.map((s) => s.key)).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(spans.map((s) => t.slice(s.from, s.to))).toEqual(['a1', 'a2', 'b1', 'b2'])
  })
})

describe('footnotes and links', () => {
  it('finds a citation in a footnote definition at its offsets', () => {
    for (const t of ['x[^2]\n\n[^2]: [@smith2020]', 'x[^2]\n\n[^2]: [@smith2020].', 'x[^2]\n\n[^2]: @smith2020']) {
      const spans = findCitationKeys(t)
      expect(spans.map((s) => t.slice(s.from, s.to)), JSON.stringify(t)).toEqual(['smith2020'])
    }
  })

  it('finds a footnote definition on a line of its own', () => {
    const t = '[^2]: see @smith2020'
    expect(findCitationKeys(t).map((s) => t.slice(s.from, s.to))).toEqual(['smith2020'])
  })

  it('finds citations inside an inline footnote at their offsets', () => {
    const t = 'A claim.^[see @a; [@b]] And @c.'
    expect(findCitationKeys(t).map((s) => [s.key, t.slice(s.from, s.to)])).toEqual([
      ['a', 'a'],
      ['b', 'b'],
      ['c', 'c'],
    ])
  })

  it('does not read a handle in a bare URL as a citation', () => {
    expect(findCitationKeys('See https://mastodon.social/@alice')).toEqual([])
  })
})

describe('unknownCitations', () => {
  it('counts a footnote citation on its own line', () => {
    expect(unknownCitations('Text.[^1]\n\n[^1]: [@gone]', () => false)).toEqual([{ key: 'gone', line: 3 }])
  })
  it('does not count a URL handle', () => {
    expect(unknownCitations('See https://mastodon.social/@alice', () => false)).toEqual([])
  })
  it('lists unknown keys with lines', () => {
    expect(unknownCitations('@a\n\n[@b; @a]', (k) => k === 'a')).toEqual([{ key: 'b', line: 3 }])
  })
  it('counts lines from the top of the document including frontmatter', () => {
    expect(unknownCitations('---\nx: y\n---\n@q', () => false)).toEqual([{ key: 'q', line: 4 }])
  })
})
