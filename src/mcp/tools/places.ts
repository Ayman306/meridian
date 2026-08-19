/**
 * Finding where somewhere actually is.
 *
 * This exists because of one rule that runs through every write tool in this
 * server: **the model never supplies coordinates.**
 *
 * Asked where a café is, a language model will produce a latitude. It will be
 * plausible, correctly formatted, and — often enough to matter — a kilometre
 * out or in the wrong city entirely. A pin that is confidently wrong is worse
 * than no pin, because nothing about it looks wrong: the name is right, the
 * address reads fine, and only the map shows the problem, which is the one
 * thing nobody checks for a place they have not been to yet.
 *
 * So the division of labour is: the model knows *what* the place is called, and
 * the geocoder knows *where* it is. `find_place` is how the model asks, and
 * every tool that stores a location takes a name to look up rather than numbers
 * to write down. A test asserts no tool anywhere accepts a latitude.
 */
import { z } from 'zod'
import { searchPlaces } from '@/lib/geocode'
import { defineTool } from './types'
import type { AnyTool } from './types'

const findPlace = defineTool({
  name: 'find_place',
  module: 'wishlist',
  title: 'Find where a place is',
  description:
    'Look up a real place by name and get back candidates with their addresses. Use this when you need to check somewhere exists or which of several you mean — and note you never need to pass coordinates anywhere in this server: the tools that save a location take a name and look it up themselves.',
  readOnly: true,
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .describe(
        'The place, as specifically as you can. "Cafe Younes Mangalore" finds it; "cafe" finds several thousand.',
      ),
    limit: z.number().int().min(1).max(8).default(5).describe('How many candidates to return.'),
  }),
  async handler(_ctx, input) {
    const results = await searchPlaces(input.query)
    if (results.length === 0) {
      return `Nothing found for "${input.query}". Try adding the city or the country — and do not invent a location for it.`
    }

    return results
      .slice(0, input.limit)
      .map((place, i) => {
        const parts = [`${i + 1}. ${place.name}`]
        if (place.kind) parts.push(place.kind)
        parts.push(place.displayName)
        return parts.join(' · ')
      })
      .join('\n')
  },
})

export const placeTools: AnyTool[] = [findPlace]
