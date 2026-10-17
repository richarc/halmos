// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

const pending = vi.hoisted(() => ({ resolve: () => {} }))

vi.mock('@wailsio/runtime', () => ({
  Browser: { OpenURL: vi.fn() },
  Clipboard: { SetText: vi.fn(() => Promise.resolve()) },
}))
// The diagram hydrator never finishes until the test says so.
vi.mock('./lib/mermaid', () => ({
  createMermaidHydrator: () => ({
    hydrate: () => new Promise<void>((r) => (pending.resolve = r)),
  }),
}))

import Preview from './Preview.svelte'

describe('Preview.exportRoot', () => {
  it('waits for the render in flight to finish hydrating', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(Preview, { target, props: { html: '<p>x</p>' } }) as unknown as {
      exportRoot(): Promise<HTMLElement>
    }
    flushSync()

    let root: HTMLElement | undefined
    const wait = cmp.exportRoot().then((r) => (root = r))
    await new Promise((r) => setTimeout(r, 10))
    expect(root).toBeUndefined()

    pending.resolve()
    await wait
    expect(root).toBe(target.querySelector('.sheet'))
    unmount(cmp as never)
  })
})
