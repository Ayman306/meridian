/**
 * The upload queue. Spec 11.3 and 11.4.
 *
 * Two properties the spec asks for directly, and one that follows from them:
 *
 *   The queue survives a page refresh — the acceptance test is a fifty-photo
 *   upload with a reload halfway through. That means the state lives in
 *   IndexedDB, and every transition writes.
 *
 *   Failures retry with backoff, four attempts, then stop and say so.
 *
 *   Therefore the state machine has to be pure and separable from the
 *   uploading, because a reducer is testable and a promise chain with retries
 *   inside it is not.
 *
 * The `File` objects themselves are held in memory, not in IndexedDB. After a
 * refresh the queue remembers exactly what was pending and what failed, and
 * asks for those files again rather than pretending it can resume a byte
 * stream it no longer has.
 */

export type UploadStatus = 'pending' | 'processing' | 'uploading' | 'done' | 'failed' | 'duplicate'

export interface QueueItem {
  id: string
  name: string
  bytes: number
  status: UploadStatus
  /** 0..1, meaningful during `uploading`. */
  progress: number
  attempts: number
  error: string | null
  /** Set once the row exists, so a retry does not create a second one. */
  mediaId: string | null
  /** Set when the phash matched something already in the library. */
  duplicateOf: string | null
}

export interface QueueState {
  items: QueueItem[]
  /** Paused queues stop starting new work; whatever is in flight finishes. */
  paused: boolean
}

export const EMPTY_QUEUE: QueueState = { items: [], paused: false }

/** Spec 11.4: 1s, 2s, 4s, 8s, then give up. */
export const MAX_ATTEMPTS = 4

export function backoffMs(attempt: number): number {
  return 1000 * 2 ** Math.max(0, attempt - 1)
}

export type QueueAction =
  | { type: 'add'; items: { id: string; name: string; bytes: number }[] }
  | { type: 'status'; id: string; status: UploadStatus; error?: string | null }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'attempt'; id: string }
  | { type: 'media'; id: string; mediaId: string }
  | { type: 'duplicate'; id: string; duplicateOf: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'retry'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'clearFinished' }
  | { type: 'hydrate'; state: QueueState }

/**
 * Pure, so the whole lifecycle can be tested without a network or a browser.
 */
export function reduce(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'hydrate':
      return action.state

    case 'add':
      return {
        ...state,
        items: [
          ...state.items,
          ...action.items.map((item) => ({
            ...item,
            status: 'pending' as const,
            progress: 0,
            attempts: 0,
            error: null,
            mediaId: null,
            duplicateOf: null,
          })),
        ],
      }

    case 'status':
      return patch(state, action.id, {
        status: action.status,
        error: action.error ?? (action.status === 'failed' ? 'Upload failed.' : null),
        progress: action.status === 'done' ? 1 : undefined,
      })

    case 'progress':
      return patch(state, action.id, { progress: clamp01(action.progress) })

    case 'attempt':
      return patch(state, action.id, {
        attempts: (find(state, action.id)?.attempts ?? 0) + 1,
      })

    case 'media':
      return patch(state, action.id, { mediaId: action.mediaId })

    case 'duplicate':
      return patch(state, action.id, { status: 'duplicate', duplicateOf: action.duplicateOf })

    case 'pause':
      return { ...state, paused: true }

    case 'resume':
      return { ...state, paused: false }

    case 'retry':
      // Attempts reset: a manual retry is the user saying the circumstances
      // changed, not the fifth automatic go.
      return patch(state, action.id, { status: 'pending', attempts: 0, error: null, progress: 0 })

    case 'remove':
      return { ...state, items: state.items.filter((item) => item.id !== action.id) }

    case 'clearFinished':
      return {
        ...state,
        items: state.items.filter((item) => item.status !== 'done' && item.status !== 'duplicate'),
      }
  }
}

function patch(state: QueueState, id: string, changes: Partial<QueueItem>): QueueState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === id
        ? {
            ...item,
            ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
          }
        : item,
    ),
  }
}

function find(state: QueueState, id: string): QueueItem | undefined {
  return state.items.find((item) => item.id === id)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

export function isActive(status: UploadStatus): boolean {
  return status === 'pending' || status === 'processing' || status === 'uploading'
}

/** The next item to work on, or null when there is nothing to do. */
export function nextPending(state: QueueState): QueueItem | null {
  if (state.paused) return null
  // One at a time. Concurrency would finish a batch sooner and would also make
  // a phone with fifty photos run out of memory mid-decode.
  if (state.items.some((item) => item.status === 'processing' || item.status === 'uploading')) {
    return null
  }
  return state.items.find((item) => item.status === 'pending') ?? null
}

export function shouldRetry(item: QueueItem): boolean {
  return item.status === 'failed' && item.attempts < MAX_ATTEMPTS
}

export interface QueueSummary {
  total: number
  done: number
  failed: number
  duplicates: number
  active: number
  /** 0..1 across the whole batch, weighted by bytes rather than by count. */
  fraction: number
}

export function summarise(state: QueueState): QueueSummary {
  const total = state.items.length
  const totalBytes = state.items.reduce((sum, item) => sum + item.bytes, 0) || 1
  const doneBytes = state.items.reduce((sum, item) => sum + item.bytes * item.progress, 0)

  return {
    total,
    done: state.items.filter((i) => i.status === 'done').length,
    failed: state.items.filter((i) => i.status === 'failed').length,
    duplicates: state.items.filter((i) => i.status === 'duplicate').length,
    active: state.items.filter((i) => isActive(i.status)).length,
    // Weighted by size: a hundred-kilobyte photo finishing should not move the
    // bar as far as a five-megabyte one.
    fraction: clamp01(doneBytes / totalBytes),
  }
}

// ---------------------------------------------------------------------------
// Persistence
//
// IndexedDB rather than localStorage: the queue is written on every transition
// and localStorage is synchronous, so a fifty-item batch would block the main
// thread on the same frames that are decoding an image.
// ---------------------------------------------------------------------------

const DB_NAME = 'meridian-uploads'
const STORE = 'queue'
const KEY = 'state'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Persist, best effort.
 *
 * A queue that cannot be saved is still a queue that can upload, so every
 * failure here is swallowed. Private browsing mode denies IndexedDB entirely
 * and that must not stop someone adding photos.
 */
export async function saveQueue(state: QueueState): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      // Files cannot be serialised, and the in-flight status of a transfer
      // that no longer exists is a lie. Anything mid-flight comes back as
      // pending, which is the honest state after a refresh.
      tx.objectStore(STORE).put(
        {
          ...state,
          items: state.items.map((item) =>
            isActive(item.status) ? { ...item, status: 'pending' as const, progress: 0 } : item,
          ),
        },
        KEY,
      )
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Nothing to do about it, and nothing worth interrupting the user for.
  }
}

export async function loadQueue(): Promise<QueueState | null> {
  try {
    const db = await openDb()
    const state = await new Promise<QueueState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(KEY)
      request.onsuccess = () => resolve((request.result as QueueState) ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return state
  } catch {
    return null
  }
}

export async function clearQueue(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    db.close()
  } catch {
    // As above.
  }
}
