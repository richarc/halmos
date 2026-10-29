# Control how references are formatted — design

Written from the v0.16.0 roadmap item "Control how references are
formatted, beyond the chosen style"; the author asked for no questions, so
every decision the roadmap does not state is marked *My call*.

## Why

A citation style fixes how many authors are listed before "et al." APA
lists one author then "et al." from three in a citation, and up to twenty
in the reference list; Vancouver lists six then "et al." from seven. A
journal, a supervisor or a department often asks for something else.
LaTeX users set this with biblatex's `maxcitenames`/`maxbibnames` without
touching the style. In Halmos today the only way is to copy the `.csl`
file and edit its XML.

## Goals

- Frontmatter keys that set the author-list options of the document's
  citation style, for citations and for the reference list separately.
- One change covers every output: the preview, the citation hover, Export
  PDF and HTML (both drawn from the preview), and Word and LaTeX (the
  editor sends the CSL it formats with).
- Works with every style: bundled, installed from Find a Style…, or a
  `.csl` file.
- A list of further options worth exposing later, recorded in the roadmap.

## Non-goals

- Name formatting (initials, "and" versus "&", name order) and other
  options. They are listed below for a later item.
- A dialog or menu for these settings. *My call:* frontmatter only, as the
  roadmap says; the keys are rare and per document.
- Changing the style file on disk. The options are applied to a copy in
  memory each time the style is loaded.

## Anti-goals

- A key that silently does nothing. Where a style overrides the setting
  on an author's name, the override is replaced too (see "Applying
  them").
- Changing anything else about a style: special cases a style sets on
  purpose (APA's treaty parties, listed in full) stay as they are.
- A typo that breaks citations: an invalid value is ignored, with a
  message, and the rest of the document formats as before.

## The keys

*My call:* CSL's own attribute names, prefixed with where they apply, so
they can be looked up in the CSL specification and match what LaTeX
users know as separate citation and bibliography settings.

| Key | CSL attribute | On |
|---|---|---|
| `citation-et-al-min` | `et-al-min` | `<citation>` |
| `citation-et-al-use-first` | `et-al-use-first` | `<citation>` |
| `citation-et-al-subsequent-min` | `et-al-subsequent-min` | `<citation>` |
| `citation-et-al-subsequent-use-first` | `et-al-subsequent-use-first` | `<citation>` |
| `citation-et-al-use-last` | `et-al-use-last` | `<citation>` |
| `bibliography-et-al-min` | `et-al-min` | `<bibliography>` |
| `bibliography-et-al-use-first` | `et-al-use-first` | `<bibliography>` |
| `bibliography-et-al-use-last` | `et-al-use-last` | `<bibliography>` |

- `…-min` and `…-use-first`: a whole number from 1 to 100. With
  `citation-et-al-min: 3` and `citation-et-al-use-first: 1`, a work with
  three or more authors is cited as "Smith et al.".
- `…-use-last`: `true` or `false`; with `true` the list ends "…, last
  author" after the ellipsis, as APA's reference list does.
- *My call:* when only `…-min` is set and the style's own `…-use-first`
  for that place is not smaller than it, `…-use-first` becomes 1, so
  "et al. from 3 authors" works with one key. (APA's reference list says
  use-first 19; `bibliography-et-al-min: 4` alone would otherwise list
  all of them.)
- Keys are read by `lib/frontmatter.ts`'s line parser like `toc-depth`,
  as raw text, and interpreted by the new module.
- The keys stay in the document sent to Pandoc; Pandoc ignores metadata
  it has no use for.

## Applying them

A new pure function, `applyStyleOptions(xml, options) → xml`, in
`lib/styleOptions.ts`, using the DOM parser (the webview's, and jsdom's in
tests):

1. Each option is set on the `<citation>` or `<bibliography>` element.
2. CSL lets a `<name>` element override what it inherits, and some styles
   set the author list there (IEEE: `<name et-al-min="7" …>` in its
   `author` macro). *My call:* a `<name>` that sets the attribute is
   updated when it belongs to a `<names>` whose `variable` includes
   `author` and it is not inside a `<choose>`. One inside a `<choose>` is a
   special case the style chose (APA and Chicago list treaty parties in
   full that way) and is left alone.
3. Such a `<name>` may sit in a macro used by citations, by the reference
   list, or both. *My call:* the macros reachable from each layout are
   followed (`<text macro="…">`, macros calling macros, and `<names>`
   substitutes); a `<name>` reached only from `<citation>` takes the
   citation value, only from `<bibliography>` the bibliography value, and
   from both, the bibliography value when one is set, else the citation
   value. A style's numbered citations show no names, so in practice the
   shared case is the reference list's.
4. A style that does not parse, or has no `<citation>`, is returned
   unchanged; the formatter then fails or falls back as today.

The result replaces the style everywhere Halmos uses it:

- **Preview and hover** (`App.svelte`'s `reloadBibliography`): the style's
  XML (bundled styles loaded with `loadStyleXml`, others from
  `StyleService.ResolveStyle`) has the options applied before
  `createCitationFormatter`. The formatter is rebuilt when the options
  change, and kept when they do not (`loadedBib` compares the final XML).
- **Word and LaTeX** (`buildConvertBody`): the `csl` sent is the same
  result.

## Messages

- *My call:* an invalid value (not a whole number from 1 to 100, or not
  `true`/`false`) is ignored, and a toast says so once:
  `citation-et-al-min must be a whole number from 1 to 100 — ignored`, or
  `bibliography-et-al-use-last must be true or false — ignored`. The toast
  repeats only when the set of invalid keys changes, as the shadowed-keys
  warning does.

## Worth exposing later

For the roadmap, from the CSL specification's inheritable name options and
style options:

- `and` (`text` or `symbol`: "and" versus "&").
- `initialize-with` and `initialize` (initials and their punctuation).
- `name-as-sort-order` (`first` or `all`: "Smith, J." order).
- `delimiter-precedes-last` (the serial comma before "and").
- `page-range-format` (`expanded`, `minimal`, `chicago`).
- `disambiguate-add-givenname` and friends (how two "Smith 2020" cites are
  told apart).

## Constraints

- No new dependency.
- The frontmatter stays the document's only record; the `.csl` file is
  never written.
- Colours: none; there is no new UI.

## Done when

- `lib/styleOptions.test.ts`: each key on `<citation>`/`<bibliography>`;
  the use-first adjustment; IEEE's author `<name>` updated, its director
  `<name>` not; APA's treaty `<name>` untouched; the macro reachability
  rule (citation-only, bibliography-only, shared); invalid values
  reported and ignored; a style that does not parse returned unchanged.
- Formatting checks with real styles: APA with `citation-et-al-min: 2`
  cites a two-author work as "(Doe et al., 2020)"; IEEE with
  `bibliography-et-al-min: 2` and `bibliography-et-al-use-first: 1` lists
  "J. Doe et al."; Vancouver with `bibliography-et-al-min: 3` lists three
  authors as "Doe J, et al.".
- `App.test.ts`: the preview changes when a key is set; Word export sends
  the changed CSL; the invalid-value toast.
- Checked by eye in the app.
- Docs: `docs/authoring.md` (the citation section) describes the keys.
  `CHANGELOG.md` Unreleased → Added. `ROADMAP.md` item ticked, with the
  "worth exposing later" list added as a Backlog item; its product row
  updated after merge; `../bin/check-roadmaps`.

## Left to the builder

- The module's internal shape and the reachability walk's code.
- The exact sample authors in tests.
