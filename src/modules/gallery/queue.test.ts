import { describe, expect, it } from 'vitest'
import {
  EMPTY_QUEUE,
  MAX_ATTEMPTS,
  backoffMs,
  isActive,
  nextPending,
  reduce,
  shouldRetry,
  summarise,
  type QueueState,
} from '@/modules/gallery/queue'

const withFiles = (...names: string[]): QueueState =>
  reduce(EMPTY_QUEUE, {
    type: 'add',
    items: names.map((name, i) => ({ id: `f${i}`, name, bytes: 1000 })),
  })

describe('adding', () => {
  it('starts everything pending with no attempts', () => {
    const state = withFiles('a.jpg', 'b.jpg')
    expect(state.items).toHaveLength(2)
    expect(state.items.every((i) => i.status === 'pending' && i.attempts === 0)).toBe(true)
  })

  it('appends rather than replacing', () => {
    const first = withFiles('a.jpg')
    const second = reduce(first, { type: 'add', items: [{ id: 'x', name: 'b.jpg', bytes: 10 }] })
    expect(second.items).toHaveLength(2)
  })
})

describe('nextPending', () => {
  it('takes the first pending item', () => {
    expect(nextPending(withFiles('a.jpg', 'b.jpg'))?.name).toBe('a.jpg')
  })

  it('takes nothing while something is in flight', () => {
    // One at a time: a phone decoding two large photos at once runs out of
    // memory, and the batch is not faster for it.
    const state = reduce(withFiles('a.jpg', 'b.jpg'), {
      type: 'status',
      id: 'f0',
      status: 'processing',
    })
    expect(nextPending(state)).toBeNull()
  })

  it('takes nothing while paused', () => {
    expect(nextPending(reduce(withFiles('a.jpg'), { type: 'pause' }))).toBeNull()
  })

  it('resumes where it left off', () => {
    const paused = reduce(withFiles('a.jpg'), { type: 'pause' })
    expect(nextPending(reduce(paused, { type: 'resume' }))?.name).toBe('a.jpg')
  })
})

describe('the lifecycle', () => {
  it('runs pending → processing → uploading → done', () => {
    let state = withFiles('a.jpg')
    for (const status of ['processing', 'uploading', 'done'] as const) {
      state = reduce(state, { type: 'status', id: 'f0', status })
    }
    expect(state.items[0]!.status).toBe('done')
    // Done implies complete, whatever the last progress event said.
    expect(state.items[0]!.progress).toBe(1)
  })

  it('records the error on a failure', () => {
    const state = reduce(withFiles('a.jpg'), {
      type: 'status',
      id: 'f0',
      status: 'failed',
      error: 'Network went away.',
    })
    expect(state.items[0]!.error).toBe('Network went away.')
  })

  it('clears the error when the item goes back to pending', () => {
    let state = reduce(withFiles('a.jpg'), { type: 'status', id: 'f0', status: 'failed' })
    state = reduce(state, { type: 'retry', id: 'f0' })
    expect(state.items[0]!.error).toBeNull()
    expect(state.items[0]!.status).toBe('pending')
  })

  it('clamps progress to 0..1', () => {
    let state = reduce(withFiles('a.jpg'), { type: 'progress', id: 'f0', progress: 5 })
    expect(state.items[0]!.progress).toBe(1)
    state = reduce(state, { type: 'progress', id: 'f0', progress: -1 })
    expect(state.items[0]!.progress).toBe(0)
  })

  it('remembers the media id so a retry does not create a second row', () => {
    const state = reduce(withFiles('a.jpg'), { type: 'media', id: 'f0', mediaId: 'm1' })
    expect(state.items[0]!.mediaId).toBe('m1')
  })
})

describe('retries', () => {
  it('backs off 1s, 2s, 4s, 8s', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000])
  })

  it('stops after four attempts', () => {
    let state = withFiles('a.jpg')
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      state = reduce(state, { type: 'attempt', id: 'f0' })
    }
    state = reduce(state, { type: 'status', id: 'f0', status: 'failed' })
    expect(shouldRetry(state.items[0]!)).toBe(false)
  })

  it('retries while there are attempts left', () => {
    let state = reduce(withFiles('a.jpg'), { type: 'attempt', id: 'f0' })
    state = reduce(state, { type: 'status', id: 'f0', status: 'failed' })
    expect(shouldRetry(state.items[0]!)).toBe(true)
  })

  it('resets the count on a manual retry — the user knows something changed', () => {
    let state = withFiles('a.jpg')
    for (let i = 0; i < MAX_ATTEMPTS; i++) state = reduce(state, { type: 'attempt', id: 'f0' })
    state = reduce(state, { type: 'status', id: 'f0', status: 'failed' })
    state = reduce(state, { type: 'retry', id: 'f0' })
    expect(state.items[0]!.attempts).toBe(0)
    expect(shouldRetry({ ...state.items[0]!, status: 'failed' })).toBe(true)
  })
})

describe('duplicates', () => {
  it('parks the item rather than dropping it', () => {
    const state = reduce(withFiles('a.jpg'), { type: 'duplicate', id: 'f0', duplicateOf: 'm9' })
    expect(state.items[0]!.status).toBe('duplicate')
    expect(state.items[0]!.duplicateOf).toBe('m9')
    // Still in the list, because the user gets to say "upload anyway".
    expect(state.items).toHaveLength(1)
  })

  it('goes back to pending when the user insists', () => {
    let state = reduce(withFiles('a.jpg'), { type: 'duplicate', id: 'f0', duplicateOf: 'm9' })
    state = reduce(state, { type: 'retry', id: 'f0' })
    expect(nextPending(state)?.id).toBe('f0')
  })
})

describe('summarise', () => {
  it('weights the bar by bytes, not by count', () => {
    let state = reduce(EMPTY_QUEUE, {
      type: 'add',
      items: [
        { id: 'small', name: 's.jpg', bytes: 100 },
        { id: 'big', name: 'b.jpg', bytes: 900 },
      ],
    })
    state = reduce(state, { type: 'status', id: 'small', status: 'done' })

    // Half the files, a tenth of the bytes.
    expect(summarise(state).done).toBe(1)
    expect(summarise(state).fraction).toBeCloseTo(0.1, 2)
  })

  it('counts each outcome separately', () => {
    let state = withFiles('a.jpg', 'b.jpg', 'c.jpg')
    state = reduce(state, { type: 'status', id: 'f0', status: 'done' })
    state = reduce(state, { type: 'status', id: 'f1', status: 'failed' })
    state = reduce(state, { type: 'duplicate', id: 'f2', duplicateOf: 'm1' })

    expect(summarise(state)).toMatchObject({ total: 3, done: 1, failed: 1, duplicates: 1, active: 0 })
  })

  it('has nothing to report about an empty queue', () => {
    expect(summarise(EMPTY_QUEUE)).toMatchObject({ total: 0, fraction: 0 })
  })
})

describe('housekeeping', () => {
  it('clears finished and duplicates, keeping what still needs attention', () => {
    let state = withFiles('a.jpg', 'b.jpg', 'c.jpg')
    state = reduce(state, { type: 'status', id: 'f0', status: 'done' })
    state = reduce(state, { type: 'duplicate', id: 'f1', duplicateOf: 'm1' })
    state = reduce(state, { type: 'status', id: 'f2', status: 'failed' })

    const cleared = reduce(state, { type: 'clearFinished' })
    expect(cleared.items.map((i) => i.id)).toEqual(['f2'])
  })

  it('removes one item', () => {
    const state = reduce(withFiles('a.jpg', 'b.jpg'), { type: 'remove', id: 'f0' })
    expect(state.items.map((i) => i.name)).toEqual(['b.jpg'])
  })

  it('hydrates wholesale from what was saved', () => {
    const saved = withFiles('restored.jpg')
    expect(reduce(EMPTY_QUEUE, { type: 'hydrate', state: saved })).toEqual(saved)
  })
})

describe('isActive', () => {
  it('counts the three in-flight states and nothing else', () => {
    expect(['pending', 'processing', 'uploading'].every((s) => isActive(s as never))).toBe(true)
    expect(['done', 'failed', 'duplicate'].some((s) => isActive(s as never))).toBe(false)
  })
})
