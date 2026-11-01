import { describe, it, expect, vi, beforeEach } from 'vitest'

const runtime = vi.hoisted(() => {
  const subscribed: string[] = []
  const handlers = new Map<string, (ev: { name: string; data: unknown }) => void>()
  const unsubscribed: string[] = []
  return {
    subscribed,
    handlers,
    unsubscribed,
    Events: {
      On: vi.fn((name: string, cb: (ev: { name: string; data: unknown }) => void) => {
        subscribed.push(name)
        handlers.set(name, cb)
        return () => unsubscribed.push(name)
      }),
    },
  }
})
vi.mock('@wailsio/runtime', () => ({ Events: runtime.Events }))

import { subscribeAppEvents } from './appEvents'

beforeEach(() => {
  runtime.subscribed.length = 0
  runtime.unsubscribed.length = 0
  runtime.handlers.clear()
})

describe('subscribeAppEvents', () => {
  it('subscribes every handler given to its own event', () => {
    const format = vi.fn()
    const changed = vi.fn()
    subscribeAppEvents({ 'menu:format': format, 'document:changed': changed }, { beforeCommand: () => {} })
    expect(runtime.subscribed.sort()).toEqual(['document:changed', 'menu:format'])
    runtime.handlers.get('menu:format')!({ name: 'menu:format', data: 'bold' })
    expect(format).toHaveBeenCalledWith(expect.objectContaining({ data: 'bold' }))
  })

  it('runs beforeCommand before a menu command, and not before other events', () => {
    const order: string[] = []
    subscribeAppEvents(
      {
        'menu:save': () => order.push('save'),
        'close:confirm': () => order.push('confirm'),
        'document:closed': () => order.push('closed'),
        'menu:command-palette': () => order.push('palette'),
      },
      { beforeCommand: () => order.push('before') },
    )
    for (const name of ['menu:save', 'close:confirm', 'document:closed', 'menu:command-palette'])
      runtime.handlers.get(name)!({ name, data: null })
    expect(order).toEqual(['before', 'save', 'before', 'confirm', 'closed', 'palette'])
  })

  it('returns one function that unsubscribes them all', () => {
    const off = subscribeAppEvents({ 'menu:new': () => {}, 'recents:changed': () => {} }, { beforeCommand: () => {} })
    off()
    expect(runtime.unsubscribed.sort()).toEqual(['menu:new', 'recents:changed'])
  })
})
