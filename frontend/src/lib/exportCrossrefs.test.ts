import { describe, it, expect } from 'vitest'
import { abstractReferencesForExport, labelForExport } from './exportCrossrefs'
import { parseFrontmatter } from './frontmatter'
import { replaceDiagramFences } from './exportDiagrams'

describe('labelForExport', () => {
  it('labels an unlabelled captioned image and leaves author labels alone', () => {
    const md = '![A](a.png)\n\n![B](b.png){#fig:b}\n'
    expect(labelForExport(md)).toBe('![A](a.png){#fig:halmos-1}\n\n![B](b.png){#fig:b}\n')
  })

  it('skips a generated number that an author label already uses', () => {
    const md = '![A](a.png){#fig:halmos-1}\n\n![B](b.png)\n'
    expect(labelForExport(md)).toBe('![A](a.png){#fig:halmos-1}\n\n![B](b.png){#fig:halmos-2}\n')
  })

  it('labels a table on its caption line', () => {
    const md = '| a |\n|---|\n| 1 |\n\n: Yield\n'
    expect(labelForExport(md)).toBe('| a |\n|---|\n| 1 |\n\n: Yield {#tbl:halmos-1}\n')
  })

  it('keeps CRLF line endings', () => {
    expect(labelForExport('![A](a.png)\r\n')).toBe('![A](a.png){#fig:halmos-1}\r\n')
  })

  it('leaves uncaptioned, equation and nested targets alone', () => {
    const md = '![](a.png)\n\n$$\nx = 1\n$$\n\n- ![Inner](c.png)\n'
    expect(labelForExport(md)).toBe(md)
  })

  // pandoc-crossref would number a labelled nested target; the preview does
  // not, so the export copy drops the label and both number alike.
  it('removes the label from nested targets so Word numbers what the preview numbers', () => {
    const md = [
      '- ![A](a.png){#fig:n}',
      '',
      '> | a |',
      '> |---|',
      '> | 1 |',
      '>',
      '> : Counts {#tbl:q}',
      '',
      '> $$',
      '> x',
      '> $$ {#eq:e}',
      '',
      '![Top](t.png)',
    ].join('\n')
    expect(labelForExport(md)).toBe(
      [
        '- ![A](a.png)',
        '',
        '> | a |',
        '> |---|',
        '> | 1 |',
        '>',
        '> : Counts',
        '',
        '> $$',
        '> x',
        '> $$',
        '',
        '![Top](t.png){#fig:halmos-1}',
      ].join('\n'),
    )
  })

  it('removes a nested chart label from its fence line', () => {
    const md = '- item\n\n  ```vega-lite {#fig:c}\n  {"title":"C","mark":"bar"}\n  ```\n'
    expect(labelForExport(md)).toBe('- item\n\n  ```vega-lite\n  {"title":"C","mark":"bar"}\n  ```\n')
  })

  it('returns a document with no targets unchanged', () => {
    expect(labelForExport('Just text.\n')).toBe('Just text.\n')
  })

  it('lets a chart keep its generated label on the picture', () => {
    const md = '```vega-lite\n{"title":"Yield","mark":"bar"}\n```\n'
    const out = replaceDiagramFences(labelForExport(md), ['PNG'])
    expect(out.markdown).toBe('![Yield](diagrams/1.png){#fig:halmos-1}\n')
  })
})

// pandoc-crossref resolves references in the body only, so a reference in
// the abstract reached Word and LaTeX as "fig:photo?". The export copy
// writes it as the text the preview shows.
describe('abstractReferencesForExport', () => {
  const NBSP = '\u00a0'
  const BODY = [
    '![A photo](a.png){#fig:a}',
    '',
    '![B photo](b.png){#fig:b}',
    '',
    '| x |',
    '| - |',
    '| 1 |',
    '',
    ': Yields {#tbl:t}',
    '',
    '$$ E = mc^2 $$ {#eq:e}',
    '',
    'Body refers to @fig:a.',
    '',
  ].join('\n')
  const doc = (abstract: string) => `---\ntitle: T\nabstract: |\n  ${abstract}\ncsl: apa\n---\n\n${BODY}`

  it('writes each kind of reference as its number', () => {
    const out = abstractReferencesForExport(doc('See @fig:b, @tbl:t and @eq:e.'))
    expect(parseFrontmatter(out).abstract).toBe(`See Figure${NBSP}2, Table${NBSP}1 and Equation${NBSP}1.\n`)
  })

  it('handles a capital at the start of a sentence and a group of references', () => {
    const out = abstractReferencesForExport(doc('@Fig:a shows it; so do [@fig:a; @fig:b].'))
    expect(parseFrontmatter(out).abstract).toBe(`Figure${NBSP}1 shows it; so do Figures${NBSP}1, 2.\n`)
  })

  it('works on a one-line abstract', () => {
    const md = `---\nabstract: As in @fig:b.\n---\n\n${BODY}`
    expect(parseFrontmatter(abstractReferencesForExport(md)).abstract).toBe(`As in Figure${NBSP}2.`)
  })

  it('leaves the body, other keys and unknown labels alone', () => {
    const md = doc('Missing @fig:nosuch, and a citation [@smith2020].')
    const out = abstractReferencesForExport(md)
    expect(out).toBe(md)
    const withRef = abstractReferencesForExport(doc('See @fig:a.'))
    expect(withRef.endsWith(BODY)).toBe(true)
    expect(parseFrontmatter(withRef).csl).toBe('apa')
    expect(parseFrontmatter(withRef).title).toBe('T')
  })

  it('returns the same string when there is nothing to change', () => {
    for (const md of [BODY, `---\ntitle: T\n---\n\n${BODY}`, '---\nabstract: [broken\n---\nx\n']) {
      expect(abstractReferencesForExport(md)).toBe(md)
    }
  })
})
