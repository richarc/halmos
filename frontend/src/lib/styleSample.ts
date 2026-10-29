import type { CSLEntry } from './bibliography'
import { createCitationFormatter } from './citations'

// The article the Find a Style window formats to show what a style looks
// like: two authors, a journal, volume, issue, pages and a DOI, which is
// enough for most styles to show their punctuation.
const SAMPLE: CSLEntry = {
  id: 'sample',
  type: 'article-journal',
  title: 'Light trapping in thin silicon solar cells',
  author: [
    { family: 'Okafor', given: 'Ada' },
    { family: 'Lindqvist', given: 'Erik' },
  ],
  issued: { 'date-parts': [[2024]] },
  'container-title': 'Journal of Applied Physics',
  volume: '135',
  issue: '4',
  page: '045101',
  DOI: '10.1063/5.0000000',
}

/**
 * The sample article cited once and listed, in the style `xml`, as
 * citeproc's HTML (which escapes any text the style supplies). Throws when
 * the style formats no reference, so the window can say so.
 */
export async function formatSample(xml: string): Promise<{ citation: string; reference: string }> {
  const f = await createCitationFormatter([SAMPLE], 'sample', xml)
  const { texts, bibliographyHtml } = f.format([{ items: [{ key: 'sample' }] }])
  const reference = f.reference('sample')
  if (!reference && !bibliographyHtml) throw new Error('the style formats no reference')
  return { citation: texts[0], reference: reference ?? bibliographyHtml }
}
