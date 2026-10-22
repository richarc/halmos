# Following Changes Made to the Open File — Investigation

Source: the v0.15.0 item "Investigate following changes made to the open
file by something else" in `ROADMAP.md`. The item asks for a recommendation
with a size estimate. This document is that recommendation; the
implementation plan argues from it.

## What happens today

- Nothing watches the open document. `OpenPath` reads the file once
  (`documentservice.go`) and the editor shows that text until the next open.
- `Save` writes the editor's text with `writeFileAtomic` — a temporary file
  renamed over the document — with no check of what is on disk. A change
  made by another program since the document was opened is overwritten
  without warning. The Save button of the unsaved-changes dialog (close,
  ⌘Q, Dock Quit, logout) goes through the same `save()` and has the same
  problem.
- A moved or deleted file goes unnoticed. ⌘S after a move writes a new file
  at the old path; after a delete it recreates the file.
- **Recovery drafts can be lost.** `supersededByDocument` (`recovery.go`)
  drops a draft when the document's mtime is at or after the draft's. A
  draft is written at most every 2 s while dirty. If another program writes
  the document after the last draft and Halmos then crashes, the next launch
  finds the document newer, deletes the draft, and the unsaved edits are
  gone without a word. A program that writes often widens that window. This
  is a data-loss bug in the shipped app, independent of the rest of this
  item.
- `Editor.setContent` replaces the editor state wholesale: undo history,
  cursor, scroll and the find panel all go. Right for opening a different
  document; wrong for a reload of the same one.
- The bibliography watcher (`WatchBibliography`) polls mtime and size every
  2 s and emits `bib:changed`. It is the pattern to follow, with the
  additions below.

## What was checked

A throwaway Go program on macOS (APFS), keeping the document open and
asking for its path with `fcntl(F_GETPATH)` after each change:

| Change | Original path | Open file's path |
|---|---|---|
| Written in place | same inode | original path |
| Renamed or moved | missing | the new path |
| Replaced by rename (how Halmos, TextEdit and many editors save) | exists, new inode | original path (the old, unlinked file) |
| Deleted | missing | original path (stale) |

So the four cases can be told apart from one `stat` of the path plus one
`F_GETPATH` on a file Halmos holds open:

- Path exists, same inode → maybe changed in place: compare content.
- Path exists, new inode → replaced: compare content, reopen the new file.
- Path missing, open file reports a different path → moved there. A path
  inside `~/.Trash`, or another volume's `.Trashes`, counts as deleted.
- Path missing, open file reports the original path → deleted.

## Recommendation

Build it, in v0.15.0, as six pieces. Pieces 1–3 and 6 close the data-loss
paths and should not wait for 1.0. Piece 4 can slip to v1.0.0 if the
release runs long. Showing the difference stays in the backlog.

### 1. A version for the text on disk (Go)

- `OpenPath` returns a `version` with the content: the SHA-256 of the bytes
  read. `Save` takes the version the editor last loaded or saved, and
  returns the new one.
- The version is the content hash, not mtime and size: a `touch`, or a
  program rewriting identical bytes, is not a change. mtime and size remain
  the cheap test for whether to read the file at all.

### 2. Save checks before it writes (Go + frontend)

- `Save(path, content, baseVersion)` reads the file first. If its hash
  differs from `baseVersion`, it writes nothing and returns a conflict.
  A missing file is not a conflict: Save recreates it, as it does today.
- On a conflict the frontend asks: the file was changed by another program
  since it was opened. Choices: **Overwrite** (save anyway), **Cancel**.
  The unsaved-changes dialog's Save path shows the same question before
  the window closes or the app quits.
- The read-compare-write is not atomic against another writer; the window
  is the few milliseconds between the read and the rename. Accepted.

### 3. A document watcher (Go)

- One watcher for the open document, armed on open and on Save As, stopped
  on close. Polls every 1 s (the bibliography uses 2 s; a generator wants
  faster feedback, and one `stat` a second is negligible). No new
  dependency: polling, as `WatchBibliography` does.
- **Half-written files:** a change is acted on only when mtime and size
  are the same on two consecutive polls. A generator truncating and
  rewriting in place is read after it pauses, not mid-write. A generator
  that never pauses for a second is not reloaded until it does.
- **Own saves:** `Save` updates the watcher's known version, mtime, size
  and open file under the watcher's lock, after the rename and before
  returning. The next poll sees nothing new.
- On a change it reads the file, hashes it, and emits
  `document:changed` with `{version, content}` only if the hash differs
  from the known version. Moves and deletes emit `document:moved` (new
  path) and `document:deleted`.
- Keeps the document open for `F_GETPATH` and reopens it after a replace
  and after each own save, since an own save is itself a replace.

### 4. Moved and deleted (frontend)

- **Moved:** follow it. Update `path`, the window title, recents, the
  draft key and the bibliography watcher, and toast "Moved to <name>".
  A relative `bibliography:`, `csl:` or image path that no longer
  resolves from the new folder shows the existing missing-file messages;
  nothing is rewritten.
- **Deleted** (including moved to the Trash): keep the text, mark the
  document dirty (nothing on disk holds it now), and toast that the file
  was deleted and Save will recreate it.

### 5. Reloading (frontend)

- **No unsaved edits:** reload silently. Apply the new text as one
  CodeMirror transaction replacing only the changed span (common prefix
  and suffix kept), not through `setContent`. The cursor and selections
  map through the change, scroll stays where it is, and the preview
  re-renders through the normal change path. The transaction carries
  `addToHistory: false`, so ⌘Z does not revert the other program's
  write but still undoes the user's own earlier edits. `savedContent`
  and the version move to the new text, so the document stays clean.
- **Unsaved edits:** ask once per disk version. The file was changed by
  another program, and there are unsaved changes here. Choices:
  - **Keep Mine** — nothing changes in the editor. The disk version is
    recorded as seen, so the next Save does not raise the piece-2
    conflict for it, and no further question is asked until the file
    changes again.
  - **Use File** — apply the file's text as an undoable transaction, so
    ⌘Z brings the user's version back. The document becomes clean.
  - **Show the difference** is not offered. It needs a diff view Halmos
    does not have; it goes in the backlog.
- The chart and table builders already re-check their target against the
  live text at commit (`commitChart`, `commitTable`), so a reload under an
  open builder is safe.

### 6. Recovery drafts (Go)

Replace the mtime rule in `supersededByDocument` with content rules:

- The draft file gains `base`, the version of the disk text the edits
  started from, and `saved`, written by `Save` when it writes over a path
  that has a draft: the version it wrote.
- On `find`: drop the draft when the document's text equals the draft's,
  or when the document's version equals `saved` (Halmos itself wrote the
  current disk text after this draft). Otherwise offer it. When the
  document's version is neither `base` nor `saved`, the recovery dialog
  adds that the file was changed by another program since.
- Drafts written before this change have neither field. Treat them by the
  old mtime rule once, so an upgrade does not suddenly offer stale drafts.
- Remaining window: a draft write already in flight when Save runs lands
  after it and clears `saved`; the discard queued behind it removes the
  draft a moment later. Only a crash between the two leaves a stale draft,
  and that draft is offered rather than lost. Accepted.

## Size

| Piece | Estimate |
|---|---|
| 1. Version on open and save | 0.5 day |
| 2. Save conflict check and dialog | 1 day |
| 3. Document watcher (polling, settling, own saves, `F_GETPATH`) with tests | 1.5 days |
| 4. Moved and deleted | 1 day |
| 5. Reload as a transaction, the unsaved-edits dialog | 1.5 days |
| 6. Recovery rule | 0.5 day |
| Manual check with TextEdit, VS Code, vim and a generator script; guide, changelog | 1 day |
| **Total** | **about 7 days** |

Pieces 1, 2, 3, 5 and 6 without 4: about 6 days.

## Not in scope

- A diff or merge view (backlog).
- Following changes to images beside the document (the preview reloads
  them on the next render anyway).
- Files on network volumes, where mtime and `F_GETPATH` behave
  differently; polling still works there, moves may read as deletes.
- More than one open document: Halmos has one window.
