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

  it('has no way to reach the intimacy log at all', () => {
    // Not a gated tool — no tool. Cycle logs are reachable over MCP because
    // "when is she due, should I move the flight" is worth answering out loud;
    // this is not, and the safest guarantee is that the capability does not
    // exist rather than that a prompt declines it. `mcp/README.md` promises
    // exactly that, so the promise is enforced here: every file in the MCP
    // layer and its route is scanned, so a new tool anywhere fails the suite.
    const roots = [join(process.cwd(), 'src/mcp'), join(process.cwd(), 'src/app/api/mcp')]
    const files = roots.flatMap((root) =>
      (readdirSync(root, { recursive: true }) as string[])
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => join(root, f)),
    )
    expect(files.length).toBeGreaterThan(0)

    // Three ways in, each closed. The table by name; the health module's own
    // data functions by name; and the health module's data layer by import —
    // `health/logic` is pure and allowed (the tools borrow its disclaimers),
    // `health/api`, `health/hooks` and the barrel that re-exports them are not.
    const DATA_NAMES = /\b(?:intimacy_logs|listIntimacy|createIntimacy|updateIntimacy|deleteIntimacy|useIntimacy)\b/
    // Any path into the health module except its pure `logic` — alias or
    // relative, with or without an extension, static, dynamic or `require`.
    const DATA_IMPORT =
      /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"][^'"]*modules\/health(?!\/logic(?:\.ts)?['"])[^'"]*['"]/
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return DATA_NAMES.test(source) || DATA_IMPORT.test(source)
    })
    expect(offenders).toEqual([])
  })

  it('has no database function that could hand the intimacy log to anyone', () => {
    // The fourth way in: an RPC. A tool calling a function that returns these
    // rows would contain none of the names above. So every function in the
    // schema that touches the table is listed here, and a new one fails the
    // suite until somebody decides, on purpose, that it may exist.
    // The authoritative version of this check reads `pg_proc` and `pg_views`
    // in the RLS tests. This one reads source, so it still guards the promise
    // on a machine with no Postgres — any `create [or replace] function`, any
    // dollar-quote tag.
    const schema = readFileSync(join(process.cwd(), 'supabase/setup.sql'), 'utf8')
    const functions = [
      ...schema.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\([^)]*\)[\s\S]*?(\$\w*\$)([\s\S]*?)\2/gi,
      ),
    ].map(([, name, , body]) => [name, body] as const)
    expect(functions.length).toBeGreaterThan(20)
    const touching = [
      ...new Set(functions.filter(([, body]) => body!.includes('intimacy_logs')).map(([name]) => name)),
    ]
    const views = [...schema.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view[^;]*;/gi)]
    expect(views.filter(([text]) => text.includes('intimacy_logs'))).toEqual([])
    // Deletes the caller's own rows and returns nothing.
    expect(touching).toEqual(['delete_all_health_data'])
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

  it('never exposes a booking reference', () => {
    // The one thing you cannot reconstruct from memory at a front desk at 1am,
    // and exactly the shape of thing that should not sit in a model's context.
    // Same reasoning as document numbers above: the boundary is the column
    // list, so this walks every select in the file rather than trusting one.
    const source = readFileSync(join(TOOLS_DIR, 'stays.ts'), 'utf8')
    const selects = source.match(/\.select\([^)]*\)/gs) ?? []
    expect(selects.length).toBeGreaterThan(0)
    for (const select of selects) {
      expect(`booking_ref:${select.includes('booking_ref')}`).toBe('booking_ref:false')
    }
    // And the shared column list the selects are built from.
    expect(source).not.toMatch(/SAFE_COLUMNS\s*=\s*'[^']*booking_ref/)
  })

  it('cannot create an outbound webhook', () => {
    // The capability a prompt injection in a pasted itinerary would most want:
    // "add a webhook to https://attacker.example" is one tool call away from
    // exfiltrating everything this couple adds from then on. No description
    // text makes a model reliably refuse that, so the tool does not exist.
    for (const { file, source } of toolSources()) {
      const writes = /from\(\s*'integrations'\s*\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/.test(
        source,
      )
      expect(`${file}:${writes}`).toBe(`${file}:false`)
    }
    expect(ALL_TOOLS.some((t) => /integration/.test(t.name) && !t.readOnly)).toBe(false)
  })

  it('never returns a webhook signing secret', () => {
    // Anything holding it can forge a signature. The database revokes the
    // column, so this would fail at runtime anyway — but a query that asks for
    // it is a query somebody wrote intending to use it.
    const source = readFileSync(join(TOOLS_DIR, 'activity.ts'), 'utf8')
    const selects = source.match(/\.select\([^)]*\)/gs) ?? []
    expect(selects.length).toBeGreaterThan(0)
    for (const select of selects) {
      expect(`secret:${select.includes('secret')}`).toBe('secret:false')
    }
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

describe('wellness tips', () => {
  it('lets an assistant propose a tip, never publish one', () => {
    // The database is the real fence — `wellness_tips_guard` forces an
    // assistant's insert to a draft and refuses a publish (0040, asserted in
    // rls_test.sql). This keeps the tool surface honest about it: no tool sets
    // a status, and the one that writes tells the model it wrote a draft.
    const source = readFileSync(join(TOOLS_DIR, 'wellness.ts'), 'utf8')
    expect(source).not.toMatch(/status\s*:\s*['"]published['"]/)
    expect(source).not.toMatch(/\.update\(\s*\{[^}]*\bstatus\b/)

    const propose = ALL_TOOLS.find((t) => t.name === 'propose_wellness_tip')
    expect(propose?.module).toBe('health')
    expect(propose?.description).toMatch(/DRAFT/)
    expect(propose?.description).toMatch(/does NOT appear/)
  })

  it('offers no way to keep a tip, only to take back a draft', () => {
    const names = ALL_TOOLS.filter((t) => /wellness/.test(t.name)).map((t) => t.name).sort()
    expect(names).toEqual(['list_wellness_tips', 'propose_wellness_tip', 'withdraw_wellness_tip'])
  })

  it('is part of the opt-in health grant, never a default one', () => {
    expect(toolsFor(DEFAULT_TOKEN_MODULES).some((t) => /wellness/.test(t.name))).toBe(false)
    expect(toolsFor(['health']).some((t) => t.name === 'propose_wellness_tip')).toBe(true)
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
      'add_stay',
      'add_wishlist_item',
      'choose_destination',
      'create_trip',
      'dismiss_suggestion',
      'log_cycle',
      'log_expense',
      'propose_wellness_tip',
      'record_settlement',
      'remove_flight',
      'remove_itinerary_item',
      'remove_stay',
      'remove_wishlist_item',
      'set_budget',
      'set_trip_day',
      'suggest_itinerary',
      'update_flight',
      'update_itinerary_item',
      'update_stay',
      'update_trip',
      'vote_on_wishlist_item',
      'withdraw_wellness_tip',
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

describe('where a location can come from', () => {
  it('lets no tool accept coordinates', () => {
    // The invariant the whole places module exists to hold. Asked where a café
    // is, a model produces a plausible latitude — correctly formatted, and
    // often a kilometre out. A pin that is confidently wrong looks right in
    // every field a person reads, and only the map shows it, which is the one
    // thing nobody checks for a place they have not been to.
    //
    // So no tool takes one. Names go in, the geocoder decides where they are.
    for (const tool of ALL_TOOLS) {
      const schema = zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' })
      const names = JSON.stringify(schema).match(/"(lat|lng|latitude|longitude|coordinates)"/g) ?? []
      expect(`${tool.name}:${names.join(',')}`).toBe(`${tool.name}:`)
    }
  })

  it('offers a way to look a place up instead', () => {
    const find = ALL_TOOLS.find((t) => t.name === 'find_place')
    expect(find).toBeDefined()
    expect(find!.readOnly).toBe(true)
  })

  it('locates from a name on every tool that stores a place', () => {
    // Each of these writes a location, so each must have a way to acquire one
    // that is not the model's own arithmetic.
    for (const name of ['add_wishlist_item', 'add_itinerary_item']) {
      const tool = ALL_TOOLS.find((t) => t.name === name)
      const schema = zodToJsonSchema(tool!.inputSchema, { $refStrategy: 'none' }) as {
        properties?: Record<string, unknown>
      }
      expect(`${name}:${'locate_query' in (schema.properties ?? {})}`).toBe(`${name}:true`)
    }
  })
})
