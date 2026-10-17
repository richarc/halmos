import { describe, it, expect, vi, afterEach } from 'vitest'
import { waitForLatest } from './settle'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

describe('waitForLatest', () => {
  it('waits for the current promise', async () => {
    const d = deferred()
    let done = false
    const wait = waitForLatest(() => d.promise, 10_000).then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    d.resolve()
    await wait
    expect(done).toBe(true)
  })

  it('also waits for a promise that replaced it while waiting', async () => {
    const first = deferred()
    const second = deferred()
    let current = first.promise
    let done = false
    const wait = waitForLatest(() => current, 10_000).then(() => (done = true))
    current = second.promise
    first.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(done).toBe(false)
    second.resolve()
    await wait
    expect(done).toBe(true)
  })

  it('gives up after the cap', async () => {
    vi.useFakeTimers()
    let done = false
    const wait = waitForLatest(() => new Promise(() => {}), 10_000).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await wait
    expect(done).toBe(true)
  })

  it('still stops at the cap when every call returns a new promise', async () => {
    await expect(waitForLatest(() => Promise.resolve(), 50)).resolves.toBeUndefined()
  })

  it('treats a rejected promise as settled', async () => {
    const failed = Promise.reject(new Error('x'))
    await expect(waitForLatest(() => failed, 10_000)).resolves.toBeUndefined()
  })
})
