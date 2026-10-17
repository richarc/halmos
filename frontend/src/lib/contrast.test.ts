import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = readFileSync(
  join(fileURLToPath(import.meta.url), '../../../public/style.css'),
  'utf8',
)

/** Pulls the custom properties out of one selector's block. */
function palette(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector + ' {')
  if (start === -1) throw new Error(`no block for ${selector}`)
  const end = CSS.indexOf('\n}', start)
  const out: Record<string, string> = {}
  for (const m of CSS.slice(start, end).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    out[m[1]] = m[2].trim()
  }
  return out
}

function relativeLuminance(colour: string): number {
  let h = colour.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/** Every text pair, with the target its role demands. */
const PAIRS: Array<[label: string, fg: string, bg: string, target: number]> = [
  ['body text', '--fg', '--bg', 7],
  ['status bar', '--muted', '--bg', 4.5],
  ['blockquote', '--muted-strong', '--bg', 4.5],
  ['primary button', '--on-accent', '--accent', 4.5],
  ['toast', '--toast-fg', '--toast-bg', 4.5],
  ['welcome button', '--fg', '--surface', 4.5],
  // The chart builder's field error is the last error colour left in the
  // chrome — it sits in a dialog, so it is measured against the dialog's
  // ground. The markers that render on the sheet moved to the document
  // palette below, where they are checked against paper instead.
  ['dialog field error', '--cite-error-fg', '--overlay-bg', 4.5],
  ['editor text', '--editor-fg', '--editor-bg', 7],
  ['gutter numbers', '--editor-gutter-fg', '--editor-gutter-bg', 4.5],
  ['syntax heading', '--syn-heading', '--editor-bg', 4.5],
  ['syntax emphasis', '--syn-emphasis', '--editor-bg', 4.5],
  ['syntax code', '--syn-code', '--editor-bg', 4.5],
  ['syntax link', '--syn-link', '--editor-bg', 4.5],
  ['syntax quote', '--syn-quote', '--editor-bg', 4.5],
  ['syntax meta', '--syn-meta', '--editor-bg', 4.5],
  ['syntax keyword', '--syn-keyword', '--editor-bg', 4.5],
  ['syntax string', '--syn-string', '--editor-bg', 4.5],
  ['syntax number', '--syn-number', '--editor-bg', 4.5],
  ['syntax type', '--syn-type', '--editor-bg', 4.5],
  ['syntax function', '--syn-function', '--editor-bg', 4.5],
]

/** The document palette is one invariant light set, so it is one list. */
const DOC_PAIRS: Array<[label: string, fg: string, bg: string, target: number]> = [
  ['document text', '--doc-fg', '--doc-bg', 7],
  ['document muted', '--doc-muted', '--doc-bg', 4.5],
  ['document link', '--doc-link', '--doc-bg', 4.5],
  ['doc syntax keyword', '--doc-syn-keyword', '--doc-bg', 4.5],
  ['doc syntax string', '--doc-syn-string', '--doc-bg', 4.5],
  ['doc syntax number', '--doc-syn-number', '--doc-bg', 4.5],
  ['doc syntax type', '--doc-syn-type', '--doc-bg', 4.5],
  ['doc syntax function', '--doc-syn-function', '--doc-bg', 4.5],
  ['doc syntax meta', '--doc-syn-meta', '--doc-bg', 4.5],
  ['doc syntax link', '--doc-syn-link', '--doc-bg', 4.5],
  // Error markers, checked twice each. Against their own badge, which is what
  // the screen shows; and against bare paper, because printing drops
  // background colours and keeps text colour — the second is the check that
  // was missing when these read the theme's chrome tokens, and a dark-mode
  // marker printed at roughly 2:1 on white. A marker that exists to be
  // noticed before submission is the last thing that may vanish in the PDF.
  ['document chart error', '--doc-chart-error-fg', '--doc-chart-error-bg', 4.5],
  ['document chart error on paper', '--doc-chart-error-fg', '--doc-bg', 4.5],
  ['document cite error', '--doc-cite-error-fg', '--doc-cite-error-bg', 4.5],
  ['document cite error on paper', '--doc-cite-error-fg', '--doc-bg', 4.5],
  ['alert note title', '--doc-alert-note', '--doc-alert-note-bg', 4.5],
  ['alert note title on paper', '--doc-alert-note', '--doc-bg', 4.5],
  ['alert tip title', '--doc-alert-tip', '--doc-alert-tip-bg', 4.5],
  ['alert tip title on paper', '--doc-alert-tip', '--doc-bg', 4.5],
  ['alert important title', '--doc-alert-important', '--doc-alert-important-bg', 4.5],
  ['alert important title on paper', '--doc-alert-important', '--doc-bg', 4.5],
  ['alert warning title', '--doc-alert-warning', '--doc-alert-warning-bg', 4.5],
  ['alert warning title on paper', '--doc-alert-warning', '--doc-bg', 4.5],
  ['alert caution title', '--doc-alert-caution', '--doc-alert-caution-bg', 4.5],
  ['alert caution title on paper', '--doc-alert-caution', '--doc-bg', 4.5],
]

function check(selector: string) {
  const p = palette(selector)
  const failures: string[] = []
  for (const [label, fgVar, bgVar, target] of PAIRS) {
    const ratio = contrast(p[fgVar], p[bgVar])
    if (ratio < target) {
      failures.push(`${label}: ${ratio.toFixed(2)}:1 (needs ${target}:1)`)
    }
  }
  return failures
}

describe('palette contrast', () => {
  // Colours stay verified rather than eyeballed. A future tweak that drops a
  // pair below its target fails here instead of shipping.
  it('meets every target in the light palette', () => {
    expect(check(':root')).toEqual([])
  })

  // Every theme block in the stylesheet, so a new theme is measured the day
  // it is added rather than the day someone notices.
  const THEMES = [...CSS.matchAll(/^:root\[data-theme="([a-z]+)"\] \{/gm)].map((m) => m[1])

  it('finds the dark and sepia palettes', () => {
    expect(THEMES).toEqual(expect.arrayContaining(['dark', 'sepia']))
  })

  it.each(THEMES)('meets every target in the %s palette', (theme) => {
    expect(check(`:root[data-theme="${theme}"]`)).toEqual([])
  })

  it.each(['', ...THEMES])('keeps document text readable on the sheet paper of the "%s" theme', (theme) => {
    // The sheet is tinted on screen through --sheet-paper (sepia is warmer
    // than white), while the document tokens are invariant, so the pair is
    // only visible by crossing the two blocks.
    const paper = palette(theme ? `:root[data-theme="${theme}"]` : ':root')['--sheet-paper']
    const doc = palette('.sheet')
    const failures: string[] = []
    for (const [label, fgVar, target] of [
      ['document text', '--doc-fg', 7],
      ['document muted', '--doc-muted', 4.5],
      ['document link', '--doc-link', 4.5],
    ] as const) {
      const ratio = contrast(doc[fgVar], paper)
      if (ratio < target) failures.push(`${label}: ${ratio.toFixed(2)}:1 (needs ${target}:1)`)
    }
    expect(failures).toEqual([])
  })

  it('meets every target in the document palette', () => {
    // The print palette was never contrast-checked, on the reasoning that a
    // separate set would be numbers nothing verifies. With one invariant
    // document palette that reasoning no longer applies — this set is what
    // both the screen and the PDF actually use.
    const p = palette('.sheet')
    const failures: string[] = []
    for (const [label, fgVar, bgVar, target] of DOC_PAIRS) {
      const ratio = contrast(p[fgVar], p[bgVar])
      if (ratio < target) {
        failures.push(`${label}: ${ratio.toFixed(2)}:1 (needs ${target}:1)`)
      }
    }
    expect(failures).toEqual([])
  })
})
