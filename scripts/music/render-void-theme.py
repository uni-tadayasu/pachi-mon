#!/usr/bin/env python3
"""Re-arrange a supplied instrumental as a 16-bit console battle soundtrack.

The input's timing, chromatic pitches, modulations and dynamics are analysed,
not replaced with an unrelated generated melody. Harmonic-template unmixing
drives six bounded pulse/FM/wavetable voices; detected percussion drives a
short PCM-like drum kit. A quiet, band-limited sample layer retains details
which a polyphonic automatic transcription cannot reliably separate.

Dependencies: Python 3, numpy, scipy, soundfile, threadpoolctl; ffmpeg on PATH.
  python3 scripts/music/render-void-theme.py INPUT.mp3 OUTPUT.wav --report REPORT.json
  ffmpeg -i OUTPUT.wav -codec:a libmp3lame -b:a 112k -ar 32000 -ac 2 OUTPUT.mp3

The supplied source recording is deliberately not bundled in this repository.
"""
import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import ndimage, signal
from threadpoolctl import threadpool_limits

SR = 32000
ANALYSIS_SR = 16000
FFT = 4096
HOP = 192
BPM = 152.0
SEED = 3940


def decode(path):
    result = subprocess.run([
        'ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le',
        '-acodec', 'pcm_f32le', '-ar', str(SR), '-ac', '2', 'pipe:1'
    ], check=True, stdout=subprocess.PIPE)
    return np.frombuffer(result.stdout, dtype='<f4').reshape(-1, 2).copy()


def filt(x, cutoff, kind='lowpass', order=2):
    return signal.sosfilt(signal.butter(order, cutoff, btype=kind, fs=SR, output='sos'), x, axis=0).astype(np.float32)


def rms(x):
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))


def norm(x, target):
    return x * (target / max(rms(x), 1e-8))


def smooth_envelope(x, samples):
    return np.sqrt(ndimage.uniform_filter1d(np.square(x), max(1, samples), axis=0, mode='nearest') + 1e-12)


def stft(x):
    _, times, z = signal.stft(x, fs=ANALYSIS_SR, nperseg=FFT,
                              noverlap=FFT-HOP, boundary='zeros', padded=True)
    return times.astype(np.float32), z.astype(np.complex64)


def harmonic_analysis(mono):
    down = signal.resample_poly(mono, 1, 2).astype(np.float32)
    times, z = stft(down)
    mag = np.abs(z)
    horizontal = ndimage.median_filter(mag, size=(1, 23))
    vertical = ndimage.median_filter(mag, size=(17, 1))
    mh = horizontal ** 2 / (horizontal ** 2 + vertical ** 2 + 1e-12)
    mp = 1 - mh
    _, harmonic = signal.istft(z * mh, fs=ANALYSIS_SR, nperseg=FFT, noverlap=FFT-HOP)
    harmonic = signal.resample_poly(harmonic[:len(down)], 2, 1)[:len(mono)].astype(np.float32)
    percussive = mono[:len(harmonic)] - harmonic

    # A chromatic dictionary, with no fixed key/scale assumption. Whiten the
    # persistent bass-heavy spectrum before fitting, so upper melody survives.
    freqs = np.fft.rfftfreq(FFT, 1 / ANALYSIS_SR)
    pitches = np.arange(29, 96)
    dictionary = np.zeros((len(freqs), len(pitches)), dtype=np.float32)
    for j, note in enumerate(pitches):
        f0 = 440 * 2 ** ((note - 69) / 12)
        for h in range(1, min(17, int(7400 / f0)) + 1):
            width = max(ANALYSIS_SR / FFT * .95, f0 * h * .003)
            dictionary[:, j] += (1 / h ** .86) * np.exp(-.5 * ((freqs - h * f0) / width) ** 2)
    average = np.mean(mag * mh, axis=1)
    weight = 1 / np.sqrt(np.maximum(average, np.percentile(average, 72) * .045) + 1e-7)
    weight[freqs < 32] = 0
    weight[freqs > 7400] = 0
    dictionary *= weight[:, None]
    dictionary /= np.maximum(np.linalg.norm(dictionary, axis=0), 1e-8)
    target = mag * mh * weight[:, None]
    with threadpool_limits(limits=3):
        projected = dictionary.T @ target
        gram = dictionary.T @ dictionary
        activation = np.maximum(projected, 1e-7)
        penalty = np.max(projected, axis=0, keepdims=True) * .045
        for _ in range(36):
            activation *= projected / (gram @ activation + penalty + 1e-8)
    activation = ndimage.median_filter(activation, size=(1, 3))
    activation = ndimage.gaussian_filter1d(activation, .75, axis=1)
    # Reject weak harmonic aliases and enforce a six-tone ensemble per frame.
    maxima = np.max(activation, axis=0, keepdims=True)
    activation = np.maximum(0, activation - maxima * .11)
    groups = [(pitches < 51, 1), ((pitches >= 51) & (pitches < 67), 2), (pitches >= 67, 3)]
    for mask, voices in groups:
        sub = activation[mask]
        if len(sub) > voices:
            cutoff = np.partition(sub, -voices, axis=0)[-voices]
            sub[sub < cutoff[None, :]] = 0
        activation[mask] = sub
    activation = ndimage.gaussian_filter1d(activation, .9, axis=1)
    return times, pitches, activation, harmonic, percussive, mag, mp


def sampled_voice(phase, kind, note):
    # Single-cycle sample loops, 16-bit-era timbres. Band-limited partials
    # prevent square-wave aliasing, with gentle 8-bit sample quantisation.
    if kind == 'bass':
        wave = (.72 * np.sin(phase + 1.15 * np.sin(2 * phase))
                + .22 * np.sin(phase) + .06 * np.sin(3 * phase))
    elif kind == 'chord':
        wave = (.66 * np.sin(phase + .7 * np.sin(2 * phase))
                + .18 * np.sin(3 * phase) + .10 * np.sin(4 * phase)
                + .06 * np.sin(5 * phase))
    else:
        hz = 440 * 2 ** ((note - 69) / 12)
        wave = np.zeros_like(phase)
        for h in range(1, min(12, int(9000 / hz)) + 1):
            # A 25% pulse lead softened with a triangle fundamental.
            amplitude = .74 * math.sin(math.pi * .28 * h) / h
            if h == 1:
                amplitude += .30
            wave += amplitude * np.sin(h * phase)
    return np.round(wave * 127) / 127


def render_ensemble(times, pitches, activation, harmonic, length):
    t = np.arange(length, dtype=np.float64) / SR
    lanes = {k: np.zeros((length, 2), dtype=np.float32) for k in ('bass', 'chord', 'lead')}
    active_frames = {}
    for i, note in enumerate(pitches):
        a = activation[i]
        if np.max(a) < 1e-5:
            continue
        kind = 'bass' if note < 51 else 'chord' if note < 67 else 'lead'
        a = np.interp(t, times, a, left=0, right=0).astype(np.float32)
        # Smooth, source-following envelopes retain rests and musical phrasing.
        if kind == 'lead':
            vibrato = .003 * np.sin(2 * np.pi * 5.2 * t)
            phase = np.cumsum((440 * 2 ** ((note - 69) / 12)) * (1 + vibrato)) * (2 * np.pi / SR)
        else:
            phase = (2 * np.pi * (440 * 2 ** ((note - 69) / 12))) * t
        wave = sampled_voice(phase, kind, int(note)).astype(np.float32) * a
        pan = 0 if kind == 'bass' else ((int(note) % 5 - 2) * .18 if kind == 'chord' else (int(note) % 3 - 1) * .14)
        lanes[kind][:, 0] += wave * math.cos((pan + 1) * math.pi / 4)
        lanes[kind][:, 1] += wave * math.sin((pan + 1) * math.pi / 4)
        active_frames[str(int(note))] = int(np.count_nonzero(activation[i] > np.max(activation) * .015))
    source_env = smooth_envelope(harmonic[:length], int(SR * .060))
    source_env = np.clip(source_env / max(np.percentile(source_env, 90), 1e-6), 0, 1.3)
    output = np.zeros((length, 2), dtype=np.float32)
    for kind, level, cutoff in [('bass', .17, 1850), ('chord', .095, 5400), ('lead', .15, 7400)]:
        lane = filt(lanes[kind], cutoff)
        lane_env = smooth_envelope(np.mean(lane, axis=1), int(SR * .10))
        # A bounded local balance avoids a loud bass masking the upper motif.
        gain = np.clip(source_env * level / np.maximum(lane_env, .015), 0, 4.0)
        gain = ndimage.uniform_filter1d(gain, int(SR * .024), mode='nearest')
        output += lane * gain[:, None]
    return output, active_frames


def drum_kit():
    rng = np.random.default_rng(SEED)
    def clock(d):
        return np.arange(round(d * SR), dtype=np.float32) / SR
    t = clock(.23)
    kick = np.sin(2 * np.pi * np.cumsum(47 + 118 * np.exp(-t / .022)) / SR) * np.exp(-t / .068)
    kick += .13 * rng.uniform(-1, 1, len(t)) * np.exp(-t / .003)
    t = clock(.18)
    snare = .55 * filt(rng.uniform(-1, 1, len(t)).astype(np.float32), [1250, 7100], 'bandpass') * np.exp(-t / .045)
    snare += .35 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / .035)
    t = clock(.055)
    hat = filt(rng.uniform(-1, 1, len(t)).astype(np.float32), [5300, 11000], 'bandpass') * np.exp(-t / .012)
    t = clock(.55)
    crash = filt(rng.uniform(-1, 1, len(t)).astype(np.float32), [2700, 10000], 'bandpass') * np.exp(-t / .13)
    return {k: norm(np.round(v * 127) / 127, level) for k, v, level in [
        ('kick', kick, .26), ('snare', snare, .16), ('hat', hat, .075), ('crash', crash, .065)]}


def render_drums(times, mag, mp, length):
    freqs = np.fft.rfftfreq(FFT, 1 / ANALYSIS_SR)
    pcm = np.zeros((length, 2), dtype=np.float32)
    hits = {}
    kit = drum_kit()
    for kind, low, high, distance, prominence, pan in [
        ('kick', 35, 170, .13, .115, 0),
        ('snare', 1200, 4500, .22, .16, -.07),
        ('hat', 5000, 7400, .085, .10, .22),
    ]:
        band = np.sqrt(np.mean(np.square((mag * mp)[(freqs >= low) & (freqs < high)]), axis=0))
        band = ndimage.gaussian_filter1d(band, .6)
        strength = band / max(np.percentile(band, 95), 1e-7)
        flux = np.maximum(0, strength - ndimage.minimum_filter1d(strength, 11))
        indices, props = signal.find_peaks(flux, distance=round(distance * ANALYSIS_SR / HOP),
                                          prominence=prominence, height=.15)
        hits[kind] = len(indices)
        for j in indices:
            start = max(0, round((float(times[j]) - .014) * SR))
            end = min(length, start + len(kit[kind]))
            if end <= start:
                continue
            velocity = float(np.clip(flux[j], .18, 1.15))
            sample = kit[kind][:end-start] * velocity
            pcm[start:end, 0] += sample * math.cos((pan + 1) * math.pi / 4)
            pcm[start:end, 1] += sample * math.sin((pan + 1) * math.pi / 4)
    return pcm, hits


def arrange(source):
    mono = np.mean(source, axis=1)
    print('Analysing chromatic harmony and percussion...', flush=True)
    times, pitches, activation, harmonic, percussive, mag, mp = harmonic_analysis(mono)
    length = min(len(source), len(harmonic))
    source = source[:length]
    print('Rendering pulse/FM voices...', flush=True)
    ensemble, frames = render_ensemble(times, pitches, activation, harmonic, length)
    drums, hits = render_drums(times, mag, mp, length)

    # The game-era sample layer keeps bends, fills and countermelodies below
    # the newly synthesised voices. It is filtered/companded, not a dry copy.
    sample_layer = filt(filt(source, 115, 'highpass'), 5900)
    sample_layer = np.sign(sample_layer) * np.log1p(15 * np.abs(sample_layer)) / np.log(16)
    sample_layer = np.round(sample_layer * 127) / 127
    sample_layer = np.sign(sample_layer) * (np.exp(np.abs(sample_layer) * np.log(16)) - 1) / 15
    sample_layer = norm(sample_layer, .105)
    # Short PCM/noise texture retains the source's precise swing and fills.
    texture = filt(percussive[:length], [350, 7500], 'bandpass')
    texture = np.round(np.clip(texture * 1.7, -1, 1) * 63) / 63
    texture = norm(texture, .035)
    mix = ensemble + drums + sample_layer
    mix[:, 0] += texture * .66
    mix[:, 1] += texture * .72

    # Console-style cross echo from the melodic bus only, so drum attacks stay
    # readable next to battle effects. Feedback is explicitly bounded.
    echo_source = filt(ensemble, 4000)
    delay = round((60 / BPM * .75) * SR)
    for tap in range(1, 5):
        shift = delay * tap
        if shift >= length:
            break
        mix[shift:] += echo_source[:-shift, ::-1 if tap % 2 else 1] * (.16 * .43 ** (tap-1))
    mix = filt(filt(mix, 30, 'highpass'), 11800)
    mix = np.tanh(mix * 1.08)
    return mix, {'notes_detected': len(frames), 'active_note_frames': frames, 'drum_hits': hits}


def finish_loop(mix, full_length):
    if not full_length:
        n = min(int(.02 * SR), len(mix) // 4)
        mix[:n] *= np.linspace(0, 1, n)[:, None]
        mix[-n:] *= np.linspace(1, 0, n)[:, None]
        return mix, {'preview': True}
    # Remove the uploaded file's near-silent trailing padding. Then overlap a
    # short tail into the first beat; this is a crossfade, not a promise that
    # a composition with an outro has a bar-for-bar seamless musical loop.
    envelope = smooth_envelope(np.mean(mix, axis=1), int(.08 * SR))
    active = np.flatnonzero(envelope > max(np.percentile(envelope, 90) * .018, .001))
    cut = min(len(mix), int(active[-1]) + int(.08 * SR)) if len(active) else len(mix)
    cut = min(cut, len(mix) - int(.35 * SR))
    mix = mix[:cut].copy()
    cross = min(int(.18 * SR), len(mix) // 16)
    first = mix[:cross].copy()
    tail = mix[-cross:].copy()
    phase = np.linspace(0, np.pi / 2, cross, dtype=np.float32)[:, None]
    mix[:cross] = tail * np.cos(phase) + first * np.sin(phase)
    mix = mix[:-cross]
    # Join at the equal-phase seam without a hard sample discontinuity.
    join = min(96, len(mix) // 16)
    average = (mix[0] + mix[-1]) / 2
    mix[:join] += (average - mix[0])[None, :] * np.linspace(1, 0, join)[:, None]
    mix[-join:] += (average - mix[-1])[None, :] * np.linspace(0, 1, join)[:, None]
    return mix, {'trimmed_source_tail_seconds': round((full_length - cut) / SR, 6),
                 'crossfade_seconds': cross / SR, 'loop_join_samples': join}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--start', type=float, default=0)
    parser.add_argument('--duration', type=float)
    args = parser.parse_args()
    source = decode(args.source)
    input_frames = len(source)
    if args.duration is not None or args.start:
        start = round(args.start * SR)
        end = min(len(source), start + round(args.duration * SR)) if args.duration else len(source)
        source = source[start:end]
    with threadpool_limits(limits=3):
        mix, report = arrange(source)
    mix, loop = finish_loop(mix, input_frames if not args.duration and not args.start else 0)
    peak_before = float(np.max(np.abs(mix)))
    # The game attenuates its recorded music bus. Keep export headroom for
    # MP3 reconstruction and the user's SFX, and retain section dynamics.
    gain = min(10 ** (-16 / 20) / max(rms(mix), 1e-8), 10 ** (-1.6 / 20) / max(peak_before, 1e-8))
    mix *= gain
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(args.output, mix, SR, subtype='PCM_16')
    report.update({
        'source_filename': args.source.name,
        'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'input_decoded_seconds': input_frames / SR,
        'output_seconds': len(mix) / SR, 'sample_rate': SR, 'channels': 2,
        'tempo_bpm': BPM, 'method': 'source-following chromatic harmonic-template pulse/FM resynthesis, PCM-like drums, companded sample bed, filtered cross echo',
        'key_handling': 'chromatic; preserves source modulations, no fixed-scale snapping',
        'seed': SEED, 'rms_dbfs': round(20 * math.log10(max(rms(mix), 1e-8)), 4),
        'peak_dbfs': round(20 * math.log10(max(float(np.max(np.abs(mix))), 1e-8)), 4),
        'nonfinite_samples': int(np.count_nonzero(~np.isfinite(mix))),
        'clipped_samples': int(np.count_nonzero(np.abs(mix) >= 1)),
        'loop': loop,
    })
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'active_note_frames'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
