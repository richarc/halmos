// @vitest-environment jsdom
// `.svelte.test.ts` so the Svelte Vite plugin compiles the $state rune below;
// renaming the file breaks the test (same rule as Editor.spellcheck).
import { describe, it, expect } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Preview from './Preview.svelte'

describe('Preview reconciles the sheet instead of replacing it', () => {
  it('keeps the node of an unchanged block across an html update', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state({
      html: '<p data-source-line="1">a</p><p data-source-line="2">b</p>',
      collectAnchorsFn: () => [],
    })
    const cmp = mount(Preview, { target, props })
    flushSync()
    const sheet = target.querySelector('.sheet')!
    const [a, b] = Array.from(sheet.children)
    expect(a.textContent).toBe('a')

    props.html = '<p data-source-line="1">a</p><p data-source-line="2">B</p>'
    flushSync()
    const after = Array.from(sheet.children)
    expect(after[0]).toBe(a)
    expect(after[1]).not.toBe(b)
    expect(after[1].textContent).toBe('B')

    unmount(cmp)
    target.remove()
  })

  it('keeps one copy button per code block across an html update', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const pre = (src: string) => `<pre><code class="language-js">${src}</code></pre>`
    const props = $state({ html: pre('a') + pre('b'), collectAnchorsFn: () => [] })
    const cmp = mount(Preview, { target, props })
    flushSync()
    const [first] = Array.from(target.querySelectorAll('pre'))

    props.html = pre('a') + pre('c')
    flushSync()
    const pres = Array.from(target.querySelectorAll('pre'))
    expect(pres).toHaveLength(2)
    expect(pres[0]).toBe(first) // the button did not make the kept block look changed
    for (const p of pres) expect(p.querySelectorAll('button.code-copy')).toHaveLength(1)
    expect(pres[1].querySelector('code')!.textContent).toBe('c')

    unmount(cmp)
    target.remove()
  })
})
