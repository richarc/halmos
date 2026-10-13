import { describe, it, expect } from 'vitest'
import { parseFrontmatter, frontmatterKeyChange } from './frontmatter'

describe('parseFrontmatter', () => {
  it('extracts bibliography and csl and strips the block', () => {
    const doc = '---\nbibliography: refs.bib\ncsl: ieee\n---\n# Title\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('refs.bib')
    expect(fm.csl).toBe('ieee')
    expect(fm.body).toBe('# Title\n')
  })

  it('extracts toc and toc-depth', () => {
    const fm = parseFrontmatter('---\ntoc: true\ntoc-depth: 2\n---\nBody\n')
    expect(fm.toc).toBe('true')
    expect(fm['toc-depth']).toBe('2')
    expect(fm.body).toBe('Body\n')
  })

  it('drops a trailing YAML comment from an unquoted value', () => {
    const fm = parseFrontmatter('---\ntoc: true  # a [[toc]] paragraph positions the contents\n---\nBody')
    expect(fm.toc).toBe('true')
  })

  it('keeps a # that is part of the value', () => {
    const fm = parseFrontmatter('---\nbibliography: refs#2.bib\ncsl: "a # b"\n---\nBody')
    expect(fm.bibliography).toBe('refs#2.bib')
    expect(fm.csl).toBe('a # b')
  })

  it('handles quoted values and extra whitespace', () => {
    const doc = '---\nbibliography:  "my refs.bib"\n---\nText'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('my refs.bib')
  })

  it('ignores unknown keys but still strips the block', () => {
    const doc = '---\ntitle: My Paper\n---\nText'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.body).toBe('Text')
  })

  it('returns the document unchanged when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just a doc').body).toBe('# Just a doc')
  })

  it('does not treat a mid-document --- as frontmatter', () => {
    const doc = 'Intro\n\n---\nbibliography: x.bib\n---\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.body).toBe(doc)
  })

  it('strips an empty frontmatter block', () => {
    expect(parseFrontmatter('---\n---\n# Title').body).toBe('# Title')
  })

  it('parses a block written with CRLF line endings', () => {
    const doc = '---\r\nbibliography: refs.bib\r\ncsl: ieee\r\n---\r\n# Title\r\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('refs.bib')
    expect(fm.csl).toBe('ieee')
    expect(fm.body).toBe('# Title\r\n')
  })

  it('handles an unterminated CRLF block as plain text', () => {
    const doc = '---\r\nbibliography: refs.bib\r\nno closing fence'
    expect(parseFrontmatter(doc).body).toBe(doc)
  })

  it('does not accept a longer run of dashes as the closing fence', () => {
    const doc = '---\ncsl: apa\n----\nstill inside\n---\nreal body'
    const fm = parseFrontmatter(doc)
    expect(fm.csl).toBe('apa')
    expect(fm.body).toBe('real body')
  })

  it('handles an unterminated frontmatter block as plain text', () => {
    const doc = '---\nbibliography: refs.bib\nno closing fence'
    expect(parseFrontmatter(doc).body).toBe(doc)
  })
})

describe('bodyStartLine', () => {
  it('is 1 when there is no frontmatter', () => {
    expect(parseFrontmatter('# Title\n').bodyStartLine).toBe(1)
  })

  it('is the first line after the closing fence', () => {
    // ---(1) bibliography(2) ---(3) → body starts on line 4
    expect(parseFrontmatter('---\nbibliography: r.bib\n---\n# Title\n').bodyStartLine).toBe(4)
  })

  it('counts a multi-line block', () => {
    const src = '---\na: 1\nb: 2\nc: 3\n---\nbody\n'
    expect(parseFrontmatter(src).bodyStartLine).toBe(6)
  })

  it('is 1 for an unterminated block, which is not frontmatter', () => {
    expect(parseFrontmatter('---\nnot closed\n# Title\n').bodyStartLine).toBe(1)
  })
})

describe('frontmatterKeyChange', () => {
  const apply = (doc: string, key: string, value: string) => {
    const c = frontmatterKeyChange(doc, key, value)
    return doc.slice(0, c.from) + c.insert + doc.slice(c.to)
  }

  it('replaces an existing csl line', () => {
    const doc = '---\nbibliography: refs.bib\ncsl: "apa"\n---\n# T\n'
    expect(apply(doc, 'csl', 'ieee')).toBe('---\nbibliography: refs.bib\ncsl: ieee\n---\n# T\n')
  })

  it('replaces the last of two csl lines, the one parseFrontmatter reads', () => {
    const doc = '---\ncsl: apa\ncsl: chicago\n---\n# T\n'
    const out = apply(doc, 'csl', 'ieee')
    expect(out).toBe('---\ncsl: apa\ncsl: ieee\n---\n# T\n')
    expect(parseFrontmatter(out).csl).toBe('ieee')
  })

  it('adds csl before the closing fence', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# T\n'
    expect(apply(doc, 'csl', 'ieee')).toBe('---\nbibliography: refs.bib\ncsl: ieee\n---\n# T\n')
  })

  it('creates a frontmatter block when there is none', () => {
    expect(apply('# T\n', 'csl', 'ieee')).toBe('---\ncsl: ieee\n---\n# T\n')
  })

  it('handles an empty block and CRLF documents', () => {
    expect(apply('---\n---\nx', 'csl', 'ieee')).toBe('---\ncsl: ieee\n---\nx')
    expect(apply('---\r\ncsl: apa\r\n---\r\nx', 'csl', 'ieee')).toBe('---\r\ncsl: ieee\r\n---\r\nx')
    expect(apply('---\r\nbibliography: a.bib\r\n---\r\nx', 'csl', 'ieee')).toBe(
      '---\r\nbibliography: a.bib\r\ncsl: ieee\r\n---\r\nx',
    )
    expect(apply('# T\r\n', 'csl', 'ieee')).toBe('---\r\ncsl: ieee\r\n---\r\n# T\r\n')
  })

  it('quotes values plain YAML would misread, and only those', () => {
    expect(apply('# T', 'csl', 'my styles/x.csl')).toContain('csl: my styles/x.csl\n')
    expect(apply('# T', 'csl', 'a: b')).toContain('csl: "a: b"\n')
    expect(apply('# T', 'csl', 'a #b')).toContain('csl: "a #b"\n')
    expect(apply('# T', 'csl', ' x')).toContain('csl: " x"\n')
  })

  it('does not match a longer key or text outside the block', () => {
    const doc = '---\ncsl-note: x\n---\ncsl: body\n'
    expect(apply(doc, 'csl', 'ieee')).toBe('---\ncsl-note: x\ncsl: ieee\n---\ncsl: body\n')
  })

  it('reads back exactly what it wrote', () => {
    const values = [
      'styles/x.csl', 'my styles/x.csl', 'a#b.csl', 'a: b.csl',
      'my "x": b.csl', 'a\\b:c.csl', "'q'.csl", '"q".csl',
    ]
    for (const value of values) {
      for (const doc of ['# T\n', '---\nbibliography: r.bib\n---\n# T\n', '---\ncsl: old\n---\nx']) {
        expect(parseFrontmatter(apply(doc, 'csl', value)).csl).toBe(value)
      }
    }
  })
})
