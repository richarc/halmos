import { describe, it, expect } from 'vitest'
import { DiskState } from './diskState.svelte'

const change = (path = '/a.md') => ({ path, version: 'v2', content: 'new' })

describe('DiskState', () => {
  it('ignores a change, move or delete of another file', () => {
    const d = new DiskState()
    expect(d.changed(change('/b.md'), '/a.md', () => true)).toBe('ignore')
    expect(d.moved({ from: '/b.md', to: '/c.md' }, '/a.md')).toBeNull()
    expect(d.deleted({ path: '/b.md' }, '/a.md')).toBe(false)
    expect(d.change).toBeNull()
    expect(d.gone).toBe(false)
  })

  it('reloads a clean document and asks about a dirty one', () => {
    const d = new DiskState()
    expect(d.changed(change(), '/a.md', () => false)).toBe('reload')
    expect(d.change).toBeNull()
    expect(d.changed(change(), '/a.md', () => true)).toBe('ask')
    expect(d.change).toEqual({ version: 'v2', content: 'new' })
  })

  it('a file that comes back after a delete is judged by its text again', () => {
    const d = new DiskState()
    expect(d.deleted({ path: '/a.md' }, '/a.md')).toBe(true)
    expect(d.gone).toBe(true)
    // dirty reads gone, as App's derived does: the change must clear it first.
    expect(d.changed(change(), '/a.md', () => d.gone)).toBe('reload')
    expect(d.gone).toBe(false)
  })

  it('Keep Mine and Use File each take the held change once', () => {
    const d = new DiskState()
    d.changed(change(), '/a.md', () => true)
    expect(d.keepMine()).toEqual({ version: 'v2', content: 'new' })
    expect(d.keepMine()).toBeNull()
    d.changed(change(), '/a.md', () => true)
    expect(d.useFile()).toEqual({ version: 'v2', content: 'new' })
    expect(d.change).toBeNull()
  })

  it('follows a move of the open file, and reset forgets everything', () => {
    const d = new DiskState()
    expect(d.moved({ from: '/a.md', to: '/x/a.md' }, '/a.md')).toBe('/x/a.md')
    d.changed(change(), '/a.md', () => true)
    d.deleted({ path: '/a.md' }, '/a.md')
    d.reset()
    expect(d.change).toBeNull()
    expect(d.gone).toBe(false)
  })
})
