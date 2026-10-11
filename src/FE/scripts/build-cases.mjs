import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaseAssetManifest } from './case-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const cases = [];
let reportOnly = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--case' && args[index + 1]) cases.push(path.resolve(args[++index]));
  else if (args[index] === '--report-only') reportOnly = true;
  else throw new Error(`Unknown argument: ${args[index]}`);
}
if (!cases.length) throw new Error('Provide one or more --case paths to final case JSON exports.');
const manifest = await createCaseAssetManifest(path.join(root, 'public'), cases);
if (reportOnly) {
  console.log(JSON.stringify({ cases: manifest.cases, files: manifest.assets.length, totalBytes: manifest.totalBytes }, null, 2));
} else {
  process.env.SIRLOCKED_CASE_FILES = JSON.stringify(cases);
  const { build } = await import('vite');
  await build({ root, configFile: path.join(root, 'vite.config.js') });
}
