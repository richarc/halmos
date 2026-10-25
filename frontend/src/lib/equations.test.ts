import { describe, it, expect } from 'vitest'
import { render } from './renderer'
import { EQUATION_LABEL, equationPlugin } from './equations'
import { createMarkdownParser } from './markdownParser'

describe('EQUATION_LABEL', () => {
  it('matches a label after the closing $$', () => {
    expect(EQUATION_LABEL.exec('$$ {#eq:sum}')?.[1]).toBe('eq:sum')
    expect(EQUATION_LABEL.exec('$$ a+b $$ {#eq:sum}  ')?.[1]).toBe('eq:sum')
  })
  it('ignores other kinds and bare $$', () => {
    expect(EQUATION_LABEL.test('$$ {#fig:x}')).toBe(false)
    expect(EQUATION_LABEL.test('$$')).toBe(false)
  })
})

describe('equation labels', () => {
  it('numbers a labelled multi-line equation and moves the anchor onto the wrapper', () => {
    const out = render('$$\na+b\n$$ {#eq:sum}\n')
    expect(out).toMatch(/^<div class="equation" id="eq:sum" data-source-line="1">/)
    expect(out).toContain('<span class="equation-number">(1)</span>')
    expect(out.indexOf('katex-display')).toBeLessThan(out.indexOf('equation-number'))
    expect(out.match(/data-source-line/g)).toHaveLength(1)
    expect(out).not.toMatch(/<p [^>]*data-source-line/)
  })

  it('reads a one-line label and keeps it out of the maths', () => {
    const out = render('$$ a+b $$ {#eq:sum}\n')
    expect(out).toContain('<div class="equation" id="eq:sum" data-source-line="1">')
    expect(out).toContain('(1)')
    expect(out).not.toContain('{#eq')
    expect(out).not.toContain('eq:sum}')
  })

  it('leaves an unlabelled equation as it was', () => {
    const out = render('$$\na+b\n$$\n')
    expect(out).toMatch(/^<p data-source-line="1" class="katex-block">/)
    expect(out).not.toContain('equation')
  })

  it('counts only labelled equations', () => {
    const out = render('$$\na\n$$ {#eq:a}\n\n$$\nb\n$$\n\n$$\nc\n$$ {#eq:c}\n')
    expect(out).toContain('(1)')
    expect(out).toContain('(2)')
    expect(out).not.toContain('(3)')
    expect(out.match(/class="equation"/g)).toHaveLength(2)
  })

  it('gives a nested labelled equation an id but no number', () => {
    const out = render('- item\n\n  $$\n  a\n  $$ {#eq:in}\n')
    expect(out).toContain('id="eq:in"')
    expect(out).not.toContain('equation-number')
  })

  it('does not swallow the lines after a one-line labelled equation', () => {
    const out = render('$$ a+b $$ {#eq:sum}\n\nFollowing paragraph.\n')
    expect(out).toMatch(/<\/div>\n<p data-source-line="3">Following paragraph\.<\/p>/)
  })

  it('parses a one-line labelled equation as a block of one line', () => {
    const tokens = createMarkdownParser().use(equationPlugin).parse('$$ a+b $$ {#eq:sum}  \n\ntext\n', {})
    const block = tokens.find((t) => t.type === 'math_block')!
    expect(block.map).toEqual([0, 1])
    expect(block.content).toBe('a+b\n')
  })

  it('numbers two one-line labelled equations in a row', () => {
    const out = render('$$ a $$ {#eq:a}\n$$ b $$ {#eq:b}\n')
    expect(out).toContain('(1)')
    expect(out).toContain('(2)')
  })

  it('renders an unlabelled one-line equation as a plain block', () => {
    const out = render('$$ a+b $$\n\ntext\n')
    expect(out).toMatch(/^<p data-source-line="1" class="katex-block">/)
    expect(out).not.toContain('equation')
  })
})
