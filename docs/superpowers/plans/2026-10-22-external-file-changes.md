# Following External Changes to the Open File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halmos notices when another program changes, moves or deletes the open document, reloads or asks as the case needs, never overwrites such a change unseen, and no longer loses recovery drafts to it.

**Architecture:**
- Go owns everything about the disk. It keeps one tracked document: its path, the version (content hash) the editor's saved text matches, the last version the watcher saw, and an open file used to follow moves. Save checks the disk against that version before writing. A polling watcher reports settled changes, moves and deletes as events.
- The frontend decides what the user sees: a silent reload when clean, a question when dirty, a question before overwriting, and the moved and deleted messages. A reload is a minimal CodeMirror transaction, not `setContent`.
- Recovery drafts record the version they started from and the version Halmos last saved, and are dropped by content, not by mtime.

**Tech Stack:**
- Go 1.x standard library only (`crypto/sha256`, `os`, `syscall` for `F_GETPATH`). No new module.
- Wails v3 bindings and events.
- Svelte 5, TypeScript, CodeMirror 6, tested with Vitest and jsdom.

**Spec:** `docs/superpowers/specs/2026-10-22-external-file-changes-design.md`.

**One change from the spec, the planner's call:** the spec has `OpenPath` return a version and `Save` take one from the frontend. Here the version stays in Go (the tracked document), and the frontend passes a version back only when accepting a disk change (`AcceptDiskVersion`). Same behaviour, and no version threaded through every open, save and Save As in `App.svelte`.

## Global Constraints

- A version is the lowercase hex SHA-256 of the file's bytes. mtime and size only decide whether to read the file.
- The document watcher polls every 1 s (`docTick`, injectable for tests). A change, a disappearance or a reappearance is acted on only after the same `stat` result on two consecutive polls.
- Halmos's own saves never produce a `document:changed` event.
- A missing file at Save is not a conflict: Save recreates it.
- A move into `~/.Trash` (any path with `/.Trash/` in it) is reported as a delete.
- The silent reload uses `Transaction.addToHistory.of(false)`. **Use File** uses `addToHistory.of(true)`, so ⌘Z restores the user's text.
- New events, all plain and untyped like the existing ones: `document:changed` `{path, version, content}`, `document:moved` `{from, to}`, `document:deleted` `{path}`.
- Recovery drafts written before this change (no `base`, no `saved`) keep the old mtime rule.
- `F_GETPATH` code is `//go:build darwin`, as `keychain_darwin.go` is.
- Exact copy (the spec leaves wording to the builder; these are the plan's):
  - Save conflict, title "Changed on disk": `"{filename}" was changed by another program since it was opened. Save anyway and replace those changes?` Buttons **Cancel**, **Overwrite** (primary).
  - Change with unsaved edits, title "Changed on disk": `"{filename}" was changed by another program, and there are unsaved changes here.` Buttons **Keep Mine**, **Use File** (primary).
  - Moved toast: `Moved to {last two path segments}`, for example `Moved to Papers/qec.md`.
  - Deleted toast: `"{filename}" was deleted. Save will recreate it.`
  - Recovery dialog when `changed`: `A draft of "{filename}" was found, and the file has since been changed by another program. Restore the draft?`

## Review Focus

1. **A program that saves by deleting and recreating the file** (some vim settings, many generators): the file is missing for under a second. Expect a change, never a delete. Test in Task 2.
2. **A generator writing continuously**: a clean document reloads at most once per settle, the cursor stays, and no dialog appears. Test in Tasks 2 and 5.
3. **A second change while the "Changed on disk" question is open**: the dialog stays single and **Use File** applies the latest text, accepting the latest version. Test in Task 5.
4. **Moved while there are unsaved edits**: the draft follows to the new key, and ⌘S writes the new path, not the old one. Test in Tasks 3 and 6.
5. **Quit or close with Save while the file has an external change**: the conflict question appears over the unsaved-changes dialog. Cancel keeps the window open; Overwrite saves and then quits. Test in Task 5.

---

### Task 1: Tracked document and the checked Save (Go)

**Files:**
- Create: `docstate.go`, `docstate_test.go`
- Modify: `documentservice.go` (`DocumentService` fields, `OpenPath`, `Save`, `SaveAs`, `CreateDocument`)
- Modify: `documentservice_test.go`, and any Go test calling `Save(path, content)`

**Interfaces:**
- Produces:
  - `func contentVersion(b []byte) string`
  - `type SaveResult struct { Conflict bool \`json:"conflict"\` }`
  - `func (s *DocumentService) Save(path, content string, overwrite bool) (SaveResult, error)`
  - `func (s *DocumentService) AcceptDiskVersion(version string)`: sets the tracked base to `version` if it equals the last version the watcher saw; otherwise does nothing.
  - `func (s *DocumentService) ForgetDocument()`: clears the tracked document and stops its watcher (Task 2 fills in the stop).
  - `func (s *DocumentService) trackDocument(path string, data []byte)`: internal; sets path, base and seen to `contentVersion(data)`. Task 2 extends it to record the stat and reopen the file.
  - Fields on `DocumentService`: `docMu sync.Mutex`, `doc trackedDoc` (path, base, seen; Task 2 adds the rest).

- [ ] **Step 1: Write the failing tests** in `docstate_test.go`:
  - `TestContentVersionIsHexSHA256`: `contentVersion([]byte("abc"))` equals `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.
  - `TestSaveRefusesWhenDiskChanged`: `OpenPath` a file holding `"one"`; write `"two"` to it with `os.WriteFile`; `Save(path, "mine", false)` returns `SaveResult{Conflict: true}`, nil error, and the file still holds `"two"`.
  - `TestSaveOverwriteWritesAnyway`: same setup; `Save(path, "mine", true)` returns no conflict and the file holds `"mine"`.
  - `TestSaveAfterOwnSaveIsNotConflict`: `OpenPath`, `Save(path, "a", false)`, `Save(path, "b", false)`: neither conflicts.
  - `TestSaveRecreatesMissingFile`: `OpenPath`, `os.Remove(path)`, `Save(path, "x", false)` returns no conflict and the file holds `"x"`.
  - `TestSaveIgnoresTouch`: `OpenPath`, `os.Chtimes(path, future, future)`, `Save(path, "x", false)` does not conflict.
  - `TestAcceptDiskVersionOnlyAcceptsSeen`: after `OpenPath`, `AcceptDiskVersion("deadbeef")` leaves the base unchanged (a following external write still conflicts).
  - `TestSaveUntrackedPathDoesNotCheck`: `Save` to a path never opened (Save As, first save) writes without a check.

- [ ] **Step 2: Run** `go test ./. -run 'ContentVersion|Save|AcceptDisk'`. Expected: FAIL (undefined names, wrong `Save` arity).

- [ ] **Step 3: Implement** in `docstate.go` and `documentservice.go`:
  - `OpenPath` calls `trackDocument(path, data)` after reading.
  - `Save` holds `docMu`. If `path` is the tracked path and `overwrite` is false, it reads the file. If the read succeeds and its version differs from the base, it returns `SaveResult{Conflict: true}` without writing. A read error of `os.ErrNotExist` is not a conflict. After the write, `trackDocument(path, []byte(content))`.
  - `SaveAs` calls `Save(path, content, true)`: the save panel already asked about replacing.
  - `CreateDocument` calls `Save(path, content, true)`.
  - Update every caller of the old `Save` signature in Go tests.

- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null .`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: checked save against the version on disk`.

### Task 2: Document watcher (Go)

**Files:**
- Create: `docwatch.go`, `docwatch_test.go`, `docpath_darwin.go`
- Modify: `docstate.go` (`trackDocument`, `ForgetDocument`), `documentservice.go` (`docTick` default, `emitDoc` hook), `main.go` only if the hook needs wiring like `emitBibChanged`

**Interfaces:**
- Consumes: `trackDocument`, `contentVersion`, `docMu`, `doc` from Task 1.
- Produces:
  - `func currentPath(f *os.File) (string, error)` in `docpath_darwin.go`, via `fcntl(F_GETPATH)`.
  - Fields: `docTick time.Duration` (default `time.Second` in `NewDocumentService`), `emitDoc func(name string, data any)` (nil means `application.Get().Event.Emit(name, data)`).
  - `trackedDoc` gains: the open `*os.File`, the last acted-on `mod`, `size`, `ino`, a pending stat for the settle rule, and a `cancel` for the poll goroutine.
  - Events, as in Global Constraints. `document:changed` payload type `DiskChange { Path, Version, Content string }` with JSON keys `path`, `version`, `content`. `document:moved` payload `DocMove { From, To string }` (`from`, `to`). `document:deleted` payload `struct{ Path string }` (`path`).
  - A hook `onDocMoved func(from, to string)`, called under no lock before the event is emitted. Task 3 sets it to move the draft.

- [ ] **Step 1: Write the failing tests** in `docwatch_test.go`. Each uses `docTick = 10 * time.Millisecond`, a recording `emitDoc`, and a `waitFor(t, cond, 1*time.Second)` helper that polls `cond` (add it if the package has none). "No events" means none after 10 ticks:
  - `TestWatchReportsSettledChange`: open, rewrite in place; exactly one `document:changed` whose `content` is the new text and `version` is its hash.
  - `TestWatchIgnoresOwnSave`: open, `Save(path, "mine", false)`; wait 10 ticks; no events.
  - `TestWatchIgnoresTouch`: open, `Chtimes` only; no `document:changed`.
  - `TestWatchWaitsForSettle`: a goroutine appends a line every 5 ms for 100 ms; at most one `document:changed` arrives while it writes, and the last event's content equals the final file.
  - `TestWatchReportsReplace`: open, write a temp file and `os.Rename` it over the path; one `document:changed`. Rewrite in place afterwards; a second `document:changed` (proves the file was reopened).
  - `TestWatchDeleteAndRecreateIsAChange` (Review Focus 1): open, `os.Remove`, write new content within 1 tick; a `document:changed` and no `document:deleted`.
  - `TestWatchReportsDelete`: open, `os.Remove`, wait; one `document:deleted`.
  - `TestWatchReportsMove`: open, `os.Rename(path, other)`; one `document:moved` with `from`/`to` (compare with `filepath.EvalSymlinks` on both sides, since temp dirs sit under `/private`); a later Save to `to` is checked against the tracked base.
  - `TestWatchMoveToTrashIsDelete`: rename into `<tmp>/.Trash/doc.md`; `document:deleted`, not `document:moved`.
  - `TestForgetDocumentStopsWatching`: open, `ForgetDocument()`, rewrite; no events.

- [ ] **Step 2: Run** `go test ./. -run Watch`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `trackDocument` stops any previous poll goroutine, closes the previous file, opens `path`, records its stat (mtime, size, inode from `Sys().(*syscall.Stat_t).Ino`), and starts the goroutine. `ForgetDocument` stops it and clears `doc`.
  - One poll, under `docMu`, in this order:
    1. `os.Stat(path)`. Compare the result (exists, mtime, size, inode) with the pending one. If they differ, store it as pending and stop. If they match the last acted-on stat, stop.
    2. Exists: read the file; if its version equals `seen`, record the stat and stop. Otherwise set `seen`, record the stat, reopen the file if the inode changed, and emit `document:changed` after unlocking.
    3. Missing: call `currentPath` on the open file. If it differs from `path` and the file there exists, it was moved: a path containing `/.Trash/` is a delete; otherwise update `doc.path`, call `onDocMoved`, and emit `document:moved`. If it does not differ, emit `document:deleted` once and keep polling, so a reappearing file is reported as a change.
  - Emit outside the lock.

- [ ] **Step 4: Run** `go test ./. -race -run 'Watch|Save'`, then `go test ./. && go build -o /dev/null .`. Expected: PASS, no race reports.

- [ ] **Step 5: Commit** `feat: watch the open document for changes, moves and deletes`.

### Task 3: Recovery drafts by content (Go)

**Files:**
- Modify: `recovery.go`, `recovery_test.go`, `docstate.go` (Save marks the draft), `documentservice.go` (`WriteDraft` passes the base; set `onDocMoved`)

**Interfaces:**
- Consumes: `trackedDoc.base`, `Save`, `onDocMoved` from Tasks 1–2.
- Produces:
  - `draftFile` gains `Base string \`json:"base,omitempty"\`` and `Saved string \`json:"saved,omitempty"\``.
  - `Draft` gains `Changed bool \`json:"changed"\``.
  - `func (d *draftStore) write(docPath, content, base string) error`, which keeps an existing `Saved` only if the draft's content is unchanged (a write of new text clears it).
  - `func (d *draftStore) markSaved(docPath, version string) error`: no-op when there is no draft.
  - `func (d *draftStore) move(from, to string) error`: renames the draft file to the new key and rewrites its `path`; no-op when there is none.

- [ ] **Step 1: Write the failing tests** in `recovery_test.go`:
  - `TestDraftKeptWhenOtherProgramWritesAfterIt`: draft with `base` = version of `"one"`, content `"mine"`; the document then holds `"theirs"` with a newer mtime. `find` returns `Found: true, Changed: true`, and the draft file still exists.
  - `TestDraftDroppedWhenDocumentEqualsDraft`: the document holds the draft's text; not found, file removed.
  - `TestDraftDroppedWhenHalmosSavedOverIt`: `markSaved(path, version("saved text"))`, document holds `"saved text"`; not found.
  - `TestDraftOfferedUnchangedDiskIsNotChanged`: document still holds the base text; `Found: true, Changed: false`.
  - `TestLegacyDraftKeepsMtimeRule`: a draft JSON without `base` or `saved`, older than the document; not found (today's behaviour).
  - `TestDraftMovesWithDocument` (Review Focus 4): `move(a, b)`; `find(b)` finds it, `find(a)` does not.

- [ ] **Step 2: Run** `go test ./. -run Draft`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `find` order: a legacy draft uses `supersededByDocument` unchanged. Otherwise read the document. Unreadable means keep and offer. Drop when its text equals the draft's, or its version equals `Saved`. Otherwise offer, with `Changed = version != Base`.
  - `WriteDraft(docPath, content)` passes the tracked base when `docPath` is the tracked path, `""` otherwise.
  - `Save`, after a successful write, calls `drafts.markSaved(path, version)`.
  - `NewDocumentService` sets `onDocMoved` to `drafts.move` and `addRecent(to)`.

- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null .`. Expected: PASS.

- [ ] **Step 5: Commit** `fix: keep recovery drafts another program wrote over`.

### Task 4: Minimal reload in the editor (frontend)

**Files:**
- Create: `frontend/src/lib/textDiff.ts`, `frontend/src/lib/textDiff.test.ts`
- Modify: `frontend/src/Editor.svelte`, `frontend/src/Editor.test.ts`
- Regenerate: `wails3 task common:generate:bindings` (Tasks 1–3 changed the Go API)

**Interfaces:**
- Produces:
  - `export function minimalChange(prev: string, next: string): { from: number; to: number; insert: string } | null`: `null` when equal. It keeps the longest common prefix and suffix, and never splits a UTF-16 surrogate pair.
  - `Editor.reloadContent(text: string, undoable: boolean): void`: dispatches one change from `minimalChange(view.state.doc.toString(), text)` with `Transaction.addToHistory.of(undoable)`. It does not scroll and does not focus. `onchange` fires through the existing update listener.

- [ ] **Step 1: Write the failing tests.**
  - `textDiff.test.ts`:
    - `minimalChange('abc', 'abc')` is `null`.
    - `minimalChange('hello world', 'hello there world')` is `{ from: 6, to: 6, insert: 'there ' }`.
    - Appending: `minimalChange('a\n', 'a\nb\n')` is `{ from: 2, to: 2, insert: 'b\n' }`.
    - `minimalChange('x😀y', 'x😃y')` has `from: 1, to: 3`.
  - `Editor.test.ts`, new `describe('Editor.reloadContent')`:
    - Cursor after text that did not change stays at the same offset when lines are appended at the end.
    - Cursor in the last line maps forward when a line is inserted above it.
    - Start from `'a\n'`, type `X` at the start, then `reloadContent('Xa\nb\n', false)`. `undo` (from `@codemirror/commands`, run on the view) removes the `X` and keeps the appended line.
    - After `reloadContent(t, true)`, `undo` restores the pre-reload text.
    - `onchange` is called with the new text.

- [ ] **Step 2: Run** `npx vitest run src/lib/textDiff.test.ts src/Editor.test.ts` in `frontend/`. Expected: FAIL.

- [ ] **Step 3: Implement** both. Import `Transaction` from `@codemirror/state`.

- [ ] **Step 4: Run** the same tests, then `npx vitest run` and `npx svelte-check`. Expected: PASS, 0 errors.

- [ ] **Step 5: Commit** `feat: reload text as a minimal editor change` (with the regenerated bindings).

### Task 5: Reload, ask and save-conflict in the app (frontend)

**Files:**
- Modify: `frontend/src/App.svelte`, `frontend/src/App.test.ts` (the `DocumentService` mock gains `AcceptDiskVersion`, `ForgetDocument`, and `Save` resolving `{ conflict: false }`)

**Interfaces:**
- Consumes: `Save(path, content, overwrite) → { conflict }`, `AcceptDiskVersion(version)`, `ForgetDocument()`, the `document:changed` event (Tasks 1–2), and `editor.reloadContent` (Task 4).
- Produces state used by Task 6: `diskChange = $state<{ version: string; content: string } | null>(null)`.

- [ ] **Step 1: Write the failing tests** in `App.test.ts`, using `openDoc` and `listeners['document:changed']({ data: { path: '/tmp/paper.md', version: 'v2', content } })`:
  - `reloads a clean document silently`: the editor and preview show the new text, no dialog opens, `AcceptDiskVersion` is called with `'v2'`, and the document is not dirty (`SetDirty` last called with `false`).
  - `ignores a change for another path`.
  - `asks when there are unsaved edits`: after typing, the event opens "Changed on disk" with **Keep Mine** and **Use File**.
  - `Keep Mine keeps the text and accepts the version`: the editor text is unchanged, `AcceptDiskVersion('v2')` is called, and the document stays dirty.
  - `Use File applies the file and accepts it`: the editor shows the file's text, it is clean, and `AcceptDiskVersion('v2')` is called.
  - `a second change replaces the open question` (Review Focus 3): fire `v2`, then `v3` with other content, then **Use File**. One dialog; the editor shows `v3`'s content; `AcceptDiskVersion('v3')`.
  - `a stream of changes on a clean document asks nothing` (Review Focus 2): fire five events in a row; no dialog; the last text is shown.
  - `Save asks before overwriting`: `Save` resolves `{ conflict: true }` once. ⌘S (`listeners['menu:save']`) opens "Changed on disk" with **Cancel** and **Overwrite**. **Overwrite** calls `Save(path, text, true)` and the document becomes clean. **Cancel** leaves it dirty and calls `Save` no more.
  - `quit with Save meets a conflict` (Review Focus 5): `close:confirm` with `'quit'`, then **Save** in the unsaved-changes dialog, with `Save` reporting a conflict. **Cancel** calls `Quit` no more and leaves the document dirty. Repeat with **Overwrite**: `Quit` is called.
  - `new and close forget the document`: `menu:new` from a clean opened document and `document:closed` each call `ForgetDocument`.

- [ ] **Step 2: Run** `npx vitest run src/App.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** in `App.svelte`:
  - `save()` and `saveAs()` read `.conflict`. On a conflict, `save()` awaits `askOverwrite(): Promise<boolean>`, which opens the conflict dialog and resolves on **Overwrite** (`true`), **Cancel** or Esc (`false`). On `true` it calls `Save(path, snapshot, true)`; on `false` it returns `false`. `confirmSave` and the quit path need no change: they already act on `save()`'s result.
  - On `document:changed` for the current `path`, when not dirty: `editor.reloadContent(content, false)`, set `content` and `savedContent`, then `AcceptDiskVersion(version)`. When dirty: set `diskChange`; a later event overwrites it.
  - **Keep Mine**: `AcceptDiskVersion(diskChange.version)`, clear `diskChange`. **Use File**: `editor.reloadContent(diskChange.content, true)`, set `content` and `savedContent`, `AcceptDiskVersion`, clear `diskChange`. Esc acts as **Keep Mine**: it must not be destructive, the same rule as the recovery dialog.
  - Call `ForgetDocument()` in `doNew` and `closeDocument`.
  - Both dialogs use `Dialog` with `role="alertdialog"` and the copy from Global Constraints.

- [ ] **Step 4: Run** `npx vitest run` and `npx svelte-check`. Expected: PASS, 0 errors.

- [ ] **Step 5: Commit** `feat: reload, ask, and check before overwriting external changes`.

### Task 6: Moved, deleted and the recovery note (frontend)

**Files:**
- Modify: `frontend/src/App.svelte`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `document:moved` `{from, to}`, `document:deleted` `{path}`, `Draft.changed` (Tasks 2–3).
- Produces: `diskGone = $state(false)`. `dirty` becomes `content !== savedContent || diskGone`. `diskGone` is cleared by a successful save, `loadDocument`, `doNew`, `closeDocument`, and a `document:changed` for the path.

- [ ] **Step 1: Write the failing tests:**
  - `follows a moved file`: `document:moved` from `/tmp/paper.md` to `/tmp/Papers/qec.md`. The toast reads `Moved to Papers/qec.md`, the title shows `qec.md`, and the next ⌘S calls `Save('/tmp/Papers/qec.md', …)` (Review Focus 4).
  - `ignores a move of another file`.
  - `a deleted file stays open and unsaved`: `document:deleted` shows `"paper.md" was deleted. Save will recreate it.` `SetDirty(true)` is sent; ⌘S calls `Save` and the document becomes clean.
  - `a recovery offer says when the file changed`: `RecoverDraft` resolves `{ found: true, content: 'x', changed: true }`; the dialog shows the "changed by another program" text.

- [ ] **Step 2: Run** `npx vitest run src/App.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** the handlers. On a move, `path = to`; the existing effects re-arm the bibliography watcher and re-key the draft keeper. Go has already moved the draft and updated recents, so call `refreshRecents()` only.

- [ ] **Step 4: Run** `npx vitest run`, `npx svelte-check`, and `go test ./. && go build -o /dev/null .`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: follow a moved file and keep a deleted one open`.

### Task 7: Check in the real app; documentation

**Files:**
- Modify: `CLAUDE.md` (the events list in Architecture, and a bullet on the document watcher and its own-save rule next to the recovery-drafts bullet)
- Modify: `docs/getting-started.md` ("Saving": two or three sentences on reload, the question and the overwrite check)
- Modify: `CHANGELOG.md` (Unreleased: Added the following of external changes; Fixed the lost draft)
- Modify: `ROADMAP.md` (tick the build item) and `../ROADMAP.md` (the M0.15 row), then `../bin/check-roadmaps`, with the guarded-edit rule from `CLAUDE.md`

- [ ] **Step 1: Build and confirm the binary.** Run `wails3 task build && wails3 task package`, then `strings "bin/Halmos Editor" | grep document:moved`. Expected: a match.

- [ ] **Step 2: Manual checks**, against a copy of `docs/test-document.md`, each with the expected result:
  - TextEdit edits and saves it while clean: Halmos reloads within about 2 s; cursor and scroll unchanged.
  - VS Code saves it while Halmos has unsaved edits: "Changed on disk" appears once. **Use File** then ⌘Z brings the user's text back.
  - `vim` saves it (`:w`), with default settings and with `:set backupcopy=no`: a reload, never "was deleted".
  - A generator, `for i in $(seq 30); do echo "line $i" >> copy.md; sleep 0.3; done`: the text grows with no dialog, and the cursor stays where it was.
  - Edit in Halmos, change the file with `echo x >> copy.md`, ⌘S: the overwrite question appears.
  - Rename in Finder: the toast and title follow; ⌘S writes the new name.
  - Move to the Trash: the deleted toast appears; ⌘S recreates the file.
  - Edit in Halmos, wait 3 s, `echo x >> copy.md`, `kill -9` Halmos, relaunch, open the file: the recovery dialog offers the draft with the "changed by another program" text.

- [ ] **Step 3: Update the documents** listed above.

- [ ] **Step 4: Run** `go test ./. && go build -o /dev/null .`, then `npx vitest run` and `npx svelte-check` in `frontend/`, and `../bin/check-roadmaps`. Expected: all pass.

- [ ] **Step 5: Commit** `docs: following external changes` in the editor repository and the roadmap row in the product repository.
