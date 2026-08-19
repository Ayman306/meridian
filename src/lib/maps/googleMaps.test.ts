import { describe, expect, it } from 'vitest'
import {
  describeParseSource,
  googleMapsUrlFor,
  isGoogleMapsLink,
  parseGoogleMapsLink,
} from '@/lib/maps/googleMaps'

describe('recognising a maps link at all', () => {
  it('accepts the shapes Google actually hands out', () => {
    expect(isGoogleMapsLink('https://www.google.com/maps/place/Cafe/@12.9,74.8,17z')).toBe(true)
    expect(isGoogleMapsLink('https://maps.google.com/?q=12.9,74.8')).toBe(true)
    expect(isGoogleMapsLink('https://maps.app.goo.gl/abc123')).toBe(true)
    expect(isGoogleMapsLink('https://goo.gl/maps/abc123')).toBe(true)
    // Country domains — google.co.in is what an Indian phone shares.
    expect(isGoogleMapsLink('https://www.google.co.in/maps/place/Cafe/@12.9,74.8,17z')).toBe(true)
  })

  it('refuses everything else', () => {
    expect(isGoogleMapsLink('https://example.com/maps/place/Cafe')).toBe(false)
    expect(isGoogleMapsLink('not a url')).toBe(false)
    expect(isGoogleMapsLink('')).toBe(false)
    // Looks like Google, is not.
    expect(isGoogleMapsLink('https://google.com.evil.example/maps')).toBe(false)
  })
})

describe('the pin versus the camera', () => {
  it('prefers the pin in the data payload over the @ position', () => {
    // The bug this whole module exists to avoid. `@12.95,74.85` is where the
    // map was centred when the link was copied; `!3d12.87!4d74.84` is the
    // place. Pan before copying and those differ by a suburb.
    const parsed = parseGoogleMapsLink(
      'https://www.google.com/maps/place/Cafe+Younes/@12.95,74.85,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d12.87!4d74.84',
    )
    expect(parsed.lat).toBe(12.87)
    expect(parsed.lng).toBe(74.84)
    expect(parsed.source).toBe('pin')
  })

  it('falls back to the camera position, and says so', () => {
    const parsed = parseGoogleMapsLink(
      'https://www.google.com/maps/place/Cafe+Younes/@12.95,74.85,17z',
    )
    expect(parsed.lat).toBe(12.95)
    expect(parsed.lng).toBe(74.85)
    expect(parsed.source).toBe('camera')
    // The caller has to be able to warn about this one.
    expect(describeParseSource(parsed)).toMatch(/centred|marker/i)
  })

  it('says nothing extra when the pin was exact', () => {
    const parsed = parseGoogleMapsLink('https://maps.google.com/?q=12.87,74.84')
    expect(describeParseSource(parsed)).toBeNull()
  })
})

describe('coordinate parameters', () => {
  it('reads every spelling Google uses', () => {
    for (const url of [
      'https://maps.google.com/?q=12.87,74.84',
      'https://www.google.com/maps/search/?api=1&query=12.87,74.84',
      'https://maps.google.com/?ll=12.87,74.84',
      'https://maps.google.com/?daddr=12.87,74.84',
    ]) {
      const parsed = parseGoogleMapsLink(url)
      expect(`${url} → ${parsed.lat},${parsed.lng}`).toBe(`${url} → 12.87,74.84`)
    }
  })

  it('handles negative coordinates and whitespace', () => {
    const parsed = parseGoogleMapsLink('https://maps.google.com/?q=-33.86, 151.21')
    expect(parsed.lat).toBe(-33.86)
    expect(parsed.lng).toBe(151.21)
  })

  it('reads a plain /maps/@lat,lng link', () => {
    const parsed = parseGoogleMapsLink('https://www.google.com/maps/@12.87,74.84,15z')
    expect(parsed.lat).toBe(12.87)
    expect(parsed.source).toBe('camera')
  })
})

describe('refusing nonsense that parses as a number', () => {
  it('rejects out-of-range coordinates', () => {
    // parseFloat is happy with these. A longitude of 700 in the database is a
    // pin nobody can explain later.
    expect(parseGoogleMapsLink('https://maps.google.com/?q=91,0').lat).toBeNull()
    expect(parseGoogleMapsLink('https://maps.google.com/?q=0,181').lng).toBeNull()
  })

  it('rejects null island', () => {
    // 0,0 is in the Atlantic and is what a broken parse produces far more often
    // than a real pin.
    expect(parseGoogleMapsLink('https://maps.google.com/?q=0,0').lat).toBeNull()
  })

  it('never throws on rubbish', () => {
    for (const value of ['', 'https://', 'https://www.google.com/maps', 'maps.google.com']) {
      expect(() => parseGoogleMapsLink(value)).not.toThrow()
    }
  })
})

describe('names', () => {
  it('lifts and tidies the place name', () => {
    const parsed = parseGoogleMapsLink(
      'https://www.google.com/maps/place/Cafe+Younes/@12.95,74.85,17z',
    )
    expect(parsed.name).toBe('Cafe Younes')
  })

  it('decodes percent escapes', () => {
    const parsed = parseGoogleMapsLink(
      'https://www.google.com/maps/place/Caf%C3%A9%20Central/@12.95,74.85,17z',
    )
    expect(parsed.name).toBe('Café Central')
  })

  it('does not mistake a coordinate segment for a name', () => {
    const parsed = parseGoogleMapsLink('https://www.google.com/maps/place/12.87,74.84/@12.87,74.84,17z')
    expect(parsed.name).toBeNull()
  })
})

describe('links that name a place instead of pinning one', () => {
  it('returns a query to geocode from', () => {
    const parsed = parseGoogleMapsLink(
      'https://www.google.com/maps/search/?api=1&query=Cafe+Younes+Mangalore',
    )
    expect(parsed.lat).toBeNull()
    expect(parsed.query).toBe('Cafe Younes Mangalore')
    expect(parsed.source).toBe('query')
    expect(describeParseSource(parsed)).toMatch(/looked up by name/i)
  })
})

describe('short links', () => {
  it('are flagged rather than guessed at', () => {
    // Everything in one is opaque, including the path. Guessing would be
    // inventing a location.
    for (const url of ['https://maps.app.goo.gl/abc123', 'https://goo.gl/maps/abc123']) {
      const parsed = parseGoogleMapsLink(url)
      expect(parsed.needsResolving).toBe(true)
      expect(parsed.lat).toBeNull()
      expect(parsed.name).toBeNull()
    }
  })

  it('are not flagged for links that need no resolving', () => {
    expect(parseGoogleMapsLink('https://maps.google.com/?q=12.87,74.84').needsResolving).toBe(false)
  })
})

describe('building a link back', () => {
  it('uses the form that opens the app on a phone', () => {
    expect(googleMapsUrlFor(12.87, 74.84)).toBe(
      'https://www.google.com/maps/search/?api=1&query=12.87,74.84',
    )
  })

  it('carries a label when there is one', () => {
    expect(googleMapsUrlFor(12.87, 74.84, 'Cafe Younes')).toContain('Cafe%20Younes')
  })

  it('round-trips through the parser', () => {
    // The link we generate must be one we can read back, or a saved place
    // stops being editable after a round trip.
    const parsed = parseGoogleMapsLink(googleMapsUrlFor(12.87, 74.84))
    expect(parsed.lat).toBe(12.87)
    expect(parsed.lng).toBe(74.84)
  })
})

describe('the labelled coordinate form', () => {
  it('reads back a link this app generated', () => {
    // Found by round-tripping rather than by reading the code: the unlabelled
    // form was tested and passed, while the labelled one — which is what
    // actually gets saved — could not be parsed at all. A saved place would
    // have silently lost its pin the next time it was opened.
    const url = googleMapsUrlFor(12.8698, 74.843, 'Cafe Younes')
    const parsed = parseGoogleMapsLink(url)
    expect(parsed.lat).toBe(12.8698)
    expect(parsed.lng).toBe(74.843)
    expect(parsed.name).toBe('Cafe Younes')
    expect(parsed.source).toBe('pin')
  })

  it('reads a labelled pair whatever the label contains', () => {
    const parsed = parseGoogleMapsLink(
      'https://www.google.com/maps/search/?api=1&query=12.87,74.84(A%20Caf%C3%A9%2C%20really)',
    )
    expect(parsed.lat).toBe(12.87)
    expect(parsed.name).toBe('A Café, really')
  })

  it('still reads an unlabelled pair', () => {
    expect(parseGoogleMapsLink(googleMapsUrlFor(12.87, 74.84)).lat).toBe(12.87)
  })
})
