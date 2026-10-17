// @vitest-environment jsdom
// `.svelte.test.ts` so the Svelte Vite plugin compiles the $state rune below.
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Preview from './Preview.svelte'

describe('Preview reflow', () => {
  it('drops the cached scroll anchors when the body font changes', () => {
    const collect = vi.fn(() => [
      { line: 10, top: 500 },
      { line: 20, top: 1500 },
    ])
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state({
      html: '<p data-source-line="10">x</p>',
      bodyFont: 'charter',
      collectAnchorsFn: collect,
    })
    const cmp = mount(Preview, { target, props }) as unknown as {
      syncToLine(line: number, docLines: number): void
    }
    flushSync()
    const pane = target.querySelector('.preview-pane') as HTMLElement
    Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true })

    cmp.syncToLine(15, 40)
    cmp.syncToLine(15, 40)
    const cached = collect.mock.calls.length

    props.bodyFont = 'new-york'
    flushSync()
    cmp.syncToLine(15, 40)
    expect(collect.mock.calls.length).toBeGreaterThan(cached)

    unmount(cmp as never)
    target.remove()
  })
})
