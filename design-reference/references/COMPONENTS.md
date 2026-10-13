# Component Reference

> Repeated DOM patterns detected by structural analysis. Each component appeared 3+ times.

## Detected Components

| Component | Category | Instances | Key Classes |
|-----------|----------|-----------|-------------|
| **Bg Space/80** | unknown | 6× | `.bg-space/80`, `.duration-700`, `.ease-out` |
| **Font Condiment** | unknown | 6× | `.font-condiment`, `.leading-none`, `.text-[26px]` |
| **Font Mono** | unknown | 6× | `.font-mono`, `.leading-relaxed`, `.mt-2` |
| **Absolute** | unknown | 5× | `.absolute`, `.h-full`, `.inset-0` |
| **Liquid Glass** | unknown | 3× | `.liquid-glass`, `.p-[18px]`, `.rounded-[32px]` |
| **Overflow Hidden** | unknown | 3× | `.overflow-hidden`, `.pb-[100%]`, `.relative` |
| **Absolute** | unknown | 3× | `.absolute`, `.bottom-[30px]`, `.inset-x-[30px]` |
| **Flex** | card | 3× | `.flex`, `.gap-3`, `.items-center` |
| **Font Grotesk** | unknown | 3× | `.font-grotesk`, `.leading-none`, `.text-[20px]` |
| **Bg Gradient To Br** | card | 3× | `.bg-gradient-to-br`, `.flex`, `.from-[#b724ff]` |
| **Block** | unknown | 3× | `.block` |

## Cards

### Flex

**Instances found:** 3

**CSS classes:** `.flex` `.gap-3` `.items-center` `.justify-between` `.liquid-glass` `.overflow-visible`

**HTML structure:**

```html
<div class="liquid-glass flex items-center justify-between gap-3 overflow-visible rounded-[20px] px-5 py-4"><p class="font-grotesk text-[20px] uppercase leading-none text-cream">REEFY</p><button type="button" aria-label="Open REEFY" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#b724ff] to-[#7c3aed] shadow-lg shadow-purple-500/50 transition hover:scale-110"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round
```

**Base styles (from design tokens):**

```css
.flex {
  background: #eff4ff;
  border-radius: 20px;
  padding: 8px;
}```

### Bg Gradient To Br

**Instances found:** 3

**CSS classes:** `.bg-gradient-to-br` `.flex` `.from-[#b724ff]` `.h-12` `.items-center` `.justify-center`

**HTML structure:**

```html
<button type="button" aria-label="Open REEFY" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#b724ff] to-[#7c3aed] shadow-lg shadow-purple-500/50 transition hover:scale-110"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
```

**Base styles (from design tokens):**

```css
.bg-gradient-to-br {
  background: #eff4ff;
  border-radius: 20px;
  padding: 8px;
}```

## Other Components

### Bg Space/80

**Instances found:** 6

**CSS classes:** `.bg-space/80` `.duration-700` `.ease-out` `.h-full` `.liquid-glass` `.opacity-0`

**HTML structure:**

```html
<article class="story-frame liquid-glass h-full rounded-[20px] bg-space/80 px-5 py-4 transition-[transform,opacity] duration-700 ease-out translate-y-10 opacity-0" style="transition-delay: 0ms;"><p class="font-condiment text-[26px] leading-none text-neon">The coin</p><p class="mt-2 font-mono text-[12px] uppercase leading-relaxed text-cream/90 sm:text-[13px]">You name the coin, set the ticker, and p…</p></article>
```

**Base styles (from design tokens):**

```css
.bg-space/80 {
  background: #eff4ff;
  padding: 4px;
}```

### Font Condiment

**Instances found:** 6

**CSS classes:** `.font-condiment` `.leading-none` `.text-[26px]` `.text-neon`

**HTML structure:**

```html
<p class="font-condiment text-[26px] leading-none text-neon">The coin</p>
```

**Base styles (from design tokens):**

```css
.font-condiment {
  background: #eff4ff;
  padding: 4px;
}```

### Font Mono

**Instances found:** 6

**CSS classes:** `.font-mono` `.leading-relaxed` `.mt-2` `.text-[12px]` `.text-cream/90` `.uppercase`

**HTML structure:**

```html
<p class="mt-2 font-mono text-[12px] uppercase leading-relaxed text-cream/90 sm:text-[13px]">You name the coin, set the ticker, and pick one suit. One signature. Supply stays fixed. The pool is against SOL. Liquidity is locked.</p>
```

**Base styles (from design tokens):**

```css
.font-mono {
  background: #eff4ff;
  padding: 4px;
}```

### Absolute

**Instances found:** 5

**CSS classes:** `.absolute` `.h-full` `.inset-0` `.object-cover` `.w-full`

**HTML structure:**

```html
<video class="absolute inset-0 h-full w-full object-cover" src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_045634_e1c98c76-1265-4f5c-882a-4276f2080894.mp4" autoplay="" loop="" playsinline="" preload="auto"></video>
```

**Base styles (from design tokens):**

```css
.absolute {
  background: #eff4ff;
  padding: 4px;
}```

### Liquid Glass

**Instances found:** 3

**CSS classes:** `.liquid-glass` `.p-[18px]` `.rounded-[32px]` `.transition`

**HTML structure:**

```html
<article class="liquid-glass rounded-[32px] p-[18px] transition hover:bg-white/10"><div class="relative w-full overflow-hidden rounded-[24px] pb-[100%]"><video class="absolute inset-0 h-full w-full object-cover" src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_053923_22c0a6a5-313c-474c-85ff-3b50d25e944a.mp4" autoplay="" loop="" playsinline="" preload="auto"></video></div><div class="absolute inset-x-[30px] bottom-[30px] z-10"><div class="liquid-glass flex items-center justify-between gap-3 overflow-visible rounded-[20px] px-5 py-4"><p class="font-grotesk t
```

**Base styles (from design tokens):**

```css
.liquid-glass {
  background: #eff4ff;
  padding: 4px;
}```

### Overflow Hidden

**Instances found:** 3

**CSS classes:** `.overflow-hidden` `.pb-[100%]` `.relative` `.rounded-[24px]` `.w-full`

**HTML structure:**

```html
<div class="relative w-full overflow-hidden rounded-[24px] pb-[100%]"><video class="absolute inset-0 h-full w-full object-cover" src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260331_053923_22c0a6a5-313c-474c-85ff-3b50d25e944a.mp4" autoplay="" loop="" playsinline="" preload="auto"></video></div>
```

**Base styles (from design tokens):**

```css
.overflow-hidden {
  background: #eff4ff;
  padding: 4px;
}```

### Absolute

**Instances found:** 3

**CSS classes:** `.absolute` `.bottom-[30px]` `.inset-x-[30px]` `.z-10`

**HTML structure:**

```html
<div class="absolute inset-x-[30px] bottom-[30px] z-10"><div class="liquid-glass flex items-center justify-between gap-3 overflow-visible rounded-[20px] px-5 py-4"><p class="font-grotesk text-[20px] uppercase leading-none text-cream">REEFY</p><button type="button" aria-label="Open REEFY" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#b724ff] to-[#7c3aed] shadow-lg shadow-purple-500/50 transition hover:scale-110"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h12M13 6l6 6-6 6" stroke="white" stroke-w
```

**Base styles (from design tokens):**

```css
.absolute {
  background: #eff4ff;
  padding: 4px;
}```

### Font Grotesk

**Instances found:** 3

**CSS classes:** `.font-grotesk` `.leading-none` `.text-[20px]` `.text-cream` `.uppercase`

**HTML structure:**

```html
<p class="font-grotesk text-[20px] uppercase leading-none text-cream">REEFY</p>
```

**Base styles (from design tokens):**

```css
.font-grotesk {
  background: #eff4ff;
  padding: 4px;
}```

### Block

**Instances found:** 3

**CSS classes:** `.block`

**HTML structure:**

```html
<span class="block">Sew the suit.</span>
```

**Base styles (from design tokens):**

```css
.block {
  background: #eff4ff;
  padding: 4px;
}```

## Component Rules

- Match class names exactly from the patterns above
- Each component instance must be visually identical to others of its type
- Do not add extra wrappers or change the DOM structure

