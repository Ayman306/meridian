'use client'

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { ACCENT_COLORS, DEFAULT_ACCENT, type AccentColor } from '@/lib/constants'
import { useStoredPreference } from '@/lib/useStoredPreference'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  accent: AccentColor
  setAccent: (a: AccentColor) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'meridian.theme'
const ACCENT_KEY = 'meridian.accent'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useStoredPreference<Theme>(STORAGE_KEY, 'system')
  const [accent, setAccent] = useStoredPreference<AccentColor>(ACCENT_KEY, DEFAULT_ACCENT)

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    if (theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [theme])

  useEffect(() => {
    const hue = ACCENT_COLORS[accent] ?? ACCENT_COLORS[DEFAULT_ACCENT]
    document.documentElement.style.setProperty('--accent', hue)
    document.documentElement.style.setProperty('--ring', hue)
  }, [accent])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, accent, setTheme, setAccent }),
    [theme, accent, setTheme, setAccent],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
