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
  FORBIDDEN_MODULES,
  GRANTABLE_MODULES,
  toolsFor,
} from './registry'

const TOOLS_DIR = join(process.cwd(), 'src/mcp/tools')

function toolSources(): { file: string; source: string }[] {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((file) => ({ file, source: readFileSync(join(TOOLS_DIR, file), 'utf8') }))
}

describe('what a token can never reach', () => {
  it('registers no tool in a forbidden module', () => {
    const offenders = ALL_TOOLS.filter((tool) =>
      (FORBIDDEN_MODULES as string[]).includes(tool.module),
    )
    expect(offenders.map((t) => t.name)).toEqual([])
  })

  it('keeps health and documents forbidden', () => {
    // Named explicitly rather than derived, so widening the list is a visible
    // edit to this assertion and not a silent consequence of another change.
    expect(FORBIDDEN_MODULES).toContain('health')
    expect(FORBIDDEN_MODULES).toContain('documents')
  })

  it('never offers a forbidden module as grantable', () => {
    for (const forbidden of FORBIDDEN_MODULES) {
      expect(GRANTABLE_MODULES).not.toContain(forbidden)
      expect(DEFAULT_TOKEN_MODULES).not.toContain(forbidden)
    }
  })

  it('drops a forbidden module even when a token row somehow carries one', () => {
    // Tokens outlive code. A row granting `health` must produce no health
    // tools rather than an error that breaks every other call the token makes.
    const tools = toolsFor(['trips', 'health', 'documents'])
    expect(tools.every((t) => !(FORBIDDEN_MODULES as string[]).includes(t.module))).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
  })

  it('names no health table anywhere in the tool layer', () => {
    // The registry check above relies on tools declaring their module
    // honestly. This one does not: a tool mislabelled `trips` that queried
    // `cycle_logs` would pass every assertion above and fail this one.
    for (const { file, source } of toolSources()) {
      for (const table of ['cycle_logs', 'health_records', 'health_consents', 'documents']) {
        expect(`${file}:${source.includes(table)}`).toBe(`${file}:false`)
      }
    }
  })
})

describe('nothing auto-inserts', () => {
  it('never inserts into itinerary_items', () => {
    // Non-negotiable #5. Reading the itinerary is fine and `get_itinerary`
    // does; writing to it from here is not, and `suggest_itinerary` goes to
    // `suggestion_tray` instead. A future tool that skipped the tray would
    // almost certainly do it with `.from('itinerary_items').insert(`.
    for (const { file, source } of toolSources()) {
      const writesDirectly = /from\(\s*'itinerary_items'\s*\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/.test(
        source,
      )
      expect(`${file}:${writesDirectly}`).toBe(`${file}:false`)
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
    expect(writes.sort()).toEqual(['add_wishlist_item', 'log_expense', 'suggest_itinerary'])
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
