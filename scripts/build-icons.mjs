/**
 * Generates the PWA icon set from one SVG, so the mark is defined once.
 *
 *   node scripts/build-icons.mjs
 *
 * Two shapes, not one. A **maskable** icon is cropped by the platform to
 * whatever silhouette it likes — a circle on some Android launchers, a squircle
 * on others — and anything outside the middle 80% can be cut off. So the
 * maskable variant draws the mark smaller, inside that safe zone, and fills the
 * whole square with background. The plain variant has no such constraint and
 * uses the space properly, which is what a browser tab and the install dialog
 * actually show.
 *
 * Shipping only a maskable icon makes the app look tiny and lost in a circle of
 * background everywhere it is *not* masked; shipping only a plain one gets the
 * edges of the mark shaved off where it is. Hence both, declared with the right
 * `purpose` in the manifest.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const OUT = join(process.cwd(), 'public', 'icons')

const BACKGROUND = '#0b0d12'
const ACCENT = '#f59e0b'
const MUTED = '#3f4757'

/**
 * A globe crossed by a meridian, with the two of them on it at different
 * latitudes — which is the whole app in one picture.
 *
 * `scale` shrinks the mark for the maskable variant while the background still
 * fills the square.
 */
function markSvg(scale) {
  const c = 256
  const r = 190 * scale
  // The meridian is a vertical ellipse: a great circle through the poles, seen
  // side-on. Its width is what makes the sphere read as a sphere.
  const rx = r * 0.42
  const dotR = 21 * scale
  // Two points on the meridian, north and south of the equator.
  const northY = c - r * 0.44
  const southY = c + r * 0.5

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <g fill="none" stroke-linecap="round">
    <circle cx="${c}" cy="${c}" r="${r}" stroke="${MUTED}" stroke-width="${14 * scale}"/>
    <ellipse cx="${c}" cy="${c}" rx="${rx}" ry="${r}" stroke="${MUTED}" stroke-width="${11 * scale}"/>
    <line x1="${c - r}" y1="${c}" x2="${c + r}" y2="${c}" stroke="${MUTED}" stroke-width="${11 * scale}"/>
    <path d="M ${c} ${northY} L ${c} ${southY}" stroke="${ACCENT}" stroke-width="${15 * scale}"/>
  </g>
  <circle cx="${c}" cy="${northY}" r="${dotR}" fill="${ACCENT}"/>
  <circle cx="${c}" cy="${southY}" r="${dotR}" fill="${ACCENT}"/>
</svg>`
}

/** Full-bleed mark, for contexts that show the icon as drawn. */
const PLAIN = markSvg(1)
/** Shrunk into the middle 80%, for contexts that crop. */
const MASKABLE = markSvg(0.72)

async function png(svg, size, name) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(join(OUT, name))
  return name
}

async function main() {
  await mkdir(OUT, { recursive: true })

  const written = await Promise.all([
    png(PLAIN, 192, 'icon-192.png'),
    png(PLAIN, 512, 'icon-512.png'),
    png(MASKABLE, 192, 'maskable-192.png'),
    png(MASKABLE, 512, 'maskable-512.png'),
    // iOS ignores `purpose` and never masks, so it gets the plain mark at the
    // size Safari asks for.
    png(PLAIN, 180, 'apple-touch-icon.png'),
  ])

  // The vector, for the browser tab. Scales to 16px better than a downsampled
  // PNG does.
  await writeFile(join(process.cwd(), 'public', 'icon.svg'), PLAIN)

  console.log(`Wrote ${written.length} icons to public/icons and public/icon.svg`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
