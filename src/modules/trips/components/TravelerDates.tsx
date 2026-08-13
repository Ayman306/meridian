/**
 * Each partner sets their own arrival and departure. The overlap between them
 * is the number that actually matters, so it's stated plainly.
 */
import { useState } from 'react'
import { PersonBadge } from '@/components/PersonBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { useCouple } from '@/providers/CoupleProvider'
import { pluralise } from '@/lib/utils'
import type { DateOnly } from '@/lib/dates'
import { togetherWindow } from '../logic'
import { useSetTravelerDates } from '../hooks'
import type { TripDetail } from '../types'

export function TravelerDates({ trip }: { trip: TripDetail }) {
  const { selfRef, partnerRef } = useCouple()
  const together = togetherWindow(trip, trip.travelers)
  const people = [selfRef, partnerRef].filter((p) => p !== null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Who&apos;s there when</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {people.map((person) => (
          <TravelerRow
            key={person.id}
            trip={trip}
            personId={person.id}
            editable={person.isSelf}
            label={person.isSelf ? 'You' : person.displayName}
            badge={person}
          />
        ))}

        <div className="rounded-md bg-secondary px-3 py-2 text-sm">
          {together.incomplete ? (
            <span className="text-muted-foreground">
              Set both sets of dates to see your overlap.
            </span>
          ) : together.overlaps ? (
            <span>
              <strong className="font-medium">{pluralise(together.nights, 'night')}</strong>{' '}
              together{together.start && together.end ? `, ${together.start} → ${together.end}` : ''}
            </span>
          ) : (
            <span className="text-[hsl(var(--warn))]">
              These dates don&apos;t overlap at all — one of you leaves before the other lands.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function TravelerRow({
  trip,
  personId,
  editable,
  label,
  badge,
}: {
  trip: TripDetail
  personId: string
  editable: boolean
  label: string
  badge: Parameters<typeof PersonBadge>[0]['person']
}) {
  const traveler = trip.travelers.find((t) => t.user_id === personId)
  const save = useSetTravelerDates(trip.id)
  const [editing, setEditing] = useState(false)
  const [arrival, setArrival] = useState<string>(traveler?.arrival_date ?? trip.start_date ?? '')
  const [departure, setDeparture] = useState<string>(
    traveler?.departure_date ?? trip.end_date ?? '',
  )

  const onSave = async () => {
    await save.mutateAsync({
      userId: personId,
      arrival_date: (arrival || null) as DateOnly | null,
      departure_date: (departure || null) as DateOnly | null,
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="flex items-center gap-2">
          <PersonBadge person={badge} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Arrives" htmlFor={`arr-${personId}`}>
            <Input
              id={`arr-${personId}`}
              type="date"
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
            />
          </Field>
          <Field label="Leaves" htmlFor={`dep-${personId}`}>
            <Input
              id={`dep-${personId}`}
              type="date"
              value={departure}
              min={arrival || undefined}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void onSave()} disabled={save.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  const arr = traveler?.arrival_date ?? trip.start_date
  const dep = traveler?.departure_date ?? trip.end_date
  const inherited = !traveler?.arrival_date && !traveler?.departure_date

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <PersonBadge person={badge} />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {arr && dep ? `${arr} → ${dep}` : 'No dates'}
          {inherited && arr && <span className="ml-1.5 text-xs">(trip dates)</span>}
        </span>
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    </div>
  )
}
