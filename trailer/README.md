# Trailer

`trailer.html` is the whole 50 s cut as a single HTML timeline (12 scenes; `window.seek(t)` positions every CSS animation, counter and video at time `t`).
`render.mjs` serves the folder, steps the timeline at 30 fps in headless Chromium and writes JPEG frames; `music.py` synthesizes the 128 BPM bed.
Narration lines are generated per scene (Seed Audio, voice "Benji") and mixed over the ducked bed with ffmpeg — see the session notes in the project README.
The scene loops referenced here (`*.webm`) are VP9 copies of `public/scenes/*.mp4`; the coin push-in shot is `public/scenes/coin.mp4`.

## v2 (36 s re-cut)
`trailer2.html` + `render2.mjs` + `music2.py`. Everything is quantized to 128 BPM beats; words are keyed to the narration's measured phrase windows (pauses detected from the VO wavs at 1.12× tempo). Mix: VO lines `atempo=1.12`, `adelay` 938 / 2812 / 6562 / 12656 / 15938 / 18750 / 20625 / 23438 / 30000 ms, music `music2.wav` ducked by sidechain, limiter 0.95.
