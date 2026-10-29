// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

const { StyleService, Browser } = vi.hoisted(() => ({
  StyleService: {
    LoadIndex: vi.fn(async () => ({ ready: true, error: '', fields: ['medicine', 'science'], updates: 0 })),
    Search: vi.fn(async (_q: string, _f: string, _fmt: string) => ({ styles: [] as unknown[], total: 0 })),
    Installed: vi.fn(async () => [] as unknown[]),
    PreviewStyle: vi.fn(async (_id: string) => ({ xml: '', title: '', error: 'not_found' })),
    InstallStyle: vi.fn(async (id: string) => ({ id, title: id, error: '' })),
    UpdateAll: vi.fn(async () => ({ id: '', title: '', error: '' })),
  },
  Browser: { OpenURL: vi.fn(async (_url: string) => {}) },
}))
vi.mock('../bindings/hermes', () => ({ StyleService }))
vi.mock('@wailsio/runtime', () => ({ Browser }))

import StyleFinder from './StyleFinder.svelte'
import { loadStyleXml } from './lib/citations'

function style(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id, title, titleShort: '', format: 'numeric', fields: ['science'], parent: '', parentTitle: '',
    installed: false, update: false, ...extra,
  }
}

const NATURE = style('nature', 'Nature')
const NC = style('nature-communications', 'Nature Communications', { parent: 'nature', parentTitle: 'Nature' })
const LANCET = style('the-lancet', 'The Lancet', { titleShort: 'Lancet', fields: ['medicine'] })

let cleanup: (() => void) | undefined
beforeEach(() => {
  StyleService.Search.mockImplementation(async () => ({ styles: [NATURE, NC, LANCET], total: 3 }))
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
  vi.clearAllMocks()
  StyleService.LoadIndex.mockImplementation(async () => ({ ready: true, error: '', fields: ['medicine', 'science'], updates: 0 }))
  StyleService.InstallStyle.mockImplementation(async (id: string) => ({ id, title: id, error: '' }))
  StyleService.PreviewStyle.mockImplementation(async () => ({ xml: '', title: '', error: 'not_found' }))
  StyleService.Installed.mockImplementation(async () => [])
})

function mountFinder() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const onclose = vi.fn()
  const onuse = vi.fn()
  const onchoosefile = vi.fn()
  const cmp = mount(StyleFinder, { target, props: { open: true, onclose, onuse, onchoosefile } })
  cleanup = () => unmount(cmp)
  return { target, onclose, onuse, onchoosefile }
}

const rows = (t: HTMLElement) => [...t.querySelectorAll<HTMLElement>('[role="option"]')]
const rowTitles = (t: HTMLElement) => rows(t).map((r) => r.querySelector('.style-title')?.textContent)
const search = (t: HTMLElement) => t.querySelector<HTMLInputElement>('input[type="search"]')!
const button = (t: HTMLElement, text: string) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

async function ready(t: HTMLElement) {
  await vi.waitFor(() => expect(rows(t).length).toBe(3))
}

describe('StyleFinder', () => {
  it('shows loading, then results', async () => {
    let finish: (v: unknown) => void = () => {}
    StyleService.LoadIndex.mockImplementationOnce(() => new Promise((r) => (finish = r)) as never)
    const { target } = mountFinder()
    flushSync()
    expect(target.textContent).toContain('Loading styles…')
    expect(StyleService.Search).not.toHaveBeenCalled()
    finish({ ready: true, error: '', fields: [], updates: 0 })
    await ready(target)
    expect(rowTitles(target)).toEqual(['Nature', 'Nature Communications', 'The Lancet'])
    expect(target.textContent).not.toContain('Loading styles…')
  })

  it('searches as you type', async () => {
    const { target } = mountFinder()
    await ready(target)
    StyleService.Search.mockImplementationOnce(async () => ({ styles: [LANCET], total: 1 }))
    type(search(target), 'lancet')
    await vi.waitFor(() => expect(rowTitles(target)).toEqual(['The Lancet']))
    expect(StyleService.Search).toHaveBeenLastCalledWith('lancet', '', '')
    expect(rows(target)[0].textContent).toContain('Lancet')
  })

  it('filters by field and format', async () => {
    const { target } = mountFinder()
    await ready(target)
    const field = target.querySelector<HTMLSelectElement>('select[name="field"]')!
    expect([...field.options].map((o) => o.value)).toEqual(['', 'medicine', 'science'])
    field.value = 'medicine'
    field.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(StyleService.Search).toHaveBeenLastCalledWith('', 'medicine', ''))
    const format = target.querySelector<HTMLSelectElement>('select[name="format"]')!
    expect([...format.options].map((o) => o.textContent)).toEqual(['All formats', 'Author-date', 'Numeric', 'Note', 'Author', 'Label'])
    format.value = 'note'
    format.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(StyleService.Search).toHaveBeenLastCalledWith('', 'medicine', 'note'))
  })

  it('shows the parent and sample for a dependent style', async () => {
    const ieee = (await loadStyleXml('ieee'))!
    StyleService.PreviewStyle.mockImplementation(async () => ({ xml: ieee, title: 'Nature Communications', error: '' }))
    const { target } = mountFinder()
    await ready(target)
    search(target).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    flushSync()
    expect(rows(target)[1].getAttribute('aria-selected')).toBe('true')
    const detail = target.querySelector('.style-detail')!
    expect(detail.textContent).toContain('Uses the formatting of Nature')
    await vi.waitFor(() => expect(detail.querySelector('.style-sample-citation')?.textContent).toBe('[1]'), { timeout: 3000 })
    expect(StyleService.PreviewStyle).toHaveBeenLastCalledWith('nature-communications')
    expect(detail.querySelector('.style-sample-reference')?.textContent).toContain('Light trapping')
  })

  it('Use Style installs then calls onuse with the id', async () => {
    const { target, onuse } = mountFinder()
    await ready(target)
    rows(target)[1].click()
    flushSync()
    button(target, 'Use Style')!.click()
    await vi.waitFor(() => expect(onuse).toHaveBeenCalledWith('nature-communications'))
    expect(StyleService.InstallStyle).toHaveBeenCalledWith('nature-communications')
  })

  it('Enter in the search field uses the selected style', async () => {
    const { target, onuse } = mountFinder()
    await ready(target)
    search(target).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() => expect(onuse).toHaveBeenCalledWith('nature'))
  })

  it('shows the install error and does not call onuse', async () => {
    StyleService.InstallStyle.mockImplementation(async (id: string) => ({ id, title: 'Nature', error: 'busy' }))
    const { target, onuse } = mountFinder()
    await ready(target)
    button(target, 'Use Style')!.click()
    await vi.waitFor(() => expect(target.textContent).toContain("Couldn't install Nature."))
    expect(onuse).not.toHaveBeenCalled()
  })

  it('offline lists installed styles', async () => {
    StyleService.LoadIndex.mockImplementation(async () => ({ ready: false, error: 'offline', fields: [], updates: 0 }))
    StyleService.Installed.mockImplementation(async () => [style('bmj', 'BMJ', { installed: true })])
    const { target } = mountFinder()
    await vi.waitFor(() => expect(rowTitles(target)).toEqual(['BMJ']))
    expect(target.textContent).toContain("Halmos can't reach the style list. Installed styles and Choose a file… still work.")
    expect(StyleService.Search).not.toHaveBeenCalled()
  })

  it('says when the style list is busy', async () => {
    StyleService.LoadIndex.mockImplementation(async () => ({ ready: false, error: 'busy', fields: [], updates: 0 }))
    const { target } = mountFinder()
    await vi.waitFor(() => expect(target.textContent).toContain('The style list is busy; try again in a minute.'))
  })

  it('offers Update for an installed style with an update', async () => {
    StyleService.Search.mockImplementation(async () => ({ styles: [style('bmj', 'BMJ', { installed: true, update: true })], total: 1 }))
    const { target, onuse } = mountFinder()
    await vi.waitFor(() => expect(button(target, 'Update')).toBeDefined())
    expect(rows(target)[0].textContent).toContain('Installed')
    button(target, 'Update')!.click()
    await vi.waitFor(() => expect(onuse).toHaveBeenCalledWith('bmj'))
  })

  it('Update All calls UpdateAll', async () => {
    StyleService.LoadIndex.mockImplementation(async () => ({ ready: true, error: '', fields: [], updates: 2 }))
    const { target } = mountFinder()
    await ready(target)
    expect(target.textContent).toContain('Updates for 2 installed styles')
    button(target, 'Update All')!.click()
    await vi.waitFor(() => expect(StyleService.UpdateAll).toHaveBeenCalled())
    await vi.waitFor(() => expect(StyleService.LoadIndex).toHaveBeenCalledTimes(2))
  })

  it('Choose a file… calls onchoosefile', async () => {
    const { target, onchoosefile } = mountFinder()
    await ready(target)
    button(target, 'Choose a file…')!.click()
    expect(onchoosefile).toHaveBeenCalled()
  })

  it('Cancel closes', async () => {
    const { target, onclose } = mountFinder()
    await ready(target)
    button(target, 'Cancel')!.click()
    expect(onclose).toHaveBeenCalled()
  })

  it('shows the count when results are cut', async () => {
    StyleService.Search.mockImplementation(async () => ({ styles: [NATURE, NC, LANCET], total: 4200 }))
    const { target } = mountFinder()
    await ready(target)
    expect(target.textContent).toContain('Showing 3 of 4200 — type more to narrow it')
  })

  it('says when nothing matches', async () => {
    const { target } = mountFinder()
    await ready(target)
    StyleService.Search.mockImplementationOnce(async () => ({ styles: [], total: 0 }))
    type(search(target), 'unicorn')
    await vi.waitFor(() => expect(target.textContent).toContain('No styles match'))
    expect((button(target, 'Use Style') as HTMLButtonElement).disabled).toBe(true)
  })

  it('attribution link opens citationstyles.org', async () => {
    const { target } = mountFinder()
    await ready(target)
    const link = [...target.querySelectorAll('a')].find((a) => a.textContent?.includes('citationstyles.org'))!
    expect(link.closest('.style-attribution')?.textContent).toContain('Styles from the CSL project (citationstyles.org), shared under CC BY-SA 3.0')
    link.click()
    expect(Browser.OpenURL).toHaveBeenCalledWith('https://citationstyles.org/')
  })
})
