import { STYLE_IDS } from './citations'

/**
 * Seed text for a new document.
 *
 * The `bibliography` and `csl` keys are deliberately commented out. A live key
 * naming a file that does not exist would fire the "Bibliography not found"
 * toast on every new document. `parseFrontmatter` only matches lines starting
 * with a letter, so a `#` line is inert for free.
 *
 * The guidance is YAML comments *inside* the fences rather than HTML comments:
 * the renderer runs markdown-it with `html: false`, so `<!-- ... -->` would be
 * escaped and show up as literal text in the preview, whereas the frontmatter
 * block is stripped wholesale.
 *
 * It names all five bundled styles because they are otherwise documented only
 * in the README, and a user who does not know them cannot use `csl:` at all.
 *
 * The `toc:` line's guidance is a trailing YAML comment, not a parenthesis:
 * it has to be something `parseFrontmatter` drops, so that deleting the
 * line's leading `#` — the obvious way to switch the contents on — leaves a
 * value of exactly `true` (issue #8).
 */
export const NEW_DOCUMENT_TEMPLATE = `---
# To cite: name a .bib file below, then type [@ in
# your text. Styles (or Format → Citation Style):
# apa, chicago-author-date, ieee, vancouver, harvard.
# bibliography: references.bib
# csl: apa
# toc: true  # a [[toc]] paragraph positions the contents
---
`

/**
 * What a bibliography created by File → New… starts as. A comment rather than
 * nothing: an empty file is easy to mistake for a failed write, and `%` lines
 * are exactly what parseBib skips, so there is nothing for it to warn about.
 */
export const BIBLIOGRAPHY_SEED = `% Bibliography for the document beside this file.
% Export from Zotero (Better BibTeX keeps it in sync) or paste BibTeX entries here.
`

export type StarterId = 'blank' | 'article'

/**
 * What File → New… can start from. A list, so another shape (or a journal
 * profile later) is one more entry; `furnitureByDefault` is whether the New
 * dialog ticks "Page header and footer" when the starter is chosen.
 */
export interface Starter {
  id: StarterId
  label: string
  hint: string
  furnitureByDefault: boolean
}

export const STARTERS: readonly Starter[] = [
  {
    id: 'blank',
    label: 'Blank',
    hint: 'Frontmatter for the bibliography and nothing else.',
    furnitureByDefault: false,
  },
  {
    id: 'article',
    label: 'Research article',
    hint: 'Title, author, abstract, and Introduction, Methods, Results, Discussion, Conclusion.',
    furnitureByDefault: true,
  },
]

/** Export PDF's running header and footer; lib/pageFurniture.ts fills them. */
const PAGE_FURNITURE = `header: "{title}"
footer: "Page {page} of {pages}"
`

// The placeholder File → New… selects, so typing replaces it. Quoted in the
// frontmatter, so a title the author types with a colon stays valid YAML.
const TITLE_PLACEHOLDER = 'Title of the paper'

// No `date:` (usually the submission date, and the webview cannot format
// today's in the Mac's region) and no `#` heading: the title block is the
// document's title. Only the Introduction carries a prompt, as a model of
// tone; the reference list is added after the text, so it has no heading.
const ARTICLE_METADATA = `title: "${TITLE_PLACEHOLDER}"
author:
  - name: Your Name
    affiliation: Your institution
abstract: |
  One paragraph: the question, what was done, the main result, and why it
  matters.
`

const ARTICLE_BODY = `
## Introduction

What is known, what is not, and the question this paper answers.

## Methods

## Results

## Discussion

## Conclusion
`

/**
 * The text of a document created by File → New…, given the frontmatter value
 * naming its bibliography, or null for none. With a bibliography the keys are
 * *live* — the `.bib` either already exists or is created beside the document
 * by the same action, so there is no missing-file toast to avoid and no
 * reason to make the author uncomment anything. Without one, the ordinary
 * commented template is right: it explains how to add a bibliography later.
 *
 * The starter adds its own metadata above those keys and its body below the
 * frontmatter; `pageFurniture` adds the header and footer lines before the
 * closing fence. Blank without them is exactly the text it always was.
 */
export function newDocumentText(
  bibliography: string | null,
  csl: string,
  options: { starter?: StarterId; pageFurniture?: boolean } = {},
): string {
  const { starter = 'blank', pageFurniture = false } = options
  let keys: string
  if (bibliography === null) {
    // The commented guidance lines, without their fences.
    keys = NEW_DOCUMENT_TEMPLATE.slice('---\n'.length, -'---\n'.length)
  } else {
    if (!STYLE_IDS.includes(csl)) throw new Error(`unknown citation style: ${csl}`)
    keys = `bibliography: ${bibliography}\ncsl: ${csl}\n`
  }
  const metadata = starter === 'article' ? ARTICLE_METADATA : ''
  const furniture = pageFurniture ? PAGE_FURNITURE : ''
  const body = starter === 'article' ? ARTICLE_BODY : ''
  return `---\n${metadata}${keys}${furniture}---\n${body}`
}

/**
 * Where the title placeholder sits in a new document's text, so File → New…
 * can select it; null when the text has none (Blank).
 */
export function titleSelection(text: string): { from: number; to: number } | null {
  const line = `title: "${TITLE_PLACEHOLDER}"`
  const at = text.startsWith('---\n') ? text.indexOf(`\n${line}\n`) : -1
  if (at < 0) return null
  const from = at + '\ntitle: "'.length
  return { from, to: from + TITLE_PLACEHOLDER.length }
}

/**
 * How the frontmatter should name an existing bibliography: relative when
 * the file is in the document's folder or below, absolute otherwise. Both
 * forms resolve through Go's resolveAgainstDoc; the relative one survives
 * the folder being moved or shared, which is why it is preferred when it
 * can be. The directory check is against `dir + '/'`, so a sibling folder
 * whose name merely starts with the document's does not count as inside.
 */
export function bibliographyReference(bibPath: string, docPath: string): string {
  const dir = docPath.replace(/[^\/]*$/, '')
  return bibPath.startsWith(dir) ? bibPath.slice(dir.length) : bibPath
}

/** A typed bibliography name with `.bib` guaranteed; '' when nothing was typed. */
export function withBibExtension(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return ''
  return /\.bib$/i.test(trimmed) ? trimmed : `${trimmed}.bib`
}
