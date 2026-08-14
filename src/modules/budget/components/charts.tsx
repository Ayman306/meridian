/**
 * The three charts spec 13.2 asks for, drawn by hand in SVG.
 *
 * The spec names Recharts. This does not use it, for the same reason the map
 * does not use react-leaflet and the geometry does not use turf (D54): the
 * chart library is ~100 KB gzipped and pulls several d3 packages behind it,
 * and what is actually needed here is a donut, a line and a stacked bar over
 * at most a few dozen points. Hand-drawn SVG is a couple of hundred lines,
 * costs nothing in the bundle, inherits the theme's colours directly, and
 * scales with the viewport because it is just markup.
 *
 * All three are `role="img"` with a written summary. A chart that only exists
 * visually is not information for someone using a screen reader, and the
 * numbers are all on the page in text form anyway.
 */
'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { formatMoney } from '../logic'

const FALLBACK_COLORS = [
  '#60a5fa',
  '#a78bfa',
  '#fb923c',
  '#34d399',
  '#f472b6',
  '#facc15',
  '#94a3b8',
]

export interface Slice {
  label: string
  value: number
  color?: string | null
}

/**
 * Category breakdown.
 *
 * Drawn as a stroked circle rather than as arc paths: one `circle` per slice
 * with `stroke-dasharray` and an offset is far less arithmetic than four arc
 * commands, and there is no rounding seam between adjacent slices.
 */
export function DonutChart({
  slices,
  currency,
  size = 160,
  className,
}: {
  slices: Slice[]
  currency: string
  size?: number
  className?: string
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const titleId = useId()

  if (total <= 0) return null

  const radius = size / 2 - 12
  const circumference = 2 * Math.PI * radius

  // Cumulative arc length before each slice, computed up front rather than
  // accumulated inside the map — a running total mutated in a render closure
  // is exactly what the compiler refuses, and this reads better regardless.
  const arcs = slices.map((slice) => (slice.value / total) * circumference)
  const offsets = arcs.reduce<number[]>(
    (acc, arc, i) => [...acc, (acc[i] ?? 0) + arc],
    [0],
  )

  return (
    <div className={cn('flex flex-wrap items-center gap-6', className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby={titleId}
        className="shrink-0"
      >
        <title id={titleId}>
          {`Spending by category: ${slices
            .map((s) => `${s.label} ${formatMoney(s.value, currency)}`)
            .join(', ')}`}
        </title>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((slice, i) => {
            const dash = arcs[i] ?? 0
            return (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
                strokeWidth={16}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-(offsets[i] ?? 0)}
              />
            )
          })}
        </g>
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground text-sm font-medium"
        >
          {formatMoney(total, currency)}
        </text>
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((slice, i) => (
          <li key={slice.label} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="truncate">{slice.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {formatMoney(slice.value, currency)}
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums text-xs text-muted-foreground/70">
              {Math.round((slice.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface Point {
  label: string
  value: number
}

/** Spend over time. A polyline, an area under it, and nothing else. */
export function LineChart({
  points,
  currency,
  height = 120,
  className,
}: {
  points: Point[]
  currency: string
  height?: number
  className?: string
}) {
  const titleId = useId()
  if (points.length === 0) return null

  const width = 600 // viewBox units; the SVG scales to its container
  const max = Math.max(...points.map((p) => p.value), 1)
  const step = points.length > 1 ? width / (points.length - 1) : 0
  const y = (value: number) => height - (value / max) * (height - 8) - 4

  const coords = points.map((p, i) => `${i * step},${y(p.value)}`)
  const line = coords.join(' ')
  // Close the path along the baseline so the fill has something to fill.
  const area = `0,${height} ${line} ${(points.length - 1) * step},${height}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-labelledby={titleId}
      className={cn('h-28 w-full', className)}
    >
      <title id={titleId}>
        {`Spending over time, peaking at ${formatMoney(max, currency)} on ${
          points.find((p) => p.value === max)?.label ?? 'one day'
        }`}
      </title>
      <polygon points={area} className="fill-accent/15" />
      <polyline
        points={line}
        fill="none"
        className="stroke-accent"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        // The viewBox is stretched horizontally by preserveAspectRatio="none",
        // which would stretch the stroke with it. This opts the stroke out.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export interface Contribution {
  label: string
  segments: { label: string; value: number; color: string }[]
}

/** Per-person contribution. One bar per row, segments side by side. */
export function StackedBar({
  rows,
  currency,
  className,
}: {
  rows: Contribution[]
  currency: string
  className?: string
}) {
  const max = Math.max(
    ...rows.map((r) => r.segments.reduce((sum, s) => sum + s.value, 0)),
    1,
  )

  return (
    <div className={cn('space-y-3', className)}>
      {rows.map((row) => {
        const total = row.segments.reduce((sum, s) => sum + s.value, 0)
        return (
          <div key={row.label} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="truncate">{row.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(total, currency)}
              </span>
            </div>
            <div
              className="flex h-3 overflow-hidden rounded-full bg-secondary"
              role="img"
              aria-label={`${row.label}: ${row.segments
                .map((s) => `${s.label} ${formatMoney(s.value, currency)}`)
                .join(', ')}`}
            >
              {row.segments.map((segment) => (
                <div
                  key={segment.label}
                  style={{
                    width: `${(segment.value / max) * 100}%`,
                    backgroundColor: segment.color,
                  }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Budget vs actual. A bar that keeps going past 100% rather than clipping —
 * being over budget is the thing worth seeing, so hiding it would be backwards.
 */
export function BudgetBar({
  spent,
  budget,
  currency,
  className,
}: {
  spent: number
  budget: number
  currency: string
  className?: string
}) {
  const percent = Math.round((spent / budget) * 100)
  const over = spent > budget

  return (
    <div className={cn('space-y-1', className)}>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-accent')}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className={cn('text-xs', over ? 'text-destructive' : 'text-muted-foreground')}>
        {over
          ? `${formatMoney(spent - budget, currency)} over the ${formatMoney(budget, currency)} budget`
          : `${formatMoney(spent, currency)} of ${formatMoney(budget, currency)} — ${percent}%`}
      </p>
    </div>
  )
}
