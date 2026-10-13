# Trailer

`trailer.html` is the whole 50 s cut as a single HTML timeline (12 scenes; `window.seek(t)` positions every CSS animation, counter and video at time `t`).
`render.mjs` serves the folder, steps the timeline at 30 fps in headless Chromium and writes JPEG frames; `music.py` synthesizes the 128 BPM bed.
Narration lines are generated per scene (Seed Audio, voice "Benji") and mixed over the ducked bed with ffmpeg — see the session notes in the project README.
The scene loops referenced here (`*.webm`) are VP9 copies of `public/scenes/*.mp4`; the coin push-in shot is `public/scenes/coin.mp4`.
