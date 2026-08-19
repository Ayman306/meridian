/**
 * POST /api/cron/document-sweep — tell people before a document expires.
 *
 * `crossedThreshold` and `shouldAlert` have been written and tested since
 * Phase 4 with nothing calling them, because there was no notification channel
 * yet. There is now, so this is the last piece.
 *
 * ## The rule that makes this bearable to receive
 *
 * `shouldAlert` only fires when a document has crossed into a *narrower* band
 * than the one its owner was last told about. Without that, the six-month
 * warning would arrive every morning for three months and be muted inside a
 * week — which is how a warning that matters gets ignored along with the rest.
 * `last_alerted_threshold` is written back on every send, and it is the only
 * thing making this idempotent, so it is written even when the push itself
 * fails to deliver.
 *
 * ## Why only the owner
 *
 * A document is owner-private unless shared, and an expiry date is a fact
 * about the owner's paperwork. The partner gets nothing here even for a shared
 * document: the person who has to renew it is the one who needs telling, and
 * telling both is how one of them assumes the other is handling it.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase/server'
import { assertCronRequest } from '@/lib/cron'
import { toAppError } from '@/lib/errors'
import { sendPushTo } from '@/lib/push/server'
import { crossedThreshold, shouldAlert } from '@/modules/documents/logic'

export const dynamic = 'force-dynamic'

/** Wording per band. Plain, and never more alarming than the fact. */
const HEADLINE: Record<string, string> = {
  expired: 'has expired',
  '1mo': 'expires within a month',
  '3mo': 'expires within three months',
  '6mo': 'expires within six months',
  '9mo': 'expires within nine months',
  '12mo': 'expires within a year',
}

export async function POST(request: Request) {
  try {
    assertCronRequest(request)
  } catch (e) {
    return NextResponse.json({ error: toAppError(e).message }, { status: 401 })
  }

  const admin = createAdminSupabase()

  // Only documents that have an expiry to cross. A document with no date is
  // not "expiring soon", it is unrecorded, and inventing an alert for it would
  // train people to distrust the ones that are real.
  const { data, error } = await admin
    .from('documents')
    .select('id, owner_id, label, expires_on, last_alerted_threshold, type:document_types(name)')
    .is('deleted_at', null)
    .not('expires_on', 'is', null)

  if (error) {
    console.error('document sweep: could not list documents', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // UTC, and stated as a choice: a sweep that runs once a day cannot honour
  // sixteen timezones, and a document is a calendar fact rather than an
  // instant. Worst case somebody is told a few hours early.
  const today = new Date().toISOString().slice(0, 10)

  let alerted = 0
  let skipped = 0

  for (const doc of data ?? []) {
    const isPassport = (doc.type as { name?: string } | null)?.name === 'Passport'
    const threshold = crossedThreshold(doc.expires_on, today, isPassport)

    if (!shouldAlert(threshold, doc.last_alerted_threshold)) {
      skipped += 1
      continue
    }

    // Written before the send, and unconditionally. If the push fails, the
    // right outcome is one missed notification — not the same one every
    // morning until it succeeds.
    const { error: markError } = await admin
      .from('documents')
      .update({ last_alerted_threshold: threshold })
      .eq('id', doc.id)

    if (markError) {
      console.error('document sweep: could not record the threshold', markError.message)
      continue
    }

    // Whether this person wanted document notifications is decided inside
    // sendPushTo against their own `notify_documents`, so this does not ask.
    await sendPushTo(doc.owner_id, 'documents', {
      title: `${doc.label} ${HEADLINE[threshold!] ?? 'is expiring'}`,
      body:
        threshold === 'expired'
          ? `It expired on ${doc.expires_on}.`
          : `It expires on ${doc.expires_on}. Renewals take longer than you think.`,
      url: '/documents',
      tag: `document-${doc.id}`,
    })

    alerted += 1
  }

  return NextResponse.json({ ok: true, alerted, skipped })
}
