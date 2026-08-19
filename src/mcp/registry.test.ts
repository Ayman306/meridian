/**
 * The invariants that make this server safe to hand a token to.
 *
 * Most of these are not testing behaviour so much as pinning a decision, which
 * is the point: the failure mode for an MCP server is somebody adding a
 * plausible-looking tool in six months and nobody noticing what it reaches.
 * Each of these fails loudly in that case.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ALL_MODULES } from '@/modules/settings/logic'
import {
  ALL_TOOLS,
  DEFAULT_TOKEN_MODULES,
  SENSITIVE_TOKEN_MODULES,
  GRANTABLE_MODULES,
  toolsFor,
} from './registry'

const TOOLS_DIR = join(process.cwd(), 'src/mcp/tools')

function toolSources(): { file: string; source: string }[] {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((file) => ({ file, source: readFileSync(join(TOOLS_DIR, file), 'utf8') }))
}

describe('the sensitive modules', () => {
  it('never puts health or documents in a default scope', () => {
    // Named explicitly rather than derived, so widening this is a visible edit
    // here and not a silent consequence of some other change.
    expect(SENSITIVE_TOKEN_MODULES).toContain('health')
    expect(SENSITIVE_TOKEN_MODULES).toContain('documents')
    for (const sensitive of SENSITIVE_TOKEN_MODULES) {
      expect(DEFAULT_TOKEN_MODULES).not.toContain(sensitive)
    }
  })

  it('offers them only to a token that asked for them', () => {
    expect(toolsFor(DEFAULT_TOKEN_MODULES).some((t) => t.module === 'health')).toBe(false)
    expect(toolsFor(['trips']).some((t) => t.module === 'health')).toBe(false)
    expect(toolsFor(['health']).length).toBeGreaterThan(0)
  })

  it('ignores a module the code no longer knows about', () => {
    // Tokens outlive code. A row naming something removed later should offer
    // nothing for it rather than break every call the token makes.
    const tools = toolsFor(['trips', 'not-a-module'])
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((t) => t.module === 'trips')).toBe(true)
  })

  it('reads health only for the token owner, never a consented partner', () => {
    // This is the guarantee that goes beyond RLS. 0014 lets a partner read a
    // scope they were granted consent for, which is right in the app and wrong
    // here — consent was given so a person could look with their own eyes, not
    // so an assistant could sweep up what they were trusted with. Every query
    // in the health tools therefore pins owner_id to the caller.
    const source = readFileSync(join(TOOLS_DIR, 'health.ts'), 'utf8')
    const queries = source.match(/\.from\('(?:cycle_logs|health_records)'\)/g) ?? []
    expect(queries.length).toBeGreaterThan(0)
    // One owner filter per query, at least.
    const filters = source.match(/owner_id['"]?[,:]?\s*(?:ctx\.userId|['"]?, ctx\.userId)/g) ?? []
    expect(filters.length).toBeGreaterThanOrEqual(queries.length)
  })

  it('never exposes a document file, link or number', () => {
    // The column list in the query is the boundary. `storage_path` would invite
    // a fetch; a signed URL outliving its 300 seconds in a model's context
    // defeats the point of signing it; four digits of a passport number is
    // nothing any question here needs.
    const source = readFileSync(join(TOOLS_DIR, 'documents.ts'), 'utf8')
    const selects = source.match(/\.select\([^)]*\)/gs) ?? []
    for (const select of selects) {
      for (const forbidden of ['storage_path', 'number_last4', 'file_name', 'mime_type']) {
        expect(`${forbidden}:${select.includes(forbidden)}`).toBe(`${forbidden}:false`)
      }
    }
    expect(source).not.toContain('createSignedUrl')
  })

  it('cannot delete health data', () => {
    // The wipe RPC is irreversible by design — there is no thirty-day bin for
    // health data. A tool for it would put total erasure one hallucinated call
    // away. Matched as a call rather than as a string, so the comment in
    // health.ts explaining this omission does not trip its own assertion.
    for (const { file, source } of toolSources()) {
      const calls = /\.rpc\(\s*['"]delete_all_health_data/.test(source)
      expect(`${file}:${calls}`).toBe(`${file}:false`)
    }
    expect(ALL_TOOLS.some((t) => t.module === 'health' && /delete|remove/.test(t.name))).toBe(false)
  })

  it('still lists them as grantable, since they are opt-in and not banned', () => {
    for (const sensitive of SENSITIVE_TOKEN_MODULES) {
      expect(GRANTABLE_MODULES).toContain(sensitive)
    }
  })
})

describe('nothing auto-inserts', () => {
  it('writes itinerary items from one module only', () => {
    // Direct writes are allowed now — a dictated "dinner at 8 on Tuesday" is
    // not generated content. But they belong in the itinerary module, where
    // the tray rule is stated and enforced. A write appearing in some other
    // tool file is how the rule gets routed around.
    for (const { file, source } of toolSources()) {
      if (file === 'itinerary.ts') continue
      const writes = /from\(\s*'itinerary_items'\s*\)[\s\S]{0,200}?\.(insert|upsert)\(/.test(source)
      expect(`${file}:${writes}`).toBe(`${file}:false`)
    }
  })

  it('lets no tool create more than one itinerary item at a time', () => {
    // This is the invariant that actually carries #5 now. Bulk means generated,
    // and generated means the tray. A direct-write tool that accepted an array
    // of plan items would be `suggest_itinerary` with the review step removed.
    //
    // Scoped to the trips module deliberately. Elsewhere a list is the right
    // shape — `add_journey` takes its legs together because a connection is one
    // booking, and splitting it would allow half a journey to exist.
    for (const tool of ALL_TOOLS) {
      if (tool.readOnly || tool.module !== 'trips' || tool.name === 'suggest_itinerary') continue
      const schema = zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' }) as {
        properties?: Record<string, { type?: string }>
      }
      const arrays = Object.entries(schema.properties ?? {})
        .filter(([, value]) => value.type === 'array')
        .map(([key]) => key)
      expect(`${tool.name}:${arrays.join(',')}`).toBe(`${tool.name}:`)
    }
  })

  it('routes the one itinerary write through the suggestion tray', () => {
    const suggest = ALL_TOOLS.find((t) => t.name === 'suggest_itinerary')
    expect(suggest).toBeDefined()
    expect(suggest!.readOnly).toBe(false)

    const source = readFileSync(join(TOOLS_DIR, 'itinerary.ts'), 'utf8')
    expect(source).toContain("from('suggestion_tray')")
    // The model has to be told, or it will report the plan as updated.
    expect(suggest!.description).toMatch(/does NOT change the itinerary/i)
  })
})

describe('the registry itself', () => {
  it('has unique tool names', () => {
    const names = ALL_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('only claims modules the app actually has', () => {
    for (const tool of ALL_TOOLS) {
      expect(ALL_MODULES).toContain(tool.module)
    }
  })

  it('gives an unscoped token nothing', () => {
    expect(toolsFor([])).toEqual([])
  })

  it('gives a narrow token only its own tools', () => {
    const tools = toolsFor(['money'])
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((t) => t.module === 'money')).toBe(true)
  })

  it('marks every read-only tool as such', () => {
    // The annotation is what lets a client show a call as safe, so a write
    // mislabelled read-only is worse than no annotation at all.
    const reads = ALL_TOOLS.filter((t) => t.readOnly).map((t) => t.name)
    const writes = ALL_TOOLS.filter((t) => !t.readOnly).map((t) => t.name)
    // Listed explicitly rather than counted: adding a write tool should be a
    // visible edit here, not something that slips in under a length check.
    expect(writes.sort()).toEqual([
      'add_destination',
      'add_health_record',
      'add_itinerary_item',
      'add_journey',
      'add_wishlist_item',
      'choose_destination',
      'create_trip',
      'dismiss_suggestion',
      'log_cycle',
      'log_expense',
      'record_settlement',
      'remove_flight',
      'remove_itinerary_item',
      'remove_wishlist_item',
      'set_budget',
      'set_trip_day',
      'suggest_itinerary',
      'update_flight',
      'update_itinerary_item',
      'update_trip',
      'vote_on_wishlist_item',
    ])
    expect(reads).toContain('list_trips')
  })

  it('exposes a JSON Schema the wire can carry', () => {
    // The stdio server converts each zod schema at list time. A construct that
    // does not convert — a transform, a lazy ref — would break the tool list
    // rather than the one tool, so it is worth catching here.
    for (const tool of ALL_TOOLS) {
      const schema = zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' }) as {
        type?: string
        properties?: Record<string, unknown>
      }
      expect(schema.type).toBe('object')
      expect(JSON.stringify(schema)).not.toContain('$ref')
      // Every parameter carries a description, or a model guesses at it.
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        const described = (value as { description?: string }).description
        expect(`${tool.name}.${key}:${Boolean(described)}`).toBe(`${tool.name}.${key}:true`)
      }
    }
  })

  it('describes every tool for a model rather than leaving it blank', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})

describe('the service role stays out of the tool path', () => {
  it('is not reachable from src/mcp', () => {
    // The one place it may appear is the token exchange Route Handler, which
    // returns a user JWT and never data. If it ever shows up in here, the
    // whole RLS argument for this server collapses.
    const files = readdirSync(join(process.cwd(), 'src/mcp'), { recursive: true }) as string[]
    // Test files are excluded because this one necessarily names the thing it
    // is banning. Scanning shipped code is the point; scanning the ban is not.
    for (const file of files.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const source = readFileSync(join(process.cwd(), 'src/mcp', file), 'utf8')
      expect(`${file}:${source.includes('SERVICE_ROLE')}`).toBe(`${file}:false`)
      expect(`${file}:${source.includes('createAdminSupabase')}`).toBe(`${file}:false`)
    }
  })
})
