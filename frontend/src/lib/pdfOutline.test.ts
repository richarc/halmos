import { describe, expect, it } from 'vitest'
import { pdfOutline } from './pdfOutline'
import { parseFrontmatter } from './frontmatter'

describe('pdfOutline', () => {
  it('sends each heading with the text its bookmark shows and the text to find', () => {
    const o = pdfOutline(
      [
        { level: 1, text: 'Introduction', line: 1 },
        { level: 2, text: 'Results for x^2', line: 5, match: 'Results for \u0000', gaps: [3] },
      ],
      parseFrontmatter('# Introduction\n'),
    )
    expect(o.headings).toEqual([
      { level: 1, text: 'Introduction', match: 'Introduction', gaps: [] },
      { level: 2, text: 'Results for x^2', match: 'Results for \u0000', gaps: [3] },
    ])
  })

  it('takes the title and the author names, without affiliations', () => {
    const fm = parseFrontmatter(
      '---\ntitle: A Thesis\nauthor:\n  - name: Ada Lovelace\n    affiliation: Analytical Society\n  - Charles Babbage\n---\n\nText\n',
    )
    const o = pdfOutline([], fm)
    expect(o.title).toBe('A Thesis')
    expect(o.authors).toEqual(['Ada Lovelace', 'Charles Babbage'])
  })

  it('says when the document renders a contents list', () => {
    expect(pdfOutline([], parseFrontmatter('---\ntoc: true\n---\n\n# A\n')).contents).toBe(true)
    expect(pdfOutline([], parseFrontmatter('# A\n')).contents).toBe(false)
  })

  it('sends empty values for an untitled document with no headings', () => {
    expect(pdfOutline([], parseFrontmatter('Just text.\n'))).toEqual({ headings: [], title: '', authors: [], contents: false })
  })
})
