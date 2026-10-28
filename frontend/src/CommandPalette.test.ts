// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import type { Command, CommandList } from '../bindings/hermes/models'

// The default `load` is CommandService.Commands; every test here injects its
// own, so the binding is only stubbed to keep the Wails runtime out.
vi.mock('../bindings/hermes', () => ({ CommandService: { Commands: vi.fn(async () => ({ commands: [], recent: [] })) } }))

import CommandPalette from './CommandPalette.svelte'

function cmd(path: string[], label: string, extra: Partial<Command> = {}): Command {
  return {
    id: [...path, label].join(' › '),
    path,
    label,
    accelerator: '',
    checked: false,
    needsDocument: true,
    detail: '',
    ...extra,
  }
}

const FIXTURE: Command[] = [
  cmd(['File'], 'New…', { accelerator: 'Cmd+N', needsDocument: false }),
  cmd(['File', 'Open Recent'], 'paper.md', { id: 'File › Open Recent › /Users/ann/papers/paper.md', detail: '~/papers', needsDocument: false }),
  cmd(['Insert'], 'Chart…'),
  cmd(['Insert'], 'Table…', { accelerator: 'Cmd+Shift+T' }),
  cmd(['Format'], 'Bold', { accelerator: 'Cmd+B' }),
  cmd(['View'], 'Autosave', { checked: true, needsDocument: false }),
]

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

async function mountPalette(props: { welcome?: boolean; commands?: Command[]; recent?: string[] } = {}) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const list: CommandList = { commands: props.commands ?? FIXTURE, recent: props.recent ?? [] }
  const load = vi.fn(async () => list)
  const onclose = vi.fn()
  const onrun = vi.fn()
  const cmp = mount(CommandPalette, {
    target,
    props: { open: true, welcome: props.welcome ?? false, onclose, onrun, load },
  })
  cleanup = () => unmount(cmp)
  flushSync()
  await vi.waitFor(() => expect(target.querySelectorAll('[role="option"]').length).toBeGreaterThan(0))
  const input = target.querySelector<HTMLInputElement>('input[role="combobox"]')!
  return { target, input, load, onclose, onrun }
}

function type(input: HTMLInputElement, text: string) {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function key(input: HTMLInputElement, k: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  flushSync()
}

const options = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>('[role="option"]')]

describe('CommandPalette', () => {
  it('loads the commands and focuses a combobox over a listbox of options', async () => {
    const { target, input, load } = await mountPalette()
    expect(load).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(input)
    const listbox = target.querySelector('[role="listbox"]')!
    expect(listbox).not.toBeNull()
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(options(target)).toHaveLength(FIXTURE.length)
  })

  it('finds Insert: Table… first for "tab", with its shortcut and the matched letters bold', async () => {
    const { target, input } = await mountPalette()
    type(input, 'tab')
    const first = options(target)[0]
    expect(first.querySelector('.palette-text')?.textContent).toBe('Insert: Table…')
    expect(first.querySelector('kbd')?.textContent).toBe('⇧⌘T')
    expect([...first.querySelectorAll('b')].map((b) => b.textContent).join('')).toBe('Tab')
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id)
  })

  it('moves the highlight with the arrow keys', async () => {
    const { target, input } = await mountPalette()
    key(input, 'ArrowDown')
    const rows = options(target)
    expect(rows[0].getAttribute('aria-selected')).toBe('false')
    expect(rows[1].getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[1].id)
    key(input, 'ArrowUp')
    expect(options(target)[0].getAttribute('aria-selected')).toBe('true')
  })

  it('runs the highlighted row on Return', async () => {
    const { input, onrun, onclose } = await mountPalette()
    type(input, 'tab')
    key(input, 'Enter')
    expect(onrun).toHaveBeenCalledWith('Insert › Table…')
    expect(onclose).not.toHaveBeenCalled()
  })

  it('runs a clicked row', async () => {
    const { target, onrun } = await mountPalette()
    const bold = options(target).find((o) => o.textContent?.includes('Bold'))!
    bold.click()
    expect(onrun).toHaveBeenCalledWith('Format › Bold')
  })

  it('closes on Esc without running anything', async () => {
    const { input, onrun, onclose } = await mountPalette()
    key(input, 'Escape')
    expect(onclose).toHaveBeenCalledOnce()
    expect(onrun).not.toHaveBeenCalled()
  })

  it('shows a tick before a ticked command and none before others', async () => {
    const { target } = await mountPalette()
    const rows = options(target)
    const autosave = rows.find((o) => o.textContent?.includes('Autosave'))!
    const bold = rows.find((o) => o.textContent?.includes('Bold'))!
    expect(autosave.querySelector('.palette-tick')?.textContent).toBe('✓')
    expect(bold.querySelector('.palette-tick')?.textContent).toBe('')
  })

  it("shows an Open Recent entry's folder", async () => {
    const { target } = await mountPalette()
    const recent = options(target).find((o) => o.textContent?.includes('paper.md'))!
    expect(recent.querySelector('.palette-detail')?.textContent).toBe('~/papers')
  })

  it('leaves out commands that need a document on the welcome screen', async () => {
    const { target } = await mountPalette({ welcome: true })
    const texts = options(target).map((o) => o.querySelector('.palette-text')?.textContent)
    expect(texts).toEqual(['File: New…', 'File: Open Recent › paper.md', 'View: Autosave'])
  })

  it('says so when nothing matches, and Return then runs nothing', async () => {
    const { target, input, onrun } = await mountPalette()
    type(input, 'zzzz')
    expect(options(target)).toHaveLength(0)
    expect(target.textContent).toContain('No matching commands')
    key(input, 'Enter')
    expect(onrun).not.toHaveBeenCalled()
  })
})
