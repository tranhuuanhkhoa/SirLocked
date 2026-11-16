"""Chiptune generator of the Sir Locked studio (VUAN-5): renders a seamless loop from a JSON description.

A song file (tools/music-gen/songs/*.json) gives the tempo, the bars, one chord per bar, and parts: bass, arpeggio,
pad, melody, comping, percussion. Every note tail, the echo and the low-pass filter wrap around the loop, so the
last sample flows into the first: the file loops without a seam (loopStartSec 0, loopEndSec = length).

    python tools/music-gen/music_gen.py tools/music-gen/songs/tra-lau.json --wav out.wav
    python tools/music-gen/build_library.py --only thuong-hai-tra-lau     # render + -16 LUFS + ogg/mp3 + index

Needs numpy (and scipy for speed, optional). Started from the sample case script
(Claude outputs/vu-an-mau/dong-ho-dem-mua/nguon/music.py); the two songs of that case are songs/ben-cang-dem-mua.json
and songs/tiem-dong-ho.json.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import wave

import numpy as np

SR = 44100
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}
FLATS = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}
QUALITY = {
    '': [0, 4, 7], 'M': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11],
    'dim': [0, 3, 6], 'sus4': [0, 5, 7], 'sus2': [0, 2, 7], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], 'add9': [0, 4, 7, 14],
}


def semitone(name: str) -> int:
    """MIDI-like number of a note name such as A4, C#5, Bb3 (A4 = 69)."""
    match = re.fullmatch(r'([A-G])([#b]?)(-?\d)', name.strip())
    if not match:
        raise ValueError(f'Nốt không hợp lệ: {name}')
    letter = match.group(1) + match.group(2)
    letter = FLATS.get(letter, letter)
    return NOTE[letter] + (int(match.group(3)) + 1) * 12


def hz(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return 440.0 * 2 ** ((semitone(value) - 69) / 12)


def chord_tones(symbol: str, octave: int) -> list[float]:
    """Frequencies of a chord symbol (Am, F, A#, Bb7, Dm7, Cmaj7, Esus4...) with its root in the given octave."""
    match = re.fullmatch(r'([A-G][#b]?)(.*)', symbol.strip())
    if not match or match.group(2) not in QUALITY:
        raise ValueError(f'Hợp âm không hợp lệ: {symbol}')
    root = hz(match.group(1) + str(octave))
    return [root * 2 ** (i / 12) for i in QUALITY[match.group(2)]]


def chord_root(symbol: str, octave: int) -> float:
    return chord_tones(symbol, octave)[0]


# ------------------------------------------------------------------ sound sources
def envelope(n: int, a=0.005, d=0.1, s=0.6, r=0.08) -> np.ndarray:
    e = np.ones(n) * s
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    e[:ai] = np.linspace(0, 1, max(ai, 1))[:len(e[:ai])]
    e[ai:ai + di] = np.linspace(1, s, max(di, 1))[:len(e[ai:ai + di])]
    if 0 < ri < n:
        e[n - ri:] *= np.linspace(1, 0, ri)
    return e


def oscillator(kind: str, f: float, n: int, duty=0.25, vibrato=0.0, seed=0) -> np.ndarray:
    t = np.arange(n) / SR
    phase = f * t
    if vibrato:
        # Frequency f * (1 + vibrato * cos(2 pi 5.2 t)): vibrato 0.004 is about 7 cents.
        phase = phase + f * vibrato * np.sin(2 * np.pi * 5.2 * t) / (2 * np.pi * 5.2)
    if kind == 'pluck':
        # Plucked string (koto, guzheng, shamisen): bright attack that dulls, a hair of pitch drop at the start.
        bend = f * (1 + 0.015 * np.exp(-t / 0.012))
        ph = np.cumsum(bend) / SR
        tone = 0.65 * (4 * np.abs(ph % 1.0 - 0.5) - 1) + 0.35 * np.where(ph % 1.0 < 0.3, 1.0, -1.0) * np.exp(-t / 0.08)
        return tone
    x = phase % 1.0
    if kind == 'pulse':
        return np.where(x < duty, 1.0, -1.0)
    if kind == 'tri':
        return 4 * np.abs(x - 0.5) - 1
    if kind == 'sine':
        return np.sin(2 * np.pi * phase)
    if kind == 'saw':
        return 2 * x - 1
    if kind == 'noise':
        return np.random.default_rng(seed).uniform(-1, 1, n)
    raise ValueError(f'Dạng sóng không hỗ trợ: {kind}')


def add_wrapped(buf: np.ndarray, start: int, sig: np.ndarray) -> None:
    """Mix sig into buf from start; whatever runs past the end continues at the beginning (loop tail)."""
    n = len(buf)
    start %= n
    pos = 0
    while pos < len(sig):
        take = min(len(sig) - pos, n - start)
        buf[start:start + take] += sig[pos:pos + take]
        pos += take
        start = 0


def circular_lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """One-pole low-pass in its steady state around the loop (filtered twice, second lap kept)."""
    a = math.exp(-2 * math.pi * cutoff / SR)
    doubled = np.concatenate([x, x])
    try:
        from scipy.signal import lfilter
        y = lfilter([1 - a], [1, -a], doubled)
    except ImportError:  # slow path without scipy
        y = np.zeros_like(doubled)
        prev = 0.0
        for i, value in enumerate(doubled):
            prev = (1 - a) * value + a * prev
            y[i] = prev
    return y[len(x):]


def circular_delay(x: np.ndarray, delay_samples: int, feedback: float, mix: float, taps: int = 5) -> np.ndarray:
    y = x.copy()
    for k in range(1, taps + 1):
        y += np.roll(x, delay_samples * k) * (feedback ** k) * mix
    return y


# ------------------------------------------------------------------ score
def swung(beat: float, swing: float) -> float:
    """Off-beat eighths move to `swing` of the beat (0.5 = straight, 0.62 = light swing)."""
    whole = math.floor(beat + 1e-9)
    frac = beat - whole
    if abs(frac - 0.5) < 1e-6:
        return whole + swing
    return beat


def parse_melody(text: str) -> list[str | None]:
    """'E5 - C5 . | D5' -> steps; '-' holds the previous note one more step, '.' is a rest, '|' only separates bars."""
    return [token for token in text.replace('|', ' ').split()]


def arp_tone(chord: list[float], token) -> float:
    """Arpeggio step: an index into the chord tones (wrapping up an octave), optionally '+12'/'-12' semitones."""
    match = re.fullmatch(r'(\d+)(?:([+-])(\d+))?', str(token).strip())
    if not match:
        raise ValueError(f'Bước arpeggio không hợp lệ: {token}')
    index = int(match.group(1))
    shift = int(match.group(3)) * (1 if match.group(2) == '+' else -1) if match.group(2) else 0
    octave, idx = divmod(index, len(chord))
    return chord[idx] * 2 ** octave * 2 ** (shift / 12)


def events(song: dict, part: dict) -> list[tuple[float, float, float, float]]:
    """(startBeat, durBeats, frequency, velocity) of a pitched part."""
    bpb = song.get('beatsPerBar', 4)
    bars = song['bars']
    chords = song['chords']
    swing = song.get('swing', 0.5)
    octave = part.get('octave', 3)
    vel = part.get('velocity', 0.6)
    out = []
    pattern = part['pattern']
    if pattern == 'melody':
        steps = parse_melody(part['melody'])
        step = part.get('stepBeats', 1)
        offset = part.get('startBeat', 0)
        dur_ratio = part.get('durRatio', 0.85)
        i = 0
        while i < len(steps):
            token = steps[i]
            if token in ('.', '-'):
                i += 1
                continue
            hold = 1
            while i + hold < len(steps) and steps[i + hold] == '-':
                hold += 1
            out.append((swung(offset + i * step, swing), hold * step * dur_ratio, hz(token), vel))
            i += hold
        return out
    for bar in range(bars):
        symbol = chords[bar % len(chords)]
        t0 = bar * bpb
        tones = chord_tones(symbol, octave)
        if pattern == 'root':
            out.append((t0, part.get('durBeats', bpb * 0.95), tones[0], vel))
        elif pattern in ('root-half', 'root-fifth'):
            vels = part.get('accent', [vel, vel * 0.8])
            second = tones[0] if pattern == 'root-half' else tones[0] * 2 ** (7 / 12)
            out.append((t0, part.get('durBeats', bpb / 2 * 0.95), tones[0], vels[0]))
            out.append((t0 + bpb / 2, part.get('durBeats', bpb / 2 * 0.95), second, vels[1]))
        elif pattern == 'walking':
            nxt = chord_root(chords[(bar + 1) % len(chords)], octave)
            line = [tones[0], tones[1 % len(tones)], tones[2 % len(tones)], nxt * 2 ** (-1 / 12)]
            for q in range(bpb):
                out.append((t0 + q, part.get('durBeats', 0.9), line[q % 4], vel * (1 if q % 2 == 0 else 0.8)))
        elif pattern == 'arp':
            seq = part.get('arp', [0, 1, 2, 1])
            step = part.get('stepBeats', 0.5)
            count = int(round(bpb / step))
            vels = part.get('accent', [vel, vel * 0.75])
            for k in range(count):
                out.append((swung(t0 + k * step, swing), part.get('durBeats', step * 0.9), arp_tone(tones, seq[k % len(seq)]), vels[k % len(vels)]))
        elif pattern == 'pad':
            for f in tones:
                out.append((t0, part.get('durBeats', bpb), f, vel))
        elif pattern == 'comp':
            for beat in part.get('beats', [1, 3]):
                for f in tones:
                    out.append((swung(t0 + beat, swing), part.get('durBeats', 0.4), f, vel))
        else:
            raise ValueError(f'Kiểu bè không hỗ trợ: {pattern}')
    return out


def render(song: dict) -> np.ndarray:
    """Stereo float64 loop of exactly bars * beatsPerBar beats, peak 0.8."""
    bpm = song['bpm']
    bpb = song.get('beatsPerBar', 4)
    beat = 60 / bpm
    n = int(round(song['bars'] * bpb * beat * SR))
    left, right = np.zeros(n), np.zeros(n)
    swing = song.get('swing', 0.5)
    for index, part in enumerate(song['parts']):
        pan = part.get('pan', 0.0)
        gain = part.get('gain', 0.3)
        env = part.get('env', [0.005, 0.1, 0.6, 0.08])
        if part['pattern'] == 'hits':
            for hit in part['hits']:
                every = hit.get('everyBeats', bpb)
                beats = np.arange(hit.get('beat', 0), song['bars'] * bpb, every)
                for k, b in enumerate(beats):
                    start = int(round(swung(b, swing) * beat * SR))
                    m = int(hit.get('durSec', 0.05) * SR)
                    t = np.arange(m) / SR
                    tone = hit.get('tone', 1000)
                    tones = tone if isinstance(tone, list) else [tone]
                    noise_mix = hit.get('noise', 0.4)
                    rng = np.random.default_rng(int(b * 1000) + index)
                    body = np.sin(2 * np.pi * tones[k % len(tones)] * t) * (1 - noise_mix) + rng.uniform(-1, 1, m) * noise_mix
                    vel = hit.get('vel', 0.6)
                    vels = vel if isinstance(vel, list) else [vel]
                    sig = body * np.exp(-t / hit.get('decaySec', 0.012)) * vels[k % len(vels)] * gain
                    add_wrapped(left, start, sig * (1 - max(pan, 0)))
                    add_wrapped(right, start, sig * (1 + min(pan, 0)))
            continue
        for k, (start_beat, dur_beats, f, vel) in enumerate(events(song, part)):
            start = int(round(start_beat * beat * SR))
            m = max(1, int(dur_beats * beat * SR))
            sig = oscillator(part['wave'], f, m, part.get('duty', 0.25), part.get('vibrato', 0.0), seed=k + index * 997)
            sig = sig * envelope(m, *env) * vel * gain
            if part['wave'] == 'pluck':
                sig *= np.exp(-np.arange(m) / (part.get('decaySec', 0.6) * SR))
            add_wrapped(left, start, sig * (1 - max(pan, 0)))
            add_wrapped(right, start, sig * (1 + min(pan, 0)))
    echo = song.get('delay')
    if echo:
        left = circular_delay(left, int(echo.get('leftBeats', 0.75) * beat * SR), echo.get('feedback', 0.35), echo.get('mix', 0.5))
        right = circular_delay(right, int(echo.get('rightBeats', 0.5) * beat * SR), echo.get('feedback', 0.35), echo.get('mix', 0.5))
    cutoff = song.get('lowpassHz')
    if cutoff:
        left, right = circular_lowpass(left, cutoff), circular_lowpass(right, cutoff)
    stereo = np.stack([left, right], 1)
    return stereo / (np.abs(stereo).max() / 0.8 + 1e-12)


def write_wav(path: str, x: np.ndarray) -> None:
    with wave.open(path, 'wb') as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def main() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='Render a chiptune loop from a song description (JSON).')
    parser.add_argument('song')
    parser.add_argument('--wav', required=True, help='WAV output (16-bit stereo 44.1 kHz)')
    args = parser.parse_args()
    song = json.load(open(args.song, encoding='utf-8'))
    audio = render(song)
    write_wav(args.wav, audio)
    print(json.dumps({'wav': args.wav, 'seconds': round(len(audio) / SR, 3), 'bpm': song['bpm'], 'bars': song['bars']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
