/**
 * Client-side image processing. Spec 11.3 and 11.4.
 *
 * This file is the reason the gallery fits in a gigabyte. Every photo is
 * resized in the browser and **the original is never uploaded**: a 1600px
 * display at q75 is roughly 300 KB and a 400px thumb at q70 is roughly 40 KB,
 * so a photo costs about 340 KB instead of five megabytes. That is 2,900
 * photos in the free tier rather than 250.
 *
 * Doing it here rather than server-side is also the only option: a serverless
 * function has neither the memory nor the time budget to decode a 48-megapixel
 * HEIC, and the user's phone already has the file in hand.
 *
 * Browser-only. Everything touches Canvas or `createImageBitmap`.
 */
'use client'

import { rgbaToThumbHash } from 'thumbhash'

/** Spec 11.4's size targets. Changing these changes how many photos fit. */
export const DISPLAY_MAX_PX = 1600
export const DISPLAY_QUALITY = 0.75
export const THUMB_MAX_PX = 400
export const THUMB_QUALITY = 0.7

/** Videos skip derivative generation entirely and are capped hard. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024
/** A processed still should never approach this. If it does, something is off. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface ProcessedImage {
  display: Blob
  thumb: Blob
  /** Base64 thumbhash — ~25 bytes that render instantly as a blurred stand-in. */
  thumbhash: string
  /** 64-bit perceptual hash as hex, for the duplicate prompt. */
  phash: string
  width: number
  height: number
  takenAt: string | null
  lat: number | null
  lng: number | null
}

export interface ExifSummary {
  takenAt: string | null
  lat: number | null
  lng: number | null
}

/**
 * A file to two derivatives, a placeholder and a fingerprint.
 *
 * The bitmap is decoded once and reused for all four outputs — decoding a
 * large photo is the expensive step, and doing it per output is what makes a
 * fifty-photo batch feel broken.
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  const exif = await readExif(file)
  const source = await toBitmapSource(file)
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })

  try {
    const [display, thumb, hash, phash] = await Promise.all([
      resizeToBlob(bitmap, DISPLAY_MAX_PX, DISPLAY_QUALITY),
      resizeToBlob(bitmap, THUMB_MAX_PX, THUMB_QUALITY),
      computeThumbhash(bitmap),
      perceptualHash(bitmap),
    ])

    return {
      display,
      thumb,
      thumbhash: hash,
      phash,
      width: bitmap.width,
      height: bitmap.height,
      takenAt: exif.takenAt ?? new Date(file.lastModified).toISOString(),
      lat: exif.lat,
      lng: exif.lng,
    }
  } finally {
    bitmap.close()
  }
}

/**
 * EXIF, best effort.
 *
 * A photo with no date is normal — screenshots and messaging apps strip it —
 * so the caller falls back to the file's own modified time and then to the
 * upload time (spec 11.7). Never throws; a photo without metadata is still a
 * photo.
 */
export async function readExif(file: File): Promise<ExifSummary> {
  try {
    const exifr = await import('exifr')
    const data = (await exifr.parse(file, { gps: true })) as
      | { DateTimeOriginal?: Date; CreateDate?: Date; latitude?: number; longitude?: number }
      | undefined

    const taken = data?.DateTimeOriginal ?? data?.CreateDate ?? null
    return {
      takenAt: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : null,
      lat: typeof data?.latitude === 'number' ? data.latitude : null,
      lng: typeof data?.longitude === 'number' ? data.longitude : null,
    }
  } catch {
    return { takenAt: null, lat: null, lng: null }
  }
}

/**
 * HEIC to something Canvas can decode.
 *
 * `heic2any` is over a megabyte, so it is imported only when a HEIC actually
 * turns up — which on a non-Safari browser is the only time it is needed at
 * all. Slow for large batches, and the UI warns about that rather than
 * silently taking a minute per photo.
 */
export async function toBitmapSource(file: File): Promise<Blob> {
  if (!isHeic(file)) return file

  // Some browsers decode HEIC natively; try that before pulling in the polyfill.
  try {
    const native = await createImageBitmap(file)
    native.close()
    return file
  } catch {
    // Expected on most browsers — fall through to the conversion.
  }

  const heic2any = (await import('heic2any')).default
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  return Array.isArray(converted) ? converted[0]! : converted
}

export function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

export function isVideo(file: File): boolean {
  return file.type.startsWith('video/')
}

/** Longest edge to `maxPx`, never upscaling a photo that is already smaller. */
export async function resizeToBlob(
  bitmap: ImageBitmap,
  maxPx: number,
  quality: number,
): Promise<Blob> {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = makeCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.drawImage(bitmap, 0, 0, width, height)

  return toBlob(canvas, quality)
}

async function computeThumbhash(bitmap: ImageBitmap): Promise<string> {
  // thumbhash wants at most 100×100 RGBA.
  const scale = Math.min(1, 100 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = makeCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.drawImage(bitmap, 0, 0, width, height)

  const { data } = context.getImageData(0, 0, width, height)
  return bytesToBase64(rgbaToThumbHash(width, height, data))
}

/**
 * A 64-bit average-hash fingerprint, hex-encoded.
 *
 * Downscale to 8×8 greyscale, then one bit per pixel: brighter than the mean
 * or not. Crude next to a DCT hash, and enough for what it is used for —
 * asking "did you already upload this one?" before an upload, never rejecting
 * anything on its own.
 */
export async function perceptualHash(bitmap: ImageBitmap): Promise<string> {
  const canvas = makeCanvas(8, 8)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.drawImage(bitmap, 0, 0, 8, 8)

  const { data } = context.getImageData(0, 0, 8, 8)
  const grey: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    grey.push(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!)
  }

  const mean = grey.reduce((a, b) => a + b, 0) / grey.length
  let hex = ''
  for (let byte = 0; byte < 8; byte++) {
    let value = 0
    for (let bit = 0; bit < 8; bit++) {
      if (grey[byte * 8 + bit]! > mean) value |= 1 << (7 - bit)
    }
    hex += value.toString(16).padStart(2, '0')
  }
  return hex
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      'image/jpeg',
      quality,
    )
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** A poster frame for a video, so the grid has something to show. */
export async function videoPoster(file: File): Promise<{ blob: Blob; durationS: number } | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.src = url

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Could not read the video.'))
      // A file the browser cannot decode should not hang the queue.
      setTimeout(() => reject(new Error('Video timed out.')), 10_000)
    })

    // A frame from a second in; frame zero is often black.
    video.currentTime = Math.min(1, video.duration / 2)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })

    const canvas = makeCanvas(video.videoWidth, video.videoHeight)
    const context = canvas.getContext('2d')
    if (!context) return null
    ;(context as CanvasRenderingContext2D).drawImage(video, 0, 0)

    return { blob: await toBlob(canvas, THUMB_QUALITY), durationS: Math.round(video.duration) }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
