import { describe, it, expect } from 'vitest'
import { formatSample } from './styleSample'
import { loadStyleXml } from './citations'

describe('formatSample', () => {
  it('formats the sample article as a citation and a reference', async () => {
    const sample = await formatSample((await loadStyleXml('ieee'))!)
    expect(sample.citation).toBe('[1]')
    expect(sample.reference).toContain('Light trapping in thin silicon solar cells')
  })

  it('formats an author-date style differently', async () => {
    const sample = await formatSample((await loadStyleXml('apa'))!)
    expect(sample.citation).toMatch(/^\(Okafor .*2024\)$/)
  })

  it('throws for a style that formats no reference', async () => {
    const empty = '<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0"><info><title>X</title><id>x</id></info><citation><layout><text variable="title"/></layout></citation></style>'
    await expect(formatSample(empty)).rejects.toThrow()
  })
})
