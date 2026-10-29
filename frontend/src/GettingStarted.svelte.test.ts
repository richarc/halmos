// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

const { TutorialService } = vi.hoisted(() => ({
  TutorialService: {
    State: vi.fn(async () => ({ existing: '', existingEntry: '', suggested: '/Users/a/Documents/Halmos Tutorial' })),
    ChooseLocation: vi.fn(async () => ''),
    Create: vi.fn(async (folder: string) => ({ entry: `${folder}/getting-started.md`, bundled: false, needsUpdate: false })),
  },
}))
vi.mock('../bindings/hermes', () => ({ TutorialService }))

import GettingStarted from './GettingStarted.svelte'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
  vi.clearAllMocks()
  TutorialService.State.mockImplementation(async () => ({
    existing: '',
    existingEntry: '',
    suggested: '/Users/a/Documents/Halmos Tutorial',
  }))
  TutorialService.ChooseLocation.mockImplementation(async () => '')
})

function mountDialog() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const onclose = vi.fn()
  const onstarted = vi.fn()
  const cmp = mount(GettingStarted, { target, props: { open: true, onclose, onstarted } })
  flushSync()
  cleanup = () => unmount(cmp)
  return { target, onclose, onstarted }
}

const button = (t: HTMLElement, label: string) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined

describe('GettingStarted', () => {
  it('offers Start with the suggested folder', async () => {
    const { target } = mountDialog()
    await vi.waitFor(() => expect(target.textContent).toContain('Halmos Tutorial'))
    expect(target.textContent).toContain('/Users/a/Documents/Halmos Tutorial')
    expect(button(target, 'Start')).toBeTruthy()
    expect(button(target, 'Open It')).toBeUndefined()
  })

  it('Change… replaces the folder, and a cancelled panel keeps it', async () => {
    const { target } = mountDialog()
    await vi.waitFor(() => expect(target.textContent).toContain('/Users/a/Documents/Halmos Tutorial'))
    TutorialService.ChooseLocation.mockResolvedValueOnce('/Users/a/Desktop/Halmos Tutorial')
    button(target, 'Change…')!.click()
    await vi.waitFor(() => expect(target.textContent).toContain('/Users/a/Desktop/Halmos Tutorial'))
    button(target, 'Change…')!.click()
    await vi.waitFor(() => expect(TutorialService.ChooseLocation).toHaveBeenCalledTimes(2))
    flushSync()
    expect(target.textContent).toContain('/Users/a/Desktop/Halmos Tutorial')
  })

  it('Start shows Getting the tutorial… and hands back the result', async () => {
    let finish!: (r: { entry: string; bundled: boolean; needsUpdate: boolean }) => void
    TutorialService.Create.mockImplementationOnce(() => new Promise((r) => (finish = r)))
    const { target, onstarted } = mountDialog()
    await vi.waitFor(() => expect(button(target, 'Start')?.disabled).toBe(false))
    button(target, 'Start')!.click()
    flushSync()
    expect(target.textContent).toContain('Getting the tutorial…')
    expect(button(target, 'Start')!.disabled).toBe(true)
    expect(TutorialService.Create).toHaveBeenCalledWith('/Users/a/Documents/Halmos Tutorial')
    const result = { entry: '/Users/a/Documents/Halmos Tutorial/getting-started.md', bundled: true, needsUpdate: true }
    finish(result)
    await vi.waitFor(() => expect(onstarted).toHaveBeenCalledWith(result))
  })

  it('a write error stays open and says so', async () => {
    TutorialService.Create.mockRejectedValueOnce(new Error('open /x: permission denied'))
    const { target, onstarted } = mountDialog()
    await vi.waitFor(() => expect(button(target, 'Start')?.disabled).toBe(false))
    button(target, 'Start')!.click()
    await vi.waitFor(() => expect(target.textContent).toContain('Could not write the tutorial: open /x: permission denied'))
    expect(button(target, 'Start')!.disabled).toBe(false)
    expect(onstarted).not.toHaveBeenCalled()
  })

  it('an earlier tutorial offers Open It and Start Fresh', async () => {
    TutorialService.State.mockImplementation(async () => ({
      existing: '/Users/a/Documents/Halmos Tutorial',
      existingEntry: '/Users/a/Documents/Halmos Tutorial/getting-started.md',
      suggested: '/Users/a/Documents/Halmos Tutorial 2',
    }))
    const { target, onstarted } = mountDialog()
    await vi.waitFor(() => expect(button(target, 'Open It')).toBeTruthy())
    expect(target.textContent).toContain('You started the tutorial before, in /Users/a/Documents/Halmos Tutorial')
    button(target, 'Open It')!.click()
    expect(onstarted).toHaveBeenCalledWith({
      entry: '/Users/a/Documents/Halmos Tutorial/getting-started.md',
      bundled: false,
      needsUpdate: false,
    })
    button(target, 'Start Fresh')!.click()
    flushSync()
    expect(button(target, 'Start')).toBeTruthy()
    expect(target.textContent).toContain('/Users/a/Documents/Halmos Tutorial 2')
    expect(TutorialService.Create).not.toHaveBeenCalled()
  })
})
