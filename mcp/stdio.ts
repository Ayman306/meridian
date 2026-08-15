/**
 * The stdio MCP server. A thin wrapper and nothing else.
 *
 * Everything with an opinion lives in `src/mcp/` — the tools, the scoping, the
 * context. This file translates between that and the MCP wire protocol, which
 * is the only reason it exists and the reason it should stay short: the remote
 * HTTP connector, when it comes, is a different file of the same size wrapping
 * the identical registry.
 *
 * Run it with `npm run mcp`. It speaks on stdin/stdout, so **nothing may ever
 * be written to stdout** except protocol frames — a stray `console.log` would
 * corrupt the stream and the client would drop the connection with an error
 * that points nowhere near the print. Diagnostics go to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { toolsFor } from '../src/mcp/registry'
import { contextForCall, currentSession } from './session'

const server = new Server(
  { name: 'meridian', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

/**
 * The tool list depends on the token's scope, so it is resolved per request
 * rather than at startup. A token narrowed to trips should not see money tools
 * described at all — a model told a capability exists will offer it, and being
 * refused later is a worse experience than never being offered.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const session = await currentSession()
  return {
    tools: toolsFor(session.modules).map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' }),
      annotations: { readOnlyHint: tool.readOnly },
    })),
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const session = await currentSession()
  const tool = toolsFor(session.modules).find((t) => t.name === request.params.name)

  // Scope is re-checked here and not only in the listing. The two handlers are
  // separate requests, and a client that cached an older list — or was simply
  // asked to call something it invented — must not get through on that basis.
  if (!tool) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `No tool called "${request.params.name}" is available to this token.`,
        },
      ],
    }
  }

  try {
    const input = tool.inputSchema.parse(request.params.arguments ?? {})
    const text = await tool.handler(await contextForCall(), input)
    return { content: [{ type: 'text' as const, text }] }
  } catch (error) {
    // Returned as a tool error rather than thrown: a protocol-level failure
    // ends the turn, while this lets the model read what went wrong and try
    // something else — usually a missing id it can go and look up.
    const message = error instanceof Error ? error.message : String(error)
    return { isError: true, content: [{ type: 'text' as const, text: message }] }
  }
})

async function main() {
  await server.connect(new StdioServerTransport())
  // stderr, never stdout. See the note at the top.
  console.error('meridian mcp server ready')
}

main().catch((error: unknown) => {
  console.error('meridian mcp server failed to start:', error)
  process.exit(1)
})
