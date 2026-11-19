#!/usr/bin/env node
/**
 * sirlocked-studio MCP server (stdio). Configured by environment variables only:
 *   SIRLOCKED_API         default https://sirlocked.id.vn (local: http://localhost:5000)
 *   SIRLOCKED_BRIDGE_KEY  the bot's bridge key (Yen sets it; never printed)
 * Nothing is written to stdout except the MCP protocol; notes go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createStudioServer } from './server.js';
import { createContext } from './tools/context.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createStudioServer(createContext(config));
  await server.connect(new StdioServerTransport());
  process.stderr.write(`sirlocked-studio: API ${config.apiBase}, bridge key ${config.bridgeKey ? 'set' : 'MISSING'}, repo ${config.repoRoot}\n`);
}

main().catch((error) => {
  process.stderr.write(`sirlocked-studio failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
