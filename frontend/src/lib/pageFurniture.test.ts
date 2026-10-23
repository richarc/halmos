import { describe, expect, it } from 'vitest'
import { pageFurniture } from './pageFurniture'

describe('pageFurniture', () => {
  it('is empty when the frontmatter asks for neither', () => {
    expect(pageFurniture({}, 'First heading', 'paper.md')).toEqual({ header: '', footer: '', title: '' })
  })

  // The export fills the placeholders in, page by page, in one pass.
  it('sends the templates as written, with the title', () => {
    const got = pageFurniture(
      { header: '{title} — {date}', footer: 'Page {page} of {pages}' },
      'On Mirrors',
      'paper.md',
    )
    expect(got).toEqual({
      header: '{title} — {date}',
      footer: 'Page {page} of {pages}',
      title: 'On Mirrors',
    })
  })

  // The same rule the HTML export uses for <title>.
  it('takes the title from the file name when the document has no heading', () => {
    expect(pageFurniture({ header: '{title}' }, '', 'notes.draft.md').title).toBe('notes.draft')
    expect(pageFurniture({ header: '{title}' }, '', null).title).toBe('Untitled')
  })
})
