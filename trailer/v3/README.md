# Trailer v3 — "The ring is the vault" (motionmaxxing)
Built with the motionmaxxing skill runtime (GSAP, seek-safe). To re-render: copy `runtime/` from the skill next to `index.html`,
put the scene loops in `media/` (public/scenes/*.mp4 converted to .webm, plus public/brand/emblem.png), the UI captures in `ui/`
(launch picker, review step, coin page; 2x screenshots of the running app) and the brand fonts in `brand/fonts/`, then:
`node <skill>/scripts/render.mjs index.html final.mp4 --audio audio/mix.wav --grain 0.03`. See NOTE.md for gates and STORYBOARD.md for the plan.
