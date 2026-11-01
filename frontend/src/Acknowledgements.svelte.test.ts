// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

const { DocumentService, load } = vi.hoisted(() => ({
  DocumentService: { ShowLicences: vi.fn(async () => {}) },
  load: vi.fn(),
}))
vi.mock('../bindings/hermes', () => ({ DocumentService }))
vi.mock('./lib/acknowledgements', () => ({ loadAcknowledgements: load }))

import Acknowledgements from './Acknowledgements.svelte'

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  version: '1.0.0',
  licence: 'MIT',
  copyright: [`Copyright (c) ${name} authors`],
  text: `The ${name} licence text`,
  origin: 'npm',
  ...extra,
})

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

function mountPage(open = true) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const onclose = vi.fn()
  const cmp = mount(Acknowledgements, { target, props: { open, onclose } })
  flushSync()
  cleanup = () => unmount(cmp)
  return { target, onclose }
}

const button = (t: HTMLElement, label: string) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined

describe('Acknowledgements', () => {
  it('lists each component with its version and licence, in the order given', async () => {
    load.mockResolvedValue({ generatedBy: 'halmos-notices', entries: [entry('codemirror'), entry('katex')] })
    const { target } = mountPage()
    await vi.waitFor(() => expect(target.querySelectorAll('details')).toHaveLength(2))
    const rows = [...target.querySelectorAll('summary')].map((s) => s.textContent?.replace(/\s+/g, ' ').trim())
    expect(rows).toEqual(['codemirror 1.0.0 MIT', 'katex 1.0.0 MIT'])
  })

  it('shows the copyright, election, source and full texts inside each row', async () => {
    load.mockResolvedValue({
      generatedBy: 'halmos-notices',
      entries: [
        entry('citeproc', {
          election: 'Halmos elects the CPAL-1.0 option.',
          source: 'Source code for this version: https://github.com/Juris-M/citeproc-js, version 2.4.63.',
          extraText: 'Common Public Attribution License Version 1.0',
        }),
      ],
    })
    const { target } = mountPage()
    await vi.waitFor(() => expect(target.querySelector('details')).toBeTruthy())
    const body = target.querySelector('details')!.textContent!
    for (const s of [
      'Copyright (c) citeproc authors',
      'Halmos elects the CPAL-1.0 option.',
      'Source code for this version: https://github.com/Juris-M/citeproc-js, version 2.4.63.',
      'The citeproc licence text',
      'Common Public Attribution License Version 1.0',
    ]) {
      expect(body).toContain(s)
    }
  })

  it('says so when the notices are not there', async () => {
    load.mockResolvedValue(null)
    const { target } = mountPage()
    await vi.waitFor(() => expect(target.textContent).toContain('The licence notices are only available in the packaged app.'))
  })

  it('shows the licence files in Finder', async () => {
    load.mockResolvedValue({ generatedBy: 'halmos-notices', entries: [] })
    const { target } = mountPage()
    await vi.waitFor(() => expect(button(target, 'Show Licence Files in Finder')).toBeTruthy())
    button(target, 'Show Licence Files in Finder')!.click()
    expect(DocumentService.ShowLicences).toHaveBeenCalledTimes(1)
  })

  it('loads nothing until it is opened', () => {
    load.mockResolvedValue(null)
    mountPage(false)
    expect(load).not.toHaveBeenCalled()
  })
})
