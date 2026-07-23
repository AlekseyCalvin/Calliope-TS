#!/usr/bin/env node
// Example SSE (legacy) MCP client for Calliope TS
// Useful for testing /sse endpoint which many desktop clients still use.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const url = process.argv[2] || 'http://localhost:7860/sse';
console.log(`Connecting via SSE to ${url} ...`);

const transport = new SSEClientTransport(new URL(url));
const client = new Client({ name: 'calliope-mcp-sse-example', version: '1.0.0' });

await client.connect(transport);
console.log('Connected.');

const { tools } = await client.listTools();
console.log(tools.map(t => t.name).join(', '));

const res = await client.callTool({
  name: 'scan_line',
  arguments: { text: 'Because I could not stop for Death', engine: 'calliope' }
});
console.log(res.content[0].text.slice(0, 4000));

await client.close();
