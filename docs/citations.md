# Citing in Halmos

This guide covers citing in Halmos from start to finish: connecting a
bibliography, inserting citations, checking them before you submit, and
choosing a style. For the exact syntax rules, see
[Writing documents for Halmos](authoring.md#citations). For Zotero, see
[Setting up Zotero](zotero-setup.md).

---

## 1. Connect a bibliography

Halmos resolves citations against a BibTeX file (`.bib`). Name it in the
frontmatter at the top of the document:

```markdown
---
bibliography: refs.bib
---
```

The path is relative to the document, so `refs.bib` means the file beside it.
An absolute path also works. The document has to be saved before a relative
path can be found.

There are three ways to get a `.bib`:

- **File → New…** can create one beside the new document, or point the
  document at one you already have.
- **Zotero with Better BibTeX** can export your library and keep the file up
  to date as you edit references. This is the most reliable setup if you
  already use Zotero; [Setting up Zotero](zotero-setup.md) walks through it.
- **Write it by hand** or paste entries copied from a publisher's "Cite" or
  "Export citation" link.

Halmos watches the file. When it changes on disk, the preview, the
autocomplete list and the warnings update on their own.

---

## 2. Insert a citation

### Type `[@`

With a bibliography connected, type `[@` where the citation belongs. A list of
entries from the `.bib` opens, showing each key with its first author, year
and title. Keep typing to narrow it: you can type part of the key, an author's
name or a word from the title. Press Return to insert the key, then type `]`.

The list also opens after `; @` inside brackets (a second source in the same
citation), after `-@`, and after a bare `@` that starts a word. It shows up to
100 entries at a time. It does not open inside code, maths, the frontmatter,
an email address or a web address.

This needs nothing but the `.bib`. Zotero does not have to be running.

### Use the Zotero picker

Press ⌘⇧C, choose **Insert → Citation…**, or click **Cite** in the toolbar.
Zotero's own search window opens; pick one or more items and press Return. The
keys arrive at the cursor.

This needs Zotero and the Better BibTeX plugin. If the picker cannot open,
Halmos tells you whether Zotero is not running or Better BibTeX is not
installed, with a link to install it.

### Write it yourself

Citations are plain text, so you can always type them:

| You write | You get (APA) |
|---|---|
| `[@smith2020]` | (Smith, 2020) |
| `[@smith2020; @doe2021]` | (Smith, 2020; Doe, 2021) |
| `[see @smith2020, p. 33]` | (see Smith, 2020, p. 33) |
| `[-@smith2020]` | (2020) |
| `@smith2020 found that…` | Smith (2020) found that… |

- Separate several sources with `;`.
- Text before the `@`, such as `see` or `cf.`, becomes a prefix.
- `, p. 33`, `, pp. 33-35`, `, chapter 3` or `, sec. 2` after the key is a
  page or section locator.
- A `-` straight before the `@` leaves out the author's name, for when the
  sentence already names them.
- A bare `@key` without brackets names the author in your own sentence.

Halmos adds the References section at the end of the document. Do not write
one yourself, or there will be two.

---

## 3. Check your citations before you submit

### Hover over a key

Rest the pointer on a citation key in the editor. A tooltip shows the full
reference as it will appear in the References section, in the document's
style. It is a quick way to confirm `smith2020` is the paper you meant without
opening the `.bib`.

If the key is not in the `.bib`, the tooltip says `Not in refs.bib` (with your
file's name).

### Unknown citations

A key that is not in the `.bib` gets a red wavy underline in the editor, and
shows as a red `[@key?]` in the preview. The rest of the document still
renders.

The status bar at the bottom of the window counts them: "1 unknown citation",
"3 unknown citations". Click the count to see every unknown key with its line
number, and click an entry to jump to that line. When the count has gone, every
citation in the document resolves.

Common causes:

- **A typo in the key.** Fix it in the text, or use `[@` autocomplete so the
  key comes from the `.bib`.
- **The source was never added to the `.bib`.** Add it, in Zotero or by hand.
- **The `.bib` is not an export of the library you picked from.** The Zotero
  picker supplies keys from your Zotero library; Halmos checks them against
  the `.bib` the document names. See
  [Setting up Zotero](zotero-setup.md#the-one-thing-to-understand-first).

The count and the underlines only appear when the document names a
bibliography and Halmos has loaded it.

---

## 4. Choose a citation style

**Format → Citation Style** lists the five bundled styles: APA, Chicago
(author-date), Harvard, IEEE and Vancouver. The current one is ticked. Choosing
another writes the `csl:` line in the frontmatter for you, and the preview
reformats straight away. ⌘Z undoes it like any other edit.

### A journal's own style

Most journals publish a citation style in CSL format. The
[Zotero Style Repository](https://www.zotero.org/styles) has over ten thousand
of them, searchable by journal name.

1. Download the journal's `.csl` file. Saving it in the document's folder, or a
   folder inside it, keeps the document and its style together.
2. Choose **Format → Citation Style → Other Style File…** and pick the file.

Halmos writes the path into `csl:`, relative to the document when the file is
in its folder and absolute otherwise. Save a new document first: an unsaved
document has no folder to be relative to.

If a style file cannot be read or is not valid CSL, Halmos says so and uses APA
until it is fixed. Halmos does not watch the style file for changes; after
editing one, choose it again from the menu or reopen the document.

Two limits:

- Styles format in US English. A style written for another language still
  uses English terms such as "and" and "edited by".
- Styles that put citations in footnotes (such as Chicago notes and
  bibliography) are not supported. Use the author-date or numeric version of
  the style.

---

## 5. Citations in footnotes

Footnotes can hold citations, which is common for asides and for sources that
support a side point:

```markdown
The effect held in every run.[^1]

[^1]: Run 4 was discarded after a laser fault [@alqedra2026].
```

Or inline, with no separate definition:

```markdown
The effect held in every run.^[See @alqedra2026 for the full data.]
```

Citations in footnotes are formatted, checked and counted like any other.
Footnotes are listed after the References section.

---

## 6. Export

**File → Export PDF…** (⌘E) includes the formatted citations, the References
section and the footnotes. Check the unknown-citation count first: an unknown
key prints as a red `[@key?]`.

---

## Troubleshooting

**No autocomplete list, no hover, no underlines.** The document has no
`bibliography:` line, it has not been saved, or the `.bib` could not be found.
Halmos shows a message when the file is missing. If the preview shows `[@key]`
as plain text with no References section, the bibliography has not loaded.

**The list opens but my source is not in it.** It is not in the `.bib` the
document names. If you use Zotero, check that the export has **Keep updated**
ticked.

**The Zotero picker does not open.** Read the message Halmos shows: it says
whether Zotero is closed or Better BibTeX is missing. Typing `[@` works without
Zotero in the meantime. More in
[Setting up Zotero](zotero-setup.md#troubleshooting).

**The style did not change.** If you typed `csl:` by hand, check the spelling
against the five bundled names, or use the menu. A misspelled name falls back
to APA with a message.
