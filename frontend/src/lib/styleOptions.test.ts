// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { applyStyleOptions, hasStyleOptions, readStyleOptions, STYLE_OPTION_KEYS, type StyleOptions } from './styleOptions'
import { createCitationFormatter, loadStyleXml } from './citations'
import type { CSLEntry } from './bibliography'

const NO_OPTIONS: StyleOptions = { citation: {}, bibliography: {} }

function opts(fm: Record<string, string>): StyleOptions {
  return readStyleOptions(fm).options
}

function doc(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

const MINI = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>Mini</title><id>mini</id></info>
  <macro name="a"><names variable="author"><name et-al-min="9" et-al-use-first="8"/></names></macro>
  <macro name="b"><names variable="author editor"><name et-al-min="9" et-al-use-first="8"/></names></macro>
  <macro name="b-outer"><text macro="b"/></macro>
  <macro name="c"><names variable="author"><name et-al-min="9" et-al-use-first="8"/></names></macro>
  <citation et-al-min="3" et-al-use-first="1">
    <layout><text macro="a"/><text macro="c"/></layout>
  </citation>
  <bibliography et-al-min="21" et-al-use-first="19">
    <layout><text macro="b-outer"/><text macro="c"/></layout>
  </bibliography>
</style>`

const threeAuthors: CSLEntry = {
  id: 't', type: 'article-journal', title: 'T', 'container-title': 'J', issued: { 'date-parts': [[2020]] },
  author: [{ family: 'Doe', given: 'J' }, { family: 'Roe', given: 'K' }, { family: 'Poe', given: 'L' }],
}

function nameIn(d: Document, macro: string): Element {
  return [...d.getElementsByTagName('macro')].find((m) => m.getAttribute('name') === macro)!.getElementsByTagName('name')[0]
}

describe('readStyleOptions', () => {
  it('lists eight keys', () => {
    expect(STYLE_OPTION_KEYS).toHaveLength(8)
  })

  it('reads valid keys', () => {
    const { options, invalid } = readStyleOptions({ 'citation-et-al-min': '3', 'bibliography-et-al-use-last': 'true' })
    expect(options.citation['et-al-min']).toBe('3')
    expect(options.bibliography['et-al-use-last']).toBe('true')
    expect(invalid).toEqual([])
    expect(hasStyleOptions(options)).toBe(true)
    expect(hasStyleOptions(NO_OPTIONS)).toBe(false)
  })

  it('reports invalid values', () => {
    for (const bad of ['0', '101', '2.5', 'three']) {
      const { options, invalid } = readStyleOptions({ 'citation-et-al-min': bad })
      expect(options.citation['et-al-min']).toBeUndefined()
      expect(invalid).toEqual(['citation-et-al-min must be a whole number from 1 to 100 — ignored'])
    }
    const { invalid } = readStyleOptions({ 'bibliography-et-al-use-last': 'yes' })
    expect(invalid).toEqual(['bibliography-et-al-use-last must be true or false — ignored'])
  })

  it('ignores a key with no value', () => {
    const { options, invalid } = readStyleOptions({ 'citation-et-al-min': '' })
    expect(hasStyleOptions(options)).toBe(false)
    expect(invalid).toEqual([])
  })
})

describe('applyStyleOptions', () => {
  it('returns the same text with no options', () => {
    expect(applyStyleOptions(MINI, NO_OPTIONS)).toBe(MINI)
  })

  it('returns a style that does not parse unchanged', () => {
    expect(applyStyleOptions('<style', opts({ 'citation-et-al-min': '2' }))).toBe('<style')
  })

  it('sets the attribute on citation and bibliography', () => {
    const d = doc(applyStyleOptions(MINI, opts({ 'citation-et-al-use-last': 'true', 'bibliography-et-al-use-last': 'false' })))
    expect(d.getElementsByTagName('citation')[0].getAttribute('et-al-use-last')).toBe('true')
    expect(d.getElementsByTagName('bibliography')[0].getAttribute('et-al-use-last')).toBe('false')
  })

  it('replaces an existing value', () => {
    const d = doc(applyStyleOptions(MINI, opts({ 'citation-et-al-min': '5' })))
    expect(d.getElementsByTagName('citation')[0].getAttribute('et-al-min')).toBe('5')
    expect(d.getElementsByTagName('citation')[0].getAttribute('et-al-use-first')).toBe('1')
  })

  it("use-first becomes 1 when only min is set and the style's is not smaller", () => {
    const d = doc(applyStyleOptions(MINI, opts({ 'bibliography-et-al-min': '4' })))
    const bib = d.getElementsByTagName('bibliography')[0]
    expect(bib.getAttribute('et-al-min')).toBe('4')
    expect(bib.getAttribute('et-al-use-first')).toBe('1')
  })

  it('min alone cuts the list in a style that sets no et-al at all', async () => {
    const bare = MINI.replace(/ et-al-[a-z-]+="\d+"/g, '')
    const d = doc(applyStyleOptions(bare, opts({ 'citation-et-al-min': '2', 'bibliography-et-al-min': '3' })))
    expect(d.getElementsByTagName('citation')[0].getAttribute('et-al-use-first')).toBe('1')
    expect(d.getElementsByTagName('bibliography')[0].getAttribute('et-al-use-first')).toBe('1')
    // Harvard without its et-al settings now cuts at two authors.
    const harvard = (await loadStyleXml('harvard'))!.replace(/ et-al-[a-z-]+="\d+"/g, '')
    const f = await createCitationFormatter([threeAuthors], 'harvard', applyStyleOptions(harvard, opts({ 'citation-et-al-min': '2' })))
    expect(f.format([{ items: [{ key: 't' }] }]).texts[0]).toContain('et al.')
  })

  it('accepts True and FALSE', () => {
    const { options, invalid } = readStyleOptions({ 'citation-et-al-use-last': 'True', 'bibliography-et-al-use-last': 'FALSE' })
    expect(options.citation['et-al-use-last']).toBe('true')
    expect(options.bibliography['et-al-use-last']).toBe('false')
    expect(invalid).toEqual([])
  })

  it("keeps the style's use-first when it is smaller", () => {
    const d = doc(applyStyleOptions(MINI, opts({ 'citation-et-al-min': '6' })))
    expect(d.getElementsByTagName('citation')[0].getAttribute('et-al-use-first')).toBe('1')
    const d2 = doc(applyStyleOptions(MINI, opts({ 'bibliography-et-al-min': '30' })))
    expect(d2.getElementsByTagName('bibliography')[0].getAttribute('et-al-use-first')).toBe('19')
  })

  it('follows macros to pick the value', () => {
    let d = doc(applyStyleOptions(MINI, opts({ 'citation-et-al-min': '2', 'bibliography-et-al-min': '5' })))
    expect(nameIn(d, 'a').getAttribute('et-al-min')).toBe('2')
    expect(nameIn(d, 'b').getAttribute('et-al-min')).toBe('5')
    expect(nameIn(d, 'c').getAttribute('et-al-min')).toBe('5')
    d = doc(applyStyleOptions(MINI, opts({ 'citation-et-al-min': '2' })))
    expect(nameIn(d, 'a').getAttribute('et-al-min')).toBe('2')
    expect(nameIn(d, 'b').getAttribute('et-al-min')).toBe('9')
    expect(nameIn(d, 'c').getAttribute('et-al-min')).toBe('2')
    // The name's own use-first (8) is not smaller than 2, so it becomes 1.
    expect(nameIn(d, 'a').getAttribute('et-al-use-first')).toBe('1')
  })

  it("updates IEEE's author name, not its director name", async () => {
    const d = doc(applyStyleOptions((await loadStyleXml('ieee'))!, opts({ 'bibliography-et-al-min': '2' })))
    expect(nameIn(d, 'author').getAttribute('et-al-min')).toBe('2')
    expect(nameIn(d, 'director').getAttribute('et-al-min')).toBe('7')
  })

  it("leaves APA's treaty name alone", async () => {
    const out = applyStyleOptions((await loadStyleXml('apa'))!, opts({ 'bibliography-et-al-min': '2', 'citation-et-al-min': '2' }))
    expect(out).toContain('<name delimiter="-" et-al-min="100" et-al-use-first="99" form="short" initialize="false"/>')
  })
})

describe('formatting with options', () => {
  const people = (n: number) =>
    ['Doe', 'Roe', 'Poe', 'Low', 'Fay'].slice(0, n).map((family, i) => ({ family, given: 'JKLMN'[i] }))
  const entry = (id: string, n: number): CSLEntry => ({
    id, type: 'article-journal', title: 'A study', author: people(n),
    'container-title': 'Journal', issued: { 'date-parts': [[2020]] }, volume: '1', page: '1-2',
  })

  async function format(style: string, fm: Record<string, string>, e: CSLEntry) {
    const xml = applyStyleOptions((await loadStyleXml(style))!, opts(fm))
    const f = await createCitationFormatter([e], style, xml)
    return { cite: f.format([{ items: [{ key: e.id }] }]).texts[0], ref: f.reference(e.id) ?? '' }
  }

  it('APA cites two authors as et al. with citation-et-al-min: 2', async () => {
    expect((await format('apa', {}, entry('a', 2))).cite).toBe('(Doe &#38; Roe, 2020)')
    expect((await format('apa', { 'citation-et-al-min': '2' }, entry('a', 2))).cite).toBe('(Doe et al., 2020)')
  })

  it('IEEE lists one author then et al.', async () => {
    const { ref } = await format('ieee', { 'bibliography-et-al-min': '2', 'bibliography-et-al-use-first': '1' }, entry('a', 3))
    expect(ref).toContain('J. Doe <i>et al.</i>')
  })

  it('Vancouver cuts three authors to one', async () => {
    const { ref } = await format('vancouver', { 'bibliography-et-al-min': '3' }, entry('a', 3))
    expect(ref).toContain('Doe J et al.')
  })
})

describe('the frontmatter knows every key', () => {
  it('reads each STYLE_OPTION_KEYS key', async () => {
    const { parseFrontmatter } = await import('./frontmatter')
    const fm = parseFrontmatter(`---\n${STYLE_OPTION_KEYS.map((k) => `${k}: 1`).join('\n')}\n---\n`) as unknown as Record<string, string>
    for (const k of STYLE_OPTION_KEYS) expect(fm[k]).toBe('1')
  })
})
