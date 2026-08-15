/**
 * The tool contract, deliberately free of any transport.
 *
 * A tool is a name, a description, a zod schema and a function from context to
 * text. It knows nothing about stdio, nothing about HTTP, and nothing about the
 * MCP SDK's wire types. That is the point: the plan is stdio now and a remote
 * connector later, and when that happens this file and everything importing it
 * should not need to change — only the wrapper around it.
 *
 * Handlers return a string rather than structured JSON because the consumer is
 * a language model. A short paragraph naming the trip and its dates is read
 * more reliably than the same facts as nested objects, and it costs fewer
 * tokens than the JSON would.
 */
import type { z } from 'zod'
import type { ModuleName } from '@/modules/settings/types'
import type { McpContext } from '../context'

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Snake case, verb first. This is what the model calls. */
  name: string
  /**
   * Which module this belongs to. A token scoped without it does not merely
   * refuse the call — the tool is never advertised, so the model does not
   * describe a capability the person deliberately withheld.
   *
   * This is a second fence, not the fence. RLS is what actually stops a read.
   */
  module: ModuleName
  /** A human label for tool pickers. */
  title: string
  /**
   * Written for the model, not for a docs page. Says what the tool does, what
   * it refuses to do, and — where it matters — what happens next, because a
   * model that does not know a write lands in a review tray will report to the
   * user that the plan was updated.
   */
  description: string
  inputSchema: S
  /** True if the tool cannot change anything. Surfaced as an MCP annotation. */
  readOnly: boolean
  handler: (ctx: McpContext, input: z.infer<S>) => Promise<string>
}

/**
 * A tool with its input type erased, which is the only way a heterogeneous
 * array of them can exist.
 *
 * Every tool has a differently-shaped `inputSchema`, and a handler that expects
 * exactly that shape. TypeScript cannot express "the schema and the handler in
 * this record agree with each other" across a list where each element agrees
 * differently, so past that boundary the input is `unknown`.
 */
export interface AnyTool extends Omit<ToolDefinition, 'handler'> {
  handler: (ctx: McpContext, input: unknown) => Promise<string>
}

/**
 * Declare a tool with its schema fully typed, and hand back the erased form.
 *
 * This is the only cast in the tool layer, and it is sound because of an
 * invariant the callers hold: a handler is *only* ever invoked with the result
 * of `inputSchema.parse(...)` on the same object — see `stdio.ts`. Erasing here
 * rather than at each call site keeps every tool body strictly typed against
 * its own schema, which is where mistakes would actually be made.
 */
export function defineTool<S extends z.ZodTypeAny>(tool: ToolDefinition<S>): AnyTool {
  return tool as AnyTool
}

/**
 * Tools that need a couple say so in one place.
 *
 * Solo mode is legitimate — someone signs in days before their partner does —
 * so this reads as an explanation rather than a failure.
 */
export function requireCouple(ctx: McpContext): string {
  if (!ctx.coupleId) {
    throw new Error(
      'There is no couple set up on this account yet, so there is nothing shared to read or write. Create one in the app first.',
    )
  }
  return ctx.coupleId
}
