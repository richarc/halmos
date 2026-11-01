# Third-party licence notices — design

Roadmap: `ROADMAP.md` v1.0.0, "Third-party licence notices in the app"
(product milestone M1.0). Written 2026-11-01.

## Why

Halmos ships about 275 JavaScript packages and 3 Go modules inside every
copy of the app. Almost all are under licences (MIT, ISC, BSD, Apache-2.0)
whose one condition is that their copyright line and licence text travel
with every copy, binary copies included. Two (citeproc-js under CPAL-1.0,
elkjs under EPL-2.0) also require the full licence text and a statement of
where the source can be had.

Today the app does not meet this. `bundle:licences` copies four files
(Halmos's LICENSE and NOTICE, citeproc-js's two-paragraph dual-licence
statement, and the CSL styles' licence), and the Vite build removes every
licence comment from the bundled code: no `@license` comment survives in
`frontend/dist`. NOTICE says the remaining dependencies "are credited in
README.md", which is a credit, not the licence text the licences ask for.
v1.0.0 is the first release meant for anyone to download, so it is the
release that has to get this right.

## Audit (2026-11-01)

What the app ships, what each licence asks of a binary copy, and whether it
is met today. This is a reading of the licences, not legal advice.

| What ships | Licence | Requirement for a binary copy | Met today |
|---|---|---|---|
| Halmos | Apache-2.0 | LICENSE and NOTICE with it | yes |
| 262 JS packages (CodeMirror, markdown-it, KaTeX and its fonts, Mermaid, Vega, …) | MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD | each package's copyright and licence text | no |
| `khroma`, `i` | MIT (no `license` field in `package.json`; their LICENSE files say MIT) | as above | no |
| Chevrotain (6 packages, Mermaid's parser) | Apache-2.0 | the licence, and NOTICE files if any (none exist) | no |
| DOMPurify | MPL-2.0 OR Apache-2.0 | elect Apache-2.0; then as above | no |
| elkjs (Mermaid's layout engine) | EPL-2.0 | the licence text, and telling recipients how to obtain the source | no |
| citeproc-js | CPAL-1.0 OR AGPL-3.0; Halmos elects CPAL | the CPAL text, and where the source is | partly: only the dual-licence statement ships. citeproc-js defines no Exhibit B attribution, so no on-screen attribution is owed |
| CSL styles and en-US locale | CC-BY-SA-3.0 | attribution and the licence | yes |
| Wails v3, `github.com/adrg/xdg` | MIT | copyright and licence | no |
| `golang.org/x/sys`, the Go standard library and runtime | BSD-3-Clause | copyright and licence in the materials shipped with the binary | no |
| 2 packages under CC0-1.0 and the Unlicense | public domain | nothing | yes |
| `argparse` (Python-2.0) | — | used only by markdown-it's command-line tool; not in the bundle | nothing owed |

Two places the roadmap item did not name:

- **Quick Look** (`Contents/PlugIns`) carries its own copies of Mermaid,
  elkjs, KaTeX and markdown-it in its single script.
- **Exported HTML** embeds KaTeX's stylesheet with its fonts in the user's
  file, a substantial portion of KaTeX under MIT.

## Goals

1. One generated notices document covering everything the app ships: the
   app's frontend bundle (including lazy chunks), Quick Look's script, and
   the Go modules linked into the binary, plus the Go standard library.
2. Each entry gives the component's name, version, licence identifier,
   copyright line(s) and the **full licence text taken from the
   component's own licence file**, not a template filled in from the
   licence name.
3. citeproc-js's entry carries the full CPAL-1.0 text and states that
   Halmos elects CPAL; elkjs's entry carries the full EPL-2.0 text. Both
   say where the source of the shipped version can be obtained (repository
   URL and version).
4. DOMPurify's entry states that Halmos elects Apache-2.0.
5. The document ships in the bundle as
   `Contents/Resources/licences/THIRD-PARTY-NOTICES.txt`, beside the four
   files there today, in both `package` and `release` builds.
6. Help → Acknowledgements opens a page inside the Halmos window showing
   the same content.
7. Exported HTML carries a short comment in its embedded KaTeX stylesheet
   with KaTeX's copyright line and licence name (MIT) and its URL.
8. NOTICE drops the "credited in README.md" sentence and points to
   `THIRD-PARTY-NOTICES.txt` for the permissive-licence dependencies.

## Non-goals

- Legal review. The audit above is the working reading; nothing here
  depends on more than it.
- The portal's obligations (its own dependencies, the vendored renderer it
  uses for guides, the CSL styles it serves). Those belong to
  `hermesportal`.
- Styles downloaded through Find a Style… They are fetched by the user
  from the portal, are not part of the app's distribution, and each file
  carries its own rights metadata.
- Windows packaging. The Windows build (v1.1.0) will need the same file in
  its installer; this design only makes the generator independent of macOS.
- Changing which packages ship, or any dependency version (the 1.0 hold
  from 2026-10-29 applies).

## Anti-goals

- **A notices file that can silently drift from what ships.** A
  hand-maintained list, or one generated from `package.json` instead of
  from what the bundler actually included, would pass review today and be
  wrong after the next dependency change. Generate from the build itself.
- **A build that ships without notices.** A package whose licence file
  cannot be found must fail the build, not produce an entry saying
  "unknown".
- **Making the startup bundle heavier.** The notices data is several
  hundred KB of text; the page must load it only when opened.

## Decisions

- **Generated during the frontend build, by a Vite plugin written in this
  repository** (in or beside `frontend/vite.config.ts`). The plugin is the
  only hook in the build chain that is not regenerated: `build/Taskfile.yml`
  and `build/darwin/Taskfile.yml` are rewritten by `update:build-assets`.
  The plugin collects the packages from the modules Rollup actually
  bundled (so tree-shaken and dev-only packages are excluded and lazy
  chunks are included), reads each package's licence file from its
  directory, and writes the output into the build directory.
  *Builder's call:* whether the Go part runs inside the same plugin (e.g.
  `go list -deps` on the main package with the production tags, then each
  module's licence file from its module directory and the standard
  library's from `$(go env GOROOT)/LICENSE`) or as a separate step in the
  root `Taskfile.yml`, provided `build`, `package` and `release` all
  produce a complete file.
- **No new npm dependency for this** (my call, given the dependency hold).
  An existing licence plugin may be used only if it is already in the
  lock file.
- **Packages that ship without a licence file** (found by the design
  check: `@wailsio/runtime` (MIT), `unicode2latex` (ISC) and the
  `@unified-latex/*` packages (MIT)) get an override text kept in the
  repository, one file per package under `licenses/overrides/`, copied
  from the upstream repository's licence file at the shipped version, with
  a first line naming the URL it came from. An override is keyed by
  package **and version**: a version bump with no matching override fails
  the build, so a changed package is looked at again rather than carried
  forward. An override for a package that now has its own licence file,
  or that no longer ships, also fails the build, so the list cannot grow
  stale (my call).
- **Web Worker bundles count as what ships** (`bibWorker.ts` and its
  packages). Vite builds workers in their own Rollup pass, so the plugin
  is registered for workers too and the two sets merged (my call).
- **Quick Look is covered by the same document**, not a second copy
  inside the appex (my call). `quicklook:build` runs after the main
  frontend build, so its build uses the same plugin in check mode: it
  fails if it bundles a package and version the main build's notices do
  not list. The build order in `package` and `release` does not change.
- **The Go module list** comes from `go list -deps` on the main package
  with the `production` tag. Paid features are switched by a build tag
  but their code and modules stay in both builds, so `nopaid` does not
  change the list. `release` checks that every module `go version -m`
  reports for the shipped binary has an entry (my call).
- **Licence texts for CPAL-1.0 and EPL-2.0** that the packages do not
  carry themselves are kept in the repository under `licenses/` (where
  `citeproc-js.LICENSE` already is), copied verbatim from the Open Source
  Initiative / Eclipse Foundation.
- **Help → Acknowledgements replaces Help → Licences** (my call: one place
  to look). The page lists components alphabetically with name, version
  and licence, each expandable to its copyright and full licence text,
  and has a button to show the licence files in Finder, which is what
  Help → Licences did. It reads the generated data as a static asset of
  the app's own page, loaded on open. Unbundled development runs, where
  the data may be absent, show a short message instead of an empty list.
- **The palette** lists Acknowledgements like every other menu item
  (`commandSet.item`).
- **Plain-text format** for `THIRD-PARTY-NOTICES.txt`: a short header
  (what the file is, which component elections Halmos makes), then one
  section per component in alphabetical order, separated clearly enough
  to read in TextEdit.

## Tests and checks

- The generator, given a fixture of bundled module paths and package
  directories, produces entries with licence text from the files; fails on
  a package with no licence file; deduplicates a package bundled from two
  paths at the same version and lists two versions separately.
- A test that the generated document contains entries for citeproc-js
  (with the CPAL text and the election), elkjs (with the EPL text and a
  source statement), DOMPurify (with the election), Wails, `golang.org/x/sys`
  and the Go standard library.
- `release` refuses a bundle without `licences/THIRD-PARTY-NOTICES.txt`,
  as it already checks `NOTICE.txt` after signing.
- The HTML export test checks the KaTeX comment is present in the exported
  stylesheet.
- A menu test covers Help → Acknowledgements and the palette entry.

## Left to the builder

- The data format the page reads (one JSON asset, or the text file
  itself), as long as the page and the text file come from one generation.
- The page's layout, within the app's existing modal and colour rules
  (`style.css` tokens; `styleContract.test.ts`).
- Whether the Content-Security-Policy needs a change for loading the
  asset (it is same-origin).
- Wording of the NOTICE change and of the page's header text, in plain
  English.
- Updating `CLAUDE.md`'s `bundle:licences` paragraph and the README's
  licence section to match.
