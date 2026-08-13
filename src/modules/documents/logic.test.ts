import { describe, expect, it } from 'vitest'
import {
  buildReadiness,
  byUrgency,
  crossedThreshold,
  expiryStatus,
  formatBytes,
  isActionable,
  isReady,
  lastFour,
  maskNumber,
  readinessFraction,
  sanitiseFileName,
  shouldAlert,
  storagePath,
} from '@/modules/documents/logic'
import type { RequirementRow } from '@/modules/documents/types'

const TODAY = '2026-06-15'

describe('expiry status', () => {
  it('says nothing about a document that never expires', () => {
    const status = expiryStatus(null, { against: TODAY })
    expect(status.level).toBe('none')
    expect(status.message).toBeNull()
  })

  it('bands an ordinary document green, amber, red', () => {
    expect(expiryStatus('2028-06-15', { against: TODAY }).level).toBe('ok')
    expect(expiryStatus('2027-01-15', { against: TODAY }).level).toBe('warning')
    expect(expiryStatus('2026-07-15', { against: TODAY }).level).toBe('blocking')
    expect(expiryStatus('2026-01-15', { against: TODAY }).level).toBe('expired')
  })

  describe('the passport rule', () => {
    it('warns at nine months, and explains why', () => {
      // The number is useless without the reason: most countries want six
      // months' validity beyond entry, so "fine today" is not the question.
      const status = expiryStatus('2027-01-15', { isPassport: true, against: TODAY })
      expect(status.level).toBe('warning')
      expect(status.message).toMatch(/6-month rule/i)
    })

    it('blocks under six months, naming the consequence', () => {
      const status = expiryStatus('2026-10-15', { isPassport: true, against: TODAY })
      expect(status.level).toBe('blocking')
      expect(status.message).toMatch(/refuse entry/i)
    })

    it('is calm beyond nine months', () => {
      expect(expiryStatus('2027-06-15', { isPassport: true, against: TODAY }).level).toBe('ok')
    })

    it('treats a passport differently from anything else at the same date', () => {
      // Seven months out: a warning for a passport, nothing for a licence.
      const date = '2027-01-20'
      expect(expiryStatus(date, { isPassport: true, against: TODAY }).level).toBe('warning')
      expect(expiryStatus(date, { isPassport: false, against: TODAY }).level).toBe('warning')
      // ...but at eight months the passport still warns while the gap narrows.
      expect(expiryStatus('2027-02-20', { isPassport: true, against: TODAY }).level).toBe('warning')
    })
  })

  it('measures against the trip end, not today — the whole point', () => {
    const expires = '2026-08-01'
    // Valid today...
    expect(expiryStatus(expires, { against: TODAY }).level).not.toBe('expired')
    // ...but not by the time this trip finishes.
    expect(expiryStatus(expires, { against: '2026-09-01' }).level).toBe('expired')
  })

  it('sorts the urgent above the calm', () => {
    const levels = ['ok', 'expired', 'warning', 'none', 'blocking'] as const
    expect([...levels].sort(byUrgency)).toEqual(['expired', 'blocking', 'warning', 'ok', 'none'])
  })

  it('knows which levels deserve a nudge', () => {
    expect(isActionable('expired')).toBe(true)
    expect(isActionable('blocking')).toBe(true)
    expect(isActionable('warning')).toBe(true)
    expect(isActionable('ok')).toBe(false)
    expect(isActionable('none')).toBe(false)
  })
})

describe('readiness', () => {
  const row = (over: Partial<RequirementRow> = {}): RequirementRow => ({
    user_id: 'u1',
    type_id: 't1',
    type_name: 'Passport',
    is_manual: false,
    document_id: 'd1',
    expires_on: '2030-01-01',
    satisfied: true,
    ...over,
  })

  it('groups by person and counts', () => {
    const reports = buildReadiness([
      row(),
      row({ type_id: 't2', type_name: 'Visa', satisfied: false, document_id: null }),
      row({ user_id: 'u2' }),
    ])

    expect(reports.u1?.total).toBe(2)
    expect(reports.u1?.satisfiedCount).toBe(1)
    expect(reports.u1?.missing).toEqual(['Visa'])
    expect(reports.u2?.total).toBe(1)
    expect(isReady(reports.u2!)).toBe(true)
    expect(isReady(reports.u1!)).toBe(false)
  })

  it('renders the fraction the spec asks for', () => {
    const reports = buildReadiness([row(), row({ type_id: 't2', satisfied: false })])
    expect(readinessFraction(reports.u1!)).toBe('1 / 2')
  })

  it('does not call an empty requirement list "ready"', () => {
    // Zero of zero is not readiness, it is an unanswered question.
    const reports = buildReadiness([])
    expect(reports.u1).toBeUndefined()
    expect(isReady({ userId: 'u1', required: [], satisfiedCount: 0, total: 0, missing: [] })).toBe(
      false,
    )
  })
})

describe('storage paths', () => {
  it('builds the path the policies parse', () => {
    // folder[1] is the couple and folder[2] the owner — the storage policies
    // read exactly these positions, so the shape is load-bearing.
    expect(storagePath('c1', 'u1', 'd1', 'passport.pdf')).toBe('c1/u1/d1/passport.pdf')
  })

  it('sanitises a filename without losing the extension', () => {
    expect(sanitiseFileName('my passport.pdf')).toBe('my-passport.pdf')
    expect(sanitiseFileName('../../etc/passwd')).toBe('etc-passwd')
    expect(sanitiseFileName('a/b/c.png')).toBe('a-b-c.png')
    expect(sanitiseFileName('  spaced  out .jpg')).toBe('spaced-out-.jpg')
  })

  it('never produces an empty name', () => {
    expect(sanitiseFileName('***')).toBe('document')
    expect(sanitiseFileName('')).toBe('document')
  })
})

describe('document numbers', () => {
  it('keeps only the last four digits', () => {
    expect(lastFour('AB1234567')).toBe('4567')
    expect(lastFour('123')).toBe('123')
    expect(lastFour('no digits here')).toBeNull()
    expect(lastFour(null)).toBeNull()
  })

  it('masks for display and never reveals more', () => {
    expect(maskNumber('4567')).toBe('•••• 4567')
    expect(maskNumber(null)).toBeNull()
  })
})

describe('the expiry sweep', () => {
  it('finds the band a document has crossed', () => {
    expect(crossedThreshold('2026-06-01', TODAY, false)).toBe('expired')
    expect(crossedThreshold('2026-07-01', TODAY, false)).toBe('1mo')
    expect(crossedThreshold('2026-08-15', TODAY, false)).toBe('3mo')
    expect(crossedThreshold('2026-11-15', TODAY, false)).toBe('6mo')
    expect(crossedThreshold('2027-03-15', TODAY, false)).toBe('12mo')
    expect(crossedThreshold('2028-01-01', TODAY, false)).toBeNull()
  })

  it('gives passports the extra nine-month band', () => {
    // Eight months out: interesting for a passport, not for anything else.
    expect(crossedThreshold('2027-02-15', TODAY, true)).toBe('9mo')
    expect(crossedThreshold('2027-02-15', TODAY, false)).toBe('12mo')
  })

  it('never alerts on a document with no expiry', () => {
    expect(crossedThreshold(null, TODAY, true)).toBeNull()
  })

  it('alerts once per band, not every morning', () => {
    // The 6-month alert fires when it is first crossed...
    expect(shouldAlert('6mo', '12mo')).toBe(true)
    // ...and then stays quiet for the next three months.
    expect(shouldAlert('6mo', '6mo')).toBe(false)
    // Never re-alerts for a band already passed.
    expect(shouldAlert('12mo', '6mo')).toBe(false)
  })

  it('alerts on the first crossing when nothing has been sent yet', () => {
    expect(shouldAlert('12mo', null)).toBe(true)
    expect(shouldAlert(null, null)).toBe(false)
  })

  it('recovers if the stored threshold is unrecognised', () => {
    expect(shouldAlert('3mo', 'nonsense')).toBe(true)
  })
})

describe('formatBytes', () => {
  it('reads naturally at the sizes documents actually are', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3_500_000)).toBe('3.3 MB')
  })

  it('says nothing for a missing size', () => {
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(0)).toBe('')
  })
})
