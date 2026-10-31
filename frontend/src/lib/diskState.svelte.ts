// What Go's document watcher reported about the open file (document:changed,
// document:moved, document:deleted) and what App should do about it. App
// keeps the editor, the toasts and the paths; this keeps the decisions.

export type DiskChange = { path: string; version: string; content: string }
type HeldChange = { version: string; content: string }

export class DiskState {
  // Another program changed the open document while it had unsaved edits,
  // awaiting Keep Mine / Use File. A later change replaces it, so the answer
  // always applies to the newest version on disk.
  change = $state<HeldChange | null>(null)
  // Another program deleted the open document. The text stays open and
  // counts as unsaved, so quitting asks and drafts keep being written; Save
  // recreates the file.
  gone = $state(false)

  reset() {
    this.change = null
    this.gone = false
  }

  /** A change to the file at path: 'reload' a clean document without asking,
   * 'ask' about a dirty one (held in change), or 'ignore' another file's —
   * the previous document's watcher can still report after a switch.
   * isDirty is read after gone is cleared: a deleted file that came back is
   * judged by its text again. */
  changed(ev: DiskChange, path: string | null, isDirty: () => boolean): 'reload' | 'ask' | 'ignore' {
    if (ev.path !== path) return 'ignore'
    this.gone = false
    if (!isDirty()) return 'reload'
    this.change = { version: ev.version, content: ev.content }
    return 'ask'
  }

  /** The open file's new path after a move, or null for another file. */
  moved(ev: { from: string; to: string }, path: string | null): string | null {
    return ev.from === path ? ev.to : null
  }

  /** Whether the open file was the one deleted; if so it now counts as gone. */
  deleted(ev: { path: string }, path: string | null): boolean {
    if (ev.path !== path) return false
    this.gone = true
    return true
  }

  /** Keep Mine and Esc: the held change, taken once. */
  keepMine(): HeldChange | null {
    const c = this.change
    this.change = null
    return c
  }

  /** Use File: the held change, taken once. */
  useFile(): HeldChange | null {
    return this.keepMine()
  }
}
