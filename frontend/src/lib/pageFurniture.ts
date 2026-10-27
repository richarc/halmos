import { hasTitleBlock, type Frontmatter } from './frontmatter'
import { plainTitle } from './renderer'

/**
 * What Export PDF draws in the top and bottom margins of every page, from the
 * frontmatter's `header` and `footer`. The templates go to Go as written:
 * pdfstamp_darwin.go fills `{title}`, `{date}`, `{page}` and `{pages}` in one
 * pass per page, so a heading that contains "{page}" is printed, not numbered.
 * The date is formatted there too, in the Mac's region format, which the
 * webview's own locale does not follow.
 *
 * The title is the frontmatter's `title`, else the document's first heading,
 * else its file name: the rule the HTML export uses for its <title>.
 *
 * A document with a title block already shows its title on page 1, so the
 * header is left off that page (`skipFirstPageHeader`); the footer is not.
 */
export interface PageFurniture {
  header: string
  footer: string
  title: string
  skipFirstPageHeader: boolean
}

export function pageFurniture(
  fm: Pick<Frontmatter, 'header' | 'footer' | 'title' | 'authors' | 'date' | 'abstract'>,
  firstHeading: string,
  filename: string | null | undefined,
): PageFurniture {
  const header = fm.header ?? ''
  const footer = fm.footer ?? ''
  if (!header && !footer) return { header: '', footer: '', title: '', skipFirstPageHeader: false }
  return {
    header,
    footer,
    title:
      (fm.title ? plainTitle(fm.title) : '') ||
      firstHeading || (filename ?? 'Untitled').replace(/\.[^.]+$/, ''),
    skipFirstPageHeader: hasTitleBlock(fm),
  }
}
