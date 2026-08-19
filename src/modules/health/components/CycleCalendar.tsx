/**
 * The cycle as a month grid, and the one place it can be edited.
 *
 * Four things are drawn, and they must stay visually distinct because
 * confusing two of them gives somebody a wrong answer about their own body:
 *
 *   - a **logged** period — solid. It happened.
 *   - a **projected** period — outlined and dashed. It has not.
 *   - the **fertile window** — a tint behind the day.
 *   - **ovulation** — a dot, filled when she recorded it and hollow when the
 *     app worked it out.
 *
 * Solid versus dashed is doing the real work. Spec 12.7 says an estimate is
 * never rendered as a fact, and on a calendar that rule is mostly about
 * borders: a filled square and an outlined one read as different kinds of claim
 * before any legend is consulted, which is what a glance needs.
 *
 * Editing lives here rather than in a separate form because the calendar is
 * where the mistake is noticed. Tapping the day a period actually started is a
 * more direct way to say so than finding a date field and typing it, and
 * correcting a projection is the same gesture as logging a new one — which is
 * the point: a correction is not a special case, it is just the truth arriving
 * later.
 *
 * Nothing here celebrates anything (spec 12.6). No streaks, no "best month", no
 * green ticks. Colour indicates category, never approval.
 */
'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { parseDateOnly, todayIn, type DateOnly } from '@/lib/dates'
import { useCouple } from '@/providers/CoupleProvider'
import {
  FERTILITY_DISCLAIMER,
  calendarMarks,
  describeProjectedCycle,
  monthGrid,
  monthOf,
  predictCycles,
  shiftMonth,
} from '../logic'
import type { CycleLog, DayMark } from '../types'

const WEEKDAYS_FROM_MONDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAYS_FROM_SUNDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** How many cycles ahead the calendar projects. Three months is what fits. */
const PROJECT_AHEAD = 3

export interface CycleCalendarProps {
  /** The logged cycles. Facts, not projections. */
  cycles: CycleLog[]
  /** The partner's view: everything visible, nothing editable. */
  readOnly?: boolean
  onLogStart?: (date: DateOnly) => void
  onSetEnd?: (log: CycleLog, date: DateOnly) => void
  onSetOvulation?: (log: CycleLog, date: DateOnly) => void
  /** Correcting the day a logged period actually began. */
  onSetStart?: (log: CycleLog, date: DateOnly) => void
  onRemove?: (log: CycleLog) => void
  weekStartsOn?: number
}

export function CycleCalendar({
  cycles,
  readOnly = false,
  onLogStart,
  onSetEnd,
  onSetOvulation,
  onSetStart,
  onRemove,
  weekStartsOn = 1,
}: CycleCalendarProps) {
  const { tzSelf } = useCouple()
  const today = todayIn(tzSelf)

  const [month, setMonth] = useState<DateOnly>(() => monthOf(today))
  const [selected, setSelected] = useState<DateOnly | null>(null)

  const days = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn])

  // Projections are recomputed from the logs on every change, so correcting a
  // date immediately redraws everything that followed from it.
  const projected = useMemo(() => predictCycles(cycles, PROJECT_AHEAD, today), [cycles, today])

  // Marks cover the whole visible grid, neighbouring days included — otherwise
  // a period straddling a month boundary vanishes halfway across the screen.
  const marks = useMemo(
    () => calendarMarks(cycles, projected, days[0]!, days[days.length - 1]!),
    [cycles, projected, days],
  )

  const monthIndex = parseDateOnly(month).getMonth()
  const year = parseDateOnly(month).getFullYear()
  const weekdays = weekStartsOn === 0 ? WEEKDAYS_FROM_SUNDAY : WEEKDAYS_FROM_MONDAY

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>

        <p className="text-sm font-medium" aria-live="polite">
          {MONTH_NAMES[monthIndex]} {year}
        </p>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Cycle calendar">
        {weekdays.map((label) => (
          <div
            key={label}
            role="columnheader"
            className="pb-1 text-center text-[11px] font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}

        {days.map((date) => (
          <DayCell
            key={date}
            date={date}
            mark={marks.get(date)}
            inMonth={parseDateOnly(date).getMonth() === monthIndex}
            isToday={date === today}
            isSelected={date === selected}
            interactive={!readOnly}
            onSelect={() => setSelected(date === selected ? null : date)}
          />
        ))}
      </div>

      <Legend />

      {!readOnly && selected && (
        <DayEditor
          date={selected}
          mark={marks.get(selected)}
          logs={cycles}
          today={today}
          onClose={() => setSelected(null)}
          onLogStart={onLogStart}
          onSetEnd={onSetEnd}
          onSetOvulation={onSetOvulation}
          onSetStart={onSetStart}
          onRemove={onRemove}
        />
      )}

      {projected.length > 0 && (
        <div className="space-y-1 border-t border-border pt-3">
          <h4 className="text-xs font-medium">What is expected next</h4>
          <ul className="space-y-1">
            {projected.map((cycle) => (
              <li key={cycle.index} className="text-xs text-muted-foreground">
                {describeProjectedCycle(cycle)}
              </li>
            ))}
          </ul>
          <p className="pt-1 text-xs text-muted-foreground">{FERTILITY_DISCLAIMER}</p>
        </div>
      )}
    </Card>
  )
}

function DayCell({
  date,
  mark,
  inMonth,
  isToday,
  isSelected,
  interactive,
  onSelect,
}: {
  date: DateOnly
  mark: DayMark | undefined
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  interactive: boolean
  onSelect: () => void
}) {
  const day = Number(date.slice(8))

  // Built as a sentence rather than a code, so somebody using a screen reader
  // gets the same four facts a sighted person gets from the colours.
  const described: string[] = []
  if (mark?.period) described.push('period logged')
  if (mark?.predictedPeriod) described.push('period expected')
  if (mark?.fertile) described.push('in the estimated fertile window')
  if (mark?.ovulationObserved) described.push('ovulation recorded')
  else if (mark?.ovulation) described.push('ovulation estimated')
  if (isToday) described.push('today')

  return (
    <button
      type="button"
      role="gridcell"
      disabled={!interactive}
      aria-label={`${date}${described.length ? `, ${described.join(', ')}` : ''}`}
      aria-current={isToday ? 'date' : undefined}
      onClick={onSelect}
      className={cn(
        'relative flex aspect-square items-center justify-center rounded-md text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !inMonth && 'text-muted-foreground/40',
        interactive && 'hover:bg-secondary',
        // The fertile window is a wash behind everything, so it never competes
        // with the period marks drawn on top of it.
        mark?.fertile && 'bg-sky-500/15',
        // Logged: solid. It happened.
        mark?.period && 'bg-rose-500/85 text-white hover:bg-rose-500',
        // Projected: outlined and dashed. It has not.
        mark?.predictedPeriod && 'border-2 border-dashed border-rose-400/80',
        isSelected && 'ring-2 ring-accent',
        isToday && !isSelected && 'ring-1 ring-foreground/40',
      )}
    >
      <span className={cn(mark?.periodStart && 'font-semibold')}>{day}</span>

      {/* Ovulation is a dot under the number rather than another background:
          it routinely lands on a fertile day, and two backgrounds on one
          square is unreadable. */}
      {(mark?.ovulation || mark?.ovulationObserved) && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-1 size-1.5 rounded-full',
            mark.ovulationObserved
              ? 'bg-sky-600 dark:bg-sky-400'
              : 'border border-sky-600 dark:border-sky-400',
          )}
        />
      )}
    </button>
  )
}

/**
 * What can be done with the day that was tapped.
 *
 * The options are derived from what that day already is, so the panel never
 * offers something contradictory — no "end the period" on a day before it
 * started, no "start a period" in the middle of one already logged.
 */
function DayEditor({
  date,
  mark,
  logs,
  today,
  onClose,
  onLogStart,
  onSetEnd,
  onSetOvulation,
  onSetStart,
  onRemove,
}: {
  date: DateOnly
  mark: DayMark | undefined
  logs: CycleLog[]
  today: DateOnly
  onClose: () => void
  onLogStart?: (date: DateOnly) => void
  onSetEnd?: (log: CycleLog, date: DateOnly) => void
  onSetOvulation?: (log: CycleLog, date: DateOnly) => void
  onSetStart?: (log: CycleLog, date: DateOnly) => void
  onRemove?: (log: CycleLog) => void
}) {
  const containing = logs.find(
    (log) => date >= log.started_on && date <= (log.ended_on ?? log.started_on),
  )

  // The cycle an ovulation on this day would belong to: the most recent one
  // that had already started.
  const owning = [...logs]
    .filter((log) => log.started_on <= date)
    .sort((a, b) => a.started_on.localeCompare(b.started_on))
    .pop()

  const isFuture = date > today

  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{date}</p>
          <p className="text-xs text-muted-foreground">
            {mark?.period
              ? 'A period is logged on this day.'
              : mark?.predictedPeriod
                ? 'A period is expected around here. If it actually started today, say so and every later estimate moves with it.'
                : mark?.fertile
                  ? 'Inside the estimated fertile window.'
                  : 'Nothing recorded on this day.'}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Starting a period. Offered whenever this day is not already inside
            one — including on a projected day, which is exactly the correction
            case: the estimate said this week, and it actually began today. */}
        {!containing && !isFuture && onLogStart && (
          <Button
            size="sm"
            onClick={() => {
              onLogStart(date)
              onClose()
            }}
          >
            {mark?.predictedPeriod ? 'It started today' : 'Period started'}
          </Button>
        )}

        {/* Ending one. Only for a cycle that has started and has no end yet,
            and never before its own start. */}
        {owning && !owning.ended_on && date >= owning.started_on && !isFuture && onSetEnd && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onSetEnd(owning, date)
              onClose()
            }}
          >
            Period ended
          </Button>
        )}

        {owning && onSetOvulation && !isFuture && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onSetOvulation(owning, date)
              onClose()
            }}
          >
            Ovulation was today
          </Button>
        )}

        {containing && onRemove && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onRemove(containing)
              onClose()
            }}
          >
            Remove this cycle
          </Button>
        )}
      </div>

      {isFuture && (
        <p className="text-xs text-muted-foreground">
          This day has not happened yet, so there is nothing to record on it. The dashed squares are
          an estimate — come back when it arrives.
        </p>
      )}

      {owning?.ovulation_on === date && (
        <p className="text-xs text-muted-foreground">
          Ovulation is recorded on this day. The next estimate uses it instead of the default.
        </p>
      )}

      {/* Changing a start date by hand, for a period somebody logged on the
          wrong day. Tapping a square is faster, but only within the month on
          screen. */}
      {containing && onSetStart && (
        <div className="space-y-1 border-t border-border pt-2">
          <label htmlFor="correct-start" className="text-xs text-muted-foreground">
            This cycle started on
          </label>
          <Input
            id="correct-start"
            type="date"
            defaultValue={containing.started_on}
            max={today}
            onBlur={(e) => {
              const value = e.target.value
              // An edit to the same row, not a new cycle — moving a start date
              // must not leave the original behind as a duplicate.
              if (value && value !== containing.started_on) onSetStart(containing, value)
            }}
          />
          <p className="text-xs text-muted-foreground">
            Corrections feed forward — every estimate after this one is recomputed from it.
          </p>
        </div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded bg-rose-500/85" aria-hidden="true" />
        Period logged
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className="size-3 rounded border-2 border-dashed border-rose-400/80"
          aria-hidden="true"
        />
        Period expected
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-3 rounded bg-sky-500/15" aria-hidden="true" />
        Fertile window
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-sky-600 dark:bg-sky-400" aria-hidden="true" />
        Ovulation recorded
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className="size-1.5 rounded-full border border-sky-600 dark:border-sky-400"
          aria-hidden="true"
        />
        Ovulation estimated
      </li>
    </ul>
  )
}

/** Kept for the summary line above the history list. */
export function nextExpected(logs: CycleLog[], today: DateOnly): string | null {
  const [next] = predictCycles(logs, 1, today)
  return next ? describeProjectedCycle(next) : null
}
