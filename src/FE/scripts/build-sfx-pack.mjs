// Builds the CC0 sound pack of the game (public/assets/audio/sfx/) from Kenney's packs, with ffmpeg:
// trims leading silence, mono 44.1 kHz, levels every file to the same loudness (mean -20 dB, peak at most -1 dB),
// writes .ogg (Vorbis) and .mp3, and writes LICENSES.json (file, source, link, licence).
//
//   node scripts/build-sfx-pack.mjs --packs <folder> --ffmpeg <ffmpeg.exe> [--synth <folder of the sample's sfx>]
//
// <folder> holds the three packs as downloaded (only CC0 files are used):
//   ui-audio/          Kenney "UI Audio" (WAV, mirror github.com/Calinou/kenney-ui-audio)
//   interface-sounds/  Kenney "Interface Sounds" (OGG, opengameart.org/content/interface-sounds)
//   rpg-audio/         Kenney "RPG Audio" (OGG, opengameart.org/content/50-rpg-sound-effects)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUZZLE_KINDS, PUZZLE_PROBE_KINDS, SFX_ROOT, UI_CUES } from '../Client/js/game/atmosphere/sfxCatalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.resolve(here, '..', 'public', 'assets', 'audio', 'sfx');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const packs = arg('packs');
const ffmpeg = arg('ffmpeg') ?? 'ffmpeg';
const synth = arg('synth');
if (!packs) throw new Error('--packs <folder> is required');

const CC0 = 'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)';
const PACKS = {
  ui: { name: 'Kenney UI Audio', dir: 'ui-audio', link: 'https://kenney.nl/assets/ui-audio', mirror: 'https://github.com/Calinou/kenney-ui-audio' },
  iface: { name: 'Kenney Interface Sounds', dir: 'interface-sounds', link: 'https://kenney.nl/assets/interface-sounds', mirror: 'https://opengameart.org/content/interface-sounds' },
  rpg: { name: 'Kenney RPG Audio', dir: 'rpg-audio', link: 'https://kenney.nl/assets/rpg-audio', mirror: 'https://opengameart.org/content/50-rpg-sound-effects' },
};

/** target (relative to sfx/, no extension) -> [pack, source file, labels] */
const MAP = {
  'ui/dialogue': ['iface', 'question_002.ogg', ['giao diện', 'hỏi', 'thoại']],
  'ui/discovery': ['iface', 'confirmation_001.ogg', ['giao diện', 'tìm thấy', 'manh mối']],
  'ui/reveal': ['iface', 'confirmation_003.ogg', ['giao diện', 'lật mở', 'thành công']],
  'ui/scene': ['rpg', 'doorOpen_1.ogg', ['giao diện', 'chuyển cảnh', 'cửa']],
  'ui/ping': ['iface', 'bong_001.ogg', ['giao diện', 'gọi đồng đội', 'chuông']],
  'ui/interact': ['ui', 'click1.wav', ['giao diện', 'bấm', 'khám nghiệm']],
  'ui/error': ['iface', 'error_004.ogg', ['giao diện', 'lỗi', 'sai']],
  'puzzle/balance_scale-tap': ['rpg', 'handleCoins.ogg', ['giải đố', 'cân', 'quả cân', 'đồng xu']],
  'puzzle/balance_scale-probe': ['rpg', 'metalPot2.ogg', ['giải đố', 'cân', 'cân thử', 'kim loại']],
  'puzzle/balance_scale-solve': ['iface', 'confirmation_002.ogg', ['giải đố', 'cân', 'giải xong']],
  'puzzle/balance_scale-wrong': ['iface', 'error_006.ogg', ['giải đố', 'cân', 'sai']],
  'puzzle/doc_forgery-tap': ['rpg', 'bookFlip1.ogg', ['giải đố', 'giấy tờ', 'lật giấy']],
  'puzzle/doc_forgery-solve': ['rpg', 'bookClose.ogg', ['giải đố', 'giấy tờ', 'giải xong']],
  'puzzle/doc_forgery-wrong': ['iface', 'error_003.ogg', ['giải đố', 'giấy tờ', 'sai']],
  'puzzle/fingerprint-tap': ['rpg', 'cloth3.ogg', ['giải đố', 'vân tay', 'rắc bột', 'chổi']],
  'puzzle/fingerprint-solve': ['iface', 'maximize_003.ogg', ['giải đố', 'vân tay', 'khớp']],
  'puzzle/fingerprint-wrong': ['iface', 'error_005.ogg', ['giải đố', 'vân tay', 'sai']],
  'puzzle/gear_train-tap': ['iface', 'switch_004.ogg', ['giải đố', 'bánh răng', 'cơ khí']],
  'puzzle/gear_train-solve': ['rpg', 'metalLatch.ogg', ['giải đố', 'bánh răng', 'giải xong']],
  'puzzle/gear_train-wrong': ['iface', 'glitch_002.ogg', ['giải đố', 'bánh răng', 'kẹt']],
  'puzzle/lockpick-tap': ['rpg', 'metalClick.ogg', ['giải đố', 'mở khóa', 'kim loại']],
  'puzzle/lockpick-probe': ['ui', 'switch7.wav', ['giải đố', 'mở khóa', 'thử chốt']],
  'puzzle/lockpick-solve': ['rpg', 'doorOpen_2.ogg', ['giải đố', 'mở khóa', 'mở cửa']],
  'puzzle/lockpick-wrong': ['iface', 'error_001.ogg', ['giải đố', 'mở khóa', 'sai']],
  'puzzle/music_box-tap': ['iface', 'pluck_001.ogg', ['giải đố', 'hộp nhạc', 'gảy']],
  'puzzle/music_box-solve': ['iface', 'maximize_008.ogg', ['giải đố', 'hộp nhạc', 'giải xong']],
  'puzzle/music_box-wrong': ['iface', 'error_007.ogg', ['giải đố', 'hộp nhạc', 'sai']],
  'puzzle/parallax_code-tap': ['iface', 'glass_002.ogg', ['giải đố', 'thấu kính', 'thủy tinh']],
  'puzzle/parallax_code-solve': ['iface', 'glass_005.ogg', ['giải đố', 'thấu kính', 'giải xong']],
  'puzzle/parallax_code-wrong': ['iface', 'error_008.ogg', ['giải đố', 'thấu kính', 'sai']],
  'puzzle/reagent_mix-tap': ['iface', 'drop_002.ogg', ['giải đố', 'thuốc thử', 'giọt']],
  'puzzle/reagent_mix-solve': ['iface', 'glass_006.ogg', ['giải đố', 'thuốc thử', 'ống nghiệm']],
  'puzzle/reagent_mix-wrong': ['iface', 'glitch_004.ogg', ['giải đố', 'thuốc thử', 'sai']],
  'puzzle/tilt_maze-tap': ['iface', 'tick_002.ogg', ['giải đố', 'mê cung', 'viên bi']],
  'puzzle/tilt_maze-solve': ['iface', 'drop_004.ogg', ['giải đố', 'mê cung', 'bi vào ổ']],
  'puzzle/tilt_maze-wrong': ['iface', 'back_001.ogg', ['giải đố', 'mê cung', 'sai']],
  'puzzle/torn_paper-tap': ['iface', 'scratch_002.ogg', ['giải đố', 'giấy rách', 'ghép mảnh']],
  'puzzle/torn_paper-solve': ['rpg', 'bookPlace1.ogg', ['giải đố', 'giấy rách', 'giải xong']],
  'puzzle/torn_paper-wrong': ['iface', 'error_002.ogg', ['giải đố', 'giấy rách', 'sai']],
  'puzzle/classic-tap': ['ui', 'switch3.wav', ['giải đố', 'mã số', 'thứ tự', 'ký hiệu']],
  'puzzle/classic-solve': ['iface', 'confirmation_004.ogg', ['giải đố', 'mã số', 'giải xong']],
  'puzzle/classic-wrong': ['iface', 'back_002.ogg', ['giải đố', 'mã số', 'sai']],
};

// Every cue and every kind/event the game asks for must have a file.
for (const cue of UI_CUES) if (!MAP[`ui/${cue}`]) throw new Error(`No sound for cue ${cue}`);
for (const kind of PUZZLE_KINDS) {
  for (const event of ['tap', 'solve', 'wrong', ...(PUZZLE_PROBE_KINDS.includes(kind) ? ['probe'] : [])]) {
    if (!MAP[`puzzle/${kind}-${event}`]) throw new Error(`No sound for ${kind} ${event}`);
  }
}

function findSource(pack, file) {
  const root = path.join(packs, PACKS[pack].dir);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (name === file) return full;
    }
  }
  throw new Error(`Missing ${file} in ${root}`);
}

/** Mean and peak level (dB) after the given filters; volumedetect prints them on stderr. */
function volumes(file, filters) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', `${filters},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  const text = String(result.stderr ?? '');
  return { mean: Number(/mean_volume: (-?[\d.]+) dB/.exec(text)?.[1]), max: Number(/max_volume: (-?[\d.]+) dB/.exec(text)?.[1]) };
}

const TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005,aformat=channel_layouts=mono,aresample=44100';
const TARGET_MEAN = -20;
const PEAK_LIMIT = -1;

const entries = [];
let total = 0;
async function main() {
  for (const [target, [pack, file, labels]] of Object.entries(MAP)) {
    const source = findSource(pack, file);
    const { mean, max } = volumes(source, TRIM);
    if (!Number.isFinite(mean) || !Number.isFinite(max)) throw new Error(`Could not measure ${source}`);
    const gain = Math.round(Math.min(TARGET_MEAN - mean, PEAK_LIMIT - max) * 10) / 10;
    const filters = `${TRIM},volume=${gain}dB`;
    const outBase = path.join(outRoot, ...target.split('/'));
    mkdirSync(path.dirname(outBase), { recursive: true });
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-af', filters, '-c:a', 'libvorbis', '-q:a', '3', `${outBase}.ogg`]);
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-af', filters, '-c:a', 'libmp3lame', '-b:a', '64k', `${outBase}.mp3`]);
    const bytes = statSync(`${outBase}.ogg`).size + statSync(`${outBase}.mp3`).size;
    total += bytes;
    const [group, name] = target.split('/');
    const [kind, event] = group === 'puzzle' ? name.split(/-(?=[a-z]+$)/) : [undefined, undefined];
    entries.push({
      file: `${SFX_ROOT}/${target}.ogg`,
      fallback: `${SFX_ROOT}/${target}.mp3`,
      use: group === 'ui' ? { cue: name } : { puzzleKind: kind, event },
      labels,
      source: PACKS[pack].name,
      sourceFile: file,
      link: PACKS[pack].link,
      downloadedFrom: PACKS[pack].mirror,
      author: 'Kenney (www.kenney.nl)',
      license: CC0,
      levelDb: gain,
    });
  }
  // The sample case's self-synthesized set, kept as a fallback of the interface cues.
  const synthEntries = [];
  if (synth && existsSync(synth)) {
    const dir = path.join(outRoot, 'tu-tong-hop');
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(synth).filter((n) => /\.(ogg|mp3)$/.test(n))) {
      copyFileSync(path.join(synth, name), path.join(dir, name));
      total += statSync(path.join(dir, name)).size;
      if (name.endsWith('.ogg')) {
        const base = name.replace(/\.ogg$/, '');
        synthEntries.push({
          file: `${SFX_ROOT}/tu-tong-hop/${base}.ogg`,
          fallback: `${SFX_ROOT}/tu-tong-hop/${base}.mp3`,
          use: UI_CUES.includes(base) ? { cue: base, role: 'fallback' } : { name: base, role: 'sample-case' },
          labels: ['tự tổng hợp', 'dự phòng', base],
          source: 'Sir Locked (vụ mẫu "Đồng hồ bỏ túi đêm mưa")',
          sourceFile: name,
          link: 'tools/studio-mcp (bot xưởng), Claude outputs/vu-an-mau/dong-ho-dem-mua/nguon/build_assets.py',
          downloadedFrom: null,
          author: 'Claude (bot xưởng Sir Locked)',
          license: 'Sir Locked (tự tổng hợp bằng code, dùng tự do trong dự án)',
        });
      }
    }
  }
  const licenses = {
    note: 'Gói tiếng hiệu ứng của game. File Kenney đều CC0 (không bắt buộc ghi tên, vẫn ghi để tra cứu). Gói Impact Sounds không tải được (kenney.nl chỉ cho tải qua trang có JavaScript, bản sao trên GitHub đã gỡ), nên tiếng va chạm lấy từ RPG Audio cùng tác giả, cùng giấy phép. Mỗi file có .ogg và .mp3, đã chuẩn hóa bằng ffmpeg: cắt im lặng đầu, mono 44,1 kHz, mức trung bình -20 dB, đỉnh tối đa -1 dB.',
    packs: Object.values(PACKS).map(({ name, link, mirror }) => ({ name, link, downloadedFrom: mirror, author: 'Kenney (www.kenney.nl)', license: CC0 })),
    sfx: entries,
    fallback: synthEntries,
    totalBytes: total,
  };
  writeFileSync(path.join(outRoot, 'LICENSES.json'), `${JSON.stringify(licenses, null, 1)}\n`);
  console.log(JSON.stringify({ files: entries.length * 2 + synthEntries.length * 2, totalBytes: total, totalMB: Math.round(total / 1048576 * 100) / 100 }));
  if (total > 3 * 1024 * 1024) throw new Error(`Sound pack is ${total} bytes, over the 3 MB budget.`);
}
await main();
