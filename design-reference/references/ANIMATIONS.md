# Animation Reference

> Cinematic motion design extracted from live DOM. Follow these specs exactly to recreate the experience.

## Motion Technology Stack

| Library | Type | Notes |
|---------|------|-------|
| **Web Animations API (3 active)** | animation |  |

## Scroll Journey

The page is **2,868px** tall. Each frame below shows what the user sees at that scroll depth.

> **Use these screenshots to understand WHAT animates, WHEN it animates, and HOW it moves.**

### 0% — Top / Hero
Scroll position: 0px

![Scroll 0%](../screens/scroll/scroll-000.png)

### 17% — Opening Section
Scroll position: 335px

![Scroll 17%](../screens/scroll/scroll-017.png)

### 33% — First Feature Section
Scroll position: 649px

![Scroll 33%](../screens/scroll/scroll-033.png)

### 50% — Mid-Page
Scroll position: 984px

![Scroll 50%](../screens/scroll/scroll-050.png)

### 67% — Lower Content
Scroll position: 1,319px

![Scroll 67%](../screens/scroll/scroll-067.png)

### 83% — Near Footer
Scroll position: 1,633px

![Scroll 83%](../screens/scroll/scroll-083.png)

### 100% — Bottom / Footer
Scroll position: 1,968px

![Scroll 100%](../screens/scroll/scroll-100.png)

## Video Elements

| # | Role | Autoplay | Loop | Muted | Size | First Frame |
|---|------|----------|------|-------|------|-------------|
| 1 | background | ✓ | ✓ | ✓ | 1440×900 | [view](../screens/scroll/video-1-frame.png) |
| 2 | background | ✓ | ✓ | ✓ | 1440×900 | — |
| 3 | content | ✓ | ✓ | ✓ | 396×396 | — |
| 4 | content | ✓ | ✓ | ✓ | 396×396 | — |
| 5 | content | ✓ | ✓ | ✓ | 396×396 | — |
| 6 | background | ✓ | ✓ | ✓ | 1440×150 | — |

**Video 1 first frame:**

![Video 1 Frame](../screens/scroll/video-1-frame.png)

- **Source:** `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_045634_e1c98c76-1265-4f5c-882a-4276f20`
- **Source:** `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_151551_992053d1-3d3e-4b8c-abac-45f2215`
- **Source:** `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_053923_22c0a6a5-313c-474c-85ff-3b50d25`
- **Source:** `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_054411_511c1b7a-fb2f-42ef-bf6c-32c0b1a`
- **Source:** `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_055427_ac7035b5-9f3b-4289-86fc-941b243`
- **Source:** `https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_055729_72d66327-b59e-4ae9-bb70-de6ccb5`

## CSS Keyframes (4 extracted)

### `@keyframes hero-rise`

Duration: `0.95s` · Easing: `cubic-bezier(0.16, 1, 0.3, 1)` · Delay: `0s` · Iteration: `1` · Fill: `both`

Used by: `.hero-line`

```css
@keyframes hero-rise {
  0% {
    opacity: 0;
    filter: blur(10px);
    transform: translateY(42px);
  }
  100% {
    opacity: 1;
    filter: blur();
    transform: translateY(0px);
  }
}
```

> Fade + motion enter animation · Filter effect (blur/brightness)

### `@keyframes hero-script`

Duration: `0.9s` · Easing: `cubic-bezier(0.16, 1, 0.3, 1)` · Delay: `0.46s` · Iteration: `1` · Fill: `both`

Used by: `.hero-script`

```css
@keyframes hero-script {
  0% {
    opacity: 0;
    filter: blur(8px);
    transform: translateY(16px) rotate(-14deg) scale(0.82);
  }
  100% {
    opacity: 0.9;
    filter: blur();
    transform: translateY(0px) rotate(-1deg) scale(1);
  }
}
```

> Fade + motion enter animation · Filter effect (blur/brightness)

### `@keyframes toast-rise`

Duration: `0.35s` · Easing: `cubic-bezier(0.16, 1, 0.3, 1)` · Delay: `0s` · Iteration: `1` · Fill: `both`

Used by: `.toast-rise`

```css
@keyframes toast-rise {
  0% {
    opacity: 0;
    transform: translateY(16px);
  }
  100% {
    opacity: 1;
    transform: translateY(0px);
  }
}
```

> Fade + motion enter animation

### `@keyframes ca-check`

Duration: `0.22s` · Easing: `cubic-bezier(0.16, 1, 0.3, 1)` · Delay: `0s` · Iteration: `1` · Fill: `both`

Used by: `.ca-check`

```css
@keyframes ca-check {
  0% {
    opacity: 0;
    transform: translate(-50%, 8px) scale(0.8);
  }
  100% {
    opacity: 1;
    transform: translate(-50%) scale(1);
  }
}
```

> Fade + motion enter animation

## How to Recreate This Motion Design

### Step 1 — Install Dependencies

```bash
```

### Step 2 — Scroll-Reveal Pattern

Elements that animate into view follow this pattern:

```css
/* Initial hidden state */
.reveal {
  opacity: 0;
  transform: translateY(40px);
  transition: opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}
```

### Step 3 — Key Motion Principles

- **Video backgrounds** — use `<video autoplay loop muted playsinline>` for background videos. Always include a poster image fallback
- **Always add** `@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`

### Step 4 — Scroll Journey Reference

Match what happens at each scroll position:

- **0%** (`0px`) → `screens/scroll/scroll-000.png`
- **17%** (`335px`) → `screens/scroll/scroll-017.png`
- **33%** (`649px`) → `screens/scroll/scroll-033.png`
- **50%** (`984px`) → `screens/scroll/scroll-050.png`
- **67%** (`1319px`) → `screens/scroll/scroll-067.png`
- **83%** (`1633px`) → `screens/scroll/scroll-083.png`
- **100%** (`1968px`) → `screens/scroll/scroll-100.png`

