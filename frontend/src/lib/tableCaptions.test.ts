import { describe, it, expect } from 'vitest'
import { render } from './renderer'
import { parseCaptionLine } from './tableCaptions'

// Captured from main, before the plugin existed.
const PLAIN_TABLE =
  '<table data-source-line="1">\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n'
const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |'
const html = (md: string) => render(md)

describe('parseCaptionLine', () => {
  it('reads the caption and its label', () => {
    expect(parseCaptionLine(': Results {#tbl:r}')).toEqual({ caption: 'Results', label: 'tbl:r' })
    expect(parseCaptionLine(': Results')).toEqual({ caption: 'Results', label: null })
  })
  it('needs a space after the colon', () => {
    expect(parseCaptionLine(':Results')).toBeNull()
  })
})

describe('table captions', () => {
  it('renders a numbered caption as the first child of the table', () => {
    const out = html(`${TABLE}\n\n: Yield by group`)
    expect(out).toMatch(/<table[^>]*>\s*<caption>Table 1: Yield by group<\/caption>/)
    expect(out).not.toContain('<p')
  })

  it('turns a label into the table id and strips it from the caption', () => {
    const out = html(`${TABLE}\n\n: Yield by group {#tbl:yield}`)
    expect(out).toContain('id="tbl:yield"')
    expect(out).toContain('<caption>Table 1: Yield by group</caption>')
    expect(out).not.toContain('{#')
  })

  it('parses inline markdown in the caption', () => {
    expect(html(`${TABLE}\n\n: Caption with *emphasis*`)).toContain(
      '<caption>Table 1: Caption with <em>emphasis</em></caption>',
    )
  })

  it('numbers tables and figures independently', () => {
    const out = html(
      `${TABLE}\n\n: One\n\n![First](a.png)\n\n${TABLE}\n\n: Two`,
    )
    expect(out).toContain('Table 1: One')
    expect(out).toContain('Table 2: Two')
    expect(out).toContain('Figure 1: First')
  })

  it('renders a table without a caption line exactly as before', () => {
    expect(html(TABLE)).toBe(PLAIN_TABLE)
  })

  it('leaves a caption two blank lines away as a paragraph', () => {
    const out = html(`${TABLE}\n\n\n: Caption`)
    expect(out).not.toContain('<caption')
    expect(out).toContain(': Caption')
  })

  it('treats a caption line with no blank line before it as a table row', () => {
    const out = html(`${TABLE}\n: Caption`)
    expect(out).not.toContain('<caption')
    expect(out).toContain('<td>: Caption</td>')
  })

  it('captions a quoted table without numbering it', () => {
    const out = html(`> ${TABLE.replace(/\n/g, '\n> ')}\n>\n> : Quoted {#tbl:q}`)
    expect(out).toContain('<caption>Quoted</caption>')
    expect(out).not.toContain('Table 1')
    expect(out).not.toContain('id="tbl:q"')
  })
})
