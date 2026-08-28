/**
 * These are about one outage, not about a utility.
 *
 * The middleware awaited a Supabase auth refresh with no deadline, so a stalled
 * dependency turned into every page hanging for five minutes. Each case below
 * is a way that could happen again.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { withTimeout } from './timeout'

describe('withTimeout', () => {
  it('returns the real value when the work is quick', async () => {
    expect(await withTimeout(Promise.resolve('fresh'), 50, 'stale')).toBe('fresh')
  })

  it('gives up at the deadline rather than waiting', async () => {
    const never = new Promise<string>(() => {})
    const started = Date.now()
    expect(await withTimeout(never, 20, 'stale')).toBe('stale')
    // The point of the whole file: it came back, and it came back quickly.
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('treats a rejection the same as a timeout', async () => {
    // "The refresh did not happen" is one outcome with one sensible response.
    // Two error paths doing the same thing is two places to get it wrong.
    expect(await withTimeout(Promise.reject(new Error('down')), 50, 'stale')).toBe('stale')
  })

  it('survives a rejection that lands after the deadline', async () => {
    // The dangerous case. An unhandled rejection arriving late can kill the
    // very invocation the timeout was protecting, which would make this
    // helper worse than no helper.
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    const late = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('late')), 30))
    expect(await withTimeout(late, 5, 'stale')).toBe('stale')
    await new Promise((r) => setTimeout(r, 60))

    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('does not leave a timer holding the process open', async () => {
    // A pending setTimeout keeps a serverless invocation billable and alive.
    const spy = vi.spyOn(globalThis, 'clearTimeout')
    await withTimeout(Promise.resolve(1), 10_000, 0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
