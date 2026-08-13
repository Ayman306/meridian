import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ACCENT_COLORS, DEFAULT_ACCENT, type AccentColor } from '@/lib/constants'

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
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system',
  )
  const [accent, setAccentState] = useState<AccentColor>(
    () => (localStorage.getItem(ACCENT_KEY) as AccentColor | null) ?? DEFAULT_ACCENT,
  )

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
    () => ({
      theme,
      accent,
      setTheme: (t) => {
        localStorage.setItem(STORAGE_KEY, t)
        setThemeState(t)
      },
      setAccent: (a) => {
        localStorage.setItem(ACCENT_KEY, a)
        setAccentState(a)
      },
    }),
    [theme, accent],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
