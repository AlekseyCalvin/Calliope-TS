#!/usr/bin/env python3
"""
Python MCP client for Calliope TS — Streamable HTTP
Requires: pip install mcp
Usage: python examples/mcp-client.py [url]
Default: http://localhost:7860/mcp
Remote: https://AlekseyCalvin-cts.hf.space/mcp
"""
import asyncio
import sys

try:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
except ImportError:
    print("Please install MCP Python SDK: pip install mcp")
    sys.exit(1)

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7860/mcp"

async def main():
    print(f"Connecting to {URL} via Streamable HTTP...")
    async with streamablehttp_client(URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("Initialized")

            tools = await session.list_tools()
            print("\nTools:")
            for t in tools.tools:
                print(f" - {t.name}: {t.description[:80]}...")

            print("\n--- scan_poem ---")
            res = await session.call_tool("scan_poem", {
                "text": "Shall I compare thee to a summer's day?\nThou art more lovely and more temperate:",
                "detail_level": "summary"
            })
            print(res.content[0].text[:4000])

            print("\n--- parse_syntax ---")
            res = await session.call_tool("parse_syntax", {
                "text": "Because I could not stop for Death",
            })
            print(res.content[0].text[:3000])

            print("\n--- find_rhymes ---")
            res = await session.call_tool("find_rhymes", {"word": "time", "limit": 10})
            print(res.content[0].text)

if __name__ == "__main__":
    asyncio.run(main())
