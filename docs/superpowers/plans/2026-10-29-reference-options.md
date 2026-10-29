# Reference Formatting Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frontmatter keys (`citation-et-al-min`, …) override the citation style's author-list options in the preview, the hover and every export.

**Architecture:** A pure `applyStyleOptions(xml, options)` in `lib/styleOptions.ts` rewrites a copy of the style's XML with the DOM parser. `App.svelte` applies it to the style's XML before building the formatter and before sending CSL to the portal.

**Tech Stack:** TypeScript, DOMParser/XMLSerializer, citeproc-js, Svelte 5, vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-29-reference-options-design.md`

## Global Constraints

- Keys and attributes: `citation-et-al-min`→`et-al-min`, `citation-et-al-use-first`→`et-al-use-first`, `citation-et-al-subsequent-min`→`et-al-subsequent-min`, `citation-et-al-subsequent-use-first`→`et-al-subsequent-use-first`, `citation-et-al-use-last`→`et-al-use-last` (on `<citation>`); `bibliography-et-al-min`, `bibliography-et-al-use-first`, `bibliography-et-al-use-last` (on `<bibliography>`).
- Numbers: whole numbers 1–100. `use-last`: `true` or `false`.
- Toast texts: `<key> must be a whole number from 1 to 100 — ignored`; `<key> must be true or false — ignored`. Several invalid keys: one toast per key set change, joined with `; `.
- The `.csl` file on disk is never written. No new dependency.
- Tests: `cd frontend && npx vitest run < /dev/null`, `npx svelte-check`; `go test ./.` unchanged.

## Review Focus

- A style whose `<citation>` already sets the attribute: the user's value replaces it (Task 1 test "replaces an existing value").
- A key typed partway (`citation-et-al-min: 1` on the way to `10`): valid at each step, no toast; an empty value is not set (Task 1 test "ignores a key with no value").
- Options with a non-bundled style (Find a Style… or a file): applied to the resolved XML (Task 2 test "applies to a resolved style").
- Changing only an option rebuilds the formatter; changing nothing keeps it (Task 2 test "keeps the formatter when nothing changed").
- A style that is not valid XML: unchanged, no exception (Task 1 test "returns a style that does not parse unchanged").

---

### Task 1: applyStyleOptions

**Files:**
- Create: `frontend/src/lib/styleOptions.ts`, `frontend/src/lib/styleOptions.test.ts`
- Modify: `frontend/src/lib/frontmatter.ts` (`KNOWN_KEYS` and `Frontmatter` gain the eight keys, raw strings), `frontend/src/lib/frontmatter.test.ts`

**Interfaces:**
- Produces:
  - `export const STYLE_OPTION_KEYS: readonly StyleOptionKey[]` (the eight keys, in the table's order).
  - `export interface StyleOptions { citation: Partial<Record<CslAttr, string>>; bibliography: Partial<Record<CslAttr, string>> }`
  - `export function readStyleOptions(fm: Partial<Record<StyleOptionKey, string>>): { options: StyleOptions; invalid: string[] }` — `invalid` holds the toast text per bad key.
  - `export function hasStyleOptions(o: StyleOptions): boolean`
  - `export function applyStyleOptions(xml: string, o: StyleOptions): string` — returns `xml` itself when `o` is empty or the XML does not parse.

- [ ] **Step 1: Failing tests** (`styleOptions.test.ts`, jsdom):
  - "reads valid keys": `{'citation-et-al-min': '3', 'bibliography-et-al-use-last': 'true'}` → options set, `invalid` empty.
  - "reports invalid values": `'0'`, `'101'`, `'2.5'`, `'three'` for a `-min` key and `'yes'` for `-use-last` → ignored, each with its toast text.
  - "ignores a key with no value": `''` → not set, not invalid.
  - "sets the attribute on citation and bibliography" and "replaces an existing value" (a minimal style with `<citation et-al-min="3">`).
  - "use-first becomes 1 when only min is set and the style's is not smaller" (bibliography `et-al-use-first="19"`, set min 4 → use-first `1`); "keeps the style's use-first when it is smaller".
  - "updates IEEE's author name, not its director name" (bundled `loadStyleXml('ieee')`, `bibliography-et-al-min: 2` → the `<name>` under `<names variable="author">` in macro `author` has `et-al-min="2"`; the director one keeps `7`).
  - "leaves APA's treaty name alone" (`loadStyleXml('apa')`, `bibliography-et-al-min: 2` → the `<name et-al-min="100">` is unchanged).
  - "follows macros to pick the value": a minimal style where macro `a` (author `<name et-al-min="9">`) is used only from `<citation>`, macro `b` only from `<bibliography>` via another macro, macro `c` from both; set citation 2, bibliography 5 → `a`=2, `b`=5, `c`=5; with only citation 2 set → `c`=2.
  - "returns a style that does not parse unchanged" (`'<style'`) and "returns the same text with no options".
  - Formatting with citeproc (`createCitationFormatter(entries, id, applyStyleOptions(xml, o))`): APA `citation-et-al-min: 2` → two-author cite `(Doe et al., 2020)`; IEEE `bibliography-et-al-min: 2`, `-use-first: 1` → reference contains `J. Doe et al.`; Vancouver `bibliography-et-al-min: 3` → three-author reference contains `Doe J, et al.`.
  - `frontmatter.test.ts`: the eight keys are read as raw strings.
- [ ] **Step 2: Run** `npx vitest run src/lib/styleOptions.test.ts src/lib/frontmatter.test.ts < /dev/null` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** `XMLSerializer` writes the result. Reachability: map macro name → element; from each layout context (`citation`, `bibliography`) walk descendants collecting `text[macro]`, recursing into macros once each. A `<name>` qualifies when its parent `<names>` has `author` in `variable` (space-separated) and it has no `<choose>` ancestor; its contexts are those whose walk reaches it (a `<name>` directly in a layout belongs to that context).
- [ ] **Step 4: Run** the full vitest suite and svelte-check — Expected: PASS.
- [ ] **Step 5: Commit** `citations: apply author-list options to a style`.

### Task 2: Wiring into the preview and export

**Files:**
- Modify: `frontend/src/App.svelte` (`reloadBibliography`, `buildConvertBody`, a derived key for the options), `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: Task 1's `readStyleOptions`, `applyStyleOptions`, `hasStyleOptions`, `STYLE_OPTION_KEYS`.
- A `$derived` string `fmStyleOptions` (JSON of the eight raw values) gates the reload effect, like `fmCsl`.
- In `reloadBibliography`: with options set, a bundled style's XML is loaded with `loadStyleXml(csl)` (APA's for an unknown id) so it can be changed; the formatter is built with `applyStyleOptions(xml, options)`. Without options, today's path is unchanged. `loadedBib.xml` holds the final XML.
- Invalid keys toast once per change of the invalid set (`warnedOptions`, like `warnedShadowed`).
- `buildConvertBody`: `csl = applyStyleOptions(csl, options)` when options are set.

- [ ] **Step 1: Failing tests** (`describe('reference formatting options')`): "the preview follows citation-et-al-min" (APA, two-author entry: `(Doe & Roe, 2020)` without, `(Doe et al., 2020)` with); "applies to a resolved style" (ResolveStyle returns IEEE's XML, `bibliography-et-al-min: 2` + `-use-first: 1` → preview reference contains `et al.`); "keeps the formatter when nothing changed" (typing in the body does not build a new formatter: `citationsSpy.created` unchanged); "shows the invalid-value toast once"; "Word export sends the changed CSL" (`req.csl` contains `et-al-min="2"` on `<citation`).
- [ ] **Step 2: Run** `npx vitest run src/App.test.ts -t "reference formatting options" < /dev/null` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full vitest, svelte-check, `go test ./.` — Expected: PASS.
- [ ] **Step 5: Commit** `citations: author-list options in the preview and export`.

### Task 3: Docs and roadmap

**Files:** `docs/authoring.md` (after "Choosing a style": a "Listing authors" subsection with the table of keys and two examples), `CHANGELOG.md` (Unreleased → Added), `ROADMAP.md` (tick the item with a done note; add a Backlog item "More reference formatting options" listing the spec's "Worth exposing later"; guarded edits, compare `grep -c '^- \['` (+1 for the new item) and `grep '^## '`), `CLAUDE.md` (one sentence in the citations paragraph on `lib/styleOptions.ts`).

- [ ] **Step 1:** Edit the files.
- [ ] **Step 2:** Verify roadmap counts. Expected: one more `- [` line (the Backlog item), headings unchanged.
- [ ] **Step 3:** Commit `citations: docs, changelog and roadmap for reference options`. The product row is updated after merge.
