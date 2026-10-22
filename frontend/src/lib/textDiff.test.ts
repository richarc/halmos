import { describe, it, expect } from 'vitest'
import { minimalChange } from './textDiff'

describe('minimalChange', () => {
  it('is null for equal text', () => {
    expect(minimalChange('abc', 'abc')).toBeNull()
  })

  it('keeps the common prefix and suffix', () => {
    expect(minimalChange('hello world', 'hello there world')).toEqual({ from: 6, to: 6, insert: 'there ' })
  })

  it('appends at the end', () => {
    expect(minimalChange('a\n', 'a\nb\n')).toEqual({ from: 2, to: 2, insert: 'b\n' })
  })

  it('does not split a surrogate pair', () => {
    // Both emoji share the high surrogate; the change must cover the whole pair.
    const c = minimalChange('x😀y', 'x😃y')
    expect(c).toEqual({ from: 1, to: 3, insert: '😃' })
  })
})
