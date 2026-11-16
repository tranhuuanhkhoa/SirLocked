"""Shared audio helpers of the music library (VUAN-5): decode, loudness, seamless loops, encoding.

Everything works on float64 stereo arrays of shape (samples, 2) at 44.1 kHz. ffmpeg does decoding, loudness
measurement (EBU R128) and encoding; numpy does the rest. ffmpeg comes from FFMPEG_PATH or PATH.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess

import numpy as np

SR = 44100
TARGET_LUFS = -16.0
TRUE_PEAK_DB = -1.5
OGG_ARGS = ['-c:a', 'libvorbis', '-q:a', '2']        # Vorbis q2: about 96 kbit/s for 44.1 kHz stereo
MP3_ARGS = ['-c:a', 'libmp3lame', '-b:a', '96k']     # LAME writes the gapless header (delay/padding), browsers trim it


def ffmpeg_path() -> str:
    for candidate in (os.environ.get('FFMPEG_PATH'), shutil.which('ffmpeg')):
        if candidate and os.path.exists(candidate) or (candidate and shutil.which(candidate)):
            return candidate
    raise SystemExit('Không tìm thấy ffmpeg: đặt FFMPEG_PATH hoặc thêm ffmpeg vào PATH.')


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def decode(path: str) -> np.ndarray:
    raw = subprocess.run([ffmpeg_path(), '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).astype(np.float64)


def _pipe(x: np.ndarray, args: list[str]) -> subprocess.CompletedProcess:
    data = np.ascontiguousarray(x, dtype='<f4').tobytes()
    return subprocess.run([ffmpeg_path(), '-hide_banner', '-nostats', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', *args],
                          input=data, capture_output=True, check=True)


def loudness(x: np.ndarray) -> dict:
    """Integrated loudness (LUFS) and true peak (dBTP) of a loop, measured on two passes so the loop seam counts."""
    twice = np.concatenate([x, x]) if len(x) < SR * 120 else x
    log = _pipe(twice, ['-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr.decode('utf-8', 'replace')
    summary = log[log.rfind('Summary:'):]
    lufs = float(re.search(r'I:\s+(-?[\d.]+|-inf) LUFS', summary).group(1))
    peak = re.search(r'Peak:\s+(-?[\d.]+|-inf) dBFS', summary)
    return {'lufs': lufs, 'truePeak': float(peak.group(1)) if peak else 0.0}


def _circular_limiter(x: np.ndarray, ceiling: float, window_sec: float = 0.08) -> np.ndarray:
    """Peak limiter computed on a ring (the loop end feeds its start), so the seam stays seamless.

    Offline, so it may look both ways: the gain is the smallest needed gain within +-window/2, smoothed by a
    window no wider than that, which keeps every sample under the ceiling without pumping on single peaks."""
    from scipy.ndimage import convolve1d, minimum_filter1d
    peak = np.abs(x).max(1)
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    if need.min() >= 1.0:
        return x
    size = 2 * int(window_sec / 2 * SR) + 1
    held = minimum_filter1d(need, size=size, mode='wrap')
    kernel = np.hanning(size)
    kernel /= kernel.sum()
    gain = np.minimum(convolve1d(held, kernel, mode='wrap'), need)
    return x * gain[:, None]


def normalize(x: np.ndarray, target: float = TARGET_LUFS, true_peak: float = TRUE_PEAK_DB) -> tuple[np.ndarray, dict]:
    """Gain to the target loudness; a ring limiter keeps peaks under the ceiling. Returns the audio and the measurement.

    Bright instruments (harpsichord) have inter-sample peaks well above their sample peaks, so the sample ceiling
    drops by whatever the measured true peak still exceeds, and the gain is adjusted again for loudness."""
    measured = loudness(x)
    gain = 10 ** ((target - measured['lufs']) / 20)
    ceiling_db = true_peak - 0.6  # margin for inter-sample peaks after lossy encoding
    y, after = x, measured
    for _ in range(8):
        ceiling = 10 ** (ceiling_db / 20)
        y = x * gain
        if np.abs(y).max() > ceiling:
            y = _circular_limiter(y, ceiling)
        after = loudness(y)
        if after['truePeak'] > true_peak - 0.1:
            ceiling_db -= after['truePeak'] - true_peak + 0.3
            continue
        if abs(after['lufs'] - target) > 0.3:
            gain *= 10 ** ((target - after['lufs']) / 20)
            continue
        break
    return y, {'sourceLufs': round(measured['lufs'], 1), 'lufs': round(after['lufs'], 1), 'truePeak': round(after['truePeak'], 1)}


def encode(x: np.ndarray, out_noext: str) -> dict:
    os.makedirs(os.path.dirname(out_noext), exist_ok=True)
    _pipe(x, [*OGG_ARGS, '-y', out_noext + '.ogg'])
    _pipe(x, [*MP3_ARGS, '-y', out_noext + '.mp3'])
    return {ext: {'bytes': os.path.getsize(out_noext + '.' + ext), 'sha256': sha256_file(out_noext + '.' + ext)} for ext in ('ogg', 'mp3')}


# ------------------------------------------------------------------ seamless loops
def _frames(signal: np.ndarray, size: int, hop: int) -> np.ndarray:
    count = 1 + max(0, (len(signal) - size) // hop)
    index = np.arange(size)[None, :] + hop * np.arange(count)[:, None]
    return signal[index]


HOP = 1024


def band_features(x: np.ndarray) -> np.ndarray:
    """Log energy in 40 log-spaced bands (60 Hz–12 kHz) every 1024 samples, z-scored per band."""
    mono = x.mean(1)
    size = 4096
    padded = np.pad(mono, (size // 2, size // 2))
    spec = np.abs(np.fft.rfft(_frames(padded, size, HOP) * np.hanning(size), axis=1)) ** 2
    freqs = np.fft.rfftfreq(size, 1 / SR)
    edges = np.geomspace(60, 12000, 41)
    bands = np.stack([spec[:, (freqs >= lo) & (freqs < hi)].sum(1) for lo, hi in zip(edges[:-1], edges[1:])], 1)
    logs = np.log10(bands + 1e-10)
    return (logs - logs.mean(0)) / (logs.std(0) + 1e-6)


def onset_strength(features: np.ndarray) -> np.ndarray:
    return np.concatenate([[0], np.maximum(0, np.diff(features, axis=0)).sum(1)])


def window_similarity(features: np.ndarray, a: int, b: int, half: int) -> float | None:
    """Mean cosine similarity of the frames around frame a and frame b (same offsets); None when a window falls off."""
    if a - half < 0 or b - half < 0 or a + half > len(features) or b + half > len(features):
        return None
    A = features[a - half:a + half]
    B = features[b - half:b + half]
    num = (A * B).sum(1)
    den = np.linalg.norm(A, axis=1) * np.linalg.norm(B, axis=1) + 1e-9
    return float((num / den).mean())


def active_range(x: np.ndarray, floor_db: float = -45.0) -> tuple[int, int]:
    """First and last sample louder than floor_db (RMS over 50 ms)."""
    mono = x.mean(1)
    win = SR // 20
    rms = np.sqrt((_frames(mono, win, win) ** 2).mean(1)) + 1e-12
    loud = np.nonzero(20 * np.log10(rms) > floor_db)[0]
    if not len(loud):
        return 0, len(x)
    return int(loud[0] * win), int(min(len(x), (loud[-1] + 1) * win))


COARSE = 4  # coarse frame = 4 feature frames, about 93 ms


def find_loop(x: np.ndarray, start_sec: float | None = None, min_sec: float = 30, max_sec: float = 100,
              target_sec: float = 60, end_guard_sec: float = 4.0, context_sec: float = 3.0) -> dict:
    """Pick loop points [s, e): the music around e must sound like the music around s, so the jump e -> s is not heard.

    Self-similarity search: for every length L in [min, max] and every start s, the mean cosine similarity of the
    coarse spectra in the window s-context..s+context against e-context..e+context (a diagonal of the similarity
    matrix, smoothed). Songs made of repeated sections score near 1 where a section repeats. The start then slides to
    the nearest strong onset (same length) and the end is lined up with the waveform."""
    feats = band_features(x)
    onset = onset_strength(feats)
    first, last = active_range(x)
    fps = SR / HOP
    n_coarse = len(feats) // COARSE
    coarse = feats[:n_coarse * COARSE].reshape(n_coarse, COARSE, -1).mean(1)
    coarse = coarse / (np.linalg.norm(coarse, axis=1, keepdims=True) + 1e-9)
    cps = fps / COARSE
    half = max(1, int(context_sec * cps))
    lo = int(first / HOP / COARSE) + half + 1
    hi = int((last / SR - end_guard_sec) * cps) - half
    if start_sec is not None:
        fixed = int(round(start_sec * cps))
        lo, hi_start = fixed, fixed + 1
    else:
        hi_start = hi
    min_l, max_l = int(min_sec * cps), int(max_sec * cps)
    best = None
    for length in range(min_l, max_l + 1):
        starts = np.arange(lo, min(hi_start, hi - length + 1))
        if not len(starts):
            continue
        diag = (coarse[:n_coarse - length] * coarse[length:]).sum(1)
        csum = np.concatenate([[0.0], np.cumsum(diag)])
        score = (csum[starts + half] - csum[starts - half]) / (2 * half)
        k = int(np.argmax(score))
        ranked = float(score[k]) - 0.0015 * abs(length / cps - target_sec)  # slight preference for the target length
        if best is None or ranked > best[0]:
            best = (ranked, float(score[k]), int(starts[k]), length)
    if best is None:
        raise ValueError('Bài quá ngắn cho khoảng lặp yêu cầu.')
    _, score, s_coarse, length = best
    # Same length, start moved to the strongest onset within +-0.5 s (a cut on a beat is easier to hide).
    s_frame, l_frames = s_coarse * COARSE, length * COARSE
    span = int(0.5 * fps)
    window = onset[max(0, s_frame - span):s_frame + span]
    s_frame = max(0, s_frame - span) + int(np.argmax(window)) if len(window) else s_frame
    s = s_frame * HOP
    e = refine(x, s, (s_frame + l_frames) * HOP)
    return {'start': s, 'end': e, 'similarity': round(score, 3)}


def refine(x: np.ndarray, s: int, e: int, search: int = HOP, size: int = 4096) -> int:
    """Move e by up to `search` samples so the waveform after e lines up with the waveform after s."""
    mono = x.mean(1)
    ref = mono[s:s + size]
    best_e, best_c = e, -2.0
    for d in range(-search, search + 1):
        cand = mono[e + d:e + d + size]
        if len(cand) < size:
            continue
        c = float(np.dot(ref, cand) / (np.linalg.norm(ref) * np.linalg.norm(cand) + 1e-9))
        if c > best_c:
            best_c, best_e = c, e + d
    return best_e


def crossfade_loop(x: np.ndarray, s: int, e: int, fade_sec: float = 0.08) -> np.ndarray:
    """Loop body x[s:e]; its head blends from x[e:] (what would follow the tail) into x[s:], so tail -> head is continuous."""
    fade = int(fade_sec * SR)
    body = x[s:e].copy()
    tail = x[e:e + fade]
    if len(tail) < fade:
        tail = np.concatenate([tail, np.zeros((fade - len(tail), 2))])
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fade))[:, None]
    body[:fade] = tail * (1 - ramp) + body[:fade] * ramp
    return body


def seam_report(y: np.ndarray, repeats: int = 3) -> dict:
    """Play the loop `repeats` times and measure every seam the way the browser test does (src/FE/tests/music-loop.spec.ts).

    click: the sample step across the seam against the larger of (a) the 99.9th percentile step of the whole loop and
    (b) the biggest step within 50 ms on either side; a cut in a smooth passage shows up as a ratio well above 1, a
    note that happens to start on the seam does not.
    gap: the quietest 10 ms around the seam (+-100 ms), in dB below the loop's average level."""
    mono = np.tile(y.mean(1), repeats)
    n = len(y)
    diff = np.abs(np.diff(mono))
    typical = float(np.percentile(diff[:n], 99.9)) + 1e-9
    whole = float(np.sqrt(np.mean(mono[:n] ** 2))) + 1e-12
    near, edge, win = int(0.05 * SR), 3, int(0.01 * SR)
    click, gap = 0.0, -99.0
    for k in range(1, repeats):
        seam = k * n
        step = float(diff[seam - edge:seam + edge - 1].max())
        neighbours = float(max(diff[seam - near:seam - edge].max(), diff[seam + edge:seam + near].max()))
        click = max(click, step / max(typical, neighbours))
        around = mono[seam - 10 * win:seam + 10 * win]
        quiet = min(float(np.sqrt(np.mean(around[i:i + win] ** 2))) for i in range(0, len(around) - win + 1, win // 2))
        gap = max(gap, 20 * np.log10(whole / (quiet + 1e-12)))
    return {'click': round(click, 2), 'gapDb': round(gap, 1)}
