# Food Industry Fabrication Ltd. — Website Specification

> **Purpose of this document:** A single reference for the structure, design system,
> and performance approach of the FIFL website. Read this first before making changes.
> Keep it up to date as the site grows.

Last updated: 2026-07-28 · Status: **Skeleton / v0**

---

## 1. What this site is

A **static marketing website** for Food Industry Fabrication Ltd. (FIFL), a machining
company specializing in parts and equipment for food production.

Design goals, in priority order:

1. **Fast** — loads and navigates near-instantly, even on old computers and browsers.
2. **Lightweight** — no frameworks, minimal JavaScript, at most one small self-hosted font.
3. **Simple & maintainable** — clean HTML, organized CSS, easy to re-theme.
4. **Expandable** — this is the skeleton; more pages/content come later.

Everything here is a placeholder (lorem ipsum, placeholder images, placeholder contact
details) unless noted. Replace placeholders as real content arrives.

---

## 2. Performance approach (the "McMaster-Carr" techniques)

McMaster-Carr's site feels instant. We copy the ideas that matter for a small static site:

| Technique | How we do it | Where |
|---|---|---|
| **Multi-page, server-served HTML** (not a single-page app) | Each page is its own small, complete, cacheable `.html` file. No client-side router, no hydration. | all `*.html` |
| **Prefetch on intent** | The moment a user *hovers* or *touches* a nav link, we fetch that page in the background so the click is instant. | `js/prefetch.js` |
| **Speculation Rules** (modern browsers) | Browsers that support it *prefetch* likely-next pages — the HTML document only, not its images. Older browsers simply ignore it and fall back to the manual hover-prefetch above. | `js/prefetch.js` |
| **At most one web font** | Currently the OS's own UI font stack — nothing to download. Candidate fonts are *self-hosted* (never a Google Fonts `<link>`): one variable WOFF2, latin subset, upright only, 26–47 KB, `font-display: swap` so text is never invisible. See § Fonts. | `css/fonts.css`, `css/theme.css` |
| **Tiny, cached CSS** | 4 small stylesheets, cached after first load, shared across every page. | `css/` |
| **Almost no JavaScript** | Two small files: the prefetch helper (~1 KB) and the mobile menu toggle (~1 KB). The site is 100% functional with JS disabled. | `js/prefetch.js`, `js/nav.js` |
| **Sharp, flat design** | No shadows/blur/animation to repaint. Cheap for old GPUs to render. | `css/*` |

#### Rule: prefetch, never prerender

`js/prefetch.js` asks for `prefetch` in both layers, and that is deliberate. `prerender`
would fetch each candidate page's **subresources** as well — so hovering the Gallery tab
would pull every photo on it, for a visitor who may never click. Prefetch costs a couple of
KB per candidate (the HTML); the images download only when the page is genuinely visited.

Images are and will remain the heaviest thing on this site by a wide margin, so this is the
one setting here capable of multiplying bandwidth several-fold. Leave it as `prefetch`.

### Server / hosting notes (do this when deploying)
The static files can be hosted anywhere (Netlify, Cloudflare Pages, GitHub Pages, plain
nginx/Apache). To match McMaster-level speed, configure the host to:

- Serve over **HTTP/2 or HTTP/3**.
- Enable **gzip/brotli compression** for `.html`, `.css`, `.js`.
- Set **long cache lifetimes** for `css/`, `js/`, `assets/` (e.g. `Cache-Control: max-age=31536000, immutable`)
  and a short/revalidate cache for `.html`.
- Later, when filenames are stable, consider content-hashed asset names for cache-busting.

None of the above requires code changes — it's host configuration.

---

## 3. Pages

The landing page is **Home** (`index.html`). Clicking the logo always returns to Home.
More pages will be added later.

| Tab | File | Contents (v0) |
|---|---|---|
| Home | `index.html` | Hero (company name title + square placeholder image), lorem subheader, a one-line strip of well-known clients, four "areas of expertise" cards with image-background + body text, a full-width banner image. |
| About Us | `about.html` | Standard about page. Lorem ipsum + placeholders. |
| Gallery | `gallery.html` | Static grid of placeholder images. |
| Services | `services.html` | Intro, then one full-width band per "area of expertise" — text left, placeholder image right, alternating tint. Lorem copy. |
| Contact | `contact.html` | Contact form (non-functional placeholder), placeholder email + phone, real address + live Google Maps embed. |

### The four "areas of expertise"
1. Custom Machined Parts
2. Fabricated Components
3. Special Purpose Machine Design
4. Industrial Sewing

These appear twice: as the four cards on Home, and as the four bands on Services.
Each Services band carries the kebab-case `id` of its title
(`#custom-machined-parts`, `#fabricated-components`, `#special-purpose-machine-design`,
`#industrial-sewing`), so the Home cards can deep-link to one. **Keep the two lists in
step** — if a service is added, renamed, or dropped, change both pages.

### The client strip (Home)

Between the hero and the expertise cards, Home carries a strip of the company's
best-known clients. Names are placeholders; the boxes are sized for logos.

**It is one horizontal line at every width — it never wraps and never stacks.**
The items share the row evenly while they fit, stop shrinking at a floor
(`min-width: 8.5rem`), and past that the strip scrolls sideways. The scrollbar is
hidden in all three engines, because a horizontal bar under a 72px strip is most
of its visual weight and only ever shows up on the narrow screens with the least
room to spare.

Two things replace the affordance the hidden bar took away, and both should
survive any resizing:

- The floor is chosen so a phone always shows **part** of the next item — a
  logo cut by the edge is what tells a visitor there is more to the right.
- The list carries `tabindex="0"`, so arrow keys scroll it. With no visible bar
  and no tab stop, the overflowing names are unreachable without a mouse or a
  touchscreen (WCAG 2.1.1).

The strip is deliberately **not** given a `.section__title` — its label is a muted
eyebrow. "Areas of Expertise" sits directly below it, and the red title bar is
worth less on both if two of them share a screen (see § 5). Full notes are in
`css/components.css` § CLIENTS STRIP, including why the row is not centred.

### The full-width banner (Home)

Below the expertise cards, Home ends on a single edge-to-edge image band — the
only element on the site that ignores the 1120px content column. It is full-bleed
by simply not being inside a `.container`; there are no negative margins and no
`100vw` (which overflows by the scrollbar's width on any page tall enough to have
one).

**Its height is one line** — the `clamp()` in `css/components.css` § FULL-WIDTH
BANNER, marked as the tweak point. It reads `clamp(220px, 26vw, 380px)`: a floor
for phones, a width-relative middle so the band keeps its proportions as the
window resizes, and a cap so it can't eat a desktop screen. Raise the third
number if the band feels short; that is the one that governs on a laptop.

---

## 4. Global layout

Every page shares the same shell:

```
┌──────────────────────────────────────────────┐
│ HEADER (sticky, always visible)               │
│  [logo] Food Industry Fabrication Ltd.        │
│                     Home About Gallery ... ▸  │
├──────────────────────────────────────────────┤
│ MAIN  (page-specific content)                 │
├──────────────────────────────────────────────┤
│ FOOTER (copyright, minimal)                   │
└──────────────────────────────────────────────┘
```

- **Header** is `position: sticky; top: 0` so it stays visible while scrolling.
  On very old browsers that ignore `sticky`, it degrades to a normal header (still works).
- The active tab is marked with `aria-current="page"` and styled with a red underline.

### The header on phones and narrow windows (below 820px)

```
┌───────────────────────────┐
│ [logo] Food Industry   ☰  │   ← tabs collapse behind the button
│        Fabrication Ltd.   │
└───────────────────────────┘
```

The brand plus five tabs need a **measured 755px** to sit on one row. Below that they wrap
to a second row under the brand (a third on a phone), and since the header is **sticky**
that cost is paid for the entire scroll. So below **820px** the tabs collapse behind a
three-bar button and open as a full-width column. See `css/base.css` § MOBILE MENU.

The 65px of slack between 755 and 820 is deliberate: 755 is what this brand text measures
in the system font stack *on Windows*, and that stack resolves to a different face on
macOS, iOS and Android. **Re-measure if the company name or nav labels change** — the
number to watch is the width at which `.site-header` grows from ~71px to ~116px tall.

This is separate from the `--fs-h1` reduction, which stays at 640px; they are different
questions and should not be merged into one media query.

#### Rule: the sticky header must never change height

The open menu is an **overlay** — `position: absolute` hanging off the header's bottom edge,
over the page — not a second row inside the header. The header is 71px whether the menu is
open or shut. This is a hard rule, not a styling preference:

> A sticky element pinned at the top of the document that *grows* pushes every box after it
> down by the same amount. The browser's scroll anchoring then compensates by jumping the
> scroll position to match. The first version of this menu grew the header 71px → 324px, and
> the page jumped 253px in both directions (measured) every time it was tapped.

Out of flow, nothing below the header moves, so there is nothing for scroll anchoring to
correct. **Anything added to this header later — a search field, a phone number, a language
picker, an announcement bar — follows the same rule: overlay it, or reserve its space
permanently. Never let the header resize.** `--header-height` in `theme.css` is what the
`[id] { scroll-margin-top: … }` rule trusts, and that promise only holds while this one does.

This is the site's one piece of behavioural JavaScript ([`js/nav.js`](js/nav.js)), and it
follows the usual rule — the button ships in `partials/header.html` carrying the `hidden`
attribute, and only `js/nav.js` removes it. With JavaScript disabled there is no dead
control: the page falls back to the plain, always-visible nav. Every `display` rule for the
button is written `:not([hidden])` so the attribute can never be overridden by accident.

**Do not shrink the nav padding at this breakpoint.** An earlier version did, which took
each link to ~41px tall — below Apple's 44px and Google's 48px minimum tap target, and
backwards, since touch is the input that needs the *larger* target. Stacking is what buys
back the vertical room; the links keep their full-size padding.

### The header & footer live in ONE file each
The header/footer markup still ends up **copied into every page** — that is what keeps the
site working with zero JavaScript, zero runtime cost, and no build output to deploy. But it
is no longer copied *by hand*. The single source of truth is:

- [`partials/header.html`](partials/header.html)
- [`partials/footer.html`](partials/footer.html)

**Edit the partial, then run `npm run sync`.** That splices the partial into the marked
region of every root-level `.html` page:

```
npm run sync     # rewrite every page's header/footer from partials/
npm run check    # write nothing; exit 1 if any page is out of date
```

There are no npm dependencies — `npm` is only a task runner. `node tools/sync-partials.js`
works just as well. Requires Node (any recent version).

**Never hand-edit anything between these markers** — the next sync overwrites it:

```html
<!-- ===== HEADER — generated from partials/header.html · DO NOT EDIT ===== -->
...
<!-- ===== /HEADER ===== -->
```

#### You don't have to remember to run it
A pre-commit hook ([`tools/hooks/pre-commit`](tools/hooks/pre-commit)) runs `npm run check`
and **blocks the commit** if any page has drifted. It's already enabled in this clone via
`git config core.hooksPath tools/hooks`; run that one command again after a fresh `git clone`,
since Git never installs hooks automatically. The hook is deliberately non-destructive — it
fails and tells you to run `npm run sync` rather than silently rewriting files mid-commit.
(If you'd rather it not block, `npm run check` is equally suited to a CI step.)

#### The active tab is automatic
`partials/header.html` contains **no** `aria-current` attribute. The sync script adds
`aria-current="page"` to the nav link matching each page's filename as it writes. Don't add
it to the partial — it gets stripped.

#### Adding a new page
Copy an existing page and keep its four marker comments; the new page joins the rotation on
the next sync, and the nav link picks up `aria-current` on its own. Remember to add the page
to the nav list in `partials/header.html`. A root-level `.html` file with no markers is a
**hard error**, so a page can't silently fall out of sync — genuine exceptions go in the
`EXCLUDE` list at the top of [`tools/sync-partials.js`](tools/sync-partials.js).

---

## 5. Design system

Style direction: **simple, clean, slightly older/industrial** — sharp edges, solid borders,
flat fills, a white + navy + red palette. Not retro, not flashy. Minimal motion.

The two brand colours have distinct jobs, and keeping them separate is what stops the
site reading as loud. **Navy is structural** — links, header/footer, borders, form focus,
the default card fill. **Red is the highlight**, and is spent only on what should draw
the eye: the call-to-action buttons, the active tab, the `.section__title` bar, the hero
title accent, the "Fabrication" in the wordmark, and the card hover outline. When adding
a component, reach for navy first; a second red thing competing on the same screen costs
the first one its emphasis.

### Colours — edit `css/theme.css` ONLY
All colours (and core spacing/sizing) live as CSS custom properties in
[`css/theme.css`](css/theme.css). **To re-theme the whole site, edit that one file.**
Nothing else hard-codes a colour.

That last sentence is **enforced**, not just intended — `npm run check:colours`
(and the pre-commit hook) fails the build if a colour literal appears anywhere
outside `theme.css`. See [`tools/check-colours.js`](tools/check-colours.js) for
what it scans and the `theme-exempt` escape hatch.

Values deliberately are **not** duplicated here — read them from `theme.css`,
which is the single source of truth. What each token is for:

| Variable | Used for |
|---|---|
| `--color-bg` | Page background |
| `--color-surface` | Cards, alternating sections |
| `--color-primary` | Brand navy — links, header border, chrome, logo ground |
| `--color-primary-dark` | Hover/pressed navy |
| `--color-primary-light` | Tinted backgrounds |
| `--color-accent` | Brand red — buttons, active tab, title accents, logo mark |
| `--color-accent-dark` | Hover/pressed red |
| `--color-accent-light` | Tinted red background (ghost button hover) |
| `--color-text` | Body text |
| `--color-text-muted` | Secondary text |
| `--color-text-invert` | Text on dark/navy/red backgrounds |
| `--color-text-invert-muted` | Secondary text on dark backgrounds (card body copy) |
| `--color-border` | Borders, dividers |
| `--color-header-bg` | Header background |
| `--color-footer-bg` | Footer background (navy) |
| `--color-footer-link` | Links on the navy footer |
| `--color-focus` | Focus ring — see note below |
| `--color-scrim-strong/-mid/-soft` | Darkening wash over card backgrounds |
| `--color-card-1` … `-4` | Placeholder tints for the four expertise cards |

The `--color-card-*` tints exist only so the four cards read as four different
"images"; they alternate navy/red so the 2×2 grid reads as a deliberate
checkerboard rather than four arbitrary colours. Delete them, and the `.card--N`
rules in `components.css`, once real background images are set.

**`--color-focus` is deliberately neither brand colour.** The ring has to clear 3:1
against the white page *and* the navy footer, and navy fails the second while red
fails on the card tints. It is a brighter blue than anything else in the palette for
that reason — if the theme changes again, re-check it against both backgrounds rather
than snapping it back to the primary.

Also defined in `theme.css`: spacing scale, max content width, border width, font stacks.

#### Themed SVG
An `<img src="logo.svg">` renders in its own document and **cannot see the page's
CSS variables**, so artwork referenced that way can never follow the theme. Any
SVG that is page chrome is therefore inlined into its partial — see the logo in
[`partials/header.html`](partials/header.html), which paints with
`fill="var(--color-primary)"`. Standalone artwork used outside a page (favicon,
social card, print) is the one place baked-in colour is correct.

### Fonts — pick in `css/theme.css`, declare in `css/fonts.css`

The site ships on the OS's own UI font stack. Three self-hosted candidates are wired
up alongside it so the look can be compared without touching any markup:

| Option | `--font-…` | Cost |
|---|---|---|
| System UI stack (current, and the fallback under every option below) | `--font-system` | 0 KB |
| Inter | `--font-inter` | 47 KB |
| Public Sans | `--font-public-sans` | 26 KB |
| Archivo | `--font-archivo` | 34 KB |
| Bell MT — **local only**, see below | `--font-bell-mt` | 0 KB |

**Switching** is one line in [`css/theme.css`](css/theme.css): set `--font-sans` to one
of the values above. `--font-heading` follows `--font-sans` unless pointed elsewhere,
which is how a heading font gets paired with a different body font.

**Heading weight travels with the font choice** — `--fw-heading`, also in `theme.css`.
700 for the sans candidates. **400 for Bell MT**: its bold is a separate, much heavier
and lower-contrast design, so at h1 size it reads as a generic bold serif and loses the
delicate high-contrast look that is the whole reason to pick it. Bell MT has no 500 or
600 face, so nearest-match rounds 500 to 400 and 600 to 700 — the choice is binary.

A `@font-face` rule only *describes* a font — the file downloads only if something on
the page asks for that family. So the unchosen candidates sit in `fonts.css` at **zero
runtime cost**, and there is no rush to delete them.

**Every stack ends in `--font-system`**, so a font that is slow, blocked, or unsupported
degrades to exactly what the site looks like today. `font-display: swap` means text is
painted immediately in the fallback and restyled on arrival — never invisible.

**Bell MT is a licensed Monotype face bundled with MS Office.** It cannot be legally
self-hosted, so it is wired as a plain local stack: real Bell MT on a machine with Office,
Georgia elsewhere. Fine for judging the look, not shippable as-is — see the note at the
foot of [`css/fonts.css`](css/fonts.css).

**Removing a candidate** — three deletions, no side effects: its fenced block in
`fonts.css`, its `.woff2` in `assets/fonts/`, its `--font-…` line in `theme.css`.

Once a font is chosen for good, add a preload to each page's `<head>` to start the
download a round trip earlier — worth ~100 ms on first paint, and only correct once the
choice is final:

```html
<link rel="preload" href="assets/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin>
```

### CSS file organization
Load order matters (later files can rely on earlier variables):

1. **`css/fonts.css`** — `@font-face` declarations only. No downloads unless a font is selected.
2. **`css/theme.css`** — *variables only.* Colours, spacing, sizes, fonts. The re-theme file.
3. **`css/base.css`** — reset, typography, layout primitives, header, footer, nav.
4. **`css/components.css`** — reusable blocks: hero, expertise cards, service rows, gallery grid, forms, buttons, placeholders.

Class-naming convention: simple, readable, block-based (e.g. `.card`, `.card__title`,
`.hero`, `.gallery-grid`). Keep it flat and obvious — no CSS methodology overhead.

### Placeholder images
To stay lightweight and binary-free, placeholders are drawn with CSS/SVG (a labeled box),
not photo files — see the `.placeholder` component in `css/components.css`. The only real
asset is [`assets/logo.svg`](assets/logo.svg), a simple placeholder mark.
Swap these for real images later; keep dimensions similar to avoid layout shift.

One ratio is deliberately not constant: the **hero image is 1:1 on desktop but 16:9 below
780px**, where the hero stacks and a square would go full-bleed — about 320px tall on a
phone, pushing everything after it that far down. Supply the hero photo in both crops, or
one wide enough to take a square crop on desktop.

#### When the real photos arrive, decide the loading strategy

There are currently **no `<img>` elements anywhere on the site** — every "image" is a CSS
gradient, so there is nothing yet to lazy-load. The only embedded resource is the Maps
iframe in `contact.html`, which carries `loading="lazy"`.

Photography will be the heaviest thing here by a wide margin, so it is worth settling
deliberately rather than by default. Things to weigh at that point:

- **File weight and format** — resize to what's actually displayed rather than shipping
  camera-resolution originals; consider WebP/AVIF, and `srcset` if phones should pull
  smaller files than desktops.
- **`loading="lazy"`** on off-screen images, and whether the above-the-fold hero should be
  excluded from it.
- **Explicit `width`/`height`** so nothing shifts as images arrive (the layout-shift point
  already noted above).
- **`<img>` vs. CSS `background-image`.** Note that §5 currently plans for the expertise
  cards to become background images (see the `--color-card-*` note). A CSS background
  cannot be lazy-loaded — there is no attribute for it, and the browser fetches it as soon
  as the element renders. If that pattern spreads to the Services bands or the gallery,
  lazy loading is lost with no missing attribute to notice it by.

---

## 6. Contact form

The form on `contact.html` is **markup only** — it does not submit anywhere yet.
When wiring it up, options (no heavy backend needed):
- A static-host form handler (Netlify Forms, Formspree, Basin), **or**
- A small serverless function / email endpoint.

Email and phone are still placeholders. The address is real, and the Google Maps embed is
live: it uses the keyless `https://www.google.com/maps?q=<address>&output=embed` form, so
there is no API key to manage. If the pin needs to be more precise than the street address,
swap `q=` for an exact `lat,lng`. Moving to the official Maps Embed API
(`/maps/embed/v1/place`) would mean a Google Cloud API key, public in the markup and
therefore needing an HTTP-referrer restriction.

---

## 7. Accessibility & compatibility

- Semantic HTML (`header`, `nav`, `main`, `section`, `footer`, real `<label>`s).
- Works with JavaScript disabled.
- Colour contrast meets WCAG AA for text.
- No reliance on hover-only interactions for core navigation.
- Tested target: works on old/low-end browsers; modern features (sticky, Speculation Rules)
  are progressive enhancements that degrade gracefully.
- **Touch targets stay at or above 48px.** Measured: menu button 48×48, nav links 53px tall
  on desktop and 51px in the mobile menu (the difference is the 3px active underline giving
  way to a 1px divider). Keep any new control in this range.
- **Anchors clear the sticky header** via `[id] { scroll-margin-top: … }` in `css/base.css`
  — without it the skip link drops `#main` behind the header.
- Form inputs use `font: inherit`, i.e. 16px. **Do not set a smaller font-size on them**:
  iOS Safari auto-zooms the whole page when a field under 16px is focused.

### Testing on mobile
1. **DevTools** (F12 → Ctrl+Shift+M) — sweep *either side of the breakpoints*, since that
   is where layout bugs live: 460, 520, 640, 780, 820, 900, plus 320 and 360.
2. **A real phone on the same Wi-Fi** — the test that actually counts. From the site root
   run `python -m http.server 8000 --bind 0.0.0.0`, find the PC's IP with `ipconfig`, and
   open `http://<ip>:8000` on the phone (allow the Windows Firewall prompt on Private
   networks). Emulation cannot reproduce iOS Safari's collapsing toolbar or real thumb
   ergonomics.
3. **Lighthouse** → Mobile — independently audits tap targets, font sizes, and layout shift.
4. Check the menu **with JavaScript disabled**: the button must be absent and all five tabs
   visible.

---

## 8. Directory structure

```
FIFL-site/
├── SITE-SPEC.md          # this file
├── package.json          # task runner only — no dependencies
├── index.html            # Home (landing page)
├── about.html            # About Us
├── gallery.html          # Gallery
├── services.html         # Services (one band per area of expertise)
├── contact.html          # Contact
├── partials/             # SHARED MARKUP — edit here, then `npm run sync`
│   ├── header.html       # the one header
│   └── footer.html       # the one footer
├── tools/
│   ├── sync-partials.js  # splices partials/ into every page
│   └── hooks/
│       └── pre-commit    # blocks a commit if pages have drifted
├── css/
│   ├── fonts.css         # @font-face for the candidate fonts — no download unless used
│   ├── theme.css         # COLOURS + design tokens — edit here to re-theme
│   ├── base.css          # reset, typography, layout, header/footer/nav
│   └── components.css     # hero, cards, gallery, forms, buttons, placeholders
├── js/
│   ├── prefetch.js       # hover/touch prefetch + speculation rules
│   └── nav.js            # mobile three-bar menu toggle (below 640px)
└── assets/
    ├── logo.svg          # placeholder logo mark
    └── fonts/            # self-hosted variable WOFF2, one per candidate font
```

The two "edit one file, everything follows" entry points are
**`css/theme.css`** (all colours) and **`partials/`** (all shared markup).

Note that `partials/` and `tools/` are *source*, not site content. They are harmless if
deployed, but you can exclude them from the upload if your host makes that easy.

---

## 9. Future / TODO (not in this skeleton)

- Real content, copy, and photography.
- Real logo.
- Real copy and photography for the four **Services** bands (structure is in place; text is lorem).
- Wire up the contact form to a handler.
- Real email address and phone number on **Contact** (the address and map are done).
- Optional: content-hashed asset filenames for long-term caching.
- Optional: graduate `tools/sync-partials.js` into a real static-site generator
  (**Eleventy** is the closest fit to this site's philosophy — plain HTML in, plain HTML
  out, no client-side runtime). Worth doing only when *more* than the header/footer is
  duplicated — repeated card markup, or ~10+ pages with per-page `<title>`/meta to manage.
  The `partials/` files carry over unchanged, so this is not a rewrite.
- Additional pages as requested by the client.
