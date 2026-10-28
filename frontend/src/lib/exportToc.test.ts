import { describe, it, expect } from 'vitest'
import { tocMarkerForExport } from './exportToc'
import { newDocumentText } from './documentTemplate'

describe('tocMarkerForExport', () => {
  it('removes the marker paragraph when the frontmatter asks for contents', () => {
    const doc = '---\ntoc: true\n---\nTitle page.\n\n[[toc]]\n\n## One\n'
    expect(tocMarkerForExport(doc)).toBe('---\ntoc: true\n---\nTitle page.\n\n\n## One\n')
  })

  it('leaves the marker when contents are off, as the preview shows it then', () => {
    const doc = '---\ntitle: T\n---\n[[toc]]\n\n## One\n'
    expect(tocMarkerForExport(doc)).toBe(doc)
  })

  it('removes only the first marker, and never one in a fence or a list', () => {
    const doc = '---\ntoc: true\n---\n- [[toc]]\n\n```\n[[toc]]\n```\n\n[[TOC]]\n\n[[toc]]\n'
    expect(tocMarkerForExport(doc)).toBe('---\ntoc: true\n---\n- [[toc]]\n\n```\n[[toc]]\n```\n\n\n[[toc]]\n')
  })

  it('takes the marker out of a new thesis', () => {
    const thesis = newDocumentText(null, 'apa', { starter: 'thesis' })
    const out = tocMarkerForExport(thesis)
    expect(out).not.toContain('\n[[toc]]\n')
    expect(out).toContain('Supervisor:')
    expect(out.split('\n').length).toBe(thesis.split('\n').length - 1)
  })
})
