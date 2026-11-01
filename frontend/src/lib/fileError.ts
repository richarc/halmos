// The code Go's FileError (fileerror.go) puts on a failed file binding call,
// as the rejected call's cause. Branch on this, never on the error's text.
export type FileErrorCode = 'not-found' | 'permission' | 'exists' | 'not-bibliography' | 'other'

const CODES: readonly FileErrorCode[] = ['not-found', 'permission', 'exists', 'not-bibliography', 'other']

export function fileErrorCode(err: unknown): FileErrorCode | null {
  const cause = (err as { cause?: unknown } | null | undefined)?.cause
  const code = (cause as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && (CODES as readonly string[]).includes(code) ? (code as FileErrorCode) : null
}

/** The toast for a failed open, save or bibliography read: plain words for
 * the codes a person can act on, the error's own text for anything else. */
export function fileErrorText(action: 'open' | 'save' | 'bibliography', err: unknown, name: string): string {
  const code = fileErrorCode(err)
  switch (action) {
    case 'open':
      if (code === 'not-found') return `Could not open ${name}: the file is no longer there.`
      if (code === 'permission') return `Could not open ${name}: Halmos is not allowed to read it.`
      return `Could not open ${name}: ${err}`
    case 'save':
      if (code === 'not-found') return 'Could not save: the folder is no longer there.'
      if (code === 'permission') return 'Could not save: Halmos is not allowed to write there.'
      return `Could not save: ${err}`
    case 'bibliography':
      if (code === 'not-bibliography') return `Bibliography ${name} is not a .bib file`
      if (code === 'permission') return `Halmos is not allowed to read the bibliography ${name}`
      return `Bibliography not found: ${name}`
  }
}
