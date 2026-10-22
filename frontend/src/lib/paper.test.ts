import { describe, it, expect } from 'vitest'
import {
  PAGE_MARGIN_MM,
  sheetWidthMm,
  pageMarginsMm,
  pageRule,
  sheetStyle,
  DEFAULT_PAPER_SIZE,
  DEFAULT_ORIENTATION,
} from './paper'

const PAPERS = ['a4', 'letter'] as const
const ORIENTATIONS = ['portrait', 'landscape'] as const
const sheetHeightMm = (size: 'a4' | 'letter', o: 'portrait' | 'landscape') =>
  sheetWidthMm(size, o === 'portrait' ? 'landscape' : 'portrait')

describe('sheetWidthMm', () => {
  it('gives the short edge in portrait and the long edge in landscape', () => {
    expect(sheetWidthMm('a4', 'portrait')).toBe(210)
    expect(sheetWidthMm('a4', 'landscape')).toBe(297)
    expect(sheetWidthMm('letter', 'portrait')).toBe(215.9)
    expect(sheetWidthMm('letter', 'landscape')).toBe(279.4)
  })
})

describe('pageMarginsMm', () => {
  it('keeps the margins across the short edge at the page margin and scales the others', () => {
    expect(pageMarginsMm('a4', 'portrait').x).toBe(25)
    expect(pageMarginsMm('a4', 'portrait').y).toBeCloseTo(35.357, 3)
    expect(pageMarginsMm('a4', 'landscape').x).toBeCloseTo(35.357, 3)
    expect(pageMarginsMm('a4', 'landscape').y).toBe(25)
    expect(pageMarginsMm('letter', 'portrait').x).toBe(25)
    expect(pageMarginsMm('letter', 'portrait').y).toBeCloseTo(32.353, 3)
    expect(pageMarginsMm('letter', 'landscape').x).toBeCloseTo(32.353, 3)
    expect(pageMarginsMm('letter', 'landscape').y).toBe(25)
  })

  it('leaves a text area the same shape as the paper', () => {
    // WebKit's PDF export makes each page's content as tall as its width
    // times the paper's height-to-width ratio, and draws it against the
    // bottom margin. Only a text area of the paper's own shape fills the
    // space between the margins; anything else leaves a blank band at the
    // top of every page.
    for (const size of PAPERS) {
      for (const o of ORIENTATIONS) {
        const { x, y } = pageMarginsMm(size, o)
        const w = sheetWidthMm(size, o)
        const h = sheetHeightMm(size, o)
        expect((w - 2 * x) * (h / w)).toBeCloseTo(h - 2 * y, 6)
        expect(Math.min(x, y)).toBe(PAGE_MARGIN_MM)
      }
    }
  })
})

describe('pageRule', () => {
  it('writes the @page margins, top and bottom first, rounded to three decimals', () => {
    expect(pageRule('a4', 'portrait')).toBe('@page { margin: 35.357mm 25mm; }')
    expect(pageRule('a4', 'landscape')).toBe('@page { margin: 25mm 35.357mm; }')
    expect(pageRule('letter', 'portrait')).toBe('@page { margin: 32.353mm 25mm; }')
    expect(pageRule('letter', 'landscape')).toBe('@page { margin: 25mm 32.353mm; }')
  })
})

describe('sheetStyle', () => {
  it('writes the width and both margin pairs as percentages and absolute caps', () => {
    expect(sheetStyle('a4', 'portrait')).toBe(
      '--sheet-width: 210mm; --sheet-margin-x: 11.905%; --sheet-margin-x-max: 25mm; ' +
        '--sheet-margin-y: 16.837%; --sheet-margin-y-max: 35.357mm',
    )
    expect(sheetStyle('letter', 'landscape')).toBe(
      '--sheet-width: 279.4mm; --sheet-margin-x: 11.579%; --sheet-margin-x-max: 32.353mm; ' +
        '--sheet-margin-y: 8.948%; --sheet-margin-y-max: 25mm',
    )
  })

  it('draws the printed margins whatever the pane width', () => {
    // Percentage padding resolves against the CONTAINING BLOCK — the preview
    // pane — not the sheet's own capped width, for the vertical padding as
    // well as the horizontal. min(percentage, absolute) is right in both
    // regimes: a pane at least as wide as the paper draws the printed margin
    // exactly; a narrower pane has shrunk the sheet, and the margin shrinks
    // with it.
    const paddingMm = (style: string, axis: 'x' | 'y', paneMm: number) => {
      const pct = Number(new RegExp(`--sheet-margin-${axis}: ([\\d.]+)%`).exec(style)![1])
      const max = Number(new RegExp(`--sheet-margin-${axis}-max: ([\\d.]+)mm`).exec(style)![1])
      return Math.min((pct / 100) * paneMm, max)
    }
    for (const size of PAPERS) {
      for (const o of ORIENTATIONS) {
        const style = sheetStyle(size, o)
        const paper = sheetWidthMm(size, o)
        const m = pageMarginsMm(size, o)
        for (const axis of ['x', 'y'] as const) {
          expect(paddingMm(style, axis, paper)).toBeCloseTo(m[axis], 2)
          expect(paddingMm(style, axis, paper * 2)).toBeCloseTo(m[axis], 2)
          expect(paddingMm(style, axis, paper / 2)).toBeCloseTo(m[axis] / 2, 2)
        }
      }
    }
  })
})

describe('defaults', () => {
  it('matches the Go defaults in settings.go', () => {
    expect(DEFAULT_PAPER_SIZE).toBe('a4')
    expect(DEFAULT_ORIENTATION).toBe('portrait')
  })
})
