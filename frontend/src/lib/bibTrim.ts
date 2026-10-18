// Cuts a .bib file down to the entries a document cites, for Word and LaTeX
// export: the export service recommends sending only those, and a whole
// Zotero library can run past its 2 MiB limit for one paper.
//
// A scanner, not a parser: it finds each top-level `@type{…}` (or `@type(…)`)
// block by counting braces, ignoring braces inside a quoted value, and keeps
// a block when its key is cited. @string, @preamble and @comment blocks are
// always kept, since cited entries may use their macros.

const ALWAYS_KEEP = new Set(['string', 'preamble', 'comment'])

interface Block {
  type: string
  key: string
  text: string
}

function scan(bib: string): Block[] {
  const blocks: Block[] = []
  let i = 0
  while ((i = bib.indexOf('@', i)) !== -1) {
    const head = /^@\s*([A-Za-z]+)\s*([{(])/.exec(bib.slice(i, i + 64))
    if (!head) {
      i++
      continue
    }
    const close = head[2] === '{' ? '}' : ')'
    let j = i + head[0].length
    let depth = 1
    let quoted = false
    for (; j < bib.length && depth > 0; j++) {
      const c = bib[j]
      if (c === '"' && depth === 1 && bib[j - 1] !== '\\') quoted = !quoted
      else if (quoted) continue
      else if (c === '{' || (close === ')' && c === '(')) depth++
      else if (c === '}' || (close === ')' && c === ')')) depth--
    }
    if (depth !== 0) break
    const body = bib.slice(i + head[0].length, j - 1)
    blocks.push({ type: head[1].toLowerCase(), key: body.split(',')[0].trim(), text: bib.slice(i, j) })
    i = j
  }
  return blocks
}

export function trimBibliography(bibText: string, keys: Set<string>): string {
  if (keys.size === 0) return ''
  const blocks = scan(bibText)
  if (!blocks.some((b) => !ALWAYS_KEEP.has(b.type))) return bibText
  return blocks
    .filter((b) => ALWAYS_KEEP.has(b.type) || keys.has(b.key))
    .map((b) => b.text)
    .join('\n\n') + '\n'
}
