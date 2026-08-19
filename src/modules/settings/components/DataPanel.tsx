/**
 * Export everything, and delete the account. Spec 14.2, "Data".
 *
 * ## The export is a client-side read, on purpose
 *
 * It fetches through the ordinary browser client, which means RLS decides what
 * lands in the file. An export built server-side with the service role would
 * have to reimplement every policy in the app to avoid handing somebody rows
 * they cannot see on screen — and would be wrong the first time a policy
 * changed and the export did not.
 *
 * So: whatever you can read, you can export. Nothing more, by construction
 * rather than by care.
 *
 * ## What the file is
 *
 * JSON, not a zip of CSVs. The data is relational and deeply nested; flattening
 * it into sheets loses the joins, which are most of what makes it worth having.
 * Photos are listed as rows with their metadata and not embedded — a gigabyte
 * of base64 in a text file helps nobody, and the gallery's bulk download exists
 * for the files themselves.
 */
'use client'

import { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState } from '@/components/common/states'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/providers/AuthProvider'
import { useCouple } from '@/providers/CoupleProvider'

/**
 * Every table worth carrying out, and what it is keyed on.
 *
 * Listed explicitly rather than discovered, so adding a table is a deliberate
 * decision about whether it belongs in an export — reference tables like
 * `airports` and `visa_rules` do not, because they are not the couple's data.
 */
const COUPLE_TABLES = [
  'trips',
  'trip_days',
  'trip_travelers',
  'trip_destinations',
  'itinerary_items',
  'accommodations',
  'wishlist_items',
  'wishlist_verdicts',
  'flights',
  'journeys',
  'documents',
  'expenses',
  'settlements',
  'budgets',
  'media',
  'albums',
  'media_comments',
  'entry_exit_log',
  'categories',
  'expense_categories',
  'document_types',
  'trip_statuses',
] as const

/** Owner-keyed, and therefore only ever this person's own. */
const OWN_TABLES = ['cycle_logs', 'health_records', 'health_consents'] as const

export function DataPanel() {
  const { user, signOut } = useAuth()
  const { coupleId } = useCouple()
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [confirming, setConfirming] = useState(false)

  async function exportEverything() {
    setBusy('export')
    setError(null)
    try {
      const data: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        note: 'Everything this account can read, as the database returned it. Photo files are not included — use Download all in the gallery for those.',
      }

      // Sequential rather than parallel: two dozen requests at once against a
      // free-tier project is how an export gets rate-limited halfway through
      // and produces a file that looks complete and is not.
      for (const table of COUPLE_TABLES) {
        const { data: rows, error: tableError } = await supabase.from(table).select('*')
        // A table that refuses is recorded as refusing rather than omitted, so
        // nobody reads a missing key as "we had nothing there".
        data[table] = tableError ? { error: tableError.message } : rows
      }
      for (const table of OWN_TABLES) {
        const { data: rows, error: tableError } = await supabase.from(table).select('*')
        data[table] = tableError ? { error: tableError.message } : rows
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `meridian-export-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  async function deleteAccount() {
    setBusy('delete')
    setError(null)
    try {
      const response = await fetch('/api/account/delete', { method: 'POST' })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'That did not work.')
      }
      await signOut()
    } catch (e) {
      setError(e)
      setBusy(null)
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Take a copy</p>
        <p className="text-xs text-muted-foreground">
          Everything this account can read, as JSON. Photo files are not in it — the gallery&rsquo;s
          Download all is for those.
        </p>
        <Button variant="outline" disabled={busy !== null || !coupleId} onClick={exportEverything}>
          <Download aria-hidden="true" />
          {busy === 'export' ? 'Gathering…' : 'Export everything'}
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-sm font-medium">Delete this account</p>
        <p className="text-xs text-muted-foreground">
          Your sign-in, your profile, your documents and your health records go for good. Trips,
          photos and expenses belong to both of you and stay with your partner — deleting their
          copy is not something you can do from here.
        </p>
        <Button variant="destructive" disabled={busy !== null} onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden="true" />
          Delete my account
        </Button>
      </div>

      {error ? <ErrorState error={error} title="That did not work" /> : null}

      <ConfirmDialog
        open={confirming}
        title="Delete your account?"
        description={`This cannot be undone. ${user?.email ?? 'Your sign-in'}, your profile, your documents and anything health-related are erased. Shared trips, photos and expenses stay with your partner. Take an export first if you want a copy.`}
        confirmLabel="Delete for good"
        typeToConfirm="DELETE"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void deleteAccount()
        }}
      />
    </Card>
  )
}
