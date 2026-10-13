"""Score + SFX for 'The ring is the vault' (31 s). Synthesized (no ElevenLabs key in this environment).
Sections follow the picture: intro pad (0-3.0) -> pulse (3.0-6.9) -> build with kick (6.9-11.2) -> riser (11.2-13.0)
-> SILENCE (13.0-13.41) -> drop on the ring closing (13.41-26.8) -> pad + low hit under the logo (26.8-31)."""
import numpy as np, wave, os
SR = 48000; DUR = 31.0; BPM = 128; BEAT = 60 / BPM
N = int(SR * DUR); out = np.zeros(N)
rng = np.random.default_rng(7)
here = os.path.dirname(os.path.abspath(__file__))

def env(n, a, d, s=0.0, r=0.05):
    e = np.ones(n); A = max(1, int(a * SR)); D = max(1, int(d * SR)); R = int(r * SR)
    e[:A] = np.linspace(0, 1, A); e[A:A + D] = np.linspace(1, s, len(e[A:A + D])); e[A + D:] = s
    if R: e[-R:] *= np.linspace(1, 0, R)
    return e
def add(buf, t, sig):
    i = int(t * SR)
    if i >= len(buf) or i < 0: return
    j = min(len(buf), i + len(sig)); buf[i:j] += sig[:j - i]
def kick():
    n = int(.34 * SR); tt = np.arange(n) / SR; f = 150 * np.exp(-tt * 26) + 44
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, .002, .3) * 1.0
def hat(o=False):
    n = int((.22 if o else .05) * SR); x = np.diff(np.concatenate([[0], rng.standard_normal(n)]))
    return x * env(n, .001, .04 if not o else .18) * .16
def snare():
    n = int(.2 * SR); tt = np.arange(n) / SR
    return (rng.standard_normal(n) * .6 + np.sin(2 * np.pi * 185 * tt) * .4) * env(n, .001, .15) * .55
def bass(f, d):
    n = int(d * SR); tt = np.arange(n) / SR
    return ((2 * ((tt * f) % 1) - 1) * .3 + np.sin(2 * np.pi * f * tt) * .55) * env(n, .004, d * .6, .5, .03) * .42
def pad(fs, d, v=.1):
    n = int(d * SR); tt = np.arange(n) / SR; s = np.zeros(n)
    for f in fs:
        for det in (-.5, 0, .5): s += np.sin(2 * np.pi * (f + det) * tt + .6 * np.sin(2 * np.pi * .25 * tt))
    return s / len(fs) / 3 * env(n, .5, d * .5, .75, .6) * v
def pluck(f, d=.18):
    n = int(d * SR); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * tt) + .45 * np.sin(2 * np.pi * 2 * f * tt)) * env(n, .002, .15) * .2

chords = [(110, 164.81, 220, 261.63), (87.31, 130.81, 174.61, 220), (130.81, 196, 261.63, 329.63), (98, 146.83, 196, 246.94)]
roots = [55, 43.65, 65.41, 49]

# pads across the whole film, one bar each (silenced inside the 13.0-13.41 hole below)
t = 0.0; bar = 0
while t < DUR:
    c = chords[bar % 4]
    add(out, t, pad(c, BEAT * 4 + .6, .07 if t < 13.4 or t > 26.8 else .09)); t += BEAT * 4; bar += 1

def groove(t0, t1, level):
    k = 0; t = t0
    while t < t1 - 1e-6:
        b = k % 4; c = chords[(k // 4) % 4]; r = roots[(k // 4) % 4]
        if level >= 1: add(out, t, kick() * (.8 if level == 1 else 1))
        if level >= 1: add(out, t + BEAT / 2, hat())
        if level >= 2:
            if b in (1, 3): add(out, t, snare())
            for q in range(4): add(out, t + q * BEAT / 4, bass(r * (2 if q % 2 else 1), BEAT / 4))
            for q in range(4): add(out, t + q * BEAT / 4, pluck(c[(b + q) % 4] * 2))
        elif level >= 1:
            add(out, t, bass(r, BEAT * .9))
            for q in range(2): add(out, t + q * BEAT / 2, pluck(c[q % 4] * 2, .14) * .7)
        else:
            add(out, t, bass(r, BEAT * .9) * .45)
        t += BEAT; k += 1

groove(3.0, 6.9, 0)          # pulse
groove(6.9, 11.2, 1)         # build: kick enters on the real UI
groove(11.2, 13.0, 1)
groove(13.41, 26.8, 2)       # drop on the ring closing
# riser into the hole
n = int(1.8 * SR); tt = np.arange(n) / SR
add(out, 11.2, rng.standard_normal(n) * np.linspace(0, .22, n) * np.sin(2 * np.pi * np.cumsum(np.linspace(220, 3600, n)) / SR) * .7)
# the hole: real silence before the hit (fade the tails out over 60 ms)
a, b = int(12.94 * SR), int(13.41 * SR)
out[a:a + int(.06 * SR)] *= np.linspace(1, 0, int(.06 * SR)); out[a + int(.06 * SR):b] = rng.standard_normal(b - a - int(.06 * SR)) * .004  # a breath of air, not digital silence
# master + fade only the last 0.8 s
m = np.tanh(out * 1.3) * .9
f0 = int((DUR - .25) * SR); m[f0:] *= np.linspace(1, 0, N - f0)

def write(path, sig):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(sig, -1, 1) * 32767).astype('<i2').tobytes())
write(os.path.join(here, 'music.wav'), m)

# ── SFX system (5 kinds, reused) ──
os.makedirs(os.path.join(here, 'sfx'), exist_ok=True)
def sfx(name, sig): write(os.path.join(here, 'sfx', name + '.wav'), sig / max(1e-9, np.abs(sig).max()) * .9)
n = int(.09 * SR); tt = np.arange(n) / SR
sfx('tick', np.sin(2 * np.pi * 1760 * tt) * env(n, .001, .07) + .3 * np.sin(2 * np.pi * 2640 * tt) * env(n, .001, .04))
n = int(.06 * SR); sfx('click', np.diff(np.concatenate([[0], rng.standard_normal(n)])) * env(n, .0005, .03) + np.sin(2 * np.pi * 900 * np.arange(n) / SR) * env(n, .001, .02) * .6)
n = int(1.6 * SR); tt = np.arange(n) / SR
sfx('impact', (np.sin(2 * np.pi * (46 * np.exp(-tt * 2.2) + 22) * tt) * np.exp(-tt * 2.4) + rng.standard_normal(n) * np.exp(-tt * 18) * .35))
n = int(.42 * SR); tt = np.arange(n) / SR
sfx('whoosh', rng.standard_normal(n) * np.sin(np.pi * tt / tt[-1]) ** 2 * np.sin(2 * np.pi * np.cumsum(np.linspace(300, 2600, n)) / SR))
n = int(2.4 * SR); tt = np.arange(n) / SR
sfx('low', np.sin(2 * np.pi * 41 * tt) * np.exp(-tt * 1.6) + .3 * np.sin(2 * np.pi * 82 * tt) * np.exp(-tt * 2.5))
print('score + sfx written')
