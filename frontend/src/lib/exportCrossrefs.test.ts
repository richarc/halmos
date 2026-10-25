import { describe, it, expect } from 'vitest'
import { labelForExport } from './exportCrossrefs'
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
