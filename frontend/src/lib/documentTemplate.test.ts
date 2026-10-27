import { describe, it, expect } from 'vitest'
import {
  NEW_DOCUMENT_TEMPLATE,
  BIBLIOGRAPHY_SEED,
  newDocumentText,
  bibliographyReference,
  withBibExtension,
  STARTERS,
  titleSelection,
} from './documentTemplate'
import { parseFrontmatter } from './frontmatter'
import { STYLE_IDS } from './citations'
import { render, renderDocument } from './renderer'

describe('NEW_DOCUMENT_TEMPLATE', () => {
  // The whole point of commenting the keys out: a live `bibliography:` naming
  // a file that does not exist would toast "Bibliography not found" on every
  // new document.
  it('leaves the bibliography and csl keys inert', () => {
    const fm = parseFrontmatter(NEW_DOCUMENT_TEMPLATE)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.csl).toBeUndefined()
  })

  it('renders to nothing, because the frontmatter is stripped', () => {
    expect(render(NEW_DOCUMENT_TEMPLATE).trim()).toBe('')
  })

  it('names every bundled citation style', () => {
    for (const id of STYLE_IDS) {
      expect(NEW_DOCUMENT_TEMPLATE).toContain(id)
    }
  })

  // Issue #8: the toc line's guidance used to follow the value on the same
  // line, so uncommenting it gave `toc: true  (a [[toc]] ...)` and no ToC.
  it('turns the contents on when only its leading # is removed', () => {
    const live = NEW_DOCUMENT_TEMPLATE.replace(/^# (toc: true.*)$/m, '$1')
    expect(live).not.toBe(NEW_DOCUMENT_TEMPLATE)
    expect(parseFrontmatter(live).toc).toBe('true')
    expect(render(live + '# Heading\n')).toContain('<nav class="toc"')
  })

  it('ends with a newline, so the cursor lands below the closing fence', () => {
    expect(NEW_DOCUMENT_TEMPLATE.endsWith('---\n')).toBe(true)
  })

  it('stays short enough to delete in one motion', () => {
    expect(NEW_DOCUMENT_TEMPLATE.trimEnd().split('\n').length).toBeLessThanOrEqual(8)
  })
})

describe('newDocumentText', () => {
  it('writes live bibliography and csl keys from the given reference', () => {
    const text = newDocumentText('paper.bib', 'ieee')
    const fm = parseFrontmatter(text)
    expect(fm.bibliography).toBe('paper.bib')
    expect(fm.csl).toBe('ieee')
    expect(text.endsWith('---\n')).toBe(true)
    expect(render(text).trim()).toBe('')
  })

  it('writes an absolute reference as given', () => {
    const fm = parseFrontmatter(newDocumentText('/Users/a/Library/refs.bib', 'apa'))
    expect(fm.bibliography).toBe('/Users/a/Library/refs.bib')
  })

  it('falls back to the commented template when there is no bibliography', () => {
    expect(newDocumentText(null, 'ieee')).toBe(NEW_DOCUMENT_TEMPLATE)
  })

  it('refuses a style it does not bundle', () => {
    expect(() => newDocumentText('paper.bib', 'mla')).toThrow()
  })
})

describe('bibliographyReference', () => {
  it('is the bare name for a file in the document folder', () => {
    expect(bibliographyReference('/Users/a/paper/refs.bib', '/Users/a/paper/paper.md')).toBe('refs.bib')
  })

  it('is a relative path for a file below the document folder', () => {
    expect(bibliographyReference('/Users/a/paper/lib/refs.bib', '/Users/a/paper/paper.md')).toBe(
      'lib/refs.bib',
    )
  })

  it('is absolute for a file anywhere else', () => {
    expect(bibliographyReference('/Users/a/Library/refs.bib', '/Users/a/paper/paper.md')).toBe(
      '/Users/a/Library/refs.bib',
    )
  })

  it('does not treat a sibling folder with the same prefix as inside', () => {
    expect(bibliographyReference('/Users/a/paper2/refs.bib', '/Users/a/paper/paper.md')).toBe(
      '/Users/a/paper2/refs.bib',
    )
  })
})

describe('withBibExtension', () => {
  it('appends .bib when missing and trims', () => {
    expect(withBibExtension('  references ')).toBe('references.bib')
  })

  it('leaves an existing .bib alone, case-insensitively', () => {
    expect(withBibExtension('refs.bib')).toBe('refs.bib')
    expect(withBibExtension('refs.BIB')).toBe('refs.BIB')
  })

  it('is empty for an empty name', () => {
    expect(withBibExtension('   ')).toBe('')
  })
})

describe('BIBLIOGRAPHY_SEED', () => {
  it('is a comment only, so parseBib has nothing to warn about', () => {
    for (const line of BIBLIOGRAPHY_SEED.trimEnd().split('\n')) {
      expect(line.startsWith('%')).toBe(true)
    }
    expect(BIBLIOGRAPHY_SEED.endsWith('\n')).toBe(true)
  })
})

describe('starters', () => {
  const article = (bib: string | null, pageFurniture = false) =>
    newDocumentText(bib, 'apa', { starter: 'article', pageFurniture })

  it('lists Blank and Research article, in that order', () => {
    expect(STARTERS.map((s) => s.id)).toEqual(['blank', 'article'])
  })

  it('keeps Blank without a header and footer exactly as before', () => {
    expect(newDocumentText(null, 'apa', { starter: 'blank', pageFurniture: false })).toBe(NEW_DOCUMENT_TEMPLATE)
    expect(newDocumentText('paper.bib', 'ieee', {})).toBe(newDocumentText('paper.bib', 'ieee'))
  })

  it('adds the page header and footer to Blank when asked', () => {
    for (const bib of [null, 'paper.bib']) {
      const plain = parseFrontmatter(newDocumentText(bib, 'ieee'))
      const fm = parseFrontmatter(newDocumentText(bib, 'ieee', { pageFurniture: true }))
      expect(fm.header).toBe('{title}')
      expect(fm.footer).toBe('Page {page} of {pages}')
      expect(fm.bibliography).toBe(plain.bibliography)
      expect(fm.csl).toBe(plain.csl)
    }
  })

  it('starts a research article with a title, an author and an abstract', () => {
    const fm = parseFrontmatter(article('paper.bib'))
    expect(fm.title).toBe('Title of the paper')
    expect(fm.authors).toEqual([{ name: 'Your Name', affiliation: 'Your institution' }])
    expect(fm.abstract?.startsWith('One paragraph:')).toBe(true)
    expect(fm.bibliography).toBe('paper.bib')
    expect(fm.csl).toBe('apa')
    expect(fm.header).toBeUndefined()
    expect(fm.footer).toBeUndefined()
    const withFurniture = parseFrontmatter(article('paper.bib', true))
    expect(withFurniture.header).toBe('{title}')
    expect(withFurniture.footer).toBe('Page {page} of {pages}')
  })

  it('renders a research article with no bibliography cleanly', () => {
    const text = article(null)
    const fm = parseFrontmatter(text)
    expect(fm.title).toBe('Title of the paper')
    expect(fm.authors).toEqual([{ name: 'Your Name', affiliation: 'Your institution' }])
    expect(fm.abstract?.startsWith('One paragraph:')).toBe(true)
    expect(fm.bibliography).toBeUndefined()
    const result = renderDocument(text)
    expect(result.html).toContain('class="title-block"')
    const sections = [...result.html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)]
      .map((m) => m[1])
      .filter((t) => t !== 'Abstract')
    expect(sections).toEqual(['Introduction', 'Methods', 'Results', 'Discussion', 'Conclusion'])
    expect(result.crossrefs.missing).toEqual([])
    expect(result.html).not.toContain('[@')
  })

  it('has no top-level heading and no date in the research article', () => {
    for (const bib of [null, 'paper.bib']) {
      const text = article(bib, true)
      // The frontmatter's own `# ` lines are YAML comments; only the body counts.
      expect(parseFrontmatter(text).body).not.toMatch(/^# /m)
      expect(text).not.toMatch(/^date:/m)
    }
  })

  it('finds the title placeholder to select', () => {
    const text = article('paper.bib')
    const range = titleSelection(text)
    expect(range).not.toBeNull()
    expect(text.slice(range!.from, range!.to)).toBe('Title of the paper')
    expect(titleSelection(NEW_DOCUMENT_TEMPLATE)).toBeNull()
    expect(titleSelection('no frontmatter')).toBeNull()
  })
})
