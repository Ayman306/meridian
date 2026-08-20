/**
 * Subscribing to a couple's own rows, once, instead of six times.
 *
 * Six modules grew their own realtime hook, each repeating the same channel
 * lifecycle: build, subscribe, remove on unmount, and get the dependency array
 * right so a re-render does not tear the socket down and rebuild it. That last
 * part is the one worth centralising — a subscription recreated on every render
 * looks like it works, because it does, right up until it is the reason the tab
 * is warm and the battery is flat.
 *
 * ## Why the filter is a courtesy rather than the control
 *
 * `filter: couple_id=eq.…` narrows what the server bothers to send. It is not
 * what makes it safe: Realtime honours RLS, so a row this couple may not read
 * never arrives regardless. Tables with no `couple_id` of their own are
 * therefore subscribed unfiltered — their policy has already decided.
 */
'use client'

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'

export interface RealtimeTable {
  table: string
  /**
   * Column to filter on, when the table has one worth filtering by. Omitted
   * for tables whose access is decided by a join in their policy instead.
   */
  filterColumn?: string
}

/**
 * Re-run `onChange` whenever any of these tables changes for this couple.
 *
 * `onChange` is read through a ref rather than depended on, so a caller may
 * pass an inline arrow function — which is what every caller wants to do —
 * without rebuilding the channel on every render.
 */
export function useCoupleRealtime(
  channelName: string,
  coupleId: string | null | undefined,
  tables: readonly RealtimeTable[],
  onChange: () => void,
): void {
  const latest = useRef(onChange)
  // Written in an effect, not during render: a render may run twice and React
  // is entitled to discard the work of one of them.
  useEffect(() => {
    latest.current = onChange
  })

  // Serialised so the effect depends on the *contents* of the array rather than
  // its identity. A caller writing `[{ table: 'documents' }]` inline would
  // otherwise hand us a fresh array every render, and a fresh socket with it.
  const key = JSON.stringify(tables)

  useEffect(() => {
    if (!coupleId) return

    const parsed = JSON.parse(key) as RealtimeTable[]
    let channel = supabase.channel(`${channelName}:${coupleId}`)

    for (const { table, filterColumn } of parsed) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          ...(filterColumn ? { filter: `${filterColumn}=eq.${coupleId}` } : {}),
        },
        () => latest.current(),
      )
    }

    channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [channelName, coupleId, key])
}
