import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The public shell contains media only. Case JSON, source maps and private draft
// metadata must not become downloadable just because they exist under public/.
const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.wav', '.mp3', '.ogg', '.m4a', '.flac', '.woff', '.woff2', '.ttf']);
const isPackagedMedia = (name) => mediaExtensions.has(path.posix.extname(name).toLowerCase());

export function collectCaseAssetPaths(value, output = new Set()) {
  if (typeof value === 'string' && value.startsWith('/assets/')) {
    const pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    if (pathname.includes('\\') || pathname.split('/').some((part) => part === '..' || part === '.')) throw new Error('Unsafe case asset path.');
    if (!isPackagedMedia(pathname) || /[\u0000-\u001f\u007f]/.test(pathname)) throw new Error('Case assets must reference an allowed public media file.');
    output.add(pathname.slice(1));
  } else if (Array.isArray(value)) value.forEach((entry) => collectCaseAssetPaths(entry, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => collectCaseAssetPaths(entry, output));
  return output;
}

export async function createCaseAssetManifest(publicDirectory, caseFiles) {
  const sourceRoot = await fs.realpath(publicDirectory);
  const selected = new Set();
  const derivedSprites = new Set();
  const cases = [];
  for (const file of caseFiles) {
    const document = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof document.caseId !== 'string' || !Array.isArray(document.stages)) throw new Error(`Expected a published case document: ${file}`);
    cases.push(document.caseId);
    collectCaseAssetPaths(document, selected);
    // The renderer can derive both a generic and scene-specific NPC sprite from
    // imageUrl. They are optional fallbacks, so include those that actually exist.
    const scenes = document.stages.flatMap((stage) => stage.scenes || []).map((scene) => scene.sceneId);
    for (const character of document.characters || []) {
      const portrait = character.imageUrl;
      if (typeof portrait !== 'string' || !portrait.startsWith('/assets/') || !portrait.includes('-portrait')) continue;
      collectCaseAssetPaths(portrait.replace('-portrait', '-sprite'), derivedSprites);
      for (const sceneId of scenes) collectCaseAssetPaths(portrait.replace('-portrait', `-${sceneId}-sprite`), derivedSprites);
    }
  }
  // Shared player/menu/legacy assets are the fixed game shell; generated cases are opt-in.
  async function walk(directory, relative = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (name === 'assets/ai-generated') continue;
      if (entry.isSymbolicLink()) throw new Error(`Public asset symlinks are not packaged: ${name}`);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name);
      else if (isPackagedMedia(name)) selected.add(name);
    }
  }
  await walk(sourceRoot);
  for (const name of derivedSprites) {
    try {
      const full = await fs.realpath(path.resolve(sourceRoot, name));
      if (!full.startsWith(sourceRoot + path.sep)) throw new Error('Sprite escapes public directory.');
      selected.add(name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const assets = [];
  for (const name of [...selected].sort()) {
    const absolute = await fs.realpath(path.resolve(sourceRoot, name));
    if (!absolute.startsWith(sourceRoot + path.sep)) throw new Error(`Asset escapes the public directory: ${name}`);
    const bytes = await fs.readFile(absolute);
    assets.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    // Legacy NPC rendering derives a sprite from its portrait filename.
    if (name.includes('-portrait.')) {
      const sprite = name.replace('-portrait.', '-sprite.');
      if (!selected.has(sprite)) {
        try {
          const full = await fs.realpath(path.resolve(sourceRoot, sprite));
          if (!full.startsWith(sourceRoot + path.sep)) throw new Error('Sprite escapes public directory.');
          const data = await fs.readFile(full);
          selected.add(sprite);
          assets.push({ path: sprite, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  return { version: 1, cases: [...new Set(cases)].sort(), totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), assets: assets.sort((a, b) => a.path.localeCompare(b.path)) };
}

export function caseAssetPackagingPlugin(caseFiles) {
  let config;
  return {
    name: 'sirlocked-case-assets', apply: 'build',
    configResolved(resolved) { config = resolved; },
    async closeBundle() {
      const sourceRoot = path.resolve(config.root, 'public');
      const outputRoot = path.resolve(config.root, config.build.outDir);
      const manifest = await createCaseAssetManifest(sourceRoot, caseFiles);
      for (const asset of manifest.assets) {
        const destination = path.resolve(outputRoot, asset.path);
        if (!destination.startsWith(outputRoot + path.sep)) throw new Error('Asset destination escapes build directory.');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.resolve(sourceRoot, asset.path), destination);
      }
      await fs.writeFile(path.join(outputRoot, 'case-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
      console.log(`Case assets: ${manifest.cases.length} case(s), ${manifest.assets.length} files, ${(manifest.totalBytes / 1048576).toFixed(1)} MiB.`);
    }
  };
}
