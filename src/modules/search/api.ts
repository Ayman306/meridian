'use client'

import { supabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/errors'
import type { SearchResult } from './types'
import type { ResultKind } from './types'

/**
 * One round trip for everything.
 *
 * The alternative — eight queries fanned out from the client — would be eight
 * round trips, eight sets of ranking to reconcile in JavaScript, and a result
 * list that arrives in pieces. The database is the only place that can rank
 * across tables in one pass.
 */
export async function searchEverything(query: string, limit = 30): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('search_everything', {
    q: query.trim(),
    max_results: limit,
  })
  if (error) throw toAppError(error)

  return (data ?? []).map((row) => ({
    kind: row.kind as ResultKind,
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    tripId: row.trip_id,
    occurred: row.occurred,
    rank: row.rank,
  }))
}
