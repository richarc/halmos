# Command palette and shortcut tidy-up — design

## Why

Remembering shortcuts is the problem. The editor has about 25 of them, with
no pattern a writer can guess (Insert uses ⇧⌘, but so do Inline Code,
Strikethrough and the lists), and many frequent actions have none at all
(Table, Chart, Code Block, Export Word and LaTeX). Adding more shortcuts
would make the memory problem worse, not better.

A command palette removes the need to remember. Press ⇧⌘P, type a few
letters of what you want, press Return. Every entry shows its shortcut, so
the shortcuts are learnt by seeing them, not by studying a list.

The author's most-used actions: citations, cross-references, tables and
charts, headings, bold.

## Goals

- ⇧⌘P opens a command palette that can run every command in the menus.
- Each entry shows its shortcut, when it has one, taken from the menu itself.
- The palette is built so that later commands that are not menu items —
  portal (paid) commands, AI commands such as "LaTeX equation from
  description" or "find a reference matching the selected text" — can be
  added to it without redesigning it.
- Table gets the shortcut ⇧⌘T, so the four insert actions the author uses
  most follow one pattern where they can: ⇧⌘C Citation, ⇧⌘R Cross-reference,
  ⇧⌘T Table.

## Non-goals

- Jumping to places in the document (headings, figures, tables). Commands
  only, for now.
- Changing or customising shortcuts.
- A shortcut for Chart. The palette and the toolbar's chart button are
  enough.
- Re-assigning the existing formatting shortcuts (⇧⌘K, ⇧⌘X, ⇧⌘7, ⇧⌘8).
  They break the "⇧⌘ inserts" pattern, but they are rarely used and may
  already be known; moving them costs more than it gains.
- Building any of the future portal or AI commands.

## Anti-goals

- A palette list that disagrees with the menus: a command shown with the
  wrong shortcut, a label that differs from the menu's, or a menu item that
  is missing. The menus are the single source; the palette reads them.
- A palette that loses the author's place: closing it, or running a
  command from it, must return the cursor and selection to where they were.
- A shortcut that silently does nothing because something else claims it
  first (see Constraints).

## What it looks like (decided: layout A)

A box near the top of the window, centred, over the editor, with a light
dimming behind it. A search field at the top, focused when it opens; under
it a single flat list.

- Each row reads `Menu: Item`, with the menu's own labels unchanged, for
  example `Insert: Table…`, `Format: Heading 2`, `Export: Export Word…`.
  *My call:* the Export items keep their labels, even though the menu name
  repeats; renaming menu items is out of scope. Items in submenus include the
  submenu's name: `Insert: Code Block › Python`, `View: Appearance › Dark`,
  `File: Paper Size › A4`.
- The shortcut sits on the right of the row, in the menu's own notation
  (⇧⌘T), when the item has one.
- An item the menu shows ticked (an on/off item such as Autosave, or the
  chosen entry of a choice such as Appearance › Dark, Paper Size › A4 or a
  citation style) shows a ✓ before its label, as the menu does. Unticked
  items show nothing. *My call:* a tick rather than `on`/`off` text, so
  checkboxes and radio-style choices read the same way.
- An Open Recent entry shows its folder after the file name, in muted text,
  so two recents with the same name can be told apart. Its id is built from
  the full path, not the label.
- The characters that matched are shown in bold.
- One row is highlighted; ↑ and ↓ move it, Return runs it, a click runs the
  clicked row, Esc closes the palette. Running a command closes the palette.

## What it lists

Every menu item that has its own action in Go, walked from the menu as
built, with these left out:

- Separators and submenu headers (a submenu's items are listed, the
  submenu itself is not).
- Disabled items (for example Clear Recents with no recents).
- Items handled natively by macOS rather than by a Go action: Undo, Redo,
  Cut, Copy, Paste, Paste and Match Style, Delete, Select All, the Speech
  submenu, the Window menu, Services, Hide, Hide Others, Show All, About.
  Run from a palette that has the focus, most of these would act on the
  palette's search field, not the document.

Quit, Account…, the Help items and Open Recent's file entries are Go
actions and are listed.

The list is read from Go each time the palette opens, so on/off states,
the citation style tick and the recents are current.

## Matching and order

- Typed letters match in order but need not be next to each other, ignoring
  case: `itab` and `ins tab` both find `Insert: Table…`. Spaces in the
  query are ignored for matching.
- Best matches first. A match that starts a word ranks above one inside a
  word, and a match on the item's own label ranks above one on the menu
  name. *Builder's call:* the exact scoring, provided `tab` puts
  `Insert: Table…` first and `bold` puts `Format: Bold` first.
- With nothing typed, the commands the author ran from the palette most
  recently come first (up to five, newest first), then every command in
  menu order.
- *My call:* recents are remembered between launches, in a small file in
  the app's data folder (`<data>/hermes/palette-recents.json`), not in the
  `Settings` struct: a settings change rebuilds the menu and notifies the
  frontend, which running a command should not do. A recent that no longer
  exists (a recent file since cleared, say) is skipped.

## Opening and closing

- ⇧⌘P opens it. A new menu item, **View → Command Palette…**, owns the
  accelerator, because AppKit delivers menu key equivalents before the
  webview sees them (see `hermes/CLAUDE.md`). *My call:* the View menu, at
  the top, because it is about how you work in the window rather than about
  the document.
- It does not open while a dialog or the chart or table builder is open;
  ⇧⌘P is then ignored.
- *My call:* on the welcome screen (no document open) it opens, and lists
  only the commands that work there: the ones whose `App.svelte` handler is
  not refused by `showWelcome` (New, Open, Open Recent, the View settings,
  Help, Account…, Quit). On close, focus goes back to where it was.
- *My call:* while the palette is open, a menu shortcut or a click on the
  menu bar closes the palette first (focus and selection restored), then
  does what it does now. The palette joins the existing "something modal is
  open" guards only for ⇧⌘P itself, not for other commands.
- It does not open while the window is hidden (the menu item goes through
  `docEmit`, like the other document actions).
- Pressing ⇧⌘P while it is open closes it.
- On close, with or without running a command, focus returns to the editor
  with the cursor and selection unchanged. A command that moves the cursor
  (Insert: Table…, say) then acts on that restored position, exactly as if
  it had been picked from the menu.

## Running a command

Running a palette entry does exactly what clicking the menu item does —
the same Go action, not a copy of it. *Builder's call:* how. Wails'
`MenuItem.handleClick` is unexported, so the likely shape is a registry
kept alongside menu construction in `menu.go`: each item's action is
registered under an id as the item is added, `Commands()` returns
`{id, path, label, accelerator, checked, detail?}` for the palette, and
`RunCommand(id)` calls the registered action on the main thread. An unknown
id (the menu was rebuilt between listing and running) does nothing.

## Later: commands that are not menu items

The palette must take commands from more than one source, so a later
release can add commands that exist only in the frontend or only for a
paired, paying account. Design for it; build only the menu source now.

- A command has an id, a display path, an optional shortcut, an optional
  state, and a way to run it. The menu source is one provider of these.
- A later provider may add commands only when they apply (paired account,
  text selected) — so the list must be assembled when the palette opens,
  not once at startup.

## Shortcut changes

- New: ⇧⌘P — View → Command Palette….
- New: ⇧⌘T — Insert → Table….
- Nothing else changes.

Both chords were checked: neither is used in `menu.go`, and CodeMirror's
keymaps (including `defaultKeymap` and `foldKeymap`) do not bind
`Mod-Shift-p` or `Mod-Shift-t`. ⇧⌘P is conventionally Page Setup on macOS;
Halmos has no Page Setup item (paper size is a submenu).

## Constraints

- Accelerators belong to `menu.go`; check `defaultKeymap` and `foldKeymap`
  before adding one (`hermes/CLAUDE.md`).
- Colours come from the palette of custom properties in
  `frontend/public/style.css`; `styleContract.test.ts` fails on a literal
  colour. Light and dark themes both.
- Bindings are regenerated, never hand-edited.
- Accessible: the field and list use the combobox/listbox roles, so the
  highlighted row is announced.

## Done when

- ⇧⌘P opens the palette; typing `tab` and Return inserts a table at the
  cursor, as Insert → Table… does.
- Every Go-handled menu item appears exactly once, with the menu's label
  and shortcut; a test fails if the palette's list and the menu drift.
- ⇧⌘T opens the table builder.
- Esc returns the cursor and selection unchanged.
- Recents survive a relaunch.
- Docs: the keyboard shortcuts in the user guide list ⇧⌘P and ⇧⌘T, and say
  the palette lists every command. `CHANGELOG.md` Unreleased → Added.
  `ROADMAP.md` item ticked, with its product roadmap row updated and
  `../bin/check-roadmaps` run.

## Left to the builder

- The matching score, within the rule above.
- The palette's size, maximum rows shown before it scrolls, and styling
  within the app's existing dialog look.
- The registry's exact shape in Go.
