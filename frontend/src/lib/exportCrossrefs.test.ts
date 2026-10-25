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

  it('returns a document with no targets unchanged', () => {
    expect(labelForExport('Just text.\n')).toBe('Just text.\n')
  })

  it('lets a chart keep its generated label on the picture', () => {
    const md = '```vega-lite\n{"title":"Yield","mark":"bar"}\n```\n'
    const out = replaceDiagramFences(labelForExport(md), ['PNG'])
    expect(out.markdown).toBe('![Yield](diagrams/1.png){#fig:halmos-1}\n')
  })
})
