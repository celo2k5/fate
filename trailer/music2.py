import numpy as np, wave, struct
SR=48000; BPM=128; BEAT=60/BPM; DUR=36.1
N=int(SR*DUR); t=np.arange(N)/SR
out=np.zeros(N)
def env(n, a, d, s=0.0, r=0.05):
    e=np.ones(n); A=int(a*SR); D=int(d*SR); R=int(r*SR)
    e[:A]=np.linspace(0,1,A); e[A:A+D]=np.linspace(1,s,D); e[A+D:]=s
    if R: e[-R:]*=np.linspace(1,0,R)
    return e
def add(start, sig):
    i=int(start*SR)
    if i>=N: return
    j=min(N, i+len(sig)); out[i:j]+=sig[:j-i]
def kick(): 
    n=int(0.35*SR); tt=np.arange(n)/SR; f=160*np.exp(-tt*28)+45
    return np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,0.002,0.3)*1.0
def hat(open_=False):
    n=int((0.25 if open_ else 0.06)*SR); x=np.random.randn(n)
    x=np.diff(np.concatenate([[0],x])); return x*env(n,0.001,0.05 if not open_ else 0.2)*0.18
def snare():
    n=int(0.2*SR); tt=np.arange(n)/SR
    return (np.random.randn(n)*0.6+np.sin(2*np.pi*190*tt)*0.4)*env(n,0.001,0.15)*0.6
def bass(f, dur):
    n=int(dur*SR); tt=np.arange(n)/SR
    saw=2*((tt*f)%1)-1; sub=np.sin(2*np.pi*f*tt)
    return (saw*0.35+sub*0.5)*env(n,0.005,dur*0.6,0.5,0.03)*0.45
def pad(freqs, dur, vol=0.12):
    n=int(dur*SR); tt=np.arange(n)/SR; s=np.zeros(n)
    for f in freqs:
        for det in (-0.4,0,0.4): s+=np.sin(2*np.pi*(f+det)*tt+np.sin(2*np.pi*0.3*tt))
    return s/len(freqs)/3*env(n,0.4,dur*0.5,0.7,0.5)*vol
def pluck(f, dur=0.18):
    n=int(dur*SR); tt=np.arange(n)/SR
    return (np.sin(2*np.pi*f*tt)+0.5*np.sin(2*np.pi*2*f*tt))*env(n,0.002,0.15)*0.22
# chord progression (A minor): Am – F – C – G
chords=[(110,164.81,220,261.63),(87.31,130.81,174.61,220),(130.81,196,261.63,329.63),(98,146.83,196,246.94)]
bassn=[55,43.65,65.41,49]
bars=int(DUR/(BEAT*4))+1
for bar in range(bars):
    t0=bar*BEAT*4; c=chords[bar%4]; bf=bassn[bar%4]
    section = 'intro' if t0<2.8 else 'build' if t0<12.6 else 'drop' if t0<30 else 'tail'
    if section!='intro': add(t0, pad(c, BEAT*4, 0.1 if section=='drop' else 0.07))
    else: add(t0, pad(c[:2], BEAT*4, 0.05))
    for b in range(4):
        tb=t0+b*BEAT
        if section in ('build','drop','tail'):
            add(tb, kick())
            if section=='drop' or section=='tail': add(tb+BEAT/2, hat())
            if b in (1,3) and section=='drop': add(tb, snare())
            if section=='build':
                for k in range(2): add(tb+k*BEAT/2, hat())
        if section=='drop':
            for k in range(4): add(tb+k*BEAT/4, bass(bf*(2 if k%2 else 1), BEAT/4))
        elif section in ('build','tail'):
            add(tb, bass(bf, BEAT))
        # arpeggio plucks
        if section in ('build','drop'):
            for k in range(4): add(tb+k*BEAT/4, pluck(c[(b+k)%4]*2 if section=='drop' else c[k%4]*2))
# riser into the drop
n=int(2*SR); tt=np.arange(n)/SR; add(10.66, np.random.randn(n)*np.linspace(0,0.25,n)*np.sin(2*np.pi*np.cumsum(np.linspace(200,4000,n))/SR)*0.6)
# impact at the drop
n=int(1.2*SR); tt=np.arange(n)/SR; add(12.656, np.sin(2*np.pi*(50*np.exp(-tt*3))*tt)*np.exp(-tt*2.5)*0.9)
# master: soft clip + fade
m=np.tanh(out*1.4)*0.9; fade=np.ones(N); fo=int(3*SR); fade[-fo:]=np.linspace(1,0,fo); m*=fade
with wave.open('out/music2.wav','wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((m*32767).astype('<i2').tobytes())
print('music ok', DUR)
