import { describe, it, expect } from 'vitest'
import { fileErrorCode, fileErrorText } from './fileError'

describe('fileErrorCode', () => {
  it("reads the code Go's FileError sends as the call's cause", () => {
    expect(fileErrorCode({ cause: { code: 'permission', path: '/a' } })).toBe('permission')
    expect(fileErrorCode({ cause: { code: 'not-bibliography' } })).toBe('not-bibliography')
  })

  it('is null for anything else', () => {
    expect(fileErrorCode(new Error('plain'))).toBeNull()
    expect(fileErrorCode(undefined)).toBeNull()
    expect(fileErrorCode({ cause: { code: 'made-up' } })).toBeNull()
    expect(fileErrorCode({ cause: 'text' })).toBeNull()
  })
})

describe('fileErrorText', () => {
  const err = (code: string) => Object.assign(new Error(`raw ${code}`), { cause: { code } })

  it('says why an open failed in plain words', () => {
    expect(fileErrorText('open', err('not-found'), 'paper.md')).toBe('Could not open paper.md: the file is no longer there.')
    expect(fileErrorText('open', err('permission'), 'paper.md')).toBe('Could not open paper.md: Halmos is not allowed to read it.')
  })

  it('says why a save failed in plain words', () => {
    expect(fileErrorText('save', err('permission'), 'paper.md')).toBe('Could not save: Halmos is not allowed to write there.')
    expect(fileErrorText('save', err('not-found'), 'paper.md')).toBe('Could not save: the folder is no longer there.')
  })

  it('says why a bibliography did not load', () => {
    expect(fileErrorText('bibliography', err('not-bibliography'), 'refs.txt')).toBe('Bibliography refs.txt is not a .bib file')
    expect(fileErrorText('bibliography', err('permission'), 'refs.bib')).toBe('Halmos is not allowed to read the bibliography refs.bib')
    expect(fileErrorText('bibliography', err('not-found'), 'refs.bib')).toBe('Bibliography not found: refs.bib')
  })

  it('keeps the error text for anything else', () => {
    expect(fileErrorText('open', new Error('disk on fire'), 'a.md')).toBe('Could not open a.md: Error: disk on fire')
    expect(fileErrorText('save', err('other'), 'a.md')).toBe('Could not save: Error: raw other')
    expect(fileErrorText('bibliography', new Error('x'), 'r.bib')).toBe('Bibliography not found: r.bib')
  })
})
