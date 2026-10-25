import { describe, expect, it } from 'vitest'
import {
  equationLabel,
  isCrossrefKey,
  labelSuffix,
  referenceKind,
  referenceText,
  slugLabel,
  trailingLabel,
  type CrossrefKind,
} from './crossrefs'

const NB = ' '

describe('isCrossrefKey / referenceKind', () => {
  it('matches the four prefixes in any case, and nothing else', () => {
    expect(isCrossrefKey('fig:a')).toBe(true)
    expect(isCrossrefKey('Fig:a')).toBe(true)
    expect(isCrossrefKey('SEC:intro')).toBe(true)
    expect(isCrossrefKey('figueroa2019')).toBe(false)
    expect(isCrossrefKey('fig')).toBe(false)
  })
  it('names the lower-cased prefix', () => {
    expect(referenceKind('TBL:x')).toBe('tbl')
    expect(referenceKind('smith2020')).toBeNull()
  })
})

describe('trailingLabel', () => {
  it('strips one trailing label of the asked kind', () => {
    expect(trailingLabel('Yield by group {#tbl:yield}', 'tbl')).toEqual({ text: 'Yield by group', label: 'tbl:yield' })
    expect(trailingLabel('x {#fig:a width=50%}', 'fig')).toEqual({ text: 'x', label: 'fig:a' })
  })
  it('leaves a label of another kind, or none', () => {
    expect(trailingLabel('Yield {#fig:a}', 'tbl')).toEqual({ text: 'Yield {#fig:a}', label: null })
    expect(trailingLabel('no label  ', 'fig')).toEqual({ text: 'no label', label: null })
  })
})

describe('slugLabel', () => {
  const none = new Set<string>()
  it('slugs and caps a caption', () => {
    expect(slugLabel('fig', 'Yield by variety, with 95% confidence intervals', none)).toBe(
      'fig:yield-by-variety-with-95-confidence',
    )
    expect(slugLabel('fig', 'Café crème', none)).toBe('fig:cafe-creme')
    expect(slugLabel('fig', '∑∑', none)).toBe('fig:figure')
    expect(slugLabel('tbl', '!!', none)).toBe('tbl:table')
  })
  it('avoids taken labels', () => {
    expect(slugLabel('tbl', 'Results', new Set(['tbl:results']))).toBe('tbl:results-2')
    expect(slugLabel('tbl', 'Results', new Set(['tbl:results', 'tbl:results-2']))).toBe('tbl:results-3')
  })
})

describe('labelSuffix', () => {
  it('touches an image, spaces everything else', () => {
    expect(labelSuffix('image', 'fig:a')).toBe('{#fig:a}')
    expect(labelSuffix('chart', 'fig:a')).toBe(' {#fig:a}')
  })
})

describe('equationLabel', () => {
  const none = new Set<string>()
  it('accepts a name, with or without eq:', () => {
    expect(equationLabel('bayes', none)).toEqual({ ok: true, label: 'eq:bayes' })
    expect(equationLabel('eq:bayes', none)).toEqual({ ok: true, label: 'eq:bayes' })
  })
  it('rejects empty, invalid and taken names', () => {
    expect(equationLabel(' ', none)).toEqual({ ok: false, reason: 'empty' })
    expect(equationLabel('two words', none)).toEqual({ ok: false, reason: 'invalid' })
    expect(equationLabel('bayes', new Set(['eq:bayes']))).toEqual({ ok: false, reason: 'taken' })
  })
})

describe('referenceText', () => {
  const nums: Record<string, { kind: CrossrefKind; number: number }> = {
    'fig:a': { kind: 'fig', number: 1 },
    'fig:b': { kind: 'fig', number: 2 },
    'tbl:t': { kind: 'tbl', number: 1 },
  }
  const lookup = (l: string) => nums[l]
  it('words one, many and mixed references', () => {
    expect(referenceText(['fig:b'], lookup)).toEqual({ text: `Figure${NB}2`, missing: false })
    expect(referenceText(['fig:a', 'fig:b'], lookup)).toEqual({ text: `Figures${NB}1, 2`, missing: false })
    expect(referenceText(['fig:a', 'tbl:t'], lookup)).toEqual({ text: `Figure${NB}1, Table${NB}1`, missing: false })
    expect(referenceText(['Fig:a'], lookup)).toEqual({ text: `Figure${NB}1`, missing: false })
  })
  it('prints ?? for a missing label', () => {
    expect(referenceText(['fig:zz'], lookup)).toEqual({ text: `Figure${NB}??`, missing: true })
    expect(referenceText(['sec:intro'], lookup)).toEqual({ text: `Section${NB}??`, missing: true })
  })
})
