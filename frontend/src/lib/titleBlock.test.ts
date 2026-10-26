import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { titleBlockHtml } from './titleBlock'

const escape = new MarkdownIt().utils.escapeHtml
const inline = (s: string) => s
const block = (parts: Parameters<typeof titleBlockHtml>[0]) => titleBlockHtml(parts, inline, escape)

describe('titleBlockHtml', () => {
  it('renders a title alone as a header holding only the h1', () => {
    expect(block({ title: 'On Things' })).toBe(
      '<header class="title-block">\n<h1 class="title-block-title">On Things</h1>\n</header>\n',
    )
  })

  it('numbers two different affiliations in order of first appearance', () => {
    const html = block({
      authors: [
        { name: 'Ann Frost', affiliation: 'Oxford' },
        { name: 'Bob Lee', affiliation: 'MIT' },
      ],
    })
    expect(html).toContain(
      '<p class="title-block-authors"><span class="title-block-author">Ann Frost<sup>1</sup></span>, ' +
        '<span class="title-block-author">Bob Lee<sup>2</sup></span></p>',
    )
    expect(html).toContain('<p class="title-block-affiliation"><sup>1</sup> Oxford</p>')
    expect(html).toContain('<p class="title-block-affiliation"><sup>2</sup> MIT</p>')
    expect(html.indexOf('Oxford')).toBeLessThan(html.indexOf('MIT'))
  })

  it('shows no numbers when every author shares one affiliation', () => {
    const html = block({
      authors: [
        { name: 'Ann Frost', affiliation: 'Oxford' },
        { name: 'Bob Lee', affiliation: 'Oxford' },
      ],
    })
    expect(html).not.toContain('<sup>')
    expect(html.match(/title-block-affiliation/g)).toHaveLength(1)
    expect(html).toContain('<p class="title-block-affiliation">Oxford</p>')
  })

  it('shows no number for a single author with one affiliation', () => {
    const html = block({ authors: [{ name: 'Ann Frost', affiliation: 'Oxford' }] })
    expect(html).not.toContain('<sup>')
    expect(html).toContain('<p class="title-block-affiliation">Oxford</p>')
  })

  it('numbers the affiliation when only some authors have one', () => {
    const html = block({ authors: [{ name: 'Ann Frost', affiliation: 'Oxford' }, { name: 'Bob Lee' }] })
    expect(html).toContain('<span class="title-block-author">Ann Frost<sup>1</sup></span>')
    expect(html).toContain('<span class="title-block-author">Bob Lee</span>')
    expect(html.match(/title-block-affiliation/g)).toHaveLength(1)
    expect(html).toContain('<p class="title-block-affiliation"><sup>1</sup> Oxford</p>')
  })

  it('escapes an author name', () => {
    const html = block({ authors: [{ name: 'Ann <b>Frost</b>' }] })
    expect(html).not.toContain('<b>')
    expect(html).toContain('Ann &lt;b&gt;Frost&lt;/b&gt;')
  })

  it('shows the date exactly as written', () => {
    expect(block({ date: 'Spring, 2026' })).toContain('<p class="title-block-date">Spring, 2026</p>')
  })

  it('puts the abstract last under its own heading', () => {
    const html = block({ title: 'T', date: 'D', abstractHtml: '<p>Summary.</p>\n' })
    expect(html).toContain(
      '<section class="title-block-abstract">\n<h2 class="title-block-abstract-heading">Abstract</h2>\n<p>Summary.</p>\n</section>\n',
    )
    expect(html.indexOf('title-block-date')).toBeLessThan(html.indexOf('title-block-abstract'))
  })

  it('renders nothing when nothing is set', () => {
    expect(block({})).toBe('')
  })
})
