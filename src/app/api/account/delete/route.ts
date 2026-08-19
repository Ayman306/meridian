/**
 * POST /api/account/delete — erase this account. Spec 14.2, "Data".
 *
 * The one irreversible action in the app, and the only Route Handler that
 * deletes a user, so the shape matters more than the length.
 *
 * ## What gets deleted, and what deliberately does not
 *
 * Deleting the `auth.users` row cascades to `profiles`, and from there to every
 * row keyed on the person: their cycle logs, their health records, their
 * documents, their access tokens, their push subscriptions, their membership.
 *
 * **Shared data survives, and that is not an oversight.** A trip, its
 * itinerary, its photos and its expenses belong to the couple. Erasing them
 * because one person left would delete the other person's memories along with
 * their own, which is not a right either of them has. `leave_couple` already
 * encodes exactly this, so the account deletion runs it first rather than
 * inventing a second answer to the same question.
 *
 * ## Why the caller is checked twice
 *
 * `requireUser()` reads the session cookie, and the id it returns is the only
 * id this handler will ever delete — it is never taken from the request body.
 * A handler that accepted a user id would be an authenticated user's ability to
 * delete anybody, which is the worst bug this file could have.
 *
 * The typed confirmation happens in the UI. It is not a security control and is
 * not treated as one here; it exists so nobody does this by accident.
 */
import { NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase, requireUser } from '@/lib/supabase/server'
import { toAppError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

export async function POST() {
  const user = await requireUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  try {
    // Leave first, as the user, so the couple's own rules decide what happens
    // to the membership and the shared rows. Running this with the service
    // role would bypass the very logic that protects the partner's copy.
    const asUser = await createServerSupabase()
    const { error: leaveError } = await asUser.rpc('leave_couple')
    // Not fatal: somebody who never paired has no couple to leave, and that
    // must not block them from deleting their account.
    if (leaveError && !/not.*member|no couple/i.test(leaveError.message)) {
      console.error('account delete: leave_couple failed', leaveError.message)
    }

    // Then the account itself. `user.id` comes from the verified session and
    // nowhere else.
    const admin = createAdminSupabase()
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) {
      return NextResponse.json({ error: toAppError(error).message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: toAppError(e).message }, { status: 500 })
  }
}
