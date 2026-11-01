import { describe, it, expect } from 'vitest'
import { renderDocument } from './renderer'

describe('outline', () => {
  it('lists headings with level, text and line, in document order', () => {
    const { outline } = renderDocument('# Title\n\ntext\n\n## Method\n\n### Detail\n\n## Results\n')
    expect(outline).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Method', line: 5 },
      { level: 3, text: 'Detail', line: 7 },
      { level: 2, text: 'Results', line: 9 },
    ])
  })

  it('counts lines from the top of the file, frontmatter included', () => {
    const { outline } = renderDocument('---\ncsl: apa\n---\n\n# After frontmatter\n')
    expect(outline).toEqual([{ level: 1, text: 'After frontmatter', line: 5 }])
  })

  it('flattens emphasis, code, links and maths to their words', () => {
    const { outline } = renderDocument('## The **bold** `code` [link](https://x) and $E=mc^2$\n')
    expect(outline[0].text).toBe('The bold code link and E=mc^2')
  })

  it('gives a heading with maths a match text without it, for finding it in a PDF', () => {
    const { outline } = renderDocument('## Results for $x^2$ and `code`\n\n## $E=mc^2$\n\n## Plain\n')
    expect(outline[0]).toMatchObject({ text: 'Results for x^2 and code', match: 'Results for \u0000 and code', gaps: [3] })
    expect(outline[1]).toMatchObject({ text: 'E=mc^2', match: '\u0000', gaps: [6] })
    expect(outline[2]).not.toHaveProperty('match')
  })

  it('ignores headings inside fences and blockquotes', () => {
    const { outline } = renderDocument('# Real\n\n```text\n# Not a heading\n```\n\n> # Quoted\n')
    expect(outline).toEqual([{ level: 1, text: 'Real', line: 1 }])
  })

  it('includes setext headings', () => {
    const { outline } = renderDocument('Title\n=====\n\nSub\n---\n')
    expect(outline).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Sub', line: 4 },
    ])
  })

  it('is empty for a document with no headings', () => {
    expect(renderDocument('just prose\n').outline).toEqual([])
    expect(renderDocument('').outline).toEqual([])
  })
})
