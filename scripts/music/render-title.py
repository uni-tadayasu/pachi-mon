# Renders the title theme (scripts/music/title-score.json) with 16-bit (SNES-style) voices:
# short looped wavetables read with linear interpolation, coarse sample depth, ADSR
# envelopes, a feedback echo and a gentle output roll-off. The echo tail wraps to the
# start so the loop is seamless. The score was transcribed from KASAI SOLUTIONS INC.'s
# original song (beats/melody: essentia; bass/chords: basic-pitch + chroma) and arranged
# for lead, strings, music box, bass and drums.
#
#   pip install numpy scipy soundfile
#   python3 scripts/music/render-title.py scripts/music/title-score.json title.wav
#   ffmpeg -i title.wav -codec:a libmp3lame -b:a 96k -ar 32000 -ac 2 assets/music/title-16bit.mp3
import json, sys, numpy as np, soundfile as sf
from scipy.signal import lfilter, butter

SR = 32000
sc = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'scripts/music/title-score.json'))
STEP = 60 / sc['bpm'] / 4
N = int(round(sc['steps'] * STEP * SR))
TAIL = int(2.5 * SR)
L = np.zeros(N + TAIL); R = np.zeros(N + TAIL); EL = np.zeros(N + TAIL); ER = np.zeros(N + TAIL)
rng = np.random.default_rng(122)

def table(kind, n=64):
    x = np.arange(n) / n
    if kind == 'pulse50': return np.where(x < .5, 1., -1.)
    if kind == 'pulse25': return np.where(x < .25, 1., -1.) + .5
    if kind == 'pulse125': return np.where(x < .125, 1., -1.) + .75
    if kind == 'saw': return 1 - 2 * x
    if kind == 'tri': return 1 - 4 * np.abs(x - .5)
    if kind == 'sine': return np.sin(2 * np.pi * x)
    raise ValueError(kind)
def q(t, bits=7):  # coarse sample depth, like short BRR loops
    m = np.max(np.abs(t)) or 1; t = t / m; lv = 2 ** bits; return np.round(t * lv) / lv
WAVES = {
    'lead': q(.62 * table('pulse50') + .38 * table('pulse25'), 6),
    'pad': q(table('saw', 64), 7),
    'arp': q(.75 * table('sine', 32) + .25 * table('tri', 32), 6),
    'bass': q(.72 * table('tri', 32) + .28 * table('pulse50', 32), 6),
}
for k, w in WAVES.items(): WAVES[k] = w - w.mean()
def hz(m): return 440 * 2 ** ((m - 69) / 12)
def osc(wave, freq, n, vib=None):
    f = np.full(n, freq) if vib is None else freq * vib
    ph = np.cumsum(f / SR) % 1 * len(wave)
    i = ph.astype(int); fr = ph - i
    return wave[i] * (1 - fr) + wave[(i + 1) % len(wave)] * fr
def adsr(n, a, d, s, r, hold):
    t = np.arange(n) / SR; env = np.empty(n)
    a = max(a, 1e-4); env = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t > hold
    if rel.any(): env[rel] = env[np.searchsorted(t, hold) - 1 if np.searchsorted(t, hold) > 0 else 0] * np.exp(-(t[rel] - hold) / max(r, 1e-4))
    return env
def onepole(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR); return lfilter([1 - a], [1, -a], x)
def add(sig, start, pan=0., echo=0.):
    s = int(round(start * SR)); e = min(len(L), s + len(sig)); sig = sig[:e - s]
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[s:e] += sig * gl; R[s:e] += sig * gr
    if echo: EL[s:e] += sig * gl * echo; ER[s:e] += sig * gr * echo

# ── Melodic voices
def voice(kind, step, length, midi, v):
    dur = length * STEP; start = step * STEP
    if kind == 'lead':
        n = int((dur + .25) * SR); t = np.arange(n) / SR
        depth = np.clip((t - .16) / .25, 0, 1) * .0105
        vib = 1 + depth * np.sin(2 * np.pi * 5.4 * t)
        sig = osc(WAVES['lead'], hz(midi), n, vib) * adsr(n, .006, .16, .72, .08, max(.05, dur - .02))
        sig = onepole(sig, 5200) * .3 * v
        add(sig, start, .08, .42)
    elif kind == 'lead2':
        n = int((dur + .25) * SR)
        sig = osc(WAVES['lead'], hz(midi), n) * adsr(n, .01, .2, .7, .1, max(.05, dur - .02))
        add(onepole(sig, 2600) * .2 * v, start, -.12, .3)
    elif kind == 'pad':
        n = int((dur + .45) * SR); env = adsr(n, .09, .6, .82, .28, dur)
        sig = sum(osc(WAVES['pad'], hz(midi) * d, n) for d in (2 ** (-7 / 1200), 1, 2 ** (6 / 1200))) / 3
        sig = onepole(onepole(sig, 2300), 3000) * env * .06 * v
        pan = {0: -.45, 1: .45, 2: 0}[midi % 3]
        add(sig, start, pan, .25)
    elif kind == 'arp':
        n = int(.42 * SR); t = np.arange(n) / SR
        sig = osc(WAVES['arp'], hz(midi), n) * np.exp(-t / .22) * np.minimum(1, t / .002)
        add(onepole(sig, 7000) * .06 * v, start, .35, .45)
    elif kind == 'bass':
        n = int((dur + .08) * SR)
        sig = osc(WAVES['bass'], hz(midi), n) * adsr(n, .003, .22, .62, .045, max(.04, dur - .03))
        add(onepole(sig, 1100) * .3 * v, start, 0., 0.)

# ── Drums: short synthesized one-shots with coarse sample depth.
def noise(n): return rng.uniform(-1, 1, n)
def hp(x, c): b, a = butter(2, c / (SR / 2), 'high'); return lfilter(b, a, x)
def bp(x, lo, hi): b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band'); return lfilter(b, a, x)
def kit():
    t = lambda d: np.arange(int(d * SR)) / SR
    k = t(.22); f = 48 + 120 * np.exp(-k / .028)
    kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-k / .085) + .25 * noise(len(k)) * np.exp(-k / .004)
    s = t(.2); snare = .75 * bp(noise(len(s)), 1100, 7000) * np.exp(-s / .065) + .55 * np.sin(2 * np.pi * 188 * s) * np.exp(-s / .045)
    h = t(.06); hat = hp(noise(len(h)), 7000) * np.exp(-h / .014)
    o = t(.3); openhat = hp(noise(len(o)), 6500) * np.exp(-o / .09)
    c = t(1.6); crash = (.7 * hp(noise(len(c)), 4200) + .3 * bp(noise(len(c)), 2500, 9000)) * np.exp(-c / .5)
    th = t(.25); tomhi = np.sin(2 * np.pi * np.cumsum(210 * (1 + .6 * np.exp(-th / .03))) / SR) * np.exp(-th / .11)
    tl = t(.3); tomlo = np.sin(2 * np.pi * np.cumsum(140 * (1 + .6 * np.exp(-tl / .03))) / SR) * np.exp(-tl / .13)
    out = {'kick': (kick, .55, 0, 0), 'snare': (snare, .36, .04, .08), 'hat': (hat, .13, .28, 0), 'openhat': (openhat, .11, .28, .05),
           'crash': (crash, .16, -.2, .1), 'tomhi': (tomhi, .32, .25, .05), 'tomlo': (tomlo, .34, -.25, .05)}
    return {k: (q(v[0], 8) * v[1], v[2], v[3]) for k, v in out.items()}
KIT = kit()

for track in ('lead', 'lead2', 'pad', 'arp', 'bass'):
    for step, length, midi, v in sc[track]: voice(track, step, length, midi, v)
for step, kind, v in sc['drums']:
    sig, pan, echo = KIT[kind]; add(sig * v, step * STEP, pan, echo)

# ── SNES-style echo: ~3 sixteenths, filtered feedback, cross-panned.
D = int(round(3 * STEP * SR)); fb = .38
buf_l = np.zeros_like(EL); buf_r = np.zeros_like(ER)
a = np.exp(-2 * np.pi * 3600 / SR)
for start in range(0, len(EL), D):
    end = min(len(EL), start + D)
    if start >= D:
        prev_l = buf_l[start - D:end - D]; prev_r = buf_r[start - D:end - D]
        buf_l[start:end] = EL[start:end] + fb * lfilter([1 - a], [1, -a], prev_r)
        buf_r[start:end] = ER[start:end] + fb * lfilter([1 - a], [1, -a], prev_l)
    else:
        buf_l[start:end] = EL[start:end]; buf_r[start:end] = ER[start:end]
wet = .32
L2 = L.copy(); R2 = R.copy()
L2[D:] += wet * buf_l[:-D]; R2[D:] += wet * buf_r[:-D]
# Wrap the tail into the beginning: the loop point is seamless.
L2[:TAIL] += L2[N:N + TAIL]; R2[:TAIL] += R2[N:N + TAIL]
out = np.stack([L2[:N], R2[:N]], axis=1)
# Output stage: gentle roll-off (interpolation filter), soft clip, level.
b, a2 = butter(2, 12500 / (SR / 2)); out = lfilter(b, a2, out, axis=0)
out = np.tanh(out * 1.15) / np.tanh(1.15)
rms = np.sqrt(np.mean(out ** 2)); target = 10 ** (-16 / 20)
out = out * min(target / rms, 10 ** (-1 / 20) / np.max(np.abs(out)))
print('rms dBFS', round(20 * np.log10(np.sqrt(np.mean(out ** 2))), 2), 'peak dBFS', round(20 * np.log10(np.max(np.abs(out))), 2), 'seconds', round(N / SR, 2))
sf.write(sys.argv[2] if len(sys.argv) > 2 else 'title16.wav', out.astype(np.float32), SR, subtype='PCM_16')
