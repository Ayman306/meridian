'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * A string preference persisted in localStorage.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: localStorage is an
 * external store, so this is what it is for. It also gets two things right that
 * the effect version does not — the server render sees the fallback instead of
 * crashing, and a change in another tab is picked up.
 */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function useStoredPreference<T extends string>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    // Snapshots must be primitives so React can compare them by value.
    () => (localStorage.getItem(key) as T | null) ?? fallback,
    () => fallback,
  )

  const set = useCallback(
    (next: T) => {
      localStorage.setItem(key, next)
      // `storage` only fires in *other* tabs, so nudge this one ourselves.
      emit()
    },
    [key],
  )

  return [value, set]
}
