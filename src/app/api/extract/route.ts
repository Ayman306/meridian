/**
 * Read a pasted link's OpenGraph tags so saving a place from Instagram or a
 * blog is one paste instead of three fields (spec 7.2).
 *
 * This is server-side for two reasons: CORS blocks the browser from fetching an
 * arbitrary page at all, and fetching a URL a user typed is a request the
 * server has to be careful about. The care is the bulk of this file — a handler
 * that will fetch any string it is given is an open proxy into whatever the
 * deployment can reach.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase/server'
import { MAX_REDIRECTS, assertPublicUrl } from '@/lib/net/publicUrl'
import { extractRequestSchema } from '@/modules/wishlist/schemas'

export const dynamic = 'force-dynamic'

/** Long enough for a slow blog, short enough not to hold a worker open. */
const TIMEOUT_MS = 6000
/** OpenGraph tags live in <head>. Half a megabyte is generous for that. */
const MAX_BYTES = 512 * 1024

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = extractRequestSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Send a URL.' }, { status: 400 })

  let target: URL
  try {
    target = new URL(body.data.url)
  } catch {
    return NextResponse.json({ error: 'That is not a link.' }, { status: 400 })
  }

  try {
    const html = await fetchPublicPage(target)
    return NextResponse.json(parseOpenGraph(html, target))
  } catch (e) {
    // Nothing here is worth interrupting the user over — they can type the
    // title. Log it and answer with empties.
    console.warn('extract failed', target.hostname, e instanceof Error ? e.message : e)
    return NextResponse.json({ title: null, image: null, description: null, siteName: null })
  }
}

/**
 * Fetch a page, refusing anything that is not a public web address.
 *
 * Redirects are followed by hand: `redirect: 'follow'` would check the first
 * URL and then happily land wherever the chain pointed, which is precisely the
 * hop an SSRF attempt uses.
 */
async function fetchPublicPage(start: URL): Promise<string> {
  let url = start

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(url)

    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Nominatim is not the only service that asks to know who is calling.
        'User-Agent': 'Meridian/1.0 (travel planner; link preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('redirect without a location')
      url = new URL(location, url)
      continue
    }

    if (!res.ok) throw new Error(`upstream ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('html')) throw new Error(`not html (${type})`)

    return await readCapped(res)
  }

  throw new Error('too many redirects')
}

/** Stop reading at MAX_BYTES rather than trusting content-length. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
      if (total >= MAX_BYTES) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk.subarray(0, Math.min(chunk.length, total - offset)), offset)
    offset += chunk.length
    if (offset >= total) break
  }
  return new TextDecoder('utf-8').decode(joined)
}

// ---------------------------------------------------------------------------
// Parsing. A regex rather than a DOM parser: we want four tags out of a head
// we already refused to read all of, and pulling in a parser to get them would
// be the largest dependency in the project.
// ---------------------------------------------------------------------------

function parseOpenGraph(html: string, source: URL) {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length)

  const title = meta(head, 'og:title') ?? meta(head, 'twitter:title') ?? titleTag(head)
  const image = meta(head, 'og:image') ?? meta(head, 'twitter:image')
  const description =
    meta(head, 'og:description') ?? meta(head, 'twitter:description') ?? meta(head, 'description')

  return {
    title: title ? decodeEntities(title).slice(0, 200) : null,
    // A relative og:image is common and useless to the client as-is.
    image: image ? absolute(decodeEntities(image), source) : null,
    description: description ? decodeEntities(description).slice(0, 500) : null,
    siteName: meta(head, 'og:site_name') ?? source.hostname.replace(/^www\./, ''),
  }
}

function meta(head: string, name: string): string | null {
  // property= and name= both appear in the wild, in either attribute order.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = head.match(pattern)
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return null
}

function titleTag(head: string): string | null {
  return head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || null
}

function absolute(value: string, base: URL): string | null {
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? _)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .trim()
}
