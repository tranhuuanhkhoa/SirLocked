/** pixellab_character_zip: saves a PixelLab character zip on this machine so asset_process npc_bundle can read it. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { StudioError } from '../bridge-client.js';
import { display, safeId, tmpDir } from '../files.js';
import type { ToolContext } from './context.js';

export const PIXELLAB_BASE = 'https://api.pixellab.ai';
const CHARACTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

export async function pixellabCharacterZip(ctx: ToolContext, args: { draftId: string; npcId: string; characterId: string }) {
  const draftId = safeId(args.draftId, 'draftId');
  const npcId = safeId(args.npcId, 'npcId');
  const characterId = String(args.characterId ?? '').trim();
  if (!CHARACTER_ID.test(characterId)) throw new StudioError('BAD_ID', `characterId không phải mã nhân vật PixelLab: "${characterId}".`);
  const url = `${ctx.config.pixellabBase ?? PIXELLAB_BASE}/mcp/characters/${characterId}/download`;
  const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(ctx.config.httpTimeoutMs, 60_000)) });
  if (!response.ok) throw new StudioError('DOWNLOAD_FAILED', `PixelLab trả ${response.status} khi tải nhân vật ${characterId}.`, response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ZIP_BYTES) throw new StudioError('ZIP_TOO_LARGE', 'File zip lớn hơn 50 MB.');
  let names: string[];
  try { names = Object.keys(unzipSync(new Uint8Array(bytes))); } catch { throw new StudioError('ZIP_INVALID', 'File tải về không phải zip.'); }
  if (!names.some((name) => /(^|\/)rotations\/south\.png$/.test(name))) {
    throw new StudioError('ZIP_INVALID', 'Zip không có rotations/south.png: nhân vật chưa vẽ xong hướng nam?');
  }
  const idleFrames = names.filter((name) => /(^|\/)animations\/[^/]*idle[^/]*\/south\/[^/]+\.png$/i.test(name)).length;
  const dir = tmpDir(ctx.config, 'pixellab', draftId, 'chars', npcId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'character.zip');
  writeFileSync(file, bytes);
  return {
    draftId, npcId, characterId, file: display(ctx.config, file), bytes: bytes.length, idleFrames,
    // npc_bundle names its default folder after the input file, and every zip here is character.zip: give each NPC its own.
    next: idleFrames ? `asset_process { op: "npc_bundle", input: "${display(ctx.config, file)}", output: "${display(ctx.config, path.join(dir, 'bundle'))}" }` :'Nhân vật chưa có hoạt ảnh thở (idle) hướng nam: animate_character trước rồi tải lại.',
  };
}
