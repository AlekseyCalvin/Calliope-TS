#!/usr/bin/env node
// Example MCP client for Calliope TS — Streamable HTTP transport.
// Tests both local and remote HF Space endpoints.
//
// Usage:
//   node examples/mcp-client.mjs [url]
//   Default URL: http://localhost:7860/mcp
//   Remote: https://AlekseyCalvin-cts.hf.space/mcp
//
// Requires: npm install @modelcontextprotocol/sdk
// (already in dev deps of this repo via package.json)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.argv[2] || 'http://localhost:7860/mcp';
console.log(`Connecting to ${url} ...`);

const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: 'calliope-mcp-example', version: '1.0.0' });

await client.connect(transport);
console.log('Connected. Server info:', await client.getServerVersion());

console.log('\n--- tools/list ---');
const { tools } = await client.listTools();
console.log(tools.map(t => `- ${t.name}: ${t.description.slice(0, 80)}...`).join('\n'));

console.log('\n--- scan_poem (summary) ---');
const poem = `Shall I compare thee to a summer's day?
Thou art more lovely and more temperate:
Rough winds do shake the darling buds of May,
And summer's lease hath all too short a date`;

let res = await client.callTool({
  name: 'scan_poem',
  arguments: { text: poem, detail_level: 'summary' }
});
console.log(res.content[0].text.slice(0, 3000));

console.log('\n--- find_rhymes (day) ---');
res = await client.callTool({
  name: 'find_rhymes',
  arguments: { word: 'day', limit: 10 }
});
console.log(res.content[0].text);

console.log('\n--- get_capabilities ---');
res = await client.callTool({
  name: 'get_capabilities',
  arguments: {}
});
console.log(res.content[0].text.slice(0, 1500));

await client.close();
console.log('\nDone.');
