export interface TextChange {
  from: number
  to: number
  insert: string
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff

/**
 * The smallest single change that turns `prev` into `next`: the longest
 * common prefix and suffix are kept, and the middle is replaced. Returns null
 * when the texts are equal. Offsets are UTF-16 code units, as CodeMirror uses,
 * and a surrogate pair is never split.
 */
export function minimalChange(prev: string, next: string): TextChange | null {
  if (prev === next) return null
  const max = Math.min(prev.length, next.length)

  let start = 0
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  // Stopped inside a pair (shared high surrogate): step back to its start.
  if (start > 0 && isHigh(prev.charCodeAt(start - 1))) start--

  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--
    endNext--
  }
  // Stopped between the halves of a pair (shared low surrogate): step forward.
  if (endPrev < prev.length && isLow(prev.charCodeAt(endPrev))) {
    endPrev++
    endNext++
  }

  return { from: start, to: endPrev, insert: next.slice(start, endNext) }
}
