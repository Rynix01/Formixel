# Optional minimal MCP adapter

The default integration is CLI/files. For clients requiring MCP, run:

```sh
node /absolute/path/to/Formixel/packages/mcp/dist/index.js
```

Example client configuration (use your real absolute path):

```json
{
  "mcpServers": {
    "formixel": {
      "command": "node",
      "args": ["/absolute/path/to/Formixel/packages/mcp/dist/index.js"]
    }
  }
}
```

The source-only tools are `formixel_validate`, `formixel_inspect`, `formixel_build`. Every call receives `{"source":"model x cube a [0,0,0] [1,1,1]"}`. Build returns JSON `.bbmodel` text in MCP text content; inspect returns a summary; validation returns a report or tool error. Inputs are bounded and parsed locally. No path, provider or shell arguments exist. Do not advertise 70 small editor tools; keep this adapter compact.

Transport: [MCP stdio specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), newline-delimited JSON-RPC 2.0, protocol `2025-06-18`. Implemented methods: initialize, ping, tools/list, tools/call. Notifications are ignored without responses, unknown request methods return method-not-found, malformed frames return parse error. Tool execution failures set `isError`. stdout contains only protocol messages. No HTTP transport, resources, prompts, subscriptions, cancellation, provider execution or progress streaming. Official MCP Node SDK stdio client tests cover initialization, discovery, model building and validation failure. This is interoperability evidence for these methods, not a claim that optional unimplemented features exist. For standalone release configuration, replace the source dist path with /absolute/path/to/formixel-mcp.mjs.
