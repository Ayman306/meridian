import { describe, expect, it } from 'vitest'
import webpush from 'web-push'
import {
  PUSH_CATEGORIES,
  settingColumnFor,
  urlBase64ToUint8Array,
  type PushCategory,
} from '@/lib/push/keys'

describe('the VAPID key conversion browsers require', () => {
  it('round-trips a real generated key', () => {
    // Against a key from the same library that will sign the pushes, rather
    // than a hand-written fixture that could agree with a wrong implementation.
    const { publicKey } = webpush.generateVAPIDKeys()
    const bytes = urlBase64ToUint8Array(publicKey)
    // A P-256 uncompressed point: one 0x04 tag plus two 32-byte coordinates.
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(4)
  })

  it('restores the padding base64url drops', () => {
    // "abc" encodes to "YWJj" (no padding needed); "abcd" to "YWJjZA" which
    // needs two '=' back before atob will accept it.
    expect(Array.from(urlBase64ToUint8Array('YWJjZA'))).toEqual([97, 98, 99, 100])
  })

  it('undoes the URL-safe alphabet', () => {
    // '-' and '_' stand in for '+' and '/'. Feeding them to atob unchanged
    // throws, which is exactly the bug this conversion exists to avoid.
    const bytes = urlBase64ToUint8Array('--__')
    expect(Array.from(bytes)).toEqual([251, 239, 255])
  })
})

describe('mapping a category to the column that governs it', () => {
  it('covers every category', () => {
    for (const category of PUSH_CATEGORIES) {
      expect(settingColumnFor(category)).toBe(`notify_${category}`)
    }
  })

  it('matches the columns user_settings actually has', () => {
    // Pinned by name. A typo here reads as "not opted out" and sends a
    // notification the person switched off, so it is worth an explicit list.
    expect(PUSH_CATEGORIES.map(settingColumnFor).sort()).toEqual([
      'notify_allowance',
      'notify_daily_exchange',
      'notify_documents',
      'notify_flights',
      'notify_partner_activity',
    ])
  })

  it('has no category without a column', () => {
    const missing = (PUSH_CATEGORIES as readonly PushCategory[]).filter((c) => !settingColumnFor(c))
    expect(missing).toEqual([])
  })
})
