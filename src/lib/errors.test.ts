import { describe, expect, it } from 'vitest'
import { AppError, toAppError, unwrap, unwrapList, unwrapMaybe, userMessage } from '@/lib/errors'

describe('toAppError', () => {
  it('passes an AppError straight through', () => {
    const original = new AppError('nope', { kind: 'permission' })
    expect(toAppError(original)).toBe(original)
  })

  it('maps our RPC codes to copy a user can act on', () => {
    const e = toAppError({ message: 'INVALID_CODE', code: 'P0001', details: '', hint: '' })
    expect(e.kind).toBe('not_found')
    expect(e.code).toBe('INVALID_CODE')
    expect(e.retryable).toBe(false)
    expect(e.message).toMatch(/check it, or ask for a new one/i)
  })

  it('keeps expired and invalid codes distinct', () => {
    // Spec 1.7 needs these to read differently: one offers a regenerate.
    const invalid = toAppError({ message: 'INVALID_CODE', code: 'P0001', details: '', hint: '' })
    const expired = toAppError({ message: 'EXPIRED_CODE', code: 'P0001', details: '', hint: '' })
    expect(invalid.message).not.toBe(expired.message)
    expect(expired.message).toMatch(/expired/i)
  })

  it('maps Postgres error codes', () => {
    expect(toAppError({ message: 'dupe', code: '23505', details: '', hint: '' }).kind).toBe(
      'conflict',
    )
    expect(toAppError({ message: 'denied', code: '42501', details: '', hint: '' }).kind).toBe(
      'permission',
    )
    expect(toAppError({ message: 'gone', code: 'PGRST301', details: '', hint: '' }).kind).toBe(
      'auth',
    )
  })

  it('never renders a raw Postgres message for a code it knows', () => {
    const e = toAppError({
      message: 'duplicate key value violates unique constraint "couples_invite_code_key"',
      code: '23505',
      details: '',
      hint: '',
    })
    expect(e.message).not.toMatch(/duplicate key|constraint/i)
  })

  it('recognises a transport failure however it is dressed up', () => {
    // A thrown TypeError from fetch...
    expect(toAppError(new TypeError('fetch failed')).kind).toBe('network')
    // ...a plain object, which is what some proxies and supabase-js produce...
    expect(toAppError({ message: 'Host not in allowlist: db.example.com' }).kind).toBe('network')
    expect(toAppError({ message: 'connect ECONNREFUSED 127.0.0.1:5432' }).kind).toBe('network')
    // ...and all of them should offer a retry.
    expect(toAppError(new TypeError('fetch failed')).retryable).toBe(true)
  })

  it('does not lose a plain object message that is not network-related', () => {
    expect(toAppError({ message: 'Something specific broke' }).message).toBe(
      'Something specific broke',
    )
  })

  it('falls back safely on anything else', () => {
    expect(toAppError(undefined).message).toBe('Something went wrong.')
    expect(toAppError('a bare string').message).toBe('Something went wrong.')
    expect(toAppError(null).kind).toBe('unknown')
  })

  it('gives a renderable message for anything', () => {
    expect(userMessage(new Error('boom'))).toBe('boom')
    expect(userMessage(42)).toBe('Something went wrong.')
  })
})

describe('unwrap helpers', () => {
  it('returns the payload on success', () => {
    expect(unwrap({ data: { id: 'x' }, error: null })).toEqual({ id: 'x' })
    expect(unwrapMaybe({ data: { id: 'x' }, error: null })).toEqual({ id: 'x' })
    expect(unwrapList({ data: [{ id: 'x' }], error: null })).toEqual([{ id: 'x' }])
  })

  it('throws a normalised error when the envelope carries one', () => {
    const failure = { data: null, error: { message: 'denied', code: '42501' } }
    expect(() => unwrap(failure)).toThrow(AppError)
    expect(() => unwrapMaybe(failure)).toThrow(AppError)
    expect(() => unwrapList(failure)).toThrow(AppError)
  })

  it('distinguishes "not found" from "legitimately absent"', () => {
    // unwrap demands a row; unwrapMaybe treats null as a real answer.
    expect(() => unwrap({ data: null, error: null })).toThrow(/not found/i)
    expect(unwrapMaybe({ data: null, error: null })).toBeNull()
  })

  it('treats an empty list as success', () => {
    expect(unwrapList({ data: [], error: null })).toEqual([])
    expect(unwrapList({ data: null, error: null })).toEqual([])
  })
})
