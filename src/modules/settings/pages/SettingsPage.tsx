/**
 * Everything configurable. Spec Module 14.
 *
 * Sectioned rather than tabbed: these are settings, not a workflow, and a page
 * you can scroll and search with the browser's own find beats one that hides
 * two thirds of itself behind tabs.
 */
'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PageLoading } from '@/components/common/states'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCouple } from '@/providers/CoupleProvider'
import { useAuth } from '@/providers/AuthProvider'
import { useAccess } from '@/providers/AccessProvider'
import { useTheme } from '@/providers/ThemeProvider'
import { CurrencyPicker } from '@/modules/budget'
import { useLeaveCouple, useUpdateProfile } from '@/modules/auth'
import { AccessPanel } from '../components/AccessPanel'
import { useCoupleSettings, useUpdateCoupleSettings, useUpdateUserSettings, useUserSettings } from '../hooks'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function SettingsPage() {
  const router = useRouter()
  const { couple, self, selfRef, partnerRef, isSolo } = useCouple()
  const { signOut } = useAuth()
  const { isOwning } = useAccess()
  const { theme, setTheme } = useTheme()

  const coupleSettings = useCoupleSettings()
  const userSettings = useUserSettings()
  const updateCouple = useUpdateCoupleSettings()
  const updateUser = useUpdateUserSettings()
  const leave = useLeaveCouple()
  const updateProfile = useUpdateProfile()

  const [leaving, setLeaving] = useState(false)

  if (coupleSettings.isLoading || userSettings.isLoading) return <PageLoading label="Settings" />

  const cs = coupleSettings.data
  const us = userSettings.data

  return (
    <div className="space-y-6 pb-12">
      <PageHeader title="Settings" description="Yours, and the two of yours." />

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Access
        </h2>
        {isSolo ? (
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">
              You are on your own so far. Pair with someone to share any of this.
            </p>
            <Button className="mt-3" onClick={() => router.push('/pair')}>
              Pair up
            </Button>
          </Card>
        ) : (
          <AccessPanel canManage={isOwning} />
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Shared preferences
        </h2>
        <Card className="space-y-4 p-5">
          {!isOwning && (
            <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              These belong to the couple, so only they can change them.
            </p>
          )}

          <CurrencyPicker
            label="Base currency"
            id="base-currency"
            value={cs?.base_currency ?? 'USD'}
            suggested={[cs?.base_currency]}
            onChange={(code) => isOwning && updateCouple.mutate({ base_currency: code })}
          />
          <p className="-mt-1 text-xs text-muted-foreground">
            Every balance is totalled in this. Changing it does not rewrite past expenses — each
            one keeps the rate it was saved at, which is the point of storing it.
          </p>

          <Row label="Distance">
            <Choice
              value={cs?.distance_unit ?? 'km'}
              options={[
                { value: 'km', label: 'Kilometres' },
                { value: 'mi', label: 'Miles' },
              ]}
              disabled={!isOwning}
              onChange={(v) => updateCouple.mutate({ distance_unit: v })}
            />
          </Row>

          <Row label="Week starts on">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={cs?.week_starts_on ?? 1}
              disabled={!isOwning}
              onChange={(e) => updateCouple.mutate({ week_starts_on: Number(e.target.value) })}
            >
              {WEEKDAYS.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </Row>

          <Row
            label="Long stay begins at"
            hint="Above this, a blank day is the point of the trip rather than a gap to fill."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={60}
                className="w-20"
                disabled={!isOwning}
                defaultValue={cs?.long_stay_threshold ?? 5}
                onBlur={(e) => {
                  const value = Number(e.target.value)
                  if (value >= 1 && value <= 60) {
                    updateCouple.mutate({ long_stay_threshold: value })
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">nights</span>
            </div>
          </Row>

          <Toggle
            label="Departure countdown"
            hint="Off by default. A timer counting down to goodbye is not what everyone wants on their home screen."
            checked={cs?.show_departure_countdown ?? false}
            disabled={!isOwning}
            onChange={(v) => updateCouple.mutate({ show_departure_countdown: v })}
          />

          <Toggle
            label="Require insurance on every trip"
            checked={cs?.require_insurance ?? false}
            disabled={!isOwning}
            onChange={(v) => updateCouple.mutate({ require_insurance: v })}
          />

          <Toggle
            label="AI suggestions"
            hint="Off by default, and the app is built to work with it off. Nothing it produces is inserted without you keeping it."
            checked={cs?.ai_enabled ?? false}
            disabled={!isOwning}
            onChange={(v) => updateCouple.mutate({ ai_enabled: v })}
          />
        </Card>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Yours only
        </h2>
        <Card className="space-y-4 p-5">
          <Row
            label="Gender"
            hint="Sets whether cycle tracking appears. You can override that below either way."
          >
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={self?.gender ?? ''}
              aria-label="Gender"
              onChange={(e) =>
                updateProfile.mutate({ gender: e.target.value || null })
              }
            >
              <option value="">Not said</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </Row>

          <Row
            label="Track my cycle"
            hint="On by default if you said female. Your choice here always wins — nobody should have this decided for them."
          >
            <Choice
              value={self?.tracks_cycle === null || self?.tracks_cycle === undefined ? 'default' : self.tracks_cycle ? 'on' : 'off'}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              onChange={(v) =>
                updateProfile.mutate({
                  tracks_cycle: v === 'default' ? null : v === 'on',
                })
              }
            />
          </Row>

          <Row label="Theme">
            <Choice
              value={theme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={(v) => {
                setTheme(v as 'system' | 'light' | 'dark')
                updateUser.mutate({ theme: v })
              }}
            />
          </Row>

          <Row
            label="Work hours"
            hint="Feeds the work-day overlay on the itinerary, so neither of you plans a lunch through the other's stand-up."
          >
            <div className="flex items-center gap-2">
              <Input
                type="time"
                className="w-32"
                defaultValue={us?.work_hours_start ?? ''}
                aria-label="Work day starts"
                onBlur={(e) => updateUser.mutate({ work_hours_start: e.target.value || null })}
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="time"
                className="w-32"
                defaultValue={us?.work_hours_end ?? ''}
                aria-label="Work day ends"
                onBlur={(e) => updateUser.mutate({ work_hours_end: e.target.value || null })}
              />
            </div>
          </Row>

          <Row
            label="Lock the vault after"
            hint="Documents ask for a fresh sign-in once you have been idle this long. Zero turns it off."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={240}
                className="w-20"
                defaultValue={us?.vault_lock_minutes ?? 15}
                onBlur={(e) => {
                  const value = Number(e.target.value)
                  if (value >= 0 && value <= 240) {
                    updateUser.mutate({ vault_lock_minutes: value })
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          </Row>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Notify me about</p>
            <Toggle
              label="Flights"
              checked={us?.notify_flights ?? true}
              onChange={(v) => updateUser.mutate({ notify_flights: v })}
            />
            <Toggle
              label="Documents expiring"
              checked={us?.notify_documents ?? true}
              onChange={(v) => updateUser.mutate({ notify_documents: v })}
            />
            <Toggle
              label="Stay allowance"
              checked={us?.notify_allowance ?? true}
              onChange={(v) => updateUser.mutate({ notify_allowance: v })}
            />
            <Toggle
              label="The daily photo"
              checked={us?.notify_daily_exchange ?? false}
              onChange={(v) => updateUser.mutate({ notify_daily_exchange: v })}
            />
            <p className="pt-1 text-xs text-muted-foreground">
              Nothing is sent yet — there is no push channel wired up. These are recorded so they
              are yours from the day there is.
            </p>
          </div>
        </Card>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Account
        </h2>
        <Card className="space-y-3 p-5">
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>

          {!isSolo && (
            <div className="border-t border-border pt-3">
              <Button variant="destructive" onClick={() => setLeaving(true)}>
                Leave {couple?.name ?? 'this couple'}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                You stop seeing everything shared. Nothing is deleted —{' '}
                {partnerRef?.displayName ?? 'the other person'} keeps it all.
              </p>
            </div>
          )}
        </Card>
      </section>

      <ConfirmDialog
        open={leaving}
        title={`Leave ${couple?.name ?? 'this couple'}?`}
        description={`Every trip, photo, document and expense stops being visible to you. ${
          partnerRef?.displayName ?? 'The other person'
        } keeps all of it. This cannot be undone from here — you would need a new invite.`}
        confirmLabel="Leave"
        typeToConfirm={selfRef?.displayName ? 'LEAVE' : undefined}
        destructive
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          leave.mutate(undefined, { onSuccess: () => router.push('/pair') })
          setLeaving(false)
        }}
      />
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="max-w-md text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Choice({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex gap-1 rounded-md border border-input p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          className={`rounded px-3 py-1.5 text-sm ${
            value === option.value ? 'bg-secondary font-medium' : 'text-muted-foreground'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block max-w-md text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
