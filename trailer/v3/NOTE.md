# NOTE — FATE "The ring is the vault" (final.mp4, 31.0 s, 1920×1080, 30 fps, stereo)

## The one idea, and why
The official emblem is a closed ring. In this film the ring **is the vault**: trading fees fill it as an arc, and when it closes the destiny executes. The same ring travels through all four destinies (in each one's colour, at a different place in frame each time) and contracts back into the emblem at the end, so the logo arrives by cause. It comes from FATE's own logo shape and its core mechanism, so a competitor can't reuse it with the colours swapped.

## Beats and what each buys
| t | beat | buys |
|---|---|---|
| 0–3.0 | emblem decelerates in over the garden; camera dives through its ring | "a coin with a fixed purpose" |
| 3.0–6.9 | the coin plate, still travelling out of the dive; "an economy." on the spoken words | "it's an economy, not a token" |
| 6.9–8.7 | the real destiny picker, magnified; the cursor parks and presses Phoenix on "destiny" | "you choose one" |
| 8.7–11.2 | the real review card: "Your destiny cannot be changed after launch." | "and it's locked" |
| 11.2–14.3 | **hero**: fees fill the ember ring in six steps; 0.4 s of held breath; the ring snaps shut on "spends", with a flare and the drop | "the vault fills, then the protocol acts" |
| 14.3–18.6 | the real execution-history row, read by the camera (punch, whip, push to "3.60M EMBER", pull back) | "it actually happened: bought and burned" |
| 18.6–26.8 | Phoenix "burns." / Gravity "forever." / Echo "who stay." / Orbit "owns itself." with the ring closing on each line | "four different economies" |
| 26.8–31.0 | the Orbit ring contracts into the emblem; FATE; "Chosen once. Enforced forever." | "this is FATE" |

## What is real, and what is illustrative
- **Real:** the emblem (the official artwork, unedited); every UI frame (screenshots of the current build: the launch flow's destiny picker and review step, and the Ember Finch coin page's execution-history row from a seeded **simnet** ledger); the copy ("Chosen once. Enforced forever." is the site's own line); and the narration (the preset voice you chose, the same takes as v2, re-timed).
- **Illustrative:** the mascot and world plates (the site's own generated media); the ring animation (a drawn metaphor of the vault, not a UI element); and the score and SFX (synthesized in `audio/score.py`, because there's no ElevenLabs key here).
- The "3.60M EMBER" row comes from the demo ledger (simnet), not mainnet.

## Gates (numbers printed by the skill's scripts)
- `look.py final.mp4 --expect 31 --expect-audio`:
  - **G0 PASS:** 31.00 s with an audio stream.
  - **G2 PASS:** no run of more than 3 flat frames.
  - **G3 PASS:** end hold 0.03 s (ends mid-motion); final shot 4.20 s = 14 % of the film.
  - Audio: −14.1 LUFS integrated, LRA 2.3 LU, true peak −1.3 dBFS, audible 0.07–31.00 s (100 %), no flags. The 13.00–13.40 s breath is quiet air, not digital silence.
  - Cut sync: 8 of 12 cuts within ±80 ms of a sound onset.
- `lint.mjs index.html`: **G5 PASS**; every rule passes (no corner labels, counters, progress bars, decks or typed headlines).
- **G1 (by eye):** picker titles about 45 px, the review headline about 90 px, and the execution row 45–75 px during its holds. The row's final pull-back (18.0–18.6 s) drops to about 0.026 H, but that's context after the readable pushes.
- **G4 (by eye):** one hero per frame throughout. The picker shows four cards, but the camera and cursor make Phoenix the hero.
- **Motion:** mean luma change 3.2/255, under the human band (median 6.8). The film is dark and the character loops play at real speed, which is deliberate after "bad model animations" (v2 ran them at 2.6×). Energy comes from cuts every 2.4 s on average, the dive, snap-ins, whips and the drop.

## One-sentence frame descriptions (look-final/sheet.jpg)
1. The emblem in the lit crystal garden.
2. Inside the emblem's star, mid-dive.
3. The astrolabe coin among the mascots.
4. "AN ECONOMY." over the coin, with "economy" in mint.
5. Pushed into the real Phoenix card in the picker.
6. The real review card, "YOUR DESTINY CANNOT BE CHANGED AFTER LAUNCH."
7. The Phoenix with the ember ring part-filled.
8. Macro on the real row: "#1 completed — Bought and burned…"
9. The row mid-whip.
10. The whole row at the pull-back.
11. The Phoenix ring closed, "BURNS."
12. "FOREVER." beside Gravity's blue ring.
13. "WHO STAY." under Echo's lavender ring.
14. "OWNS ITSELF." beside Orbit's green ring.
15. The FATE lockup arriving.
16. The lockup with "Chosen once. Enforced forever."

## What I would still improve
- Higher-resolution character plates: the loops are 544 px, so the foreground is softened by upscaling.
- A real hit-accurate sound pass with ElevenLabs SFX.
- A version where the ring arc is driven by a real devnet vault's fee events, once the devnet round trip is funded.
