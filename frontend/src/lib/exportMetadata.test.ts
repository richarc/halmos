import { describe, expect, it } from 'vitest'
import { authorsForExport } from './exportMetadata'
import { parseFrontmatter } from './frontmatter'

const doc = (yaml: string) => `---\n${yaml}\n---\n\n# Body\n\nText here.\n`

describe('authorsForExport', () => {
  it('flattens map authors to text', () => {
    const src = doc(
      'bibliography: refs.bib\nauthor:\n  - name: Ada Lovelace\n    affiliation: University of London\n  - Mary Somerville\nabstract: Short text.',
    )
    const out = authorsForExport(src)
    expect(parseFrontmatter(out).authors).toEqual([
      { name: 'Ada Lovelace, University of London' },
      { name: 'Mary Somerville' },
    ])
    expect(out).toContain('bibliography: refs.bib')
    expect(out).toContain('abstract: Short text.')
    expect(out.endsWith('\n---\n\n# Body\n\nText here.\n')).toBe(true)
  })

  it('uses the name alone when there is no affiliation', () => {
    const out = authorsForExport(doc('author:\n  - name: Ada Lovelace'))
    expect(parseFrontmatter(out).authors).toEqual([{ name: 'Ada Lovelace' }])
  })

  it('flattens a single author written as a map', () => {
    const out = authorsForExport(doc('author:\n  name: Ada\n  affiliation: Analytical Society'))
    expect(parseFrontmatter(out).authors).toEqual([{ name: 'Ada, Analytical Society' }])
  })

  it('leaves a map author without a text name unchanged', () => {
    const noName = doc('author:\n  - affiliation: Somewhere\n  - Ada')
    expect(authorsForExport(noName)).toBe(noName)
    const numeric = doc('author:\n  - name: 5\n    affiliation: X')
    expect(authorsForExport(numeric)).toBe(numeric)
    const single = doc('author:\n  affiliation: Somewhere')
    expect(authorsForExport(single)).toBe(single)
  })

  it('keeps CRLF line endings', () => {
    const out = authorsForExport(doc('author:\n  - name: Ada\n    affiliation: X').replace(/\n/g, '\r\n'))
    expect(out).not.toMatch(/[^\r]\n/)
    expect(parseFrontmatter(out).authors).toEqual([{ name: 'Ada, X' }])
  })

  it.each([
    ['plain names', doc('author:\n  - Ada\n  - Mary')],
    ['a single author string', doc('author: Ada Lovelace')],
    ['no author key', doc('title: T')],
    ['no frontmatter', '# Just a body\n'],
    ['invalid YAML', doc('author: [a\nfoo: : :')],
  ])('returns %s unchanged', (_n, src) => {
    expect(authorsForExport(src)).toBe(src)
  })
})
