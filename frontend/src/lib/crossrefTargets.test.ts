import { describe, it, expect } from 'vitest'
import { collectTargets } from './crossrefTargets'

const CHART = '```vega-lite\n{"title":"Yield","mark":"bar"}\n```'

describe('collectTargets', () => {
  it('lists an unlabelled captioned chart at its opening fence line', () => {
    const targets = collectTargets(`Intro\n\nMore\n\n${CHART}\n`)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'fig',
      block: 'chart',
      number: 1,
      label: null,
      caption: 'Yield',
      line: 5,
    })
  })

  it('lists an unlabelled equation at its closing $$ line', () => {
    const targets = collectTargets('Text\n\n$$\na+b\n$$\n')
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ kind: 'eq', block: 'equation', number: null, tex: 'a+b', line: 5 })
  })

  // Below the top level nothing is numbered, so a nested equation could
  // never be referred to; the flag is what keeps it out of the list.
  it('marks an equation below the top level as nested', () => {
    const [quoted, top] = collectTargets('> $$\n> a\n> $$\n\n$$\nb\n$$\n')
    expect(quoted).toMatchObject({ kind: 'eq', tex: 'a', nested: true })
    expect(top).toMatchObject({ kind: 'eq', tex: 'b', nested: false })
  })

  // A labelled one-line equation has a map running a line past it.
  it('puts a one-line equation on its own line, not the line after', () => {
    const targets = collectTargets('Text\n\n$$ a+b $$ {#eq:sum}\n')
    expect(targets[0]).toMatchObject({ kind: 'eq', number: 1, label: 'eq:sum', tex: 'a+b', line: 3 })
  })

  it('does not list an image whose label sits after a space', () => {
    expect(collectTargets('![A](a.png) {#fig:s}\n')).toEqual([])
  })

  // Nothing below the top level is numbered; the flag says so for every kind.
  it('lists nested figures and tables, unnumbered and marked nested', () => {
    const doc = [
      '- ![A](a.png){#fig:n}',
      '',
      '> ```vega-lite {#fig:c}',
      '> {"title":"C","mark":"bar"}',
      '> ```',
      '',
      '> | a |',
      '> |---|',
      '> | 1 |',
      '>',
      '> : Counts {#tbl:q}',
      '',
      '![Top](t.png)',
    ].join('\n')
    const targets = collectTargets(doc)
    expect(targets).toMatchObject([
      { kind: 'fig', block: 'image', label: 'fig:n', number: null, nested: true, line: 1 },
      { kind: 'fig', block: 'chart', label: 'fig:c', number: null, nested: true, line: 3 },
      { kind: 'tbl', block: 'table', label: 'tbl:q', number: null, nested: true, line: 11 },
      { kind: 'fig', block: 'image', label: null, number: 1, nested: false, line: 13 },
    ])
  })

  it('lists an image at the last line of its paragraph', () => {
    const targets = collectTargets('![Yield\nby group](a.png){#fig:a}\n')
    expect(targets[0]).toMatchObject({
      kind: 'fig',
      block: 'image',
      number: 1,
      label: 'fig:a',
      caption: 'Yield\nby group',
      line: 2,
    })
  })

  it('lists a Mermaid figure at its opening fence line', () => {
    const targets = collectTargets('```mermaid {#fig:m}\n---\ntitle: Flow\n---\ngraph TD\nA-->B\n```\n')
    expect(targets[0]).toMatchObject({ kind: 'fig', block: 'mermaid', number: 1, label: 'fig:m', line: 1 })
  })

  it('lists a captioned table at its caption line and skips one without a caption', () => {
    const doc = '| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n\n: Counts {#tbl:t}\n'
    const targets = collectTargets(doc)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'tbl',
      block: 'table',
      number: 1,
      label: 'tbl:t',
      caption: 'Counts',
      line: 9,
    })
  })

  it('puts a wrapped table caption at its last line, where the label goes', () => {
    const table = '| a |\n|---|\n| 1 |\n\n'
    expect(collectTargets(`${table}: Long caption\nwrapped {#tbl:t}\n`)[0]).toMatchObject({
      kind: 'tbl',
      label: 'tbl:t',
      line: 6,
    })
    expect(collectTargets(`${table}: Long caption\nwrapped\n`)[0]).toMatchObject({
      kind: 'tbl',
      label: null,
      line: 6,
    })
  })

  it('counts document lines when there is frontmatter', () => {
    const targets = collectTargets(`---\ntoc: true\n---\n${CHART}\n`)
    expect(targets[0]).toMatchObject({ line: 4 })
  })

  it('lists targets in document order', () => {
    const doc = '![A](a.png){#fig:a}\n\n$$\nx\n$$ {#eq:x}\n\n![B](b.png){#fig:b}\n'
    expect(collectTargets(doc).map((t) => t.label)).toEqual(['fig:a', 'eq:x', 'fig:b'])
  })
})
