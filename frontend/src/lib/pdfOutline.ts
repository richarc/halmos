import type { PDFOutline } from '../../bindings/hermes'
import type { Frontmatter } from './frontmatter'
import type { OutlineEntry } from './outline'

/**
 * What Export PDF… adds to the PDF after rendering (Go: pdfoutline.go,
 * pdfexport.go): a bookmark per heading of the sidebar outline, with the
 * same text, plus the text to look for in the rendered pages; the Title and
 * Author properties from the frontmatter (author names only); and whether
 * the document renders a contents list, whose entries repeat the headings.
 */
export function pdfOutline(outline: OutlineEntry[], fm: Frontmatter): PDFOutline {
  return {
    headings: outline.map((e) => ({ level: e.level, text: e.text, match: e.match ?? e.text, gaps: e.gaps ?? [] })),
    title: fm.title ?? '',
    authors: (fm.authors ?? []).map((a) => a.name).filter((n) => n !== ''),
    contents: fm.toc === 'true',
  }
}
