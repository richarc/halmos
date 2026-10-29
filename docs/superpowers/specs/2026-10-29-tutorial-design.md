# An interactive Getting Started tutorial — design

Written from the v0.16.0 roadmap item "An interactive Getting Started
tutorial" and the contract agreed with the portal on 2026-10-29
(`hermesportal/docs/api/tutorial.md`, served since `e07043d`). The author
asked for no questions, so every decision neither states is marked *My
call*.

## Why

The Getting Started guide is read on the site. A new user learns more by
doing the thing in the editor: write an equation, build a chart, cite a
paper, caption a table, refer to them. The tutorial is a real document in
a real folder, with its own bibliography and data, so every feature it
teaches works as it will in the user's own work.

## Goals

- Help → Getting Started, a Getting Started button on the start screen,
  and the palette (`Help: Getting Started`, which comes free with the menu
  item) start it.
- The editor downloads the tutorial from the portal, checks it, writes it
  to a folder the user picks (default `~/Documents/Halmos Tutorial/`) and
  opens its document.
- Offline, on any error, or when the portal's tutorial needs a newer
  editor, the copy bundled with the app is used instead.
- Each section shows a finished example, then sets tasks the user does in
  the same document, naming the palette command that does each one.
- Halmos ticks a task in the preview when the user has done it.
- A second run offers to open the existing tutorial or start fresh.
- A first launch points at it. The start screen appears only once there
  are recent files, so a new user goes straight into a templated document
  and never sees the start screen's button. *My call:* the first launch
  stays as it is, and a toast says "New to Halmos? Help → Getting Started
  walks you through it." It shows only on the launch that has no recent
  files and no recovery draft, after the update question if that is
  asked. The start screen's button serves returning users.

## Non-goals

- Screenshots in the first version. *My call:* the finished examples are
  live (a real equation, a real chart), which shows more than a picture,
  and no one can take screenshots from this session. The code handles
  `images/` as the contract says, so screenshots can be added to
  `docs/tutorial/` later with no code change.
- A progress bar, score or "all done" screen.
- Tutorials other than Getting Started.

## Anti-goals

- Writing anything the manifest did not name, anywhere outside the chosen
  folder, or over a file that is already there. The user's edits to an
  earlier tutorial are never overwritten.
- Changing the user's text to tick a task. The tick is drawn in the
  preview only; the Markdown keeps `- [ ]`.
- A tutorial that fails to start. Every failure of the download ends in
  the bundled copy, not an error.

## The flow

1. The user chooses Getting Started. The frontend opens the **Getting
   Started dialog** (a modal like the New dialog, with the same guards:
   not over a builder, the New dialog or Find a Style…).
2. The dialog asks Go for the state:
   - **No earlier tutorial** (or its folder has gone): "A short document
     that teaches Halmos by doing: equations, a chart, a citation, a table
     and cross-references. It goes in a folder of its own, with its
     bibliography and data." Below it, `Folder: ~/Documents/Halmos
     Tutorial` and **Change…**. Buttons: Cancel, **Start**.
   - **An earlier tutorial**: "You started the tutorial before, in
     ~/Documents/Halmos Tutorial." Buttons: Cancel, Start Fresh, **Open
     It**. Start Fresh switches to the first state with the next free
     folder name.
3. **Change…** shows a folder panel ("Choose where to put the tutorial";
   folders only, can create one). *My call:* the user picks the place, and
   the tutorial goes in a `Halmos Tutorial` folder inside it, so picking
   Desktop never scatters files across the Desktop. When that name is
   taken by anything, the next free one is used: `Halmos Tutorial 2`, `3`,
   ….
4. **Start** shows "Getting the tutorial…" with the buttons disabled. Go
   downloads, checks and writes it (below), then returns the entry's path.
   The dialog closes and the entry opens through the same route as a
   recent file, so an unsaved document gets the usual
   save/discard/cancel question first.
5. When the bundled copy was used because the portal's needs a newer
   editor, a toast says: "This is the tutorial that came with Halmos. An
   update brings the latest." *My call:* offline and other failures are
   silent: the tutorial works, and the user cannot act on the reason.
6. If writing fails (disk full, no permission), the dialog stays open and
   says so in one line, e.g. "Could not write the tutorial: permission
   denied", and Start is enabled again.

## Downloading and checking (Go)

A `TutorialService` in `tutorialservice.go`, over a small client in
`tutorialclient.go`. *My call:* the client reuses `styleclient.go`'s GET
(same-origin redirects, the user agent, the size cap, the contract's error
body) rather than copying it; the builder may move that GET into a shared
helper that both clients call.

- **Manifest:** `GET <portal>/tutorial/manifest.json`, the same origin as
  the styles (`portalOrigin()`). No ETag caching: the tutorial is fetched
  once per start, and the files are immutable per revision.
- **Checks, refusing the whole manifest on any failure:**
  - `version` is 1; unknown keys are ignored.
  - every `name` matches `^[a-z0-9][a-z0-9-]*\.(md|bib|csv|tsv|json)$` or
    `^images/[a-z0-9][a-z0-9-]*\.(png|jpg)$`; no name twice;
  - `entry` is one of the names and not in `images/`;
  - each `size` is at most 1 MiB for a text file and 2 MiB for an image,
    and the total under 16 MiB;
  - `sha256` is 64 lowercase hex characters;
  - `url` is a path on the same origin (starts with `/tutorial/`).
- **min_editor:** compared with the app's version using `update.go`'s
  `compareVersions`. Newer than this app: use the bundled copy and say so
  (step 5 above). *My call:* an unbundled build with no version (`go run`,
  development) uses the portal's.
- **Files:** each fetched with the size cap from the manifest, checked
  against its `sha256`. Nothing is written until every file is in memory
  and checked.
- **Time:** *My call:* one 30-second deadline over the whole download;
  past it, the bundled copy.
- **Errors:** any network error, any status but 200, a refused manifest or
  a hash mismatch: the bundled copy. A 404 on a file is not retried (the
  contract's "fetch the manifest again" is left for later: the bundled
  copy is good enough).

## The bundled copy

- `docs/tutorial/` is embedded in the binary with `//go:embed`, so the
  bundled copy is built from the same files the portal serves.
- `docs/tutorial/tutorial.json` is the contract's hand-written file
  (`title`, `entry`, `min_editor`, `files`). The bundled copy is read from
  it with the same checks as a manifest (names, entry, sizes); a Go test
  runs those checks on the real `docs/tutorial/`, so a bad name or a
  missing file fails the build, not a user's first run.
- Its revision is recorded as `bundled-<app version>`.

## Writing the folder

- The folder is created (`MkdirAll` on the folder itself only); if it
  exists it must be empty, or the write is refused. `images/` is created
  inside when a name needs it. No other folder is created.
- Each file is written with `O_EXCL`, so nothing that exists is ever
  replaced, at `filepath.Join(folder, name)` after the name check above.
- Last, `.halmos-tutorial.json`:
  `{"revision": "…", "source": "online" | "bundled", "entry": "…",
  "created": "<RFC 3339>"}`.
- *My call:* Go remembers the last tutorial folder in
  `<data>/hermes/tutorial.json` (`{"folder": "…"}`), like
  `palette-recents.json`. "An earlier tutorial" means that folder still
  holds `.halmos-tutorial.json` and its entry file. Settings is for
  preferences, and this is not one.

## Ticking tasks

Contract decision 5 left this to the editor. *My call:* Halmos checks.

- A task is a GitHub task-list item ending in a marker:
  `- [ ] Add a display equation below. <!-- check: display-math -->`.
  An HTML comment, so GitHub, Pandoc and any other renderer hide it. The
  editor renders with `html: false`, so a new markdown-it core rule
  (`lib/tutorialTasks.ts`) recognises the marker at the end of a task
  item's text and removes it from what is rendered (children only, not
  `content`, as `taskAlerts.ts` does).
- The task's **area** is everything after the task's list and before the
  next heading. The finished example sits above the task list, so it never
  counts.
- The checks, each on the area's tokens:

  | Marker | Done when the area has |
  |---|---|
  | `inline-math` | inline maths (`$…$`) |
  | `display-math` | display maths (`$$ … $$`) |
  | `chart` | a `vega-lite` fence |
  | `citation` | a citation (`[@key]` or `@key`, not a cross-reference); *my call:* any key counts, found or not, so the rule needs no bibliography and ticks in Quick Look and HTML export too |
  | `table-caption` | a table with a caption line |
  | `ref-fig` | a cross-reference to a figure that resolves |
  | `ref-tbl` | a cross-reference to a table that resolves |
  | `ref-eq` | a cross-reference to an equation that resolves |

- A done task's checkbox is drawn checked and its item gets the class
  `tutorial-task-done` (struck through in a muted colour, from the
  palette's existing variables). An unknown marker is removed and never
  ticks. A task the user ticks by hand (`[x]`) shows ticked, as today.
- The rule runs everywhere the renderer does (preview, Quick Look, HTML
  export); with no markers it changes nothing.

## The tutorial's content

`docs/tutorial/`: `tutorial.json`, `getting-started.md`,
`getting-started.bib`, `rainfall.csv`. *My call:* the sections, in order:

1. **Welcome**: what the document is, that it is the user's to change, and
   the command palette (⇧⌘P): every command by name. A first task: none
   (the palette has nothing to check).
2. **Equations**: a finished inline and display equation; tasks
   `inline-math` and `display-math`.
3. **A chart**: a finished chart (from the same data); task `chart`,
   naming "Insert: Chart…" and the Import button with `rainfall.csv`.
4. **Citations**: a finished citation; the frontmatter's `bibliography:`
   names `getting-started.bib`; task `citation`, naming "Insert:
   Citation…" (⇧⌘C).
5. **Tables**: a finished table with a caption; task `table-caption`,
   naming "Insert: Table…" (⇧⌘T) and the `: Caption` line.
6. **Cross-references**: finished references to the examples above;
   tasks `ref-fig`, `ref-tbl`, `ref-eq`, naming "Insert:
   Cross-reference…" (⇧⌘R).
7. **Next steps**: the guides, Export, Find a Style….

`min_editor` is `0.16.0`. The chart builder's Import panel opens in the
open document's folder, so `rainfall.csv` is the first thing the user
sees there. *My call:* `ImportData` gains the document's path, and the
panel starts in its folder (the start folder only; any file can still be
picked).

## Constraints

- No new dependency, Go or npm.
- Colours only from the palette in `style.css`.
- `hermes` is public: nothing from the portal's plans; the contract is
  public material already referenced by the editor's docs.
- Accelerators: none new (Help → Getting Started has none).

## Done when

- Go tests: the manifest checks (each bad name shape, a duplicate, entry
  missing or in `images/`, sizes, a bad hash string, a foreign URL); a
  hash mismatch falls back to the bundled copy; `min_editor` newer falls
  back and reports it; a 503 falls back; the folder rules (refuses a
  non-empty folder, creates only `images/`, writes `.halmos-tutorial.json`
  last, never replaces a file); the next free folder name; the remembered
  folder; the real `docs/tutorial/` passes the checks.
- Vitest: each marker ticks with its result in the area and not with the
  result only above the task list; the marker is not rendered; an unknown
  marker never ticks; the dialog's two states, Change…, Start (busy, then
  opens the entry through the dirty guard), a write error.
- Checked by eye in the app: Help → Getting Started, the start screen
  button and the palette. The branch builds as 0.15.0 and the tutorial
  says `min_editor: 0.16.0`, and the portal serves nothing until
  `docs/tutorial/` reaches it through `mix hermes.docs.sync` after a push.
  So on the branch the bundled copy is what is checked by eye, together
  with its "An update brings the latest" toast. The online path is covered
  by Go tests against a test server, and is checked by eye in the
  release's own checks, once the files are synced and the version is
  0.16.0. *My call:* no version bump and no early push in this work.
- Docs: `docs/getting-started.md` mentions Help → Getting Started;
  `CHANGELOG.md` Unreleased → Added; `ROADMAP.md` item ticked with a done
  note; `CLAUDE.md` a paragraph on `tutorialservice.go` and
  `lib/tutorialTasks.ts`, and `menu:tutorial` in the events list; product
  row updated after merge; `../bin/check-roadmaps`.

## Left to the builder

- The dialog's markup, within the New dialog's style.
- The tutorial's prose and examples, within the sections above.
- The shared GET helper's shape.
