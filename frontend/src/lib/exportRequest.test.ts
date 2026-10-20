import { describe, it, expect } from 'vitest'
import {
  planImages, finalizeImages, bracketDepthProblem, checkRequest, buildBibliography, withReferencesHeading,
} from './exportRequest'

const MiB = 1024 * 1024

describe('planImages for Word', () => {
  it('gives each local image a safe key and remembers its source', () => {
    const md = '# T\n\n![A plot](<figs/my plot.png>)\n\n![B](figs/b.jpg "Title")\n'
    const { markdown, refs } = planImages(md, 'docx', true)
    expect(refs).toEqual([
      { src: 'figs/my plot.png', key: 'images/1' },
      { src: 'figs/b.jpg', key: 'images/2' },
    ])
    expect(markdown).not.toContain('my plot')
    expect(markdown).toMatch(/!\[A plot\]\(images\/1\.halmos-pending\)/)
    expect(markdown).toMatch(/!\[B\]\(images\/2\.halmos-pending "Title"\)/)
  })

  it('gives two references to one image one key', () => {
    const { refs, markdown } = planImages('![a](x.png)\n\n![b](./x.png)\n', 'docx', true)
    expect(refs).toEqual([{ src: 'x.png', key: 'images/1' }])
    expect(markdown.match(/images\/1\.halmos-pending/g)).toHaveLength(2)
  })

  it('leaves remote, data: and absolute images alone', () => {
    const md = '![r](https://x.org/a.png)\n\n![d](data:image/png;base64,AAAA)\n\n![abs](/Users/me/a.png)\n'
    const { markdown, refs } = planImages(md, 'docx', true)
    expect(refs).toEqual([])
    expect(markdown).toBe(md)
  })

  it('leaves an image inside a code block alone', () => {
    const md = '```\n![a](x.png)\n```\n\n    ![b](y.png)\n'
    expect(planImages(md, 'docx', true)).toEqual({ markdown: md, refs: [] })
  })

  it('skips local images when the document has no path', () => {
    const md = '![a](x.png)\n'
    expect(planImages(md, 'docx', false)).toEqual({ markdown: md, refs: [] })
  })

  it('keeps front matter as it is', () => {
    const md = '---\ntitle: "![not](an image.png)"\n---\n\n![a](x.png)\n'
    const { markdown } = planImages(md, 'docx', true)
    expect(markdown.startsWith('---\ntitle: "![not](an image.png)"\n---\n')).toBe(true)
    expect(markdown).toContain('![a](images/1.halmos-pending)')
  })
})

describe('planImages for LaTeX', () => {
  it('only drops a leading ./ and reads nothing', () => {
    const { markdown, refs } = planImages('![a](./figs/a.png)\n\n![b](figs/b.png)\n', 'latex', true)
    expect(refs).toEqual([])
    expect(markdown).toBe('![a](figs/a.png)\n\n![b](figs/b.png)\n')
  })
})

describe('finalizeImages', () => {
  it('gives a resolved image its extension', () => {
    const { markdown } = planImages('![a](<figs/my plot.png>)\n', 'docx', true)
    expect(finalizeImages(markdown, [{ key: 'images/1', src: 'figs/my plot.png', ext: 'png' }]))
      .toBe('![a](images/1.png)\n')
  })

  it('puts back the original reference when the image could not be read', () => {
    const { markdown } = planImages('![a](<figs/my plot.png>)\n', 'docx', true)
    expect(finalizeImages(markdown, [{ key: 'images/1', src: 'figs/my plot.png', ext: null }]))
      .toBe('![a](<figs/my plot.png>)\n')
  })
})

describe('bracketDepthProblem', () => {
  const nest = (n: number) => '['.repeat(n) + 'x' + ']'.repeat(n)

  it('allows six levels in a paragraph', () => {
    expect(bracketDepthProblem(`a\n${nest(6)}\n`)).toBeNull()
  })

  it('reports the line where a paragraph passes six', () => {
    expect(bracketDepthProblem(`a\n\nb\n${nest(7)}\n`)).toEqual({ line: 4 })
  })

  it('counts across the lines of one paragraph', () => {
    expect(bracketDepthProblem('[[[[\n[[[x]]]]]]]\n')).toEqual({ line: 2 })
  })

  it('starts afresh after a blank line, including one of spaces and tabs', () => {
    expect(bracketDepthProblem('[[[[\n\n[[[x]]]\n')).toBeNull()
    expect(bracketDepthProblem('[[[[\n \t \n[[[x]]]\n')).toBeNull()
  })

  it('does not count escaped brackets', () => {
    expect(bracketDepthProblem('\\[\\[\\[\\[\\[\\[\\[x\n')).toBeNull()
  })

  it('counts brackets in code', () => {
    expect(bracketDepthProblem('```\n' + nest(7) + '\n```\n')).toEqual({ line: 2 })
  })
})

describe('checkRequest', () => {
  const base = { format: 'docx' as const, markdown: 'x' }
  // Base64 text that decodes to exactly `bytes` bytes.
  const b64 = (bytes: number) =>
    'A'.repeat(Math.floor(bytes / 3) * 4) + ['', 'AA==', 'AAA='][bytes % 3]

  it('accepts a request at every limit', () => {
    expect(checkRequest({ ...base, markdown: 'a'.repeat(2 * MiB) })).toBeNull()
    expect(checkRequest({ ...base, bibliography: 'a'.repeat(2 * MiB) })).toBeNull()
    expect(checkRequest({ ...base, csl: 'a'.repeat(256 * 1024) })).toBeNull()
  })

  it('names what is over its limit', () => {
    expect(checkRequest({ ...base, markdown: 'a'.repeat(2 * MiB + 1) })).toEqual({ code: 'markdown_size' })
    expect(checkRequest({ ...base, markdown: 'é'.repeat(MiB + 1) })).toEqual({ code: 'markdown_size' })
    expect(checkRequest({ ...base, bibliography: 'a'.repeat(2 * MiB + 1) })).toEqual({ code: 'bibliography_size' })
    expect(checkRequest({ ...base, csl: 'a'.repeat(256 * 1024 + 1) })).toEqual({ code: 'csl_size' })
  })

  it('refuses a style with a DTD', () => {
    expect(checkRequest({ ...base, csl: '<?xml?><!DOCTYPE style><style/>' })).toEqual({ code: 'csl_dtd' })
    expect(checkRequest({ ...base, csl: '<!ENTITY x "y">' })).toEqual({ code: 'csl_dtd' })
  })

  it('checks image count, size and total', () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`images/${i}.png`, 'AAAA']))
    expect(checkRequest({ ...base, images: many })).toEqual({ code: 'image_count' })
    expect(checkRequest({ ...base, images: { 'images/1.png': b64(8 * MiB + 3) } })).toEqual({ code: 'image_size' })
    expect(checkRequest({ ...base, images: { 'images/1.png': b64(8 * MiB) } })).toBeNull()
    const three = { 'images/1.png': b64(6 * MiB), 'images/2.png': b64(6 * MiB), 'images/3.png': b64(6 * MiB) }
    expect(checkRequest({ ...base, images: three })).toEqual({ code: 'images_total' })
  })

  it('reports too-deep brackets with their line', () => {
    expect(checkRequest({ ...base, markdown: 'a\n[[[[[[[x]]]]]]]\n' })).toEqual({ code: 'nesting', line: 2 })
  })
})

describe('buildBibliography', () => {
  const bib = '@article{a, title={A}}\n@article{b, title={B}}\n'

  it('keeps only the entries the document cites', () => {
    const out = buildBibliography('As shown [@a].', bib)
    expect(out).toContain('@article{a,')
    expect(out).not.toContain('@article{b,')
  })

  it('sends nothing when there is no bibliography or no citation', () => {
    expect(buildBibliography('As shown [@a].', '')).toBeUndefined()
    expect(buildBibliography('No citations.', bib)).toBeUndefined()
  })
})

describe('withReferencesHeading', () => {
  it('ends the document with an unnumbered References heading', () => {
    expect(withReferencesHeading('# T\n\nAs shown [@a].\n\n\n')).toBe(
      '# T\n\nAs shown [@a].\n\n## References {.unnumbered}\n',
    )
  })

  it('leaves a document that places the list with a refs div alone', () => {
    const md = 'As shown [@a].\n\n# Sources\n\n::: {#refs}\n:::\n\n# Appendix\n'
    expect(withReferencesHeading(md)).toBe(md)
  })
})
