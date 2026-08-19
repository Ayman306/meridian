import { describe, expect, it } from 'vitest'
import { assertPublicUrl, isPrivateIpv4, isPrivateIpv6 } from '@/lib/net/publicUrl'

const refuses = (url: string) => expect(() => assertPublicUrl(new URL(url))).toThrow()
const allows = (url: string) => expect(() => assertPublicUrl(new URL(url))).not.toThrow()

describe('what a server-side fetch will not reach', () => {
  it('refuses schemes that are not the web', () => {
    refuses('file:///etc/passwd')
    refuses('ftp://example.com/x')
  })

  it('refuses loopback by every spelling', () => {
    refuses('http://localhost/x')
    refuses('http://anything.localhost/x')
    refuses('http://127.0.0.1/x')
    // A different loopback address in the same /8 — the range, not the one
    // famous address.
    refuses('http://127.9.9.9/x')
    refuses('http://[::1]/x')
  })

  it('refuses the cloud metadata endpoints', () => {
    // The single most valuable thing to reach from inside a deployment: it
    // hands out the instance's own credentials.
    refuses('http://169.254.169.254/latest/meta-data/')
    refuses('http://metadata.google.internal/x')
    refuses('http://anything.internal/x')
  })

  it('refuses private ranges', () => {
    refuses('http://10.0.0.1/x')
    refuses('http://192.168.1.1/x')
    refuses('http://172.16.0.1/x')
    refuses('http://172.31.255.255/x')
    // Carrier-grade NAT, which is routable-looking and is not.
    refuses('http://100.64.0.1/x')
    refuses('http://169.254.1.1/x')
  })

  it('allows the public part of ranges that are only partly private', () => {
    // 172.15 and 172.32 sit outside 172.16–172.31 and are ordinary internet.
    allows('http://172.15.0.1/x')
    allows('http://172.32.0.1/x')
    allows('http://100.63.0.1/x')
  })

  it('refuses private IPv6 and the v4 addresses hidden inside it', () => {
    refuses('http://[fc00::1]/x')
    refuses('http://[fd12:3456::1]/x')
    refuses('http://[fe80::1]/x')
    // An IPv4-mapped literal is the trick worth catching: it reads as v6 and
    // routes as v4. Note WHATWG URL rewrites these into hex — `::ffff:7f00:1`
    // — so a check for a trailing dotted quad sees nothing at all.
    refuses('http://[::ffff:127.0.0.1]/x')
    refuses('http://[::ffff:10.0.0.1]/x')
    refuses('http://[::ffff:192.168.0.1]/x')
    // The already-normalised spelling, in case a caller passes one directly.
    expect(isPrivateIpv6('::ffff:7f00:1')).toBe(true)
    expect(isPrivateIpv6('::ffff:a00:1')).toBe(true)
  })

  it('allows ordinary public addresses', () => {
    allows('https://www.google.com/maps')
    allows('https://nominatim.openstreetmap.org/reverse')
    allows('http://8.8.8.8/x')
    allows('https://[2606:4700:4700::1111]/x')
    // A mapped address that is genuinely public must still be allowed.
    allows('http://[::ffff:8.8.8.8]/x')
  })
})

describe('the address predicates on their own', () => {
  it('does not treat a hostname as an address', () => {
    expect(isPrivateIpv4('example.com')).toBe(false)
    expect(isPrivateIpv4('1.2.3')).toBe(false)
    // Octets above 255 are not an address at all, so not a private one.
    expect(isPrivateIpv4('999.0.0.1')).toBe(false)
  })

  it('needs a colon before it considers something IPv6', () => {
    expect(isPrivateIpv6('10.0.0.1')).toBe(false)
    expect(isPrivateIpv6('fc00')).toBe(false)
  })
})
