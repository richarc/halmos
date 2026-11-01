import { describe, expect, it, vi } from 'vitest'
import { describeFailure, loadAcknowledgements } from './acknowledgements'

const good = {
  generatedBy: 'halmos-notices',
  entries: [{ name: 'katex', version: '0.19.1', licence: 'MIT', copyright: ['Copyright (c) 2013-2020 Khan Academy'], text: 'MIT', origin: 'npm' }],
}
const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('loadAcknowledgements', () => {
  it('returns the notices from /acknowledgements.json', async () => {
    const fetchFn = respond(200, good)
    const n = await loadAcknowledgements(fetchFn)
    expect(fetchFn).toHaveBeenCalledWith('/acknowledgements.json')
    expect(n?.entries[0].name).toBe('katex')
  })
  it('returns null when the file is not there', async () => {
    expect(await loadAcknowledgements(respond(404, {}))).toBeNull()
  })
  it('returns null for a file that is not the notices', async () => {
    expect(await loadAcknowledgements(respond(200, {}))).toBeNull()
    expect(await loadAcknowledgements(respond(200, { generatedBy: 'halmos-notices' }))).toBeNull()
  })
  it('says why it could not load them', async () => {
    expect(await describeFailure(respond(404, {}))).toBe('HTTP 404')
    expect(await describeFailure(respond(200, {}))).toBe('not a licence notices file')
    expect(await describeFailure(vi.fn(async () => Promise.reject(new TypeError('Load failed'))))).toBe('TypeError: Load failed')
    expect(await describeFailure(respond(200, good))).toBe('')
  })
  it('returns null when the fetch fails', async () => {
    expect(await loadAcknowledgements(vi.fn(async () => Promise.reject(new Error('offline'))))).toBeNull()
  })
})
