import type { Author } from './frontmatter'

/**
 * The title block the preview opens with: title, authors, affiliations, date
 * and abstract, in that order, each only when set. `inline` renders the
 * title's markdown; `escape` is for the plain-text fields. The abstract
 * arrives already rendered, since only the renderer can resolve its
 * citations and cross-references against the body.
 *
 * Affiliations are numbered by first appearance, and the numbers are shown
 * only when they tell the reader something: two or more distinct
 * affiliations, or some authors with one and some without. One shared
 * affiliation is a single unnumbered line.
 */
export function titleBlockHtml(
  parts: { title?: string; authors?: Author[]; date?: string; abstractHtml?: string },
  inline: (s: string) => string,
  escape: (s: string) => string,
): string {
  const { title, authors = [], date, abstractHtml } = parts
  let out = ''
  if (title !== undefined) out += `<h1 class="title-block-title">${inline(title)}</h1>\n`

  const affiliations: string[] = []
  for (const a of authors) {
    if (a.affiliation !== undefined && !affiliations.includes(a.affiliation)) affiliations.push(a.affiliation)
  }
  const numbered =
    affiliations.length > 1 || (affiliations.length > 0 && authors.some((a) => a.affiliation === undefined))
  if (authors.length) {
    const names = authors.map((a) => {
      const sup = numbered && a.affiliation !== undefined ? `<sup>${affiliations.indexOf(a.affiliation) + 1}</sup>` : ''
      return `<span class="title-block-author">${escape(a.name)}${sup}</span>`
    })
    out += `<p class="title-block-authors">${names.join(', ')}</p>\n`
  }
  affiliations.forEach((aff, i) => {
    const sup = numbered ? `<sup>${i + 1}</sup> ` : ''
    out += `<p class="title-block-affiliation">${sup}${escape(aff)}</p>\n`
  })

  if (date !== undefined) out += `<p class="title-block-date">${escape(date)}</p>\n`
  if (abstractHtml !== undefined) {
    out +=
      '<section class="title-block-abstract">\n' +
      '<h2 class="title-block-abstract-heading">Abstract</h2>\n' +
      `${abstractHtml}</section>\n`
  }
  return out ? `<header class="title-block">\n${out}</header>\n` : ''
}
