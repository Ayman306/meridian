import type { Tables } from '@/types/database'

export type Media = Tables<'media'>
export type Album = Tables<'albums'>
export type AlbumMedia = Tables<'album_media'>
export type MediaComment = Tables<'media_comments'>
export type ShareLink = Tables<'share_links'>
export type DailyExchange = Tables<'daily_exchange'>

export type MediaVariant = 'thumb' | 'display'
export type MediaType = 'photo' | 'video'
export type AlbumKind = 'trip' | 'manual' | 'exchange'
export type ShareTarget = 'media' | 'album'

export interface MediaFilters {
  tripId?: string | null
  uploaderId?: string | null
  albumId?: string | null
  favouritesOnly?: boolean
  hasLocation?: boolean
  mediaType?: MediaType | null
  from?: string | null
  to?: string | null
  /** Full-text over captions. */
  search?: string | null
}

/** A page of media plus the cursor to ask for the next one. */
export interface MediaPage {
  items: Media[]
  /** `taken_at` of the last row, or null when the library is exhausted. */
  cursor: string | null
}

/** One heading in the grid: a trip, or a date within it. */
export interface MediaGroup {
  key: string
  label: string
  items: Media[]
}

/** Two photos taken within minutes and metres of each other, one from each. */
export interface SameMoment {
  a: Media
  b: Media
  minutesApart: number
  metresApart: number
}

export interface ShareOptions {
  allowDownload: boolean
  expiresInDays: number
  passcode?: string | null
}

/** What the public share route returns. Never a storage path. */
export interface SharedPayload {
  target: ShareTarget
  title: string | null
  allowDownload: boolean
  items: {
    id: string
    caption: string | null
    thumbhash: string | null
    width: number | null
    height: number | null
    /** Short-lived signed URL, minted per request. */
    url: string
  }[]
}

export interface MediaUsage {
  photoCount: number
  totalBytes: number
  trashedCount: number
}

/** The post-trip recap (spec 11.3). */
export interface Recap {
  count: number
  favourites: number
  withLocation: number
  /** Straight-line total between consecutive photo locations, in km. */
  distanceKm: number
  places: { lat: number; lng: number; id: string }[]
  first: string | null
  last: string | null
}
