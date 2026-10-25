// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { crossrefCompletionSource, crossrefOptionClass, crossrefOptionFormula, planReference } from './crossrefCompletion'
import { collectTargets } from './crossrefTargets'
import type { CrossrefTarget } from './crossrefs'

/** Applies a plan's changes, all in the original text's coordinates. */
function apply(text: string, plan: ReturnType<typeof planReference>): string {
  if ('error' in plan) throw new Error(plan.error)
  let out = text
  for (const c of [...plan.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  return out
}

/** The range a typed `@kind:` covers, the `@` included. */
function typed(text: string, what: string): [number, number] {
  const from = text.indexOf(what)
  return [from, from + what.length]
}

function target(text: string, kind: CrossrefTarget['kind'], n = 0): CrossrefTarget {
  return collectTargets(text).filter((t) => t.kind === kind)[n]
}

describe('planReference', () => {
  it('labels an unlabelled image figure from its caption and refers to it', () => {
    const text = 'See @fig:\n\n![Yield](a.png)\n'
    const [from, to] = typed(text, '@fig:')
    const plan = planReference(text, target(text, 'fig'), from, to)
    expect(apply(text, plan)).toBe('See @fig:yield\n\n![Yield](a.png){#fig:yield}\n')
  })

  it('only replaces what was typed for a labelled target', () => {
    const text = 'See @fig:\n\n![Yield](a.png){#fig:crop}\n'
    const [from, to] = typed(text, '@fig:')
    const plan = planReference(text, target(text, 'fig'), from, to)
    expect(plan).toEqual({ changes: [{ from, to, insert: '@fig:crop' }] })
  })

  it('writes nothing when the figure is no longer in the text', () => {
    const before = 'See @fig:\n\n![Yield](a.png)\n'
    const t = target(before, 'fig')
    const text = 'See @fig:\n\nThe figure was deleted.\n'
    const [from, to] = typed(text, '@fig:')
    expect(planReference(text, t, from, to)).toEqual({ error: 'moved' })
  })

  // Figure 2 now names a different block: the caption is what tells them apart.
  it('writes nothing when a figure was added above the target since the list was drawn', () => {
    const t = target('See @fig:\n\n![Yield](a.png)\n\n![Rain](b.png)\n', 'fig', 1)
    const text = 'See @fig:\n\n![New](n.png)\n\n![Yield](a.png)\n\n![Rain](b.png)\n'
    const [from, to] = typed(text, '@fig:')
    expect(planReference(text, t, from, to)).toEqual({ error: 'moved' })
  })

  it('finds a figure by its number when lines have moved', () => {
    const t = target('See @fig:\n\n![Yield](a.png)\n', 'fig')
    const text = 'Intro.\n\nMore intro.\n\nSee @fig:\n\n![Yield](a.png)\n'
    const [from, to] = typed(text, '@fig:')
    expect(apply(text, planReference(text, t, from, to))).toBe(
      'Intro.\n\nMore intro.\n\nSee @fig:yield\n\n![Yield](a.png){#fig:yield}\n',
    )
  })

  it("doesn't take a label another target already has", () => {
    const text = 'See @fig:\n\n![Yield](a.png)\n\n![Other](b.png){#fig:yield}\n'
    const [from, to] = typed(text, '@fig:')
    expect(apply(text, planReference(text, target(text, 'fig'), from, to))).toContain('![Yield](a.png){#fig:yield-2}')
  })

  it('names an equation after the closing $$', () => {
    const text = 'See @eq:\n\n$$\na = b\n$$\n'
    const [from, to] = typed(text, '@eq:')
    const plan = planReference(text, target(text, 'eq'), from, to, 'bayes')
    expect(apply(text, plan)).toBe('See @eq:bayes\n\n$$\na = b\n$$ {#eq:bayes}\n')
  })

  it('names a one-line equation on its line', () => {
    const text = 'See @eq:\n\n$$ a = b $$\n'
    const [from, to] = typed(text, '@eq:')
    expect(apply(text, planReference(text, target(text, 'eq'), from, to, 'eq:bayes'))).toBe(
      'See @eq:bayes\n\n$$ a = b $$ {#eq:bayes}\n',
    )
  })

  it('refuses an equation name that is not a label', () => {
    const text = 'See @eq:\n\n$$\na = b\n$$\n'
    const [from, to] = typed(text, '@eq:')
    const t = target(text, 'eq')
    expect(planReference(text, t, from, to, 'a b')).toEqual({ error: 'invalid' })
    expect(planReference(text, t, from, to, '  ')).toEqual({ error: 'empty' })
    expect(planReference(text, t, from, to)).toEqual({ error: 'empty' })
  })

  it('refuses an equation name already taken', () => {
    const text = 'See @eq:\n\n$$\na = b\n$$\n\n$$\nc = d\n$$ {#eq:bayes}\n'
    const [from, to] = typed(text, '@eq:')
    const t = collectTargets(text).find((x) => x.kind === 'eq' && x.label === null)!
    expect(planReference(text, t, from, to, 'bayes')).toEqual({ error: 'taken' })
  })

  it('finds an unnamed equation by its formula, the nearest one when two match', () => {
    const text = 'See @eq:\n\n$$ x $$\n\nMiddle.\n\n$$ x $$\n'
    const [from, to] = typed(text, '@eq:')
    const second = collectTargets(text).filter((t) => t.kind === 'eq')[1]
    // Its line has drifted by one; the nearer of the two copies is still the second.
    const plan = planReference(text, { ...second, line: second.line - 1 }, from, to, 'x')
    expect(apply(text, plan)).toBe('See @eq:x\n\n$$ x $$\n\nMiddle.\n\n$$ x $$ {#eq:x}\n')
  })

  it('reports an equation whose formula is gone as moved', () => {
    const t = target('See @eq:\n\n$$ x $$\n', 'eq')
    const text = 'See @eq:\n\n$$ y $$\n'
    const [from, to] = typed(text, '@eq:')
    expect(planReference(text, t, from, to, 'x')).toEqual({ error: 'moved' })
  })

  it('labels a chart on its opening fence line', () => {
    const text = 'See @fig:\n\n```vega-lite\n{"title": "Yield", "mark": "bar"}\n```\n'
    const [from, to] = typed(text, '@fig:')
    expect(apply(text, planReference(text, target(text, 'fig'), from, to))).toBe(
      'See @fig:yield\n\n```vega-lite {#fig:yield}\n{"title": "Yield", "mark": "bar"}\n```\n',
    )
  })

  it('labels a table at the end of its caption line', () => {
    const text = 'See @tbl:\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n: Crop yields  \n'
    const [from, to] = typed(text, '@tbl:')
    expect(apply(text, planReference(text, target(text, 'tbl'), from, to))).toBe(
      'See @tbl:crop-yields\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n: Crop yields {#tbl:crop-yields}  \n',
    )
  })

  // From the menu nothing was typed, so the "@" may land against a word,
  // where it would not read as a reference.
  it('spaces a reference off a word before it, but not after a space, a bracket or a line start', () => {
    const fig = 'XX\n\n![Yield](a.png){#fig:yield}\n'
    const at = (prefix: string) => {
      const text = fig.replace('XX', prefix)
      return apply(text, planReference(text, target(text, 'fig'), prefix.length, prefix.length)).split('\n')[0]
    }
    expect(at('see')).toBe('see @fig:yield')
    expect(at('see,')).toBe('see, @fig:yield')
    expect(at('see ')).toBe('see @fig:yield')
    expect(at('(')).toBe('(@fig:yield')
    expect(at('[')).toBe('[@fig:yield')
    expect(at('')).toBe('@fig:yield')
    // Typed: the "@" is already there and the source checked what precedes it.
    const text = '"@fig:\n\n![Yield](a.png){#fig:yield}\n'
    expect(apply(text, planReference(text, target(text, 'fig'), 1, 6)).split('\n')[0]).toBe('"@fig:yield')
  })

  it('spaces off an unlabelled target too, in the same edit as its label', () => {
    const text = 'see\n\n![Yield](a.png)\n'
    expect(apply(text, planReference(text, target(text, 'fig'), 3, 3))).toBe('see @fig:yield\n\n![Yield](a.png){#fig:yield}\n')
  })

  // The label would land after the reference, where Pandoc no longer reads
  // it as the block's; refused rather than written in the wrong place.
  it("refuses a reference on the unlabelled target's own line", () => {
    const text = '| a |\n| --- |\n| 1 |\n\n: Crops, as @tbl:\n'
    const [from, to] = typed(text, '@tbl:')
    expect(planReference(text, target(text, 'tbl'), from, to)).toEqual({ error: 'own-line' })
  })

  it('inserts at an empty range when opened from the menu', () => {
    const text = 'See \n\n![Yield](a.png)\n'
    const at = text.indexOf(' \n') + 1
    expect(apply(text, planReference(text, target(text, 'fig'), at, at))).toBe(
      'See @fig:yield\n\n![Yield](a.png){#fig:yield}\n',
    )
  })
})

const DOC = [
  '![Yield](a.png){#fig:yield}',
  '',
  '$$ a = b $$ {#eq:ab}',
  '',
  '| a |',
  '| --- |',
  '| 1 |',
  '',
  ': Crops',
  '',
  '![Rain](b.png)',
  '',
  '$$',
  '\\frac{1}{2}',
  '$$',
  '',
].join('\n')

/** `doc` has a "|" marking the cursor; the targets come from `DOC` unless given. */
function run(
  doc: string,
  opts: { targets?: CrossrefTarget[]; all?: boolean; explicit?: boolean; pick?: (...a: unknown[]) => void } = {},
): CompletionResult | null {
  const pos = doc.indexOf('|')
  const state = EditorState.create({ doc: doc.slice(0, pos) + doc.slice(pos + 1), extensions: [markdown()] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const source = crossrefCompletionSource(
    () => opts.targets ?? collectTargets(DOC),
    () => opts.all ?? false,
    opts.pick ?? (() => {}),
  )
  return source(new CompletionContext(state, pos, opts.explicit ?? false)) as CompletionResult | null
}

const shown = (r: CompletionResult | null) => r?.options.map((o) => o.displayLabel ?? o.label)

describe('crossrefCompletionSource', () => {
  it('lists only figures after @fig:, in document order', () => {
    const r = run('See @fig:|')
    expect(shown(r)).toEqual(['Figure 1', 'Figure 2'])
    expect(r?.options.map((o) => o.detail)).toEqual(['Yield', 'Rain'])
    // `[from, to)` covers the "@".
    expect(r?.from).toBe(4)
  })

  it('lists equations after @eq:, with the unnamed ones', () => {
    expect(shown(run('See @eq:|'))).toEqual(['Equation 1', 'Unnamed equation'])
  })

  it('lists tables after @tbl:', () => {
    expect(shown(run('See @tbl:|'))).toEqual(['Table 1'])
  })

  it('returns null after @tbl: when there are no captioned tables', () => {
    expect(run('See @tbl:|', { targets: collectTargets('| a |\n| --- |\n| 1 |\n') })).toBeNull()
  })

  it('matches what was typed against the label, else the caption slug', () => {
    expect(shown(run('See @fig:ra|'))).toEqual(['Figure 2'])
    expect(shown(run('See @fig:yie|'))).toEqual(['Figure 1'])
    expect(run('See @fig:zzz|')).toBeNull()
  })

  it('accepts a capitalised kind', () => {
    expect(shown(run('See @Fig:|'))).toEqual(['Figure 1', 'Figure 2'])
  })

  it('does not trigger mid-word, in code, in maths or in frontmatter', () => {
    expect(run('mail@fig:|')).toBeNull()
    expect(run('`@fig:|`')).toBeNull()
    expect(run('```\n@fig:|\n```\n')).toBeNull()
    expect(run('$x @fig:| y$')).toBeNull()
    expect(run('---\ntitle: @fig:|\n---\n')).toBeNull()
  })

  it('does not trigger on a plain citation', () => {
    expect(run('See @smith|')).toBeNull()
  })

  it('leaves out an unlabelled equation below the top level', () => {
    const doc = '> $$\n> a\n> $$\n\n$$\nb\n$$\n'
    const r = run('See @eq:|', { targets: collectTargets(doc) })
    expect(r?.options.map((o) => (o as unknown as { target: CrossrefTarget }).target.tex)).toEqual(['b'])
  })

  it('leaves out labelled targets that have no number', () => {
    const targets: CrossrefTarget[] = [
      { kind: 'eq', number: null, caption: '', label: 'eq:nested', block: 'equation', line: 3, tex: 'x' },
      { kind: 'eq', number: 1, caption: '', label: 'eq:top', block: 'equation', line: 5, tex: 'y' },
    ]
    expect(shown(run('See @eq:|', { targets }))).toEqual(['Equation 1'])
  })

  it('lists every kind at the cursor when opened from the menu: figures, tables, equations', () => {
    const r = run('See |', { all: true, explicit: true })
    expect(shown(r)).toEqual(['Figure 1', 'Figure 2', 'Table 1', 'Equation 1', 'Unnamed equation'])
    expect(r?.from).toBe(4)
    expect(r?.to ?? 4).toBe(4)
  })

  it('in the menu list, says when it declines, so the all-kinds mode can end', () => {
    const declined = vi.fn()
    const source = crossrefCompletionSource(() => collectTargets(DOC), () => true, () => {}, declined)
    const state = EditorState.create({ doc: '```\ncode\n```\nSee ', extensions: [markdown()] })
    ensureSyntaxTree(state, state.doc.length, 5000)
    expect(source(new CompletionContext(state, 5, true))).toBeNull()
    expect(declined).toHaveBeenCalledTimes(1)
    expect(source(new CompletionContext(state, state.doc.length, true))).not.toBeNull()
    expect(declined).toHaveBeenCalledTimes(1)
  })

  it('in the menu list, filters by what is typed after the cursor', () => {
    const source = crossrefCompletionSource(() => collectTargets(DOC), () => true, () => {})
    const opened = EditorState.create({ doc: 'See ', extensions: [markdown()] })
    source(new CompletionContext(opened, 4, true))
    const typedOn = EditorState.create({ doc: 'See ra', extensions: [markdown()] })
    const r = source(new CompletionContext(typedOn, 6, false)) as CompletionResult
    expect(shown(r)).toEqual(['Figure 2'])
    expect(r.from).toBe(4)
  })

  it('draws an equation with KaTeX, its TeX cut to 60 characters', () => {
    const long = 'x + '.repeat(30)
    const targets: CrossrefTarget[] = [
      { kind: 'eq', number: null, caption: '', label: null, block: 'equation', line: 3, tex: long },
    ]
    const o = run('See @eq:|', { targets })!.options[0]
    expect(crossrefOptionClass(o)).toBe('cm-crossref-option')
    const el = crossrefOptionFormula.render(o) as HTMLElement
    expect(el.className).toBe('cm-crossref-formula')
    expect(el.querySelector('.katex')).not.toBeNull()
    expect(el.textContent).toContain('…')
    expect(crossrefOptionFormula.render({ label: 'div' })).toBeNull()
    expect(crossrefOptionClass({ label: 'div' })).toBe('')
  })

  it('inserts a labelled reference itself, and hands an unlabelled target to pick', () => {
    const pick = vi.fn()
    const r = run('See @fig:|', { pick })!
    const dispatched: unknown[] = []
    const state = EditorState.create({ doc: 'See @fig:' })
    const view = { state, dispatch: (tr: unknown) => dispatched.push(tr) } as never
    const [labelled, unlabelled] = r.options as Completion[]
    ;(labelled.apply as (v: never, c: Completion, f: number, t: number) => void)(view, labelled, 4, 9)
    expect(dispatched).toHaveLength(1)
    expect(JSON.stringify(dispatched[0])).toContain('@fig:yield')
    expect(pick).not.toHaveBeenCalled()
    ;(unlabelled.apply as (v: never, c: Completion, f: number, t: number) => void)(view, unlabelled, 4, 9)
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fig', number: 2 }), 4, 9)
  })
})
