# Command palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⇧⌘P opens a palette that lists and runs every Go-handled menu command, with its shortcut; Insert → Table… gets ⇧⌘T.

**Architecture:** Every menu item's action is registered in a Go `commandSet` as `menu.go` builds the menu, so the list and the menu cannot drift; a new `CommandService` serves the list (`Commands`) and runs an entry (`RunCommand`), which calls the same function the menu item calls and records the palette's recents in `<data>/hermes/palette-recents.json`. The frontend's `lib/commandPalette.ts` does matching, ranking and shortcut display; `CommandPalette.svelte` is the box; `App.svelte` opens it on `menu:command-palette` and restores focus before running a command.

**Tech Stack:** Go, Wails v3 beta.30 menus and bindings, Svelte 5, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-command-palette-design.md`

## Global Constraints

- Shortcuts: new ⇧⌘P on **View → Command Palette…** (first item in View, then a separator), accelerator `"shift+cmdorctrl+p"`; new ⇧⌘T on **Insert → Table…**, accelerator `"shift+cmdorctrl+t"`. No other shortcut changes.
- Menu labels are unchanged (`Export: Export Word…` is correct).
- Row text: `<Menu>: <submenu › …><Label>`, e.g. `Insert: Table…`, `Insert: Code Block › Python`, `View: Appearance › Dark`.
- Shortcut display uses the menu's order and symbols: ⌃⌥⇧⌘ then the key, e.g. `⇧⌘T`, `⌥⌘O`, `⌥⌘[`.
- A ticked item shows `✓` before its label; nothing otherwise.
- Open Recent rows show the file's folder as muted detail; their id comes from the full path.
- Not listed: separators, submenu headers, disabled items, role items (Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Delete, Select All, Speech, Window menu, Services, Hide, Hide Others, Show All, About).
- Recents: up to 5, newest first, de-duplicated, only commands run from the palette, in `<data>/hermes/palette-recents.json`, not in `Settings`. An id no longer in the list is skipped.
- Opens only when no dialog or builder is open; ⇧⌘P while open closes it. On the welcome screen it lists only commands with `needsDocument: false`.
- Any other `menu:*` event while it is open closes it first (focus restored), then acts.
- Colours only from `style.css` custom properties (`styleContract.test.ts`); light and dark.
- Bindings are regenerated with `wails3 task common:generate:bindings`, never hand-edited.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A menu rebuild (a settings change, a recent file added) between opening the palette and pressing Return — the stale id runs nothing and the palette still closes cleanly. Test in Task 1 (`RunCommand` unknown id → false) and Task 4 (a `false` result closes without a toast).
2. Running a checkbox or radio command from the palette (Autosave, Appearance › Dark) — the setting changes exactly as a menu click would, and the menu's tick follows (the rebuild). Test in Task 2.
3. A command that acts at the cursor (Insert: Table…, Format: Bold) — it acts on the selection the author had before opening the palette. Test in Task 4 (focus and selection restored before `RunCommand` is called).
4. Two Open Recent files with the same name — two rows, different ids, each opens its own file. Test in Task 2.
5. A palette-recents file that is missing, empty, or not JSON — the palette opens with no recents and the next run rewrites it. Test in Task 1.

---

### Task 1: Command registry and CommandService (Go)

**Files:**
- Create: `commands.go`, `commandservice.go`
- Test: `commands_test.go`, `commandservice_test.go`

**Interfaces:**
- Produces, in `commands.go`:
  - `type Command struct { ID string \`json:"id"\`; Path []string \`json:"path"\`; Label string \`json:"label"\`; Accelerator string \`json:"accelerator"\`; Checked bool \`json:"checked"\`; NeedsDocument bool \`json:"needsDocument"\`; Detail string \`json:"detail"\` }` — `Path` is the top menu name then any submenu names, not including the label; `Accelerator` is Wails' `GetAccelerator()` string (`"Cmd+Shift+T"`) or `""`.
  - `type commandOpts struct { needsDocument bool; id string; detail string }` — `id` overrides the default id.
  - `type commandSet struct` with `func newCommandSet() *commandSet` and `func (s *commandSet) item(it *application.MenuItem, path []string, fn func(), o commandOpts) *application.MenuItem` — sets `it.OnClick` to call `fn`, records the entry (keeping `it` so `Label`, `GetAccelerator`, `Checked`, `Enabled` are read when listed), returns `it`. Default id: `strings.Join(append(path, it.Label()), " › ")`.
  - `type commandRegistry struct` (mutex-guarded current set): `func (r *commandRegistry) replace(s *commandSet)`, `func (r *commandRegistry) list() []Command` (registration order, disabled items left out), `func (r *commandRegistry) run(id string) bool` (calls the entry's `fn` outside the lock; false if unknown).
- Produces, in `commandservice.go`:
  - `type CommandList struct { Commands []Command \`json:"commands"\`; Recent []string \`json:"recent"\` }`
  - `type CommandService struct` with `func newCommandService(reg *commandRegistry, dataDir string) *CommandService`, `func (c *CommandService) Commands() CommandList`, `func (c *CommandService) RunCommand(id string) bool` — runs, and on success moves `id` to the front of the recents (max 5, no duplicates) and writes `<dataDir>/palette-recents.json` with `writeFileAtomic`. `Recent` is read from the file once, lazily; a missing, empty or invalid file is an empty list.

- [ ] **Step 1: Write the failing tests.**
  - `commands_test.go` (use `testApp()` as `menu_test.go` does):
    - `TestCommandSetRecordsPathLabelAndAccelerator`: an `Insert` submenu item `Table…` with `"shift+cmdorctrl+t"` registered under `[]string{"Insert"}` lists as `{ID: "Insert › Table…", Path: ["Insert"], Label: "Table…", Accelerator: "Cmd+Shift+T"}`.
    - `TestCommandSetLeavesOutDisabledItems`: an item with `SetEnabled(false)` is not listed.
    - `TestCommandSetReportsChecked`: an `AddCheckbox(…, true)` item lists `Checked: true`; an `AddRadio(…, false)` lists `false`.
    - `TestCommandSetIDOverride`: `commandOpts{id: "File › Open Recent › /a/notes.md", detail: "/a"}` lists with that id and detail.
    - `TestRegistryRunCallsTheMenuAction`: `run(id)` calls `fn` once and returns true; `run("nope")` returns false.
    - `TestRegistryReplaceDropsOldEntries`: after `replace` with a new set, an old id runs nothing.
  - `commandservice_test.go` (temp dir):
    - `TestRunCommandRecordsRecentsNewestFirst`: run a, b, a → `Recent == [a, b]`.
    - `TestRecentsKeepFive`: run six distinct → five, newest first.
    - `TestRecentsSurviveANewService`: a second `newCommandService` on the same dir reads them back.
    - `TestUnknownCommandIsNotRecorded`: `RunCommand("nope") == false`, `Recent` unchanged.
    - Review Focus 5: `TestBadRecentsFileIsEmpty`: file contents `""`, then `"{"` → `Recent` empty; a run then rewrites a valid file.
- [ ] **Step 2: Run them to see them fail.** `go test ./. -run 'Command|Recent'` — FAIL (undefined).
- [ ] **Step 3: Implement** both files to the interfaces above.
- [ ] **Step 4: Run the tests.** `go test ./. -run 'Command|Recent'` then `go test ./. && go build -o /dev/null .` — PASS.
- [ ] **Step 5: Commit.** `commands: a registry of menu actions, and CommandService for the palette`.

### Task 2: Register every menu item; ⇧⌘P and ⇧⌘T

**Files:**
- Modify: `menu.go` (every `OnClick`), `main.go` (one `commandRegistry`, `CommandService` registered beside `docs`, `demo`, `portal`; `installMenu` gains the registry), `frontend/bindings/` (regenerated), `CLAUDE.md` (the events list gains `menu:command-palette`)
- Test: `menu_test.go`

**Interfaces:**
- Consumes: `commandSet.item`, `commandOpts`, `commandRegistry.replace`, `newCommandService` (Task 1).
- Produces:
  - `installMenu(app, win, docs, reg *commandRegistry)` builds a `newCommandSet()`, passes it to every builder, and calls `reg.replace(set)` after `SetApplicationMenu`.
  - `addInsertMenu(menu, emit, cmds *commandSet)` and `addExportMenu(menu, emit, cmds *commandSet)`; the other builders take `cmds` likewise.
  - Event `menu:command-palette` (no payload), sent through `docEmit`.
  - Binding `CommandService.Commands(): Promise<CommandList>` and `CommandService.RunCommand(id: string): Promise<boolean>`.
- `needsDocument: true` for: Save, Save As…, Print…, everything in Export, Edit → Find, Insert (all, including Code Block), Format (all, including Citation Style), View → Fold/Unfold Block, Fold All Code Blocks, Unfold All. Check each against its `App.svelte` handler: a handler refused by `showWelcome` means `true`. Everything else `false`.
- Open Recent items: `id` is `"File › Open Recent › " + path`, `detail` is `filepath.Dir(path)`. The Quit item (`reclaimQuitItem`) is registered under the app menu's name.

- [ ] **Step 1: Write the failing tests** in `menu_test.go`:
  - `TestInsertTableHasShiftCmdT`: in `addInsertMenu`'s menu, `Table…` has accelerator `"Cmd+Shift+T"`.
  - `TestInsertMenuItemsAreCommands`: after `addInsertMenu(menu, emit, cmds)`, the set lists `Insert › Citation…`, `Insert › Cross-reference…`, `Insert › Chart…`, `Insert › Table…` and `Insert › Code Block › Python`, each `needsDocument`; running `Insert › Table…` emits `menu:insert-table` exactly as a click would.
  - `TestExportMenuItemsAreCommands`: four commands, labels as the menu's.
  - `TestEveryMenuActionIsRegistered`: parse `menu.go` with `go/parser`; fail if any call expression `X.OnClick(…)` appears there (all must go through `commandSet.item` in `commands.go`).
  - Review Focus 4: `TestSameNamedRecentsAreTwoCommands`: the recents builder given `/a/notes.md` and `/b/notes.md` lists two commands with different ids and details `/a`, `/b`. (Extract the Open Recent builder into `addRecentItems(recent *application.Menu, paths []string, open func(string), cmds *commandSet)` if it is not already separate.)
  - Review Focus 2: `TestCheckboxCommandRunsTheSameAction`: register a checkbox item whose `fn` flips a setting; `run` flips it once (the palette path does not depend on Wails' native toggle).
- [ ] **Step 2: Run them to see them fail.** `go test ./. -run 'Insert|Export|Registered|Recents|Checkbox'` — FAIL.
- [ ] **Step 3: Implement.** Convert every `.OnClick(func(*application.Context) { … })` in `menu.go` to `cmds.item(<item>, <path>, func() { … }, commandOpts{…})`; add ⇧⌘T to Table…; add View → Command Palette… (⇧⌘P, `needsDocument: false`, `docEmit("menu:command-palette")`) as View's first item followed by a separator; wire `main.go`; update existing `addInsertMenu`/`addExportMenu` test calls; regenerate bindings; add `menu:command-palette` to `CLAUDE.md`'s event list with a one-line note that palette entries run through `CommandService` (`commands.go`).
- [ ] **Step 4: Run the tests.** `go test ./. && go build -o /dev/null .`; `cd frontend && npx svelte-check --threshold error` — PASS, 0 errors.
- [ ] **Step 5: Commit.** `menu: every item registered as a command; ⇧⌘P palette item, ⇧⌘T for Table`.

### Task 3: Matching, ranking and shortcut display

**Files:**
- Create: `frontend/src/lib/commandPalette.ts`
- Test: `frontend/src/lib/commandPalette.test.ts`

**Interfaces:**
- Consumes: the `Command`/`CommandList` shapes from the bindings (Task 2).
- Produces:
  - `export function commandText(c: Pick<Command, 'path' | 'label'>): string` — `path[0] + ': ' + [...path.slice(1), label].join(' › ')`.
  - `export function formatAccelerator(acc: string): string` — `"Cmd+Shift+T"` → `"⇧⌘T"`; modifiers `Ctrl`→⌃, `Option`→⌥, `Shift`→⇧, `Cmd`→⌘, in that order; `""` → `""`.
  - `export interface Match { command: Command; text: string; ranges: [number, number][] }` — `ranges` are the matched character spans in `text`, for bold.
  - `export function rankCommands(commands: Command[], query: string, recent: string[], opts: { welcome: boolean }): Match[]`.
- Matching: case-insensitive; spaces in the query ignored; the query's characters must appear in order in `text`. Score (higher first): a match starting a word beats one inside a word; matches in the part after `': '` beat matches in the menu name; fewer gaps beat more; ties keep menu order. Empty query: the `recent` ids that exist, in order, then the rest in menu order. `welcome: true` drops `needsDocument` commands.

- [ ] **Step 1: Write the failing tests.**
  - `commandText`: `{path:['Insert'],label:'Table…'}` → `'Insert: Table…'`; `{path:['Insert','Code Block'],label:'Python'}` → `'Insert: Code Block › Python'`.
  - `formatAccelerator`: `'Cmd+Shift+T'`→`'⇧⌘T'`, `'Cmd+Option+O'`→`'⌥⌘O'`, `'Cmd+Option+['`→`'⌥⌘['`, `'Cmd+0'`→`'⌘0'`, `''`→`''`.
  - With a fixture list built from the real menu's labels (Insert: Citation…, Cross-reference…, Chart…, Table…; Format: Bold, Italic, Strikethrough, Heading › Heading 1; Export: Export LaTeX…; View: Autosave):
    - `'tab'` → first is `Insert: Table…`.
    - `'bold'` → first is `Format: Bold`.
    - `'itab'` and `'ins tab'` both include `Insert: Table…`.
    - `'TAB'` equals `'tab'`.
    - `'zzz'` → `[]`.
    - `ranges` for `'tab'` on `Insert: Table…` cover `Tab`.
    - `''` with `recent = ['Format › Bold', 'Gone › Item']` → first `Format: Bold`, `Gone` skipped, then the others in menu order.
    - `welcome: true` → no `needsDocument` command in the result.
- [ ] **Step 2: Run them to see them fail.** `cd frontend && npx vitest run src/lib/commandPalette.test.ts` — FAIL.
- [ ] **Step 3: Implement** `commandPalette.ts`.
- [ ] **Step 4: Run the tests.** That file, then `npx vitest run` — PASS.
- [ ] **Step 5: Commit.** `palette: matching, ranking and shortcut display`.

### Task 4: The palette, and opening it from App

**Files:**
- Create: `frontend/src/CommandPalette.svelte`
- Modify: `frontend/src/App.svelte`, `frontend/src/Editor.svelte` (add `export function focus(): void`), `frontend/public/style.css` only if a new custom property is needed (both theme blocks)
- Test: `frontend/src/CommandPalette.test.ts`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `rankCommands`, `commandText`, `formatAccelerator`, `Match` (Task 3); `CommandService.Commands`, `CommandService.RunCommand`, `menu:command-palette` (Task 2).
- Produces: `CommandPalette.svelte` props `{ open: boolean; welcome: boolean; onclose: () => void; onrun: (id: string) => void; load?: () => Promise<CommandList> }` (`load` defaults to `CommandService.Commands`, injectable for tests).

- [ ] **Step 1: Write the failing tests.**
  - `CommandPalette.test.ts`: opening calls `load` and focuses an input with `role="combobox"` and a `role="listbox"` of `role="option"` rows; typing `tab` makes the first option read `Insert: Table…` with `⇧⌘T`; ↓ moves `aria-selected`; Return calls `onrun('Insert › Table…')`; a click on a row calls `onrun` with its id; Esc calls `onclose` and not `onrun`; a ticked command shows `✓`; an Open Recent row shows its detail; `welcome: true` hides `needsDocument` rows.
  - `App.test.ts`:
    - `menu:command-palette` opens it; sent again, closes it.
    - It does not open while the New dialog (or the chart or table builder) is open.
    - Review Focus 3: with the editor selection at 5–9, open, then pick a row: `editor.focus` has run and the selection is still 5–9 **before** `RunCommand` is called.
    - Esc restores focus to the editor with the selection unchanged.
    - Another `menu:*` event (e.g. `menu:format` `bold`) while open closes the palette, then applies bold to the restored selection.
    - Review Focus 1: `RunCommand` resolving `false` closes the palette and shows no toast.
    - On the welcome screen, it opens and lists no `Insert:` rows.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/CommandPalette.test.ts src/App.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
  - `CommandPalette.svelte`: layout A from the spec — centred near the top, light scrim, search field, flat list (max ~10 rows visible, then scroll, highlighted row kept in view), matched characters in `<b>`, shortcut right-aligned in `<kbd>`, `✓` before a ticked label, detail muted. Its own component, not `Dialog.svelte`.
  - `App.svelte`: `paletteOpen` state; `Events.On('menu:command-palette', togglePalette)`; refused when `chartOpen || tableOpen || newOpen || pendingAction || equationAsk || unknownOpen || zoteroHelp || ` the account/connect dialogs are open; on open remember `document.activeElement`; on close, focus back (the editor via `editor.focus()`, else the remembered element); `onrun(id)` closes and restores focus first, then `await CommandService.RunCommand(id)`. Every other `Events.On('menu:…')` registration goes through one wrapper that closes the palette first.
  - `Editor.svelte`: `focus()` calls `view.focus()` (selection is kept by CodeMirror).
- [ ] **Step 4: Run the tests.** `npx vitest run`, `npx svelte-check --threshold error` — PASS, 0 errors.
- [ ] **Step 5: Commit.** `palette: ⇧⌘P opens the command palette`.

### Task 5: Docs, check in the app, roadmap

**Files:**
- Modify: `docs/getting-started.md` (a short "Command palette" section; ⇧⌘T in the table/insert text, written `⌘⇧T` as that file writes chords), `CHANGELOG.md` (Unreleased → Added), `ROADMAP.md` (tick the v0.16.0 item), `../ROADMAP.md` (M0.16 "Command palette" row)

- [ ] **Step 1: Docs.** `getting-started.md`: ⌘⇧P opens the command palette; type part of a command's name, Return runs it; every command is there, with its shortcut, so it's also where to look a shortcut up. Add ⌘⇧T for Insert → Table… wherever the table builder is described.
- [ ] **Step 2: Check in the app** (controller). `wails3 task build && wails3 task run`; `strings "bin/Halmos Editor" | grep -c "menu:command-palette"` ≥ 1. With a document open: ⇧⌘P, `tab`, Return → table builder at the cursor; Esc keeps the selection; Autosave toggled from the palette flips the menu tick; ⇧⌘T opens the table builder; on the welcome screen the palette shows no Insert rows. The user does the click-through; capture only the app window if a screenshot is needed.
- [ ] **Step 3: Changelog and roadmap.** Tick the item with a *Done* note (guarded single-block replacement; compare `grep -c '^- \['` and `grep '^## '` before and after). Product row: "done in the editor <date> (not yet released)"; run `../bin/check-roadmaps`.
- [ ] **Step 4: Run everything.** `npx vitest run`, `npx svelte-check --threshold error`, `go test ./. && go build -o /dev/null .` — all pass.
- [ ] **Step 5: Commit** in each repository: hermes `docs: the command palette`; product `roadmap: command palette done in the editor`.
