# Layout Reference

> Auto-extracted from live DOM. Use this to understand how the site is structured spatially.

## Spacing System

**Base grid:** 4px

**Scale:** `4, 8, 12, 16, 18, 20, 24, 30, 32, 40, 48, 52, 64, 80, 96` px

| Spacing | Semantic Use |
|---------|-------------|
| 4px | Tight — within a component |
| 8px | Medium — between sibling items |
| 16px | Wide — between sections |
| 32px | Vast — major section breaks |

## Flex Layouts

| Element | Direction | Justify | Align | Gap | Children |
|---------|-----------|---------|-------|-----|----------|
| `header.relative.flex` | row | — | center | 12px | 2 |
| `div.relative.z-10` | column | center | — | — | 1 |
| `div.relative.z-10` | column | — | — | — | 2 |
| `div.absolute.inset-0` | row | end | center | — | 1 |
| `div.order-3.flex` | row | center | — | — | 1 |
| `div.ml-auto.flex` | row | — | center | 8px | 2 |
| `div.flex.flex-col` | row | space-between | end | 32px | 2 |
| `div.mb-12.flex` | row | space-between | end | 40px | 2 |
| `a.inline-flex.w-fit` | column | — | — | — | 2 |
| `button.liquid-glass.flex` | row | — | center | 8px | 3 |
| `span.flex.items-center` | row | — | center | 12px | 2 |
| `span.flex.flex-col` | column | — | — | — | 2 |
| `div.liquid-glass.flex` | row | space-between | center | 12px | 2 |
| `div.liquid-glass.flex` | row | space-between | center | 12px | 2 |
| `div.liquid-glass.flex` | row | space-between | center | 12px | 2 |

## Grid Layouts

| Element | Template Columns | Gap | Children |
|---------|-----------------|-----|----------|
| `div.mt-8.grid` | `662px 662px` | 20px | 6 |
| `div.grid.grid-cols-1` | `432px 432px 432px` | 24px | 3 |

## Structural Containers

### `<main>` 

```
display:          block
children:         4
```

### `<section>` (`section#home.relative.min-h-screen`)

```
display:          block
children:         2
```

### `<section>` (`section#about.relative.min-h-screen`)

```
display:          block
children:         3
```

### `<section>` (`section#gallery.bg-space.py-16`)

```
display:          block
padding:          96px 0px
children:         1
```

### `<section>` (`section#contact.relative.bg-space`)

```
display:          block
children:         2
```

### `<header>` (`header.relative.flex`)

```
display:          flex
flex-direction:   row
justify-content:  —
align-items:      center
gap:              12px
children:         2
```

### `<nav>` (`nav.liquid-glass.max-w-full`)

```
display:          block
padding:          24px 52px
max-width:        100%
children:         1
```

### `<article>` (`article.story-frame.liquid-glass`)

```
display:          block
padding:          16px 20px
children:         2
```

### `<article>` (`article.story-frame.liquid-glass`)

```
display:          block
padding:          16px 20px
children:         2
```

### `<article>` (`article.story-frame.liquid-glass`)

```
display:          block
padding:          16px 20px
children:         2
```

### `<article>` (`article.story-frame.liquid-glass`)

```
display:          block
padding:          16px 20px
children:         2
```

### `<article>` (`article.story-frame.liquid-glass`)

```
display:          block
padding:          16px 20px
children:         2
```

## Layout Rules

- **Container max-width:** `1831px` — always center with `margin: auto`
- Primary layout system: **Flexbox**
- Secondary layout system: **CSS Grid** (used for card grids and multi-column layouts)
- Every spacing value must be a multiple of **4px**
- Never use arbitrary margin/padding values outside the spacing scale

