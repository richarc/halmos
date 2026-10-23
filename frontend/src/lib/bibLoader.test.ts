import { describe, expect, it, vi } from 'vitest'
import { BIB_WORKER_READY_MS, createBibParser, type BibWorker } from './bibLoader'
import { parseBib } from './bibliography'

const BIB = '@article{smith2020, author = {Smith, Jane}, title = {A Title}, year = {2020}}'

// Stands in for the Web Worker: answers each request with parseBib, as
// bibWorker.ts does, after a tick, so replies are asynchronous like the real one.
function fakeWorker() {
  const posted: { id: number; text: string }[] = []
  const w: BibWorker & { posted: typeof posted } = {
    posted,
    onmessage: null,
    onerror: null,
    postMessage(msg: { id: number; text: string }) {
      posted.push(msg)
      setTimeout(() => w.onmessage?.({ data: { id: msg.id, result: parseBib(msg.text) } }), 0)
    },
    terminate() {},
  }
  // bibWorker.ts says it is ready as soon as it has loaded.
  setTimeout(() => w.onmessage?.({ data: { ready: true } }), 0)
  return w
}

describe('createBibParser', () => {
  it('parses in the worker and returns what parseBib returns', async () => {
    const w = fakeWorker()
    const p = createBibParser(() => w)
    const got = await p.parse(BIB)
    expect(got).toEqual(parseBib(BIB))
    expect(w.posted).toHaveLength(1)
  })

  // A style change or a second document naming the same .bib reads the same
  // text again; it must not be parsed again.
  it('does not parse the same text twice', async () => {
    const w = fakeWorker()
    const p = createBibParser(() => w)
    await p.parse(BIB)
    await p.parse(BIB)
    expect(w.posted).toHaveLength(1)
  })

  it('parses new text', async () => {
    const w = fakeWorker()
    const p = createBibParser(() => w)
    await p.parse(BIB)
    const other = BIB.replace('smith2020', 'jones2021')
    const got = await p.parse(other)
    expect(got.entries[0].id).toBe('jones2021')
    expect(w.posted).toHaveLength(2)
  })

  // The formatter keeps the entries it is given, so two callers sharing one
  // cached array could see each other's changes.
  it('gives each caller its own copy of the entries', async () => {
    const p = createBibParser(() => fakeWorker())
    const a = await p.parse(BIB)
    a.entries[0].title = 'changed'
    const b = await p.parse(BIB)
    expect(b.entries[0].title).toBe(parseBib(BIB).entries[0].title)
  })

  it('matches overlapping replies to their requests', async () => {
    const w = fakeWorker()
    const p = createBibParser(() => w)
    const other = BIB.replace('smith2020', 'jones2021')
    const [a, b] = await Promise.all([p.parse(BIB), p.parse(other)])
    expect(a.entries[0].id).toBe('smith2020')
    expect(b.entries[0].id).toBe('jones2021')
  })

  it('parses on the main thread when no worker can be started', async () => {
    const p = createBibParser(() => null)
    expect(await p.parse(BIB)).toEqual(parseBib(BIB))
  })

  it('parses on the main thread when the worker fails, and stops using it', async () => {
    const w = fakeWorker()
    w.postMessage = () => setTimeout(() => w.onerror?.(new Event('error')), 0)
    const terminate = vi.spyOn(w, 'terminate')
    const spawn = vi.fn(() => w)
    const p = createBibParser(spawn)
    expect(await p.parse(BIB)).toEqual(parseBib(BIB))
    expect(terminate).toHaveBeenCalled()
    const other = BIB.replace('smith2020', 'jones2021')
    expect((await p.parse(other)).entries[0].id).toBe('jones2021')
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('parses on the main thread when the worker replies with an error', async () => {
    const w = fakeWorker()
    w.postMessage = (msg) => {
      w.posted.push(msg)
      setTimeout(() => w.onmessage?.({ data: { id: msg.id, error: 'boom' } }), 0)
    }
    const p = createBibParser(() => w)
    expect(await p.parse(BIB)).toEqual(parseBib(BIB))
  })

  // A worker that loads but never runs would leave every parse waiting.
  it('gives up on a worker that never says it is ready', async () => {
    vi.useFakeTimers()
    try {
      const silent: BibWorker = { onmessage: null, onerror: null, postMessage() {}, terminate: vi.fn() }
      const p = createBibParser(() => silent)
      const result = p.parse(BIB)
      await vi.advanceTimersByTimeAsync(BIB_WORKER_READY_MS)
      expect(await result).toEqual(parseBib(BIB))
      expect(silent.terminate).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
