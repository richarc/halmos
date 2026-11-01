# PDF bookmarks and document properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every PDF from Export PDF… carries a nested outline of the document's headings, each opening its page, and Title, Author and Creator in its properties.

**Architecture:** The frontend sends the headings (bookmark text, match text, level), title and authors with the export. WebKit renders to a temporary file as it does now; the Objective-C finisher, now run for every export, optionally stamps the header and footer into a second temporary file, then hands both paths to Go and returns. On a goroutine, Go reads each page's text from the unstamped file (`pdfPageTexts`), assigns pages in a pure function, writes bookmarks and properties with pdfcpu into the chosen path, and falls back to moving the stamped file there if anything fails.

**Tech Stack:** Go 1.26, cgo/Objective-C (AppKit, PDFKit), pdfcpu v0.16.4, Svelte 5, markdown-it, vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-pdf-outline-design.md`

## Global Constraints

- pdfcpu is pinned to one exact version in `go.mod`: `github.com/pdfcpu/pdfcpu v0.16.4`. No other new dependency.
- Task 1 is a gate. If pdfcpu fails any of its four checks, stop and report to the user; do not switch library or work around it.
- Size and time limits (spec, check 4): on a 200-page PDF, growth ≤ max(10%, 1 MB); added time ≤ 2 s.
- An export never fails because of this step: on any error the user gets the PDF WebKit rendered, with its header and footer.
- The pdfcpu step and the move to the chosen path never run on the main thread.
- Page matching reads the PDF **before** the header and footer are stamped.
- A bookmark never points before the previous bookmark's page.
- Creator is `Halmos Editor`. Author is the author names joined with `, `. No frontmatter title, no Title property and no `DisplayDocTitle`.
- File → Print… and the Word and LaTeX exports are unchanged.
- Test commands: `go test ./. ./internal/...`, `go test -tags nopaid ./. ./internal/...`, `GOOS=windows GOARCH=amd64 go vet ./. ./internal/...`, `cd frontend && npx vitest run < /dev/null`, `cd frontend && npx svelte-check`.

## Review Focus

1. A heading whose words also appear on an earlier page (the contents list, a cross-reference, body text): expect its own page, not the earlier one.
2. A heading made only of maths, or only of code: no match text, so it takes the previous bookmark's page, logged; the export goes on.
3. Two headings with the same text ("Introduction" in two chapters): expect two bookmarks on their own pages, in order.
4. A PDF of 1 page with no headings, and an untitled document: no outline and no Title written, and the file is still valid.
5. A save path that already exists, or a folder that becomes unwritable during the export: the fallback still leaves a PDF at the path, or reports the error, and temporary files are removed.

Lines 1–3 have tests in Task 2; line 4 in Task 3; line 5 in Task 4.

---

### Task 1: The pdfcpu check (gate)

**Files:**
- Modify: `go.mod`, `go.sum` (add `github.com/pdfcpu/pdfcpu v0.16.4`)
- Create: `testdata/webkit-export.pdf`, `testdata/webkit-export-200.pdf` (made by the script below; commit the PDFs, not the script)
- Create: `pdfcpu_check_test.go`

**Interfaces:**
- Produces: the fixture PDFs and the knowledge of which pdfcpu calls set nested bookmarks, the standard Title/Author/Creator, and `DisplayDocTitle`. Record the calls in the ledger for Task 3.

- [ ] **Step 1: Make the fixtures with WebKit.** In the scratchpad, write a throwaway Swift script that loads an HTML page into a `WKWebView` and saves it with `NSPrintOperation` to a file, as `hermesExportWebViewPDF` in `print_darwin.go` does (A4, zero margins, `NSPrintSaveJob`, `runOperationModalForWindow`). The page has a contents list linking to `#h1`…, an external link, three levels of headings, and body text. `webkit-export.pdf` is about 5 pages; `webkit-export-200.pdf` repeats the body to about 200 pages. Run it with `swift` and copy the two PDFs to `testdata/`.
- [ ] **Step 2: Write the checks** in `pdfcpu_check_test.go` (`//go:build darwin`, since it reads page text through `pdfPageTexts`), each writing the result through pdfcpu to a temp file and reading it back:
  - `TestPdfcpuWritesNestedBookmarks`: two top-level bookmarks, the first with two children; `api.Bookmarks` reads back the same tree and pages.
  - `TestPdfcpuWritesTitleAuthorCreator`: the document information reads back `Title`, `Author`, `Creator` as set (not as custom keys).
  - `TestPdfcpuKeepsLinksAndText`: the count of link annotations per page and the text of every page (read with `pdfPageTexts`) are unchanged.
  - `TestPdfcpuSizeAndTime200Pages`: on `webkit-export-200.pdf`, size growth ≤ max(10%, 1 MB) and the write takes ≤ 2 s.
- [ ] **Step 3: Run** `go test ./. -run Pdfcpu -v`. Expected: all four pass. **If any fails, stop and report to the user.** Look for how pdfcpu sets the standard Info keys and `DisplayDocTitle` before concluding it cannot.
- [ ] **Step 4: Commit**

```bash
git add go.mod go.sum testdata/webkit-export.pdf testdata/webkit-export-200.pdf pdfcpu_check_test.go
git commit -m "pdf: pdfcpu keeps WebKit's links and text and writes nested bookmarks and properties"
```

### Task 2: Headings to bookmarks, and finding their pages (pure Go)

**Files:**
- Create: `pdfoutline.go`, `pdfoutline_test.go`

**Interfaces:**
- Produces:
  - `type PDFHeading struct { Level int \`json:"level"\`; Text string \`json:"text"\`; Match string \`json:"match"\` }`
  - `type PDFOutline struct { Headings []PDFHeading \`json:"headings"\`; Title string \`json:"title"\`; Authors []string \`json:"authors"\`; Contents bool \`json:"contents"\` }`
  - `type outlineNode struct { Title string; Page int; Kids []outlineNode }`
  - `assignPages(headings []PDFHeading, pageTexts []string, contents bool) []int` — 1-based pages, one per heading
  - `nestOutline(headings []PDFHeading, pages []int) []outlineNode`
  - `normaliseForMatch(s string) string` — lower case, runs of whitespace to one space, soft hyphens and line-end hyphens joined, the `ﬁ`/`ﬂ` ligatures expanded

- [ ] **Step 1: Write the failing tests:**
  - `TestAssignPagesFindsEachHeadingOnItsPage`
  - `TestAssignPagesSkipsAnEarlierMention` (Review Focus 1): "Results" in body text on page 2, heading on page 4 → 4. Rule: a match counts only if the page's normalised text has the heading's match text **at the start of a line** (PDFKit's page text keeps line breaks; normalise within lines only).
  - `TestAssignPagesSkipsTheContentsPages`: with `contents` true, a page whose lines start with at least half of the headings' match texts (and at least 3) is never matched.
  - `TestAssignPagesWrappedHeading`: a heading split over two lines matches.
  - `TestAssignPagesSameTextTwice` (Review Focus 3): two "Introduction" headings on pages 3 and 9 → 3, 9.
  - `TestAssignPagesNoMatchTakesThePreviousPage` (Review Focus 2): empty match text or not found → previous page (page 1 for the first); never decreasing.
  - `TestNestOutline`: levels 1,2,2,1,3 → two roots; the second root's level-3 heading is its child (skipped level).
  - `TestNestOutlineNoHeadings`: nil.
- [ ] **Step 2: Run to verify they fail.** `go test ./. -run 'AssignPages|NestOutline'`. Expected: FAIL, undefined.
- [ ] **Step 3: Implement** in `pdfoutline.go`. Matching scans pages from the previous heading's page forward, so a heading is never placed before its predecessor.
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS. Also `GOOS=windows GOARCH=amd64 go vet ./.` (the file has no build tag).
- [ ] **Step 5: Commit**

```bash
git add pdfoutline.go pdfoutline_test.go
git commit -m "pdf: place each heading on its page and nest the outline"
```

### Task 3: Writing the outline and properties with pdfcpu

**Files:**
- Modify: `pdfoutline.go`
- Test: `pdfoutline_test.go`

**Interfaces:**
- Consumes: Task 1's pdfcpu calls; Task 2's `outlineNode`.
- Produces: `writeOutline(in, out string, nodes []outlineNode, o PDFOutline) error` — writes `out` from `in` with the bookmarks (none when `nodes` is empty), `Title` and `DisplayDocTitle` when `o.Title != ""`, `Author` when `o.Authors` is not empty, and `Creator = "Halmos Editor"`.

- [ ] **Step 1: Write the failing tests** over `testdata/webkit-export.pdf`: `TestWriteOutlineBookmarksAndProperties` (read back the tree, pages, Title, Author `"Ada Lovelace, Charles Babbage"`, Creator); `TestWriteOutlineUntitledNoHeadings` (Review Focus 4: no outline, no Title, Creator set, file opens with `api.ValidateFile`); `TestWriteOutlineKeepsPageCount`.
- [ ] **Step 2: Run to verify they fail.** `go test ./. -run WriteOutline`. Expected: FAIL, undefined.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add pdfoutline.go pdfoutline_test.go
git commit -m "pdf: write the outline, title, author and creator with pdfcpu"
```

### Task 4: The export hand-over to Go

**Files:**
- Modify: `print_darwin.go` (the finisher runs for every export; it stamps into a second temp file when there is a header or footer; then calls the Go export below and returns), `documentservice.go` (`ExportPDF` gains the outline), `pdfstamp_darwin.go` only if a helper moves
- Create: `pdfexport.go` (platform-independent finishing), `pdfexport_darwin.go` (the `//export` callback and the pending-export registry), `pdfexport_test.go`
- Regenerate: `frontend/bindings`

**Interfaces:**
- Consumes: `assignPages`, `nestOutline`, `writeOutline`, `pdfPageTexts`.
- Produces:
  - `ExportPDF(docPath string, furniture PageFurniture, outline PDFOutline) error` (binding).
  - `finishExport(rendered, stamped, dest string, o PDFOutline, pageTexts func(string) []string) error` — runs on a goroutine; pages from `pageTexts(rendered)`; writes `dest` through a temp file in dest's folder and a rename; on any error from the outline step, moves `stamped` (or `rendered` when there is no stamp) to `dest` instead; removes the temp files in every case; logs what failed.
  - The registry maps an export id (an `int` passed through the finisher as `contextInfo` or a field) to its `PDFOutline`, so the Objective-C side never sees it.

- [ ] **Step 1: Write the failing tests** in `pdfexport_test.go` (platform-independent, `pageTexts` injected): `TestFinishExportWritesTheOutline` (fixture in, dest has bookmarks, temps gone); `TestFinishExportFallsBackToTheStampedPDF` (an outline step forced to fail, e.g. `rendered` truncated: dest is a byte copy of `stamped`, temps gone); `TestFinishExportReplacesAnExistingFile` and `TestFinishExportReportsAnUnwritableFolder` (Review Focus 5).
- [ ] **Step 2: Run to verify they fail.** `go test ./. -run FinishExport`. Expected: FAIL, undefined.
- [ ] **Step 3: Implement**, then rewire `print_darwin.go`: render to temp A; on success, if header/footer stamp A → temp B; call the exported Go function with (id, A, B or "", dest) and return at once. Keep the `paperName`/margin/centring rules and `runOperationModalForWindow` exactly as they are. Run `wails3 task common:generate:bindings`.
- [ ] **Step 4: Run** all Go suites and Windows vet. Expected: pass.
- [ ] **Step 5: Commit**

```bash
git add print_darwin.go documentservice.go pdfexport.go pdfexport_darwin.go pdfexport_test.go frontend/bindings
git commit -m "pdf: every export hands its file to Go, which adds the outline off the main thread"
```

### Task 5: The frontend sends the outline

**Files:**
- Modify: `frontend/src/lib/outline.ts` (each entry also carries `match`: the text with maths and inline code left out)
- Create: `frontend/src/lib/pdfOutline.ts`, `frontend/src/lib/pdfOutline.test.ts`
- Modify: `frontend/src/App.svelte` (`exportPDF` passes `pdfOutline(...)`), `frontend/src/lib/outline.test.ts`

**Interfaces:**
- Consumes: `PDFOutline` from the regenerated bindings.
- Produces: `pdfOutline(outline: OutlineEntry[], fm: Frontmatter, contents: boolean): PDFOutline` — `headings` from `outline` (`text` as the sidebar shows it, `match` from the new field), `title` from `fm.title` (plain text, or `''`), `authors` from `fm.authors` names only, `contents` true when the document has `toc: true` or a `[[toc]]` marker (use what `lib/toc.ts` already reports).

- [ ] **Step 1: Write the failing tests:** `outline.ts` gives `match: 'Results for'` for `## Results for $x^2$` while `text` keeps the maths; `match: ''` for a heading of only maths; `pdfOutline` maps headings, title, author names without affiliations, and `contents`; no headings gives `headings: []`.
- [ ] **Step 2: Run to verify they fail.** `cd frontend && npx vitest run src/lib/outline.test.ts src/lib/pdfOutline.test.ts < /dev/null`. Expected: FAIL.
- [ ] **Step 3: Implement**, and pass the outline in `exportPDF()`.
- [ ] **Step 4: Run** the full vitest suite and `npx svelte-check`. Expected: pass.
- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "pdf: send the headings, title and authors with the export"
```

### Task 6: Docs, roadmap, packaged check

**Files:**
- Modify: `CLAUDE.md` (the `print_darwin.go` paragraph: the finisher runs for every export and hands off to `pdfexport.go`), `README.md` if it lists what Export PDF writes, `../ROADMAP.md` (M1.0 row status)

- [ ] **Step 1:** Update CLAUDE.md and the README.
- [ ] **Step 2:** Product row: "built on branch `pdf-outline`, waiting on app checks"; run `../bin/check-roadmaps`. Expected: `ok`. Do not tick the editor item until merged.
- [ ] **Step 3:** `wails3 task package`; `strings "bin/Halmos Editor" | grep -c hermesPDFExportFinished` (≥ 1, or the exported function's name); `go version -m "bin/Halmos Editor" | grep pdfcpu`; `go run ./internal/tools/checknotices "bin/Halmos Editor" frontend/dist/acknowledgements.json` (pdfcpu and its modules listed).
- [ ] **Step 4:** Commit in each repository. Hand to the user for the spec's manual check.
