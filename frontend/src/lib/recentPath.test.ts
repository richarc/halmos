import { describe, it, expect } from 'vitest'
import { splitRecent } from './recentPath'

describe('splitRecent', () => {
  it('shortens a folder under home to ~', () => {
    expect(splitRecent('/Users/ann/Papers/qec.md', '/Users/ann')).toEqual({ name: 'qec.md', folder: '~/Papers' })
  })

  it('shows ~ for a file directly in home', () => {
    expect(splitRecent('/Users/ann/notes.md', '/Users/ann')).toEqual({ name: 'notes.md', folder: '~' })
  })

  // /Users/anna starts with the string /Users/ann but is not inside it.
  it('does not shorten a folder that only shares a prefix with home', () => {
    expect(splitRecent('/Users/anna/x.md', '/Users/ann')).toEqual({ name: 'x.md', folder: '/Users/anna' })
  })

  it('leaves folders outside home alone', () => {
    expect(splitRecent('/Volumes/Data/a.md', '/Users/ann')).toEqual({ name: 'a.md', folder: '/Volumes/Data' })
  })

  it('shows / for a file at the root', () => {
    expect(splitRecent('/a.md', '/Users/ann')).toEqual({ name: 'a.md', folder: '/' })
  })

  it('keeps the full folder when home is unknown', () => {
    expect(splitRecent('/Users/ann/Papers/qec.md', '')).toEqual({ name: 'qec.md', folder: '/Users/ann/Papers' })
  })

  it('accepts a home with a trailing slash', () => {
    expect(splitRecent('/Users/ann/Papers/qec.md', '/Users/ann/')).toEqual({ name: 'qec.md', folder: '~/Papers' })
  })
})
