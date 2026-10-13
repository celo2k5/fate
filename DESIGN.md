# FATE — design notes

> v4 — "Deep plum, mint & marker". Built on the *style* skillui extracted from reefy.cash in ultra mode (saturated dark base, condensed uppercase poster display, handwritten script stickers, mono uppercase microcopy, 2px-outlined cards, glass pill nav, gradient arrow buttons, full-bleed video loops) and re-authored with none of its parts: deep plum `#0B0516` instead of navy, mint `#4DFFC3` + magenta→violet instead of lime + purple, Big Shoulders Display instead of Anton, Caveat instead of Condiment, JetBrains Mono microcopy, Space Grotesk forms. Own composition (sigil inside the pill nav, stats strip + ticker in the hero, four story cards, crew cards with glow, board + activity, right-aligned closing) and own copy. Motion from v3 kept (preloader, route bar, reveal, parallax, count-ups, marquee).


> v3 — "Obsidian & astral gold". Own identity after the v2 reference pass: obsidian `#0A0812` base with a violet cast (matches the generated scenes), the astrolabe gold engraved in the renders as the single brand accent `#F2C14E`, aurora teal `#6EE7D8` secondary, ivory `#F4EDE3` text. Syne 800 display in sentence case, Instrument Serif italic as the "voice", Space Grotesk body. One card system (`.card`, 24px, hairline + inner highlight, destiny-tinted when accumulating), one button system (pill, gold primary). Motion: first-visit preloader (sigil draws itself), gold route-progress bar, staggered scroll reveal, hero parallax, scroll-driven lifecycle timeline, count-up stats, live activity marquee, destiny character pulses on execution; all gated by `prefers-reduced-motion`. Home organization: parallax hero + ticker → lifecycle timeline → destinies as alternating media rows → featured board → closing scene. Admin console at `/admin` on the same system.


> v2: rebuilt on the reefy.cash design system extracted with `skillui --url https://reefy.cash --mode ultra` (output kept in `design-reference/`). Space navy `#010828`, cream `#EFF4FF`, one neon accent, Anton condensed uppercase display + brush-script accent (Yellowtail) + uppercase monospace body, liquid-glass surfaces (`.liquid-glass`), 2px cream story-frame cards, purple gradient arrow buttons, `hero-rise`/`hero-script` blur-in motion, scroll-reveal cards, and full-bleed looping video scenes. All scene media (`public/scenes/*.mp4|jpg`) was generated for this project: 7 stills → 7 image-to-video loops.

---

## v1 notes (superseded)


Reference: reefy.cash (deep-navy base, tall condensed uppercase display type, a neon script accent, floating pill nav, thin-bordered rounded cards, rendered 3D character scenes, "suit sewn to the coin" premise). FATE borrows the *structure* — hero scene → explainer → character grid → manifesto band — and nothing else.

## Subject grounding
Destiny chosen once and enforced. Vernacular: oracles, astrolabes, star charts, engraved plates. That becomes ruled technical lines, a destiny wheel as the hero centerpiece, and four characters drawn as living sigils that react to vault state.

## Tokens
- Ink `#080709` base · Ash `#141116` surface · Rule `#2A252C` · Parchment `#EDE6DA` text · Muted `#8F877C`
- Phoenix ember `#FF5A1F` / `#C8102E` · Gravity cobalt `#2D5BFF` / silver `#B8C2D6` · Echo violet `#8B5CF6` / lavender `#DCD3FF` · Orbit emerald `#10B981` / cyan `#22D3EE`
- An accent only appears inside its own destiny's context (`[data-destiny]` sets `--accent`).
- Type: Fraunces (display; italic carries the "fate" voice) + Schibsted Grotesk (UI, tabular numerals for every protocol figure). Sentence case, no tracked eyebrow labels, no monospace data labels.
- Borders encode state: a coin card's border takes the destiny color only once its vault is accumulating.
- Motion: one orchestrated page-load moment (the wheel assembling); everything else answers protocol state (vault fill, rebirth burst, epoch waves, satellites) or a user action. `prefers-reduced-motion` disables all of it.

## Characters (procedural, `src/components/Character.tsx`)
- Phoenix: ember-glass bird; glow and core brightness = vault progress; rebirth ring on execution.
- Gravity: cobalt sphere; silver rings = number of locked positions; floor dimple deepens as the vault fills.
- Echo: stacked glass-ring column; standing ripples charge with the vault; concentric waves on epoch settle.
- Orbit: emerald core; satellites sized by treasury allocation, orbit paths brighten with the vault.
AI-rendered scene images (`public/scenes/*.jpg`, generated for this project) depict the same four creatures for hero/section backdrops.

## Reviewed against generic defaults
Near-black base is the brief's call. Four structural accents avoid the single-acid-accent look. No uniform card kit: hairline rules, 6px radius, no shadows, borders that mean something. Numbered markers only on the actual four-step loop.
