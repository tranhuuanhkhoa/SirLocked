"""Builds the game's music library from tools/music-gen/library.json (VUAN-5).

For every track: get the source (download from its page's file URL into tmp/music-src/, check the sha256 recorded when it
was first downloaded) or render the chiptune of a song description; cut a seamless loop (find two points where the
music sounds alike, line the waveforms up, short crossfade at the seam); bring it to -16 LUFS; write .ogg (Vorbis ~96
kbit/s) and .mp3 (96 kbit/s) to src/FE/public/assets/audio/music/<folder>/<name>; then write index.json next to them.

    set FFMPEG_PATH=...\\ffmpeg.exe                # when ffmpeg is not on PATH
    python tools/music-gen/build_library.py                      # everything
    python tools/music-gen/build_library.py --only taisho-nha-tra  # some tracks; the others keep their index entry

Needs numpy and scipy, curl for downloads. The index is checked by src/FE/scripts/music-library.test.mjs (npm run
test:music) and the seams in a real browser by src/FE/tests/music-loop.spec.ts.
"""
from __future__ import annotations

import argparse
import datetime
import io
import json
import os
import subprocess
import sys
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import audio_lib as A  # noqa: E402
import music_gen  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PUBLIC = os.path.join(REPO, 'src', 'FE', 'public')
MUSIC = os.path.join(PUBLIC, 'assets', 'audio', 'music')
CACHE = os.path.join(REPO, 'tmp', 'music-src')
MANIFEST = os.path.join(HERE, 'library.json')


def source_audio(entry: dict) -> np.ndarray:
    if entry['source'] == 'claude-8bit':
        song = json.load(open(os.path.join(HERE, entry['generator']), encoding='utf-8'))
        return music_gen.render(song)
    download = entry['download']
    folder = os.path.join(CACHE, entry['id'])
    os.makedirs(folder, exist_ok=True)
    local = os.path.join(folder, os.path.basename(download['url']).replace('%20', ' '))
    if not os.path.exists(local) or A.sha256_file(local) != download['sha256']:
        subprocess.run(['curl', '-s', '-L', '--fail', '--max-time', '900', download['url'], '-o', local], check=True)
    digest = A.sha256_file(local)
    if digest != download['sha256']:
        raise SystemExit(f"{entry['id']}: sha256 của file gốc đã đổi ({digest}); tác giả có thể đã thay file, kiểm lại trang gốc.")
    if download.get('archiveMember'):
        with zipfile.ZipFile(local) as archive:
            member = next(name for name in archive.namelist() if name.endswith(download['archiveMember']))
            path = os.path.join(folder, os.path.basename(member))
            with open(path, 'wb') as handle:
                handle.write(archive.read(member))
        local = path
    return A.decode(local)


def make_loop(entry: dict, audio: np.ndarray) -> tuple[np.ndarray, dict]:
    loop = entry.get('loop', {'mode': 'auto'})
    mode = loop.get('mode', 'auto')
    if entry['source'] == 'claude-8bit' or mode == 'whole':
        first, last = (0, len(audio)) if entry['source'] == 'claude-8bit' else (loop.get('trimStart', 0), len(audio) - loop.get('trimEnd', 0))
        return audio[first:last], {'mode': 'whole', 'sourceStartSec': round(first / A.SR, 3), 'sourceEndSec': round(last / A.SR, 3)}
    if mode == 'manual':
        s = int(round(loop['startSec'] * A.SR))
        e = A.refine(audio, s, int(round(loop['endSec'] * A.SR)))
        found = {'start': s, 'end': e, 'similarity': None}
    else:
        found = A.find_loop(audio, start_sec=loop.get('startSec'), min_sec=loop.get('minSec', 30), max_sec=loop.get('maxSec', 75),
                            target_sec=loop.get('targetSec', 52), context_sec=loop.get('contextSec', 3.0))
    body = A.crossfade_loop(audio, found['start'], found['end'], loop.get('fadeSec', 0.08))
    return body, {'mode': mode, 'sourceStartSec': round(found['start'] / A.SR, 3), 'sourceEndSec': round(found['end'] / A.SR, 3),
                  'similarity': found['similarity'], 'fadeSec': loop.get('fadeSec', 0.08)}


def estimate_bpm(audio: np.ndarray) -> int:
    """Tempo guess from the onset autocorrelation, weighted toward 110 BPM (one octave either side) to avoid
    double/half tempo picks. An estimate only: the index says so."""
    feats = A.band_features(audio[:A.SR * 60])
    onset = A.onset_strength(feats)
    onset = onset - onset.mean()
    ac = np.correlate(onset, onset, 'full')[len(onset) - 1:]
    fps = A.SR / A.HOP
    lags = np.arange(int(fps * 60 / 200), int(fps * 60 / 50))
    bpm = 60 * fps / lags
    prior = np.exp(-0.5 * (np.log2(bpm / 110.0)) ** 2)
    lag = lags[int(np.argmax(np.maximum(ac[lags], 0) * prior))]
    return int(round(60 * fps / lag))


def build(entry: dict) -> dict:
    audio = source_audio(entry)
    body, cut = make_loop(entry, audio)
    level, measured = A.normalize(body)
    seam = A.seam_report(level)
    out_noext = os.path.join(MUSIC, entry['folder'], entry['name'])
    files = A.encode(level, out_noext)
    duration = round(len(level) / A.SR, 6)  # the loop end must land on the exact last sample
    url = f"/assets/audio/music/{entry['folder']}/{entry['name']}"
    bpm = entry.get('bpm') or estimate_bpm(body)
    record = {
        'id': entry['id'],
        'file': url + '.ogg', 'fallback': url + '.mp3',
        'title': entry['title'], 'labelVi': entry['labelVi'], 'author': entry['author'],
        'source': entry['source'], 'sourceUrl': entry['sourceUrl'],
        'license': entry['license'], 'licenseUrl': entry.get('licenseUrl'),
        'world': entry['world'], 'areas': entry['areas'], 'moods': entry['moods'], 'bpm': bpm,
        'loopStartSec': 0, 'loopEndSec': duration, 'durationSec': duration,
        'loudness': {'integratedLufs': measured['lufs'], 'truePeakDb': measured['truePeak']},
        'volume': entry.get('volume', 0.55),
        'sha256': files['ogg']['sha256'], 'bytes': files['ogg']['bytes'],
        'fallbackSha256': files['mp3']['sha256'], 'fallbackBytes': files['mp3']['bytes'],
        'original': {k: v for k, v in {
            'file': (entry.get('download') or {}).get('url') or entry.get('generator'),
            'archiveMember': (entry.get('download') or {}).get('archiveMember'),
            'sha256': (entry.get('download') or {}).get('sha256'),
            'downloadedAt': (entry.get('download') or {}).get('downloadedAt'),
            'licenseNote': entry.get('licenseNote'),
        }.items() if v},
        'processing': {**cut, 'sourceLufs': measured['sourceLufs'], 'seam': seam},
    }
    if entry.get('notes'):
        record['notes'] = entry['notes']
    print(f"{entry['id']:38s} {duration:6.1f}s  {measured['lufs']:6.1f} LUFS  tp {measured['truePeak']:5.1f}  "
          f"ogg {files['ogg']['bytes'] / 1e6:4.2f} MB mp3 {files['mp3']['bytes'] / 1e6:4.2f} MB  sim {cut.get('similarity')}  seam {seam}", flush=True)
    return record


def main() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='comma-separated ids')
    args = parser.parse_args()
    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    index_path = os.path.join(MUSIC, 'index.json')
    previous = {}
    if os.path.exists(index_path):
        previous = {track['id']: track for track in json.load(open(index_path, encoding='utf-8')).get('tracks', [])}
    only = set(args.only.split(',')) if args.only else None
    tracks = []
    for entry in manifest['tracks']:
        if only and entry['id'] not in only and entry['id'] in previous:
            tracks.append(previous[entry['id']])
            continue
        tracks.append(build(entry))
    index = {
        'version': 1,
        'description': manifest['description'],
        'generatedAt': datetime.date.today().isoformat(),
        'licenses': manifest['licenses'],
        'worlds': manifest['worlds'],
        'moods': manifest['moods'],
        'tracks': tracks,
    }
    with io.open(index_path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(index, handle, ensure_ascii=False, indent=1)
        handle.write('\n')
    total = sum(track['bytes'] + track['fallbackBytes'] for track in tracks)
    print(f'{len(tracks)} bài, tổng {total / 1e6:.1f} MB -> {os.path.relpath(index_path, REPO)}')


if __name__ == '__main__':
    main()
