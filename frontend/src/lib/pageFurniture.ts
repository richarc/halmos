import type { Frontmatter } from './frontmatter'

/**
 * What Export PDF draws in the top and bottom margins of every page, from the
 * frontmatter's `header` and `footer`. The templates go to Go as written:
 * pdfstamp_darwin.go fills `{title}`, `{date}`, `{page}` and `{pages}` in one
 * pass per page, so a heading that contains "{page}" is printed, not numbered.
 * The date is formatted there too, in the Mac's region format, which the
 * webview's own locale does not follow.
 *
 * The title is the document's first heading, else its file name: the rule the
 * HTML export uses for its <title>.
 */
export interface PageFurniture {
  header: string
  footer: string
  title: string
}

export function pageFurniture(
  fm: Pick<Frontmatter, 'header' | 'footer'>,
  firstHeading: string,
  filename: string | null | undefined,
): PageFurniture {
  const header = fm.header ?? ''
  const footer = fm.footer ?? ''
  if (!header && !footer) return { header: '', footer: '', title: '' }
  return {
    header,
    footer,
    title: firstHeading || (filename ?? 'Untitled').replace(/\.[^.]+$/, ''),
  }
}
