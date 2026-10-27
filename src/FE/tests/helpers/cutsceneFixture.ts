// A realistic motion-comic payload for UI tests, built from the real Lo thuoc thu Nam pixel case (art paths and ids are real).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Beat = { type: 'caption' | 'speech' | 'sfx'; speakerId?: string; text: string; style?: string };

const caseFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json');
export const pixelCase = JSON.parse(readFileSync(caseFile, 'utf8'));
export const caseId: string = pixelCase.caseId;

const scenes: any[] = pixelCase.stages.flatMap((stage: any) => stage.scenes).filter((scene: any) => scene.backgroundUrl);
const characters: any[] = pixelCase.characters.filter((c: any) => c.imageUrl);
const items: any[] = pixelCase.items.filter((i: any) => i.imageUrl);

export const assets = {
  scenes: Object.fromEntries(scenes.map((s) => [s.sceneId, { title: s.title, url: s.backgroundUrl }])),
  characters: Object.fromEntries(characters.map((c) => [c.characterId, { title: c.name, url: c.imageUrl }])),
  items: Object.fromEntries(items.map((i) => [i.itemId, { title: i.name, url: i.imageUrl }])),
  coverUrl: pixelCase.coverImageUrl,
};

const scene = (i: number, focus = [0.05, 0.1, 0.9, 0.8]) => ({ kind: 'scene', id: scenes[i % scenes.length].sceneId, focus });
const cap = (text: string): Beat => ({ type: 'caption', text });
const sfx = (text: string, style: string): Beat => ({ type: 'sfx', text, style });
const panel = (art: any, weather: string, enter: string, beats: Beat[], audio: string[] = []) => ({ art, weather, enter, beats, audio });

/** Three pages, eight panels. Vietnamese with the hardest diacritics, in captions and in sound effects. */
export function makeScript(overrides: Record<string, unknown> = {}) {
  return {
    format: 'motion-comic-v1',
    caseId,
    language: 'vi',
    title: { eyebrow: 'Hồ sơ 01', title: 'Lọ thuốc thứ Năm', subtitle: 'Một buổi sáng, một lọ thuốc và những lời chưa nói hết.' },
    mood: 'rain-night',
    pages: [
      { layout: 'wide-top-two-bottom', panels: [
        panel(scene(0), 'rain', 'top', [cap('Phố Hàng Đường. Sáu giờ bốn mươi sáng.'), cap('Sương còn đọng trên mặt kính đồng hồ quảng trường.')], ['ticking']),
        panel(scene(1), 'fog', 'left', [cap('Nhà số 7 mở cửa sớm hơn mọi ngày.'), sfx('CẠCH.', 'soft')]),
        panel(scene(2), 'streetlight', 'right', [{ type: 'speech', speakerId: characters[1].characterId, text: 'Ông ấy ngồi yên từ nãy, tôi gọi mãi không thưa.' }, sfx('TÚT. TÚT.', 'phone')], ['ring']),
      ] },
      { layout: 'tall-left-two-right', panels: [
        panel(scene(3), 'rain', 'bottom', [cap('Một lọ thuốc nhỏ nằm cạnh ghế bành.'), cap('Nhãn dán ngày Thứ Năm, nét chữ hơi run.')]),
        panel({ kind: 'item', id: items[0].itemId, focus: [0.1, 0.1, 0.8, 0.8] }, 'none', 'right', [cap('Chiếc kính lúp vẫn mở sẵn trên bàn.'), sfx('CHOANG!', 'glass')], ['shatter']),
        panel({ kind: 'character', id: characters[0].characterId, focus: [0.1, 0.05, 0.8, 0.8] }, 'night', 'bottom', [cap('Ai cũng có lý do để có mặt ở đây.'), { type: 'speech', speakerId: characters[0].characterId, text: 'Tôi chỉ ghé qua thăm bác một lát thôi mà.' }]),
      ] },
      { layout: 'splash-inset', panels: [
        panel({ kind: 'cover', id: 'cover', focus: [0, 0, 1, 1] }, 'sunrise', 'none', [cap('Hộp nữ trang mở toang. Tờ di chúc có dấu bị sửa.'), sfx('ẦM!!', 'thunder')], ['thunder']),
        panel(scene(4), 'fog', 'left', [cap('Hai thám tử. Một buổi sáng để lần theo dấu vết.'), cap('Bắt đầu thôi.')]),
      ] },
    ],
    ...overrides,
  };
}

export const playable = (script: any = makeScript()) => ({ caseId, trigger: 'INTRO', version: 1, script, assets });
