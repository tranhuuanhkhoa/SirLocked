#!/usr/bin/env node
// VUAN-7: image runner of paid VIP orders, for the studio VPS (no AI, no PixelLab). Needs SIRLOCKED_BRIDGE_KEY and
// SIRLOCKED_API in the environment, and a built studio (npm run build).
//   node scripts/vip-asset-runner.mjs --once          one pass, then exit (cron, tests)
//   node scripts/vip-asset-runner.mjs --interval 60   keep running, one pass every 60 seconds (tmux, systemd)
import { loadConfig } from '../dist/src/config.js';
import { createContext } from '../dist/src/tools/context.js';
import { runOnce } from '../dist/src/vipRunner.js';

const args = process.argv.slice(2);
const once = args.includes('--once');
const at = args.indexOf('--interval');
const interval = Math.max(15, Number(at >= 0 ? args[at + 1] : 60) || 60);
const config = loadConfig();
if (!config.bridgeKey) {
  console.error('SIRLOCKED_BRIDGE_KEY is not set: the runner cannot reach the bridge.');
  process.exit(2);
}
const ctx = createContext(config);
const log = { info: (message) => console.log(new Date().toISOString(), message), warn: (message) => console.warn(new Date().toISOString(), message) };

async function pass() {
  try {
    const result = await runOnce(ctx, log);
    if (result.completed.length || result.released.length)
      log.info(`pass: ${result.completed.length} complete, ${result.uploaded} picture(s), ${result.released.length} released`);
  } catch (error) {
    log.warn(`pass failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await pass();
if (!once) setInterval(pass, interval * 1000);
