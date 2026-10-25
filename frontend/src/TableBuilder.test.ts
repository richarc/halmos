// frontend/src/TableBuilder.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import TableBuilder from './TableBuilder.svelte'
import type { PipeTable } from './lib/pipeTable'

function mountBuilder(initial: PipeTable | null = null) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const oncommit = vi.fn()
  const oncancel = vi.fn()
  const cmp = mount(TableBuilder, { target, props: { initial, oncommit, oncancel } })
  flushSync()
  return {
    target,
    oncommit,
    oncancel,
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

const headers = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input.th-cell')]
const cells = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input.td-cell')]

describe('TableBuilder caption', () => {
  const initial: PipeTable = { header: ['a'], align: [null], rows: [['1']], caption: 'Yield', label: 'tbl:y' }
  const field = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[data-field="caption"]')!

  it('has a Caption field above the grid, seeded from the table', () => {
    const { target, cleanup } = mountBuilder(initial)
    expect(target.querySelector('label[for="table-caption"]')?.textContent).toBe('Caption')
    expect(field(target).value).toBe('Yield')
    expect(field(target).compareDocumentPosition(target.querySelector('.table-grid')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup()
  })

  it('commits the caption and keeps the label', () => {
    const { target, oncommit, cleanup } = mountBuilder(initial)
    type(field(target), 'New yield')
    button(target, 'Update').click()
    expect(oncommit.mock.calls[0][0]).toMatchObject({ caption: 'New yield', label: 'tbl:y' })
    cleanup()
  })

  it('refuses to drop the caption of a referred-to table', () => {
    const { target, oncommit, cleanup } = mountBuilder(initial)
    type(field(target), '')
    button(target, 'Update').click()
    flushSync()
    expect(oncommit).not.toHaveBeenCalled()
    expect(target.querySelector('.field-error')?.textContent).toBe(
      'This table is referred to; give it a caption or remove the references first.',
    )
    cleanup()
  })

  it('commits no caption when there was no label and the field is cleared', () => {
    const { target, oncommit, cleanup } = mountBuilder({ ...initial, label: undefined })
    type(field(target), '')
    button(target, 'Update').click()
    expect(oncommit.mock.calls[0][0].caption).toBeUndefined()
    expect(oncommit.mock.calls[0][0].label).toBeUndefined()
    cleanup()
  })
})

describe('TableBuilder', () => {
  it('starts as 3 named columns and 2 empty rows', () => {
    const { target, cleanup } = mountBuilder()
    expect(headers(target).map((i) => i.value)).toEqual(['Column 1', 'Column 2', 'Column 3'])
    expect(cells(target)).toHaveLength(6)
    // The default headers are text, so this is a committable skeleton.
    expect(button(target, 'Insert').disabled).toBe(false)
    cleanup()
  })

  it('disables commit only once every cell, header included, is empty', () => {
    const { target, cleanup } = mountBuilder()
    for (const input of headers(target)) type(input, '')
    expect(button(target, 'Insert').disabled).toBe(true)
    type(cells(target)[4], 'x')
    expect(button(target, 'Insert').disabled).toBe(false)
    cleanup()
  })

  it('focuses the first header cell on open', () => {
    const { target, cleanup } = mountBuilder()
    expect(document.activeElement).toBe(headers(target)[0])
    cleanup()
  })

  it('commits the edited grid as a PipeTable', () => {
    const { target, oncommit, cleanup } = mountBuilder()
    type(headers(target)[0], 'Name')
    type(cells(target)[0], 'Alice')
    type(cells(target)[3], 'Bob')
    button(target, 'Insert').click()
    expect(oncommit).toHaveBeenCalledWith({
      header: ['Name', 'Column 2', 'Column 3'],
      align: [null, null, null],
      rows: [['Alice', '', ''], ['Bob', '', '']],
    })
    cleanup()
  })

  it('shows Update and the initial table when reopening one', () => {
    const initial: PipeTable = { header: ['a', 'b'], align: ['right', null], rows: [['1', '2']] }
    const { target, cleanup } = mountBuilder(initial)
    expect(headers(target).map((i) => i.value)).toEqual(['a', 'b'])
    expect(cells(target).map((i) => i.value)).toEqual(['1', '2'])
    expect(button(target, 'Update').disabled).toBe(false)
    expect(target.querySelector('button.align[data-col="0"][data-align="right"]')?.getAttribute('aria-pressed')).toBe('true')
    cleanup()
  })

  it('gives each alignment button an accessible name matching its title', () => {
    const { target, cleanup } = mountBuilder()
    for (const btn of target.querySelectorAll<HTMLButtonElement>('button.align[data-col="0"]')) {
      expect(btn.getAttribute('aria-label')).toBe(btn.getAttribute('title'))
    }
    cleanup()
  })

  it('adds and removes rows and columns, never removing the last column', () => {
    const { target, cleanup } = mountBuilder()
    button(target, 'Add Row').click()
    flushSync()
    expect(cells(target)).toHaveLength(9)
    button(target, 'Add Column').click()
    flushSync()
    expect(headers(target).map((i) => i.value)).toEqual(['Column 1', 'Column 2', 'Column 3', 'Column 4'])
    expect(cells(target)).toHaveLength(12)

    target.querySelector<HTMLButtonElement>('button.remove-row[data-row="0"]')!.click()
    flushSync()
    expect(cells(target)).toHaveLength(8)

    for (let i = 0; i < 3; i++) {
      target.querySelector<HTMLButtonElement>('button.remove-col[data-col="0"]')!.click()
      flushSync()
    }
    expect(headers(target)).toHaveLength(1)
    expect(target.querySelector<HTMLButtonElement>('button.remove-col[data-col="0"]')!.disabled).toBe(true)
    cleanup()
  })

  it('toggles alignment per column and commits it', () => {
    const { target, oncommit, cleanup } = mountBuilder()
    type(cells(target)[0], 'x')
    target.querySelector<HTMLButtonElement>('button.align[data-col="1"][data-align="center"]')!.click()
    flushSync()
    button(target, 'Insert').click()
    expect(oncommit.mock.calls[0][0].align).toEqual([null, 'center', null])
    cleanup()
  })

  it('Enter on the last row adds a row and moves into it', () => {
    const { target, cleanup } = mountBuilder()
    const last = cells(target)[3]
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    flushSync()
    expect(cells(target)).toHaveLength(9)
    expect(document.activeElement).toBe(cells(target)[6])
    cleanup()
  })

  it('imports delimited text, replacing the grid', () => {
    const { target, oncommit, cleanup } = mountBuilder()
    button(target, 'Paste Data…').click()
    flushSync()
    const box = target.querySelector<HTMLTextAreaElement>('#table-import')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(headers(target).map((i) => i.value)).toEqual(['dose', 'response'])
    expect(cells(target).map((i) => i.value)).toEqual(['0', '1', '5', '2'])
    button(target, 'Insert').click()
    expect(oncommit.mock.calls[0][0].rows).toEqual([['0', '1'], ['5', '2']])
    cleanup()
  })

  it('imports numeric-looking cells verbatim, without reformatting them', () => {
    const { target, oncommit, cleanup } = mountBuilder()
    button(target, 'Paste Data…').click()
    flushSync()
    const box = target.querySelector<HTMLTextAreaElement>('#table-import')!
    box.value = 'id,amount\n007,1.50\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(cells(target).map((i) => i.value)).toEqual(['007', '1.50'])
    button(target, 'Insert').click()
    expect(oncommit.mock.calls[0][0].rows).toEqual([['007', '1.50']])
    cleanup()
  })

  it('reports import text that does not parse and leaves the grid alone', () => {
    const { target, cleanup } = mountBuilder()
    type(cells(target)[0], 'keep')
    button(target, 'Paste Data…').click()
    flushSync()
    const box = target.querySelector<HTMLTextAreaElement>('#table-import')!
    box.value = 'only a header'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(target.querySelector('.field-error')).not.toBeNull()
    expect(cells(target)[0].value).toBe('keep')
    cleanup()
  })

  it('Cancel calls oncancel', () => {
    const { target, oncancel, cleanup } = mountBuilder()
    button(target, 'Cancel').click()
    expect(oncancel).toHaveBeenCalled()
    cleanup()
  })
})

describe('table builder design', () => {
  const primary = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.modal-buttons .primary')!

  it('titles a new table Insert table and an existing one Edit table', () => {
    const fresh = mountBuilder()
    expect(fresh.target.querySelector('h2.dialog-title')?.textContent).toBe('Insert table')
    expect(fresh.target.querySelector('dialog')?.getAttribute('aria-label')).toBe('Insert table')
    expect(primary(fresh.target).textContent?.trim()).toBe('Insert')
    fresh.cleanup()
    const edit = mountBuilder({ header: ['a'], align: [null], rows: [['1']] })
    expect(edit.target.querySelector('h2.dialog-title')?.textContent).toBe('Edit table')
    expect(edit.target.querySelector('dialog')?.getAttribute('aria-label')).toBe('Edit table')
    expect(primary(edit.target).textContent?.trim()).toBe('Update')
    edit.cleanup()
  })

  it("puts each column's alignment and remove buttons in its header cell", () => {
    const { target, cleanup } = mountBuilder()
    const th = target.querySelectorAll('thead th')[0]
    expect(th.querySelector('.align-group')).not.toBeNull()
    expect(th.querySelector('button.remove-col[data-col="0"]')).not.toBeNull()
    expect(th.querySelector('input.th-cell')).not.toBeNull()
    expect(target.querySelector('tr.remove-col-row')).toBeNull()
    cleanup()
  })

  it('alignment buttons show icons, not arrow characters', () => {
    const { target, cleanup } = mountBuilder()
    const buttons = [...target.querySelectorAll('button.align')]
    expect(buttons).toHaveLength(12)
    for (const b of buttons) {
      expect(b.querySelector('svg')).not.toBeNull()
      expect(b.textContent?.trim()).toBe('')
    }
    cleanup()
  })

  it('names the paste toggle by its state', () => {
    const { target, cleanup } = mountBuilder()
    const toggle = button(target, 'Paste Data…')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    flushSync()
    expect(toggle.textContent?.trim()).toBe('Hide Paste Box')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(target.querySelector('label[for="table-import"]')?.textContent).toBe('Paste data')
    expect(target.textContent).toContain('It replaces the table above.')
    cleanup()
  })

  it('marks the paste box when its text is invalid', () => {
    const { target, cleanup } = mountBuilder()
    button(target, 'Paste Data…').click()
    flushSync()
    const box = target.querySelector<HTMLTextAreaElement>('#table-import')!
    expect(box.getAttribute('aria-invalid')).not.toBe('true')
    box.value = 'only a header'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(box.nextElementSibling?.classList.contains('field-error')).toBe(true)
    cleanup()
  })
})
