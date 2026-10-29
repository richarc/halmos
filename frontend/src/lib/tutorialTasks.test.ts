// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from './renderer'
import { CHECKS } from './tutorialTasks'

/** The task item's `<li>` for the task whose text includes `text`. */
function taskItem(html: string, text: string): HTMLLIElement {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const li = [...doc.querySelectorAll('li')].find((l) => l.textContent?.includes(text))
  if (!li) throw new Error(`no task "${text}" in ${html}`)
  return li
}

function isDone(li: HTMLLIElement): boolean {
  const box = li.querySelector('input[type=checkbox]') as HTMLInputElement
  return li.classList.contains('tutorial-task-done') && box.hasAttribute('checked')
}

function section(marker: string, below: string, above = ''): string {
  return `## Try it\n\n${above}\n\n- [ ] Do the thing. <!-- check: ${marker} -->\n\n${below}\n\n## Next\n`
}

const CHART = '```vega-lite\n{"title": "Rain", "data": {"values": [{"a": 1}]}, "mark": "bar", "encoding": {"x": {"field": "a"}}}\n```'
const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |\n\n: Numbers {#tbl:numbers}'
const EQUATION = '$$ E = mc^2 $$ {#eq:energy}'
const FIGURE = '![A rainfall chart](rain.png){#fig:rain}'

describe('tutorial tasks', () => {
  it('lists the eight checks', () => {
    expect([...CHECKS].sort()).toEqual(
      ['chart', 'citation', 'display-math', 'inline-math', 'ref-eq', 'ref-fig', 'ref-tbl', 'table-caption'].sort(),
    )
  })

  const cases: [string, string][] = [
    ['inline-math', 'The area is $\\pi r^2$.'],
    ['display-math', '$$\n\\int_0^1 x\\,dx\n$$'],
    ['chart', CHART],
    ['citation', 'As shown before [@knuth1984literate].'],
    ['table-caption', TABLE],
    ['ref-fig', `${FIGURE}\n\nSee @fig:rain.`],
    ['ref-tbl', `${TABLE}\n\nSee @tbl:numbers.`],
    ['ref-eq', `${EQUATION}\n\nSee @eq:energy.`],
  ]
  for (const [marker, below] of cases) {
    it(`ticks ${marker} when its result is below the task`, () => {
      const li = taskItem(render(section(marker, below)), 'Do the thing.')
      expect(isDone(li)).toBe(true)
    })
    it(`leaves ${marker} unticked with nothing below`, () => {
      const li = taskItem(render(section(marker, 'Nothing yet.')), 'Do the thing.')
      expect(isDone(li)).toBe(false)
    })
  }

  it('does not count the example above the task', () => {
    const li = taskItem(render(section('display-math', 'Your turn.', '$$ a^2 + b^2 = c^2 $$')), 'Do the thing.')
    expect(isDone(li)).toBe(false)
  })

  it('stops at the next heading', () => {
    const md = '## Try it\n\n- [ ] Do the thing. <!-- check: inline-math -->\n\n## Next\n\nHere $x$ is.\n'
    expect(isDone(taskItem(render(md), 'Do the thing.'))).toBe(false)
  })

  it('counts a citation whose key is not in any bibliography', () => {
    const li = taskItem(render(section('citation', 'See [@nobody2020].')), 'Do the thing.')
    expect(isDone(li)).toBe(true)
  })

  it('does not count a cross-reference as a citation', () => {
    const li = taskItem(render(section('citation', `${FIGURE}\n\nSee @fig:rain.`)), 'Do the thing.')
    expect(isDone(li)).toBe(false)
  })

  it('does not tick ref-fig for a reference that does not resolve', () => {
    const li = taskItem(render(section('ref-fig', 'See @fig:nothing.')), 'Do the thing.')
    expect(isDone(li)).toBe(false)
  })

  it('does not tick ref-fig for a reference to a table', () => {
    const li = taskItem(render(section('ref-fig', `${TABLE}\n\nSee @tbl:numbers.`)), 'Do the thing.')
    expect(isDone(li)).toBe(false)
  })

  it('hides the marker', () => {
    const html = render(section('chart', CHART))
    expect(html).not.toContain('check:')
    expect(html).not.toContain('&lt;!--')
  })

  it('hides an unknown marker and never ticks it', () => {
    const html = render(section('everything', `${CHART}\n\n$x$`))
    expect(html).not.toContain('check:')
    expect(isDone(taskItem(html, 'Do the thing.'))).toBe(false)
  })

  it('keeps a task ticked by hand', () => {
    const html = render('- [x] Done already. <!-- check: chart -->\n')
    const box = taskItem(html, 'Done already.').querySelector('input') as HTMLInputElement
    expect(box.hasAttribute('checked')).toBe(true)
  })

  it('leaves a task without a marker alone', () => {
    const html = render('- [ ] Plain task\n\n$x$\n')
    const li = taskItem(html, 'Plain task')
    expect(li.classList.contains('tutorial-task-done')).toBe(false)
  })
})
