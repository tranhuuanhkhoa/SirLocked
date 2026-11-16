import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * VUAN-5: every song of the music library loops without a gap or a click, in a real browser.
 *
 * For each song and each format (.ogg, and the .mp3 a browser without Ogg gets), the page decodes the file with Web
 * Audio and plays it three times in a row exactly as the game does (AudioBufferSourceNode, loop on, loopStart/loopEnd
 * from the index, start at loopStart) through an OfflineAudioContext, then measures the two seams of the rendered
 * audio: the sample step across the seam against the steps around it (a click), and the quietest 10 ms near the seam
 * against the song's own level (a gap). Same measure as tools/music-gen/audio_lib.py seam_report.
 */
type Track = { id: string; file: string; fallback: string; loopStartSec: number; loopEndSec: number; durationSec: number };
const index = JSON.parse(readFileSync(path.resolve('public/assets/audio/music/index.json'), 'utf8')) as { tracks: Track[] };

/** A seam step this many times the larger of (song's 99.9th percentile step, biggest step within 50 ms) is a click. */
const CLICK_LIMIT = 2;
/** The quietest 10 ms near a seam may be this far below the song's average level, or no quieter than the song gets anyway. */
const GAP_LIMIT_DB = 35;

test.describe.configure({ mode: 'parallel' });

for (const track of index.tracks) {
  test(`${track.id} loops three times without a gap or a click (ogg and mp3)`, async ({ page }) => {
    await page.goto('/assets/audio/music/index.json');
    for (const url of [track.file, track.fallback]) {
      const result = await page.evaluate(async ({ url, loopStartSec, loopEndSec }) => {
        const data = await (await fetch(url)).arrayBuffer();
        const rate = 44100;
        const probe = new OfflineAudioContext(2, rate, rate);
        const buffer = await probe.decodeAudioData(data);
        // The game's rules (audioController.ts): loopStart when inside the file, loopEnd capped at the file's end.
        const start = loopStartSec < buffer.duration ? loopStartSec : 0;
        const end = Math.min(loopEndSec, buffer.duration);
        const loopSamples = Math.round((end - start) * rate);
        const length = loopSamples * 3;
        const context = new OfflineAudioContext(2, length, rate);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = start;
        source.loopEnd = end;
        source.connect(context.destination);
        source.start(0, start);
        const rendered = await context.startRendering();
        const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
        const mono = new Float32Array(length);
        for (let i = 0; i < length; i++) mono[i] = (left[i] + right[i]) / 2;
        const diff = new Float32Array(length - 1);
        for (let i = 0; i < length - 1; i++) diff[i] = Math.abs(mono[i + 1] - mono[i]);
        const firstLap = Array.from(diff.subarray(0, loopSamples)).sort((a, b) => a - b);
        const typical = firstLap[Math.floor(firstLap.length * 0.999)] + 1e-9;
        let sum = 0;
        for (let i = 0; i < loopSamples; i++) sum += mono[i] * mono[i];
        const average = Math.sqrt(sum / loopSamples) + 1e-12;
        const win = Math.round(rate * 0.01);
        const rms = (from: number) => { let s = 0; for (let i = from; i < from + win; i++) s += mono[i] * mono[i]; return Math.sqrt(s / win); };
        // The song's own quiet moments: the 2nd percentile of its 10 ms levels.
        const levels: number[] = [];
        for (let i = 0; i + win <= loopSamples; i += win) levels.push(rms(i));
        levels.sort((a, b) => a - b);
        const usualQuiet = levels[Math.floor(levels.length * 0.02)];
        const seams = [];
        for (const seam of [loopSamples, loopSamples * 2]) {
          let step = 0, around = 0;
          for (let i = seam - 3; i < seam + 2; i++) step = Math.max(step, diff[i]);
          for (let i = seam - Math.round(rate * 0.05); i < seam - 3; i++) around = Math.max(around, diff[i]);
          for (let i = seam + 3; i < seam + Math.round(rate * 0.05); i++) around = Math.max(around, diff[i]);
          let quiet = Infinity;
          for (let i = seam - 10 * win; i + win <= seam + 10 * win; i += Math.floor(win / 2)) quiet = Math.min(quiet, rms(i));
          seams.push({ click: step / Math.max(typical, around), gapDb: 20 * Math.log10(average / (quiet + 1e-12)), quiet, usualQuiet });
        }
        return { duration: buffer.duration, rate: buffer.sampleRate, average, seams };
      }, { url, loopStartSec: track.loopStartSec, loopEndSec: track.loopEndSec });

      // The loop end lies inside the decoded audio. Chromium keeps a few hundred samples of Vorbis block padding
      // after the last real sample, which is why every song states loopEndSec to the sample: the game loops there.
      expect(result.duration, `${url}: ${result.duration}s`).toBeGreaterThanOrEqual(track.loopEndSec - 0.000_05);
      expect(result.duration - track.durationSec, `${url}: ${result.duration}s`).toBeLessThan(0.05);
      expect(result.average, `${url} is silent`).toBeGreaterThan(0.01);
      for (const seam of result.seams) {
        expect(seam.click, `${url}: tiếng tách ở mối nối`).toBeLessThan(CLICK_LIMIT);
        expect(seam.gapDb <= GAP_LIMIT_DB || seam.quiet >= seam.usualQuiet, `${url}: khoảng lặng ở mối nối (${seam.gapDb.toFixed(1)} dB)`).toBe(true);
      }
    }
  });
}
