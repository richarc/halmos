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

export type StarterId = 'blank' | 'article' | 'assignment' | 'lab-report' | 'essay' | 'proposal' | 'thesis'

/**
 * What File → New… can start from. A list, so another shape (or a journal
 * profile later) is one more entry; `furnitureByDefault` is whether the New
 * dialog ticks "Page header and footer" when the starter is chosen.
 *
 * A starter's text is its own: `titlePlaceholder` becomes the quoted
 * `title:` line File → New… selects, `metadata` the frontmatter lines after
 * it, `header` replaces the plain `{title}` header when the box is ticked,
 * and `body` follows the closing fence. Blank has none of them.
 */
export interface Starter {
  id: StarterId
  label: string
  hint: string
  furnitureByDefault: boolean
  titlePlaceholder?: string
  metadata?: string
  header?: string
  body?: string
}

// No `date:` in any starter whose date would be today's (usually the
// submission date, and the webview cannot format today's in the Mac's
// region) and no `#` heading: the title block is the document's title.
// Prompts are few, as a model of tone; the reference list is added after
// the text, so no starter has a References heading. Chart data is inline,
// since a chart fetches nothing.
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
    titlePlaceholder: 'Title of the paper',
    metadata: `author:
  - name: Your Name
    affiliation: Your institution
abstract: |
  One paragraph: the question, what was done, the main result, and why it
  matters.
`,
    body: `
## Introduction

What is known, what is not, and the question this paper answers.

## Methods

## Results

## Discussion

## Conclusion
`,
  },
  {
    id: 'assignment',
    label: 'Assignment',
    hint: 'Name, course and due date; numbered questions with parts; a worked equation.',
    furnitureByDefault: true,
    titlePlaceholder: 'Assignment title',
    // The name is in the header as well as the title block, so every
    // printed page says whose it is; the header has no {author} to fill.
    metadata: `author:
  - name: Your Name
    affiliation: Student ID · Course code
date: "Due date"
`,
    header: 'Your Name · {title}',
    body: `
## Question 1

**(a)** Show the working, then the result. The kinetic energy of a mass $m$
moving at speed $v$ is

$$
E_k = \\tfrac{1}{2} m v^2
$$ {#eq:kinetic}

so @eq:kinetic gives $E_k = 4\\,\\text{J}$ for $m = 2\\,\\text{kg}$ and
$v = 2\\,\\text{m/s}$.

**(b)**

## Question 2
`,
  },
  {
    id: 'lab-report',
    label: 'Lab report',
    hint: 'Aim, method, results with a table and a chart, discussion.',
    furnitureByDefault: true,
    titlePlaceholder: 'Title of the experiment',
    metadata: `author:
  - name: Your Name
    affiliation: Your institution
`,
    body: `
## Aim

What the experiment set out to measure or test.

## Background

## Materials and method

## Results

@tbl:readings lists the readings, and @fig:readings plots them.

| Time (s) | Temperature (°C) |
|---------:|-----------------:|
|        0 |             20.0 |
|       60 |             31.5 |
|      120 |             41.2 |
|      180 |             49.0 |
|      240 |             55.3 |

: Temperature against time {#tbl:readings}

\`\`\`vega-lite {#fig:readings}
{
  "title": "Temperature against time",
  "data": {
    "values": [
      {"time": 0, "temperature": 20.0},
      {"time": 60, "temperature": 31.5},
      {"time": 120, "temperature": 41.2},
      {"time": 180, "temperature": 49.0},
      {"time": 240, "temperature": 55.3}
    ]
  },
  "mark": {"type": "line", "point": true},
  "encoding": {
    "x": {"field": "time", "type": "quantitative", "title": "Time (s)"},
    "y": {"field": "temperature", "type": "quantitative", "title": "Temperature (°C)"}
  }
}
\`\`\`

## Discussion

## Conclusion
`,
  },
  {
    id: 'essay',
    label: 'Essay',
    hint: 'Title, name and course; introduction, body, conclusion.',
    furnitureByDefault: true,
    titlePlaceholder: 'Title of the essay',
    metadata: `author:
  - name: Your Name
    affiliation: Course code
`,
    body: `
## Introduction

The question, why it matters, and the argument this essay makes.

## First argument

## Second argument

## Conclusion
`,
  },
  {
    id: 'proposal',
    label: 'Research proposal',
    hint: 'Background, aims, methods, timeline and expected outcomes.',
    furnitureByDefault: true,
    titlePlaceholder: 'Title of the proposal',
    metadata: `author:
  - name: Your Name
    affiliation: Your institution
abstract: |
  One paragraph: the problem, what will be done, and what it will show.
`,
    body: `
## Background

## Aims

The questions this research will answer.

## Methods

## Timeline

| Phase                      | Months |
|----------------------------|-------:|
| Literature review          |    1–3 |
| Data collection            |   4–9 |
| Analysis and writing up    |  10–12 |

: Timeline {#tbl:timeline}

## Expected outcomes
`,
  },
  {
    id: 'thesis',
    label: 'Thesis or dissertation',
    hint: 'Title page, abstract, contents, chapters and appendices.',
    furnitureByDefault: true,
    titlePlaceholder: 'Title of the thesis',
    // The degree and supervisor are body text: the title block has no
    // fields for them. [[toc]] puts the contents after that paragraph.
    metadata: `author:
  - name: Your Name
    affiliation: Department, Institution
abstract: |
  One paragraph: the question, the approach, the main findings, and what
  they contribute.
toc: true
`,
    body: `
A thesis submitted for the degree of Doctor of Philosophy, Month Year.
Supervisor: Name of supervisor.

[[toc]]

## Acknowledgements

## Introduction

## Literature review

## Methodology

## Results

## Discussion

## Conclusion

## Appendix A: Supplementary material
`,
  },
]

/** Export PDF's running footer; lib/pageFurniture.ts fills it. */
const PAGE_FOOTER = `footer: "Page {page} of {pages}"\n`

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
  const entry = STARTERS.find((s) => s.id === starter)
  if (!entry) throw new Error(`unknown starter: ${starter}`)
  // A starter that sets `toc:` itself drops the guidance's commented one:
  // uncommented beside the live key it would be a duplicate, which makes
  // the frontmatter invalid and loses the title block.
  if (/^toc:/m.test(entry.metadata ?? '')) keys = keys.replace(/^# toc:.*\n/m, '')
  // Quoted, so a title the author types with a colon stays valid YAML.
  const title = entry.titlePlaceholder ? `title: "${entry.titlePlaceholder}"\n` : ''
  const furniture = pageFurniture ? `header: "${entry.header ?? '{title}'}"\n${PAGE_FOOTER}` : ''
  return `---\n${title}${entry.metadata ?? ''}${keys}${furniture}---\n${entry.body ?? ''}`
}

/**
 * Where the title placeholder sits in a new document's text, so File → New…
 * can select it; null when the text has none (Blank).
 */
export function titleSelection(text: string): { from: number; to: number } | null {
  if (!text.startsWith('---\n')) return null
  for (const { titlePlaceholder } of STARTERS) {
    if (!titlePlaceholder) continue
    const at = text.indexOf(`\ntitle: "${titlePlaceholder}"\n`)
    if (at < 0) continue
    const from = at + '\ntitle: "'.length
    return { from, to: from + titlePlaceholder.length }
  }
  return null
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
