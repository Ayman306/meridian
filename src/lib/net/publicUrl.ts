/**
 * Refusing to fetch anything that is not a public web address.
 *
 * Lifted out of `/api/extract` when a second handler needed it. That extraction
 * is the point: two copies of an SSRF guard drift, and the copy that drifts is
 * the one nobody is looking at. Every server-side fetch of a URL a user supplied
 * goes through this.
 *
 * What it stops: `file://`, loopback, link-local, RFC1918, carrier-grade NAT,
 * multicast, the IPv6 equivalents, IPv4-mapped IPv6 literals hiding a private
 * address, and the cloud metadata endpoints — which are the single most
 * valuable thing to reach from inside a deployment.
 *
 * What it does **not** stop, stated plainly because it matters: a hostname that
 * *resolves* to a private address. Catching that needs resolution before
 * connection, which fetch does not expose. So every caller is also written to
 * return only what it specifically wanted — never a status code, never a raw
 * body — so a blind request into a private network cannot be read back out.
 */

/** Follow at most this many hops before giving up on a redirect chain. */
export const MAX_REDIRECTS = 3

export function assertPublicUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`refused scheme ${url.protocol}`)
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('refused local host')
  }
  if (host === 'metadata.google.internal' || host === '169.254.169.254') {
    throw new Error('refused metadata host')
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) throw new Error('refused private address')
}

export function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return false

  const [a, b] = octets as [number, number, number, number]
  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  )
}

export function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) return false
  const h = host.toLowerCase()
  // ::1 loopback, fc00::/7 unique-local, fe80::/10 link-local.
  if (h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8')) {
    return true
  }

  // IPv4-mapped addresses, which are the trick worth catching: they read as
  // IPv6 and route as IPv4.
  //
  // Both spellings have to be handled, and the second one is the reason this
  // is not a one-line regex. WHATWG `URL` *normalises* `::ffff:127.0.0.1` into
  // `::ffff:7f00:1` — hex hextets, no dots — so a check that only looks for a
  // trailing dotted quad sees nothing and waves loopback straight through.
  const dotted = h.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotted) return isPrivateIpv4(dotted[1]!)

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h)
  if (hex) {
    const high = Number.parseInt(hex[1]!, 16)
    const low = Number.parseInt(hex[2]!, 16)
    const v4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
    return isPrivateIpv4(v4)
  }

  return false
}

/**
 * Follow a redirect chain by hand, checking every hop.
 *
 * `redirect: 'follow'` would validate the first URL and then land wherever the
 * chain pointed, which is exactly the hop an SSRF attempt uses. Returns the
 * final URL without reading the body — which is all a short-link resolver
 * needs, and the least it could be trusted with.
 */
export async function resolveRedirects(
  start: URL,
  { timeoutMs = 6000, userAgent = 'Meridian/1.0 (travel planner)' } = {},
): Promise<URL> {
  let url = start

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(url)

    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('redirect without a location')
      url = new URL(location, url)
      continue
    }

    // Not a redirect. Wherever we are is the answer, whatever the status —
    // Google answers a resolved short link with 200 and a consent page just as
    // readily as with the map itself, and the URL is what we came for.
    return url
  }

  throw new Error('too many redirects')
}
