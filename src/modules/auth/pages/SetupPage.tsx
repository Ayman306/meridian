/**
 * Profile setup, prompted once. Home city (geocoded, because distance depends
 * on it), timezone (auto-detected, editable), nationality (drives visa rules)
 * and accent colour (so whose-pick markers are legible).
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCouple } from '@/providers/CoupleProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { PageLoading } from '@/components/common/states'
import { useUpdateProfile } from '@/modules/auth/hooks'
import { profileSetupSchema, type ProfileSetupInput } from '@/modules/auth/schemas'
import { accentCollides } from '@/modules/auth/logic'
import { searchCity, type CityResult } from '@/lib/geocode'
import { detectTimezone } from '@/lib/dates'
import { ACCENT_COLORS, DEFAULT_ACCENT, type AccentColor } from '@/lib/constants'
import { userMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

const COMMON_ZONES = [
  'America/Toronto',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
]

export function SetupPage() {
  const router = useRouter()
  const { self, partner, isLoading } = useCouple()
  const update = useUpdateProfile()
  const detected = detectTimezone()

  const form = useForm<ProfileSetupInput>({
    resolver: zodResolver(profileSetupSchema),
    defaultValues: {
      display_name: '',
      home_city: '',
      home_country: '',
      home_lat: null,
      home_lng: null,
      timezone: detected,
      nationality: '',
      second_nationality: '',
      accent_color: DEFAULT_ACCENT,
    },
  })

  // Seed from the profile Google already populated, once it arrives.
  useEffect(() => {
    if (!self) return
    form.reset({
      display_name: self.display_name ?? '',
      home_city: self.home_city ?? '',
      home_country: self.home_country ?? '',
      home_lat: self.home_lat,
      home_lng: self.home_lng,
      timezone: self.timezone && self.timezone !== 'UTC' ? self.timezone : detected,
      nationality: self.nationality ?? '',
      second_nationality: self.second_nationality ?? '',
      accent_color: self.accent_color ?? DEFAULT_ACCENT,
    })
    // Intentionally keyed on identity only — we do not want to clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self?.id])

  if (isLoading) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <PageLoading />
      </main>
    )
  }

  const accent = form.watch('accent_color') as AccentColor
  const collision = accentCollides(
    self ? { ...self, accent_color: accent } : null,
    partner,
  )

  const onSubmit = form.handleSubmit(async (values) => {
    await update.mutateAsync({
      display_name: values.display_name,
      home_city: values.home_city,
      home_country: values.home_country || null,
      home_lat: values.home_lat ?? null,
      home_lng: values.home_lng ?? null,
      timezone: values.timezone,
      nationality: values.nationality || null,
      second_nationality: values.second_nationality || null,
      accent_color: values.accent_color,
      onboarded_at: new Date().toISOString(),
    })
    router.replace('/')
  })

  const zones = Array.from(new Set([detected, ...COMMON_ZONES])).sort()

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle>A few things about you</CardTitle>
          <CardDescription>
            Where you are, what time it is there, and which passport you travel on. You can change
            any of this later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="Name" error={form.formState.errors.display_name?.message} htmlFor="name">
              <Input id="name" {...form.register('display_name')} />
            </Field>

            <CitySearchField
              value={form.watch('home_city')}
              error={form.formState.errors.home_city?.message}
              onPick={(city) => {
                form.setValue('home_city', city.name, { shouldValidate: true })
                form.setValue('home_country', city.country ?? '')
                form.setValue('home_lat', city.lat)
                form.setValue('home_lng', city.lng)
                if (city.countryCode && !form.getValues('nationality')) {
                  form.setValue('nationality', city.countryCode)
                }
              }}
              onType={(text) => form.setValue('home_city', text, { shouldValidate: true })}
            />

            <Field
              label="Your timezone"
              hint={`Detected ${detected}. Change it if that's wrong.`}
              error={form.formState.errors.timezone?.message}
              htmlFor="tz"
            >
              <Select id="tz" {...form.register('timezone')}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Passport"
                hint="Two-letter code, e.g. CA"
                error={form.formState.errors.nationality?.message}
                htmlFor="nat"
              >
                <Input id="nat" maxLength={2} className="uppercase" {...form.register('nationality')} />
              </Field>
              <Field label="Second passport" hint="Optional" htmlFor="nat2">
                <Input
                  id="nat2"
                  maxLength={2}
                  className="uppercase"
                  {...form.register('second_nationality')}
                />
              </Field>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Your colour</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    aria-pressed={accent === key}
                    onClick={() => form.setValue('accent_color', key)}
                    className={cn(
                      'size-9 rounded-full ring-offset-2 ring-offset-background transition',
                      accent === key ? 'ring-2 ring-foreground' : 'ring-1 ring-border',
                    )}
                    style={{ backgroundColor: `hsl(${ACCENT_COLORS[key]})` }}
                  />
                ))}
              </div>
              {collision && (
                <p className="text-xs text-[hsl(var(--warn))]">
                  {partner?.display_name ?? 'Your partner'} uses this colour too — picking another
                  makes it clearer whose idea is whose.
                </p>
              )}
            </div>

            {update.error ? (
              <p className="text-sm text-destructive" role="alert">
                {userMessage(update.error)}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Done'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

function CitySearchField({
  value,
  error,
  onPick,
  onType,
}: {
  value: string
  error?: string
  onPick: (c: CityResult) => void
  onType: (text: string) => void
}) {
  const [results, setResults] = useState<CityResult[]>([])
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

  // Whether to show anything is derived, not stored — clearing results from
  // inside the effect would set state synchronously and cascade a render.
  const active = query.trim().length >= 3
  const visible = active ? results : []

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        setResults(await searchCity(query, controller.signal))
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, active])

  return (
    <Field
      label="Home city"
      hint={searching ? 'Searching…' : 'We use this for the distance between you.'}
      error={error}
      htmlFor="city"
    >
      <Input
        id="city"
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onType(e.target.value)
          setQuery(e.target.value)
        }}
        placeholder="Toronto"
      />
      {visible.length > 0 && (
        <ul className="mt-1 divide-y divide-border overflow-hidden rounded-md border border-border">
          {visible.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                onClick={() => {
                  onPick(r)
                  setResults([])
                  setQuery('')
                }}
              >
                <span className="font-medium">{r.name}</span>
                <span className="ml-2 text-muted-foreground">{r.country}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  )
}
