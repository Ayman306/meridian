/**
 * Pure functions for Module 8 — Documents.
 *
 * The rule this module exists to enforce: a document must be valid through the
 * end of the trip, not merely valid today. Checking against `now` is the
 * obvious mistake and it fails silently — you would be told you are ready for a
 * trip your passport does not cover.
 */
import { monthsUntil, todayIn, type DateOnly } from '@/lib/dates'
import type {
  DocumentType,
  DocumentWithType,
  ExpiryLevel,
  ExpiryStatus,
  ReadinessReport,
  RequirementRow,
} from './types'

/**
 * Most countries require six months of passport validity *beyond the date of
 * entry*, so a passport that looks fine today can be refused at the gate. We
 * therefore warn at nine months rather than at expiry, and say why — the
 * number is useless without the reason.
 */
export const PASSPORT_WARNING_MONTHS = 9
export const PASSPORT_BLOCKING_MONTHS = 6

/** Ordinary documents: amber inside a year, red inside three months. */
export const DOCUMENT_WARNING_MONTHS = 12
export const DOCUMENT_BLOCKING_MONTHS = 3

/**
 * How worried to be about one document.
 *
 * `against` is the date the document actually has to survive — the end of the
 * trip when there is one, otherwise today.
 */
export function expiryStatus(
  expiresOn: DateOnly | null,
  opts: { isPassport?: boolean; against: DateOnly },
): ExpiryStatus {
  if (!expiresOn) {
    // A birth certificate does not expire. Absence of a date is not a problem
    // to be flagged.
    return { level: 'none', months: null, message: null }
  }

  const months = monthsUntil(expiresOn, opts.against)

  if (expiresOn < opts.against) {
    return {
      level: 'expired',
      months,
      message: `Expired ${expiresOn}`,
    }
  }

  if (opts.isPassport) {
    if (months < PASSPORT_BLOCKING_MONTHS) {
      return {
        level: 'blocking',
        months,
        message: 'Under 6 months validity at travel — many countries refuse entry',
      }
    }
    if (months < PASSPORT_WARNING_MONTHS) {
      return {
        level: 'warning',
        months,
        message: 'Renew soon — the 6-month rule will apply before you travel',
      }
    }
    return { level: 'ok', months, message: null }
  }

  if (months < DOCUMENT_BLOCKING_MONTHS) {
    return { level: 'blocking', months, message: `Expires in ${months} month${months === 1 ? '' : 's'}` }
  }
  if (months < DOCUMENT_WARNING_MONTHS) {
    return { level: 'warning', months, message: `Expires ${expiresOn}` }
  }
  return { level: 'ok', months, message: null }
}

/** Convenience for the vault, where the reference date is simply today. */
export function expiryStatusToday(
  doc: Pick<DocumentWithType, 'expires_on'> & { type?: DocumentType | null },
  viewerTz: string,
): ExpiryStatus {
  return expiryStatus(doc.expires_on, {
    isPassport: doc.type?.name === 'Passport',
    against: todayIn(viewerTz),
  })
}

const LEVEL_ORDER: Record<ExpiryLevel, number> = {
  expired: 0,
  blocking: 1,
  warning: 2,
  ok: 3,
  none: 4,
}

/** Most urgent first. Used by the vault and the dashboard alert strip. */
export function byUrgency(a: ExpiryLevel, b: ExpiryLevel): number {
  return LEVEL_ORDER[a] - LEVEL_ORDER[b]
}

export function isActionable(level: ExpiryLevel): boolean {
  return level === 'expired' || level === 'blocking' || level === 'warning'
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Turn the flat rows from `trip_readiness()` into one report per person.
 *
 * The satisfied flag is computed in SQL, because that is where the "valid
 * through the end of the trip" join lives. This only groups and counts.
 */
export function buildReadiness(rows: readonly RequirementRow[]): Record<string, ReadinessReport> {
  const byUser: Record<string, ReadinessReport> = {}

  for (const row of rows) {
    const report = (byUser[row.user_id] ??= {
      userId: row.user_id,
      required: [],
      satisfiedCount: 0,
      total: 0,
      missing: [],
    })
    report.required.push(row)
    report.total += 1
    if (row.satisfied) report.satisfiedCount += 1
    else report.missing.push(row.type_name)
  }

  for (const report of Object.values(byUser)) {
    report.required.sort((a, b) => a.type_name.localeCompare(b.type_name))
    report.missing.sort()
  }

  return byUser
}

/** "4 / 6". Zero requirements is complete, not divide-by-zero. */
export function readinessFraction(report: ReadinessReport): string {
  return `${report.satisfiedCount} / ${report.total}`
}

export function isReady(report: ReadinessReport): boolean {
  return report.total > 0 && report.satisfiedCount === report.total
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
] as const

/**
 * Where a document's file lives: {couple_id}/{owner_id}/{document_id}/{name}.
 *
 * The first two segments are what the storage policies read, so the shape is
 * load-bearing — changing it means changing the policies with it.
 */
export function storagePath(
  coupleId: string,
  ownerId: string,
  documentId: string,
  fileName: string,
): string {
  return `${coupleId}/${ownerId}/${documentId}/${sanitiseFileName(fileName)}`
}

/**
 * Strip anything that would confuse a path or a Content-Disposition header.
 * Keeps the extension, which the viewer uses to decide how to render.
 */
export function sanitiseFileName(name: string): string {
  const trimmed = name.trim().slice(-120)
  const cleaned = trimmed
    .replace(/[/\\]/g, '-')
    .replace(/[^\w.\- ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
  return cleaned || 'document'
}

/** The last four digits of whatever the user typed. Never store more. */
export function lastFour(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits ? digits.slice(-4) : null
}

/** "•••• 1234", for a viewer that must never show the whole number. */
export function maskNumber(last4: string | null): string | null {
  return last4 ? `•••• ${last4}` : null
}

export function isImage(mimeType: string | null | undefined): boolean {
  return Boolean(mimeType?.startsWith('image/'))
}

export function isPdf(mimeType: string | null | undefined): boolean {
  return mimeType === 'application/pdf'
}

/** Human file size. Sizes here are small, so one decimal is plenty. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// The expiry sweep
// ---------------------------------------------------------------------------

/** Thresholds the daily sweep alerts on, widest first. */
export const ALERT_THRESHOLDS = ['12mo', '9mo', '6mo', '3mo', '1mo', 'expired'] as const
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number]

/**
 * Which threshold a document has crossed, or null if none.
 *
 * Passports get the 9-month band; nothing else does, because for anything else
 * nine months is simply not interesting.
 */
export function crossedThreshold(
  expiresOn: DateOnly | null,
  today: DateOnly,
  isPassport: boolean,
): AlertThreshold | null {
  if (!expiresOn) return null
  if (expiresOn < today) return 'expired'

  const months = monthsUntil(expiresOn, today)
  if (months < 1) return '1mo'
  if (months < 3) return '3mo'
  if (months < 6) return '6mo'
  if (isPassport && months < 9) return '9mo'
  if (months < 12) return '12mo'
  return null
}

/**
 * Whether to alert, given what the owner was last told.
 *
 * Only fires when the document has crossed into a *narrower* band than last
 * time, so the 6-month alert lands once rather than every morning for three
 * months (spec 8.4).
 */
export function shouldAlert(
  current: AlertThreshold | null,
  lastAlerted: string | null,
): boolean {
  if (!current) return false
  if (!lastAlerted) return true

  const currentIndex = ALERT_THRESHOLDS.indexOf(current)
  const lastIndex = ALERT_THRESHOLDS.indexOf(lastAlerted as AlertThreshold)
  if (lastIndex === -1) return true
  return currentIndex > lastIndex
}
