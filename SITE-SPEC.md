# Food Industry Fabrication Ltd. — Website Specification

> **Purpose of this document:** A single reference for the structure, design system,
> and performance approach of the FIFL website. Read this first before making changes.
> Keep it up to date as the site grows.

Last updated: 2026-07-31 · Status: **Skeleton / v0**, live on a password-protected
preview URL (see § 9), with click-to-edit mode for the client (see § 11)

**In a hurry?** Every command for working on this site is in one table at the
very bottom — § 12.

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
| **At most one web font** | Exactly one, and it is *self-hosted* (never a Google Fonts `<link>`): **Public Sans**, 26 KB — one variable WOFF2, latin subset, upright only, `font-display: swap` so text is never invisible. Two other candidates sit in `fonts.css` unselected and cost nothing. See § Fonts. | `css/fonts.css`, `css/theme.css` |
| **Tiny, cached CSS** | 4 small stylesheets, cached after first load, shared across every page. | `css/` |
| **Almost no JavaScript** | Two small files: the prefetch helper (~1 KB) and the mobile menu toggle (~1 KB). The site is 100% functional with JS disabled. | `js/prefetch.js`, `js/nav.js` |

There is a third JavaScript file, `js/edit.js`, and it does **not** count against
that row. No page in this repo references it; it is spliced in at the edge by
`deploy/_worker.js` only when a URL carries `?edit`, so an ordinary visitor never
requests it and never learns it exists. See § 11.
| **Sharp, flat design** | No shadows/blur/animation to repaint. Cheap for old GPUs to render. | `css/*` |

#### Rule: prefetch, never prerender

`js/prefetch.js` asks for `prefetch` in both layers, and that is deliberate. `prerender`
would fetch each candidate page's **subresources** as well — so hovering the Gallery tab
would pull every photo on it, for a visitor who may never click. Prefetch costs a couple of
KB per candidate (the HTML); the images download only when the page is genuinely visited.

Images are and will remain the heaviest thing on this site by a wide margin, so this is the
one setting here capable of multiplying bandwidth several-fold. Leave it as `prefetch`.

### Server / hosting notes
The site is hosted on **Cloudflare Pages** — how to deploy it is § 9. What that buys us
against the list of things a host has to get right, and what is still outstanding:

| Want | Status on Cloudflare Pages |
|---|---|
| **HTTP/2 or HTTP/3** | Automatic. Nothing to configure. |
| **gzip/brotli** for `.html`, `.css`, `.js` | Automatic, negotiated per request. |
| **Long cache lifetimes** for `css/`, `js/`, `assets/` | **Not automatic.** Pages sets no long-lived `max-age` of its own; assets go out with an `ETag`, so a repeat visit revalidates each file — a cheap `304`, but still a round trip. (Check the exact `Cache-Control` against the *deployed* site if it matters: the local `wrangler pages dev` server sends none at all, so it is not the thing to measure.) |
| Content-hashed asset filenames | Not done — see § 10. |

The cache-lifetime gap is fixed with a `_headers` file dropped into
[`deploy/`](deploy/), which `tools/build.js` copies to the site root alongside
everything else there:

```
/css/*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

**Do not add that yet.** `immutable` tells the browser never to re-check for a year, so
the day you edit `theme.css` every returning visitor keeps the old one. It is only safe
once filenames carry a content hash — which is why the two items are one job, not two,
and why both sit in § 10 rather than here. While the site is a password-gated preview
being actively changed, revalidation is the behaviour you actually want.

Still no code changes in any of this — it is host configuration and one optional file.

---

## 3. Pages

The landing page is **Home** (`index.html`). Clicking the logo always returns to Home.
More pages will be added later.

Tabs are listed here in the order they appear in the nav. **Services sits before
Gallery** — the four expertise cards on Home deep-link into Services, so it is
the page a visitor is most likely to want second.

| Tab | File | Contents (v0) |
|---|---|---|
| Home | `index.html` | Hero (company name title + square placeholder image), lorem subheader, a one-line strip of well-known clients, four "areas of expertise" cards with image-background + body text, a full-width banner image. |
| About Us | `about.html` | Standard about page. Lorem ipsum + placeholders. |
| Services | `services.html` | Intro, then one full-width band per "area of expertise" — text left, placeholder image right, alternating tint. Lorem copy. |
| Gallery | `gallery.html` | Static grid of placeholder images. |
| Contact | `contact.html` | Contact form (non-functional placeholder), placeholder email + phone, real address + live Google Maps embed. |

Not in the nav, but a page all the same: **`404.html`**, which Cloudflare serves
for any URL that matches nothing. It shares the header and footer like every
other page — see § 4 for the one way it is special.

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
│                    Home About Services ... ▸  │
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

The brand plus five tabs stop fitting one row somewhere below 800px. Below that they wrap
to a second row under the brand (a third on a phone), and since the header is **sticky**
that cost is paid for the entire scroll. So below **820px** the tabs collapse behind a
three-bar button and open as a full-width column. See `css/base.css` § MOBILE MENU.

**820 is a round number with slack in it, not a measurement.** The original figure was
755px — measured for this brand text in the system font stack *on Windows* — and 820 was
set above it to leave room. The slack is the load-bearing part, because that measurement
does not hold still: the system stack resolves to a different face on macOS, iOS and
Android; the site no longer uses that stack at all (`--font-sans` is Public Sans, a wider
grotesque than Segoe UI, so the true minimum is probably *above* 755 and the slack
correspondingly smaller than 65px); and the brand name is placeholder copy that may yet
change. 820 has survived one font change without wrapping, and it is already the
`.contact-grid` breakpoint, which is a second reason not to chase the exact number.

**Re-measure after a font change or new brand/nav copy.** The recipe is in `css/base.css`
§ MOBILE MENU; the number to watch is the width at which `.site-header` grows from ~71px
to ~116px tall, which is the nav wrapping. If it lands within ~40px of 820, raise 820 and
the `.contact-grid` breakpoint together.

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

#### `404.html` is the one page with root-relative paths

Every link on the site is *relative* (`about.html`, `css/base.css`), deliberately, because
that is what lets a page be opened straight off the disk (§ 9). `404.html` cannot do that,
and it is the only page that can't:

> Cloudflare Pages answers **any** unmatched URL with `404.html`'s contents while leaving
> the requested URL in the address bar. At `/deep/missing/path`, a relative
> `css/base.css` resolves to `/deep/missing/css/base.css` and 404s in its turn — so the
> page arrives with no styles, no logo and a dead nav, at the exact moment something has
> already gone wrong for the visitor.

So every path in `404.html` starts with `/`. The `<head>` and body links are written that
way by hand; the header and footer are handled for you, because `404.html` is listed in
**`ROOT_RELATIVE`** in [`tools/sync-partials.js`](tools/sync-partials.js), which rewrites
the partial's relative `href`s as it splices them in. There is still exactly one header
partial and no per-page copy to maintain.

Two notes on that. It is done in the sync script rather than with a single `<base href="/">`
because `<base>` also re-bases *fragment-only* URLs — `href="#main"` would become `/#main`,
so the skip link would navigate to the homepage instead of scrolling, trading an
accessibility feature for a layout fix. And the trade this does make is that `404.html`
alone does not render correctly from `file://`; preview it over `npm run serve` by
requesting any made-up URL.

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
| `--color-header-bg` | Header background — *references `--color-bg`* |
| `--color-footer-bg` | Footer background — *references `--color-primary`* (navy) |
| `--color-footer-link` | Links on the navy footer |
| `--color-focus` | Focus ring — see note below |
| `--color-scrim-strong/-mid/-soft` | Darkening wash over card backgrounds |
| `--color-card-1` … `-4` | Placeholder tints for the four expertise cards |

The `--color-card-*` tints exist only so the four cards read as four different
"images"; they alternate navy/red so the 2×2 grid reads as a deliberate
checkerboard rather than four arbitrary colours. Delete them, and the `.card--N`
rules in `components.css`, once real background images are set.

**Where one token IS another, it references it rather than repeating the hex.**
`--color-header-bg` → `--color-bg`, `--color-footer-bg` → `--color-primary`,
`--color-card-3` → `--color-primary-dark`. Two copies of the same navy are two
things that can drift apart on the next re-theme, and one of them did: the footer
was independently set to the brand red at one point while three separate comments
in `theme.css` (and this table) still described it as navy. The token names all
survive, so pointing the footer or the header somewhere else is still a one-line
edit — it is the *duplicate literal* that is gone, not the ability to differ.

#### `--color-focus` — the one thing here that is measured, not chosen

`--color-focus` paints the `:focus-visible` ring in `base.css`: the only visible
indication a keyboard user has of where they are on the page. It is deliberately
**neither brand colour**, because the ring has to clear 3:1 (WCAG 1.4.11) against
every background it can land on, and navy fails on the footer while red fails on
the card tints.

Measured, so nobody has to recompute it:

| ring against | ratio | |
|---|---|---|
| `--color-bg` (white page) | 4.88:1 | ✓ |
| `--color-footer-bg` (navy) | 3.07:1 | ✓, and this is the tight one |
| `--color-surface` (tinted sections) | 4.53:1 | ✓ |

**Re-check both ends if the palette changes again.** This is not a hypothetical:
the footer being switched off navy took the ring to **1.42:1** against it — the
focus indicator was effectively invisible on the footer link of every page, and
nothing on screen said so. If more margin is ever wanted, `#3d82e8` balances the
two ends better (3.96 navy / 3.78 white); brighter than that starts failing
against the white page, which is the opposite trade.

The corollary rule: **`--color-focus` is the site's only focus indicator, and
nothing may replace it with something dimmer.** `outline: none` on a control is
only acceptable if what replaces it also clears 3:1. The contact form once
swapped the ring for a 2px `--color-primary-light` halo at 1.20:1 — see the note
above `.form-field input:focus` in `components.css`. Navy `border-color` on focus
is fine and is what § 5 means by navy owning "form focus", but it sits *on top of*
the ring, not instead of it.

Also defined in `theme.css`: spacing scale, max content width, border width, font stacks.

#### Themed SVG
An `<img src="logo.svg">` renders in its own document and **cannot see the page's
CSS variables**, so artwork referenced that way can never follow the theme. Any
SVG that is page chrome is therefore inlined into its partial — see the logo in
[`partials/header.html`](partials/header.html), which paints with
`fill="var(--color-primary)"`. Standalone artwork used outside a page (favicon,
social card, print) is the one place baked-in colour is correct, and it is why
`tools/check-colours.js` exempts `assets/*.svg`.

That exemption is also the catch: the hex values in `assets/logo.svg` are copies
of `--color-primary`, `--color-accent` and `--color-text-invert`, and no check
will tell you when they fall out of step with `theme.css`. A re-theme has to come
back to that file by hand.

### Fonts — pick in `css/theme.css`, declare in `css/fonts.css`

The site currently ships **Public Sans**, self-hosted, 26 KB. The other candidates stay
wired up alongside it so the look can still be compared without touching any markup —
**the choice is not final** (§ 10):

| Option | `--font-…` | Cost |
|---|---|---|
| Public Sans — **current** | `--font-public-sans` | 26 KB |
| System UI stack (the fallback under every option, including the current one) | `--font-system` | 0 KB |
| Inter | `--font-inter` | 47 KB |
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

#### Not yet: the font preload

Once a font is chosen **for good**, a preload in each page's `<head>` starts the download
a round trip earlier — worth ~100 ms on first paint:

```html
<link rel="preload" href="assets/fonts/public-sans-latin-var.woff2" as="font" type="font/woff2" crossorigin>
```

**It is deliberately not there yet, because the font may still change.** A preload is
fetched at the *highest* priority the moment the HTML parses, whether or not any CSS ever
asks for that file. So a preload left pointing at the previous choice is the worst of both
worlds: the old file downloaded at top priority and thrown away, *plus* the new one
downloaded normally — measurably slower than having no preload at all, with nothing visibly
wrong to tip you off. It is also a per-page edit (six files now), which is exactly the kind
of thing that gets half-done.

The gain is ~100 ms on *first* visit only; repeat visits are cached either way. That is not
worth carrying a silent trap for while the font is still being decided.

**When the choice is final**, add the preload *and* a `tools/check-preload.js` alongside it
— same shape as `check-colours.js`, wired into `npm run check` — that fails if the
preloaded filename doesn't match the active `--font-sans` in `theme.css`. That converts the
trap into a build error and makes switching fonts safe again rather than risky. The two
halves are one job, like the cache headers in § 2.

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
asset is [`assets/logo.svg`](assets/logo.svg).
Swap these for real images later; keep dimensions similar to avoid layout shift.

**The logo is temporary.** A real one is coming and replaces the placeholder mark. When it
arrives, note that it lives in **two places, not one** — see § Themed SVG immediately below
for why:

- `assets/logo.svg` — the standalone file, for uses outside a page (favicon, social card,
  print). Nothing on the site loads it today, which is why none of those are wired up yet.
- the **inline copy** in [`partials/header.html`](partials/header.html) — this is the one
  actually on screen.

Updating only the file is the likely mistake: the site would carry on showing the old mark
while the asset looked done.

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

**Wire it to the machinery § 11 already built**, rather than to a third-party
handler. `deploy/_worker.js` has a `notify()` function and a KV store behind it;
an enquiry is the same shape as an edit batch — a POST that must be kept and then
announced. Reusing it means one notification path to configure, not two.

Copy the ordering exactly: **store first, notify second.** An enquiry that exists
only as an email is one delivery failure away from being lost silently, and
nothing on screen would ever say so. KV is the record; the email is a convenience.

Two things differ from the edit endpoint and must not be copied across:

- **It is public.** `/api/edits` sits behind the password; the contact endpoint
  cannot. Add it to the route table *outside* the auth branch.
- **It therefore needs spam protection** — Turnstile is the natural fit on this
  host and adds no dependency. The edit endpoint needs none, because the password
  is already the filter.

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
- **One focus indicator, everywhere**: the `:focus-visible` ring in `base.css`, painted with
  `--color-focus`, clearing 3:1 on every background it can land on. Nothing overrides it
  with something dimmer — the measurements and the rule are in § 5.
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
5. Tab through a page to the **footer link** and to the **contact form** — the focus ring
   must be clearly visible on both (§ 5). These are the two places it has been lost before.
6. Request a **deep made-up URL** (`/a/b/c`) under `npm run serve`: `404.html` must arrive
   fully styled with a working nav, not as unstyled text (§ 4).

---

## 8. Directory structure

```
FIFL-site/
├── SITE-SPEC.md          # this file
├── package.json          # task runner only — no dependencies
├── index.html            # Home (landing page)
├── about.html            # About Us
├── services.html         # Services (one band per area of expertise)
├── gallery.html          # Gallery
├── contact.html          # Contact
├── 404.html              # not in the nav; ROOT-RELATIVE paths, see § 4
├── partials/             # SHARED MARKUP — edit here, then `npm run sync`
│   ├── header.html       # the one header
│   └── footer.html       # the one footer
├── tools/
│   ├── sync-partials.js  # splices partials/ into every page
│   ├── check-colours.js  # fails if a colour literal escapes theme.css
│   ├── serve.js          # local preview server (fonts + 404.html need http://)
│   ├── build.js          # assembles dist/ — the exact files that get uploaded
│   └── hooks/
│       └── pre-commit    # blocks a commit if pages have drifted
├── deploy/               # NOT site content — Cloudflare-specific, see § 9
│   ├── _worker.js        # password gate + client-edit inbox; runs at the edge
│   │                     #   on every request. See § 9 and § 11.
│   ├── robots.txt        # noindex while the site is a preview
│   └── README.md         # runbook: setup, rollback, edit mode, going live
├── css/
│   ├── fonts.css         # @font-face for the candidate fonts — no download unless used
│   ├── theme.css         # COLOURS + design tokens — edit here to re-theme
│   ├── base.css          # reset, typography, layout, header/footer/nav
│   └── components.css     # hero, cards, gallery, forms, buttons, placeholders
├── js/
│   ├── prefetch.js       # hover/touch prefetch + speculation rules
│   ├── nav.js            # mobile three-bar menu toggle (below 820px, see § 4)
│   └── edit.js           # click-to-edit mode. NEVER loaded by a page in this
│                         #   repo — injected at the edge under ?edit (§ 11)
├── assets/
│   ├── logo.svg          # TEMPORARY logo mark — also inlined in the header partial
│   └── fonts/            # self-hosted variable WOFF2, one per candidate font
└── dist/                 # generated, gitignored — wiped and rebuilt every build
```

The two "edit one file, everything follows" entry points are
**`css/theme.css`** (all colours) and **`partials/`** (all shared markup).

`partials/`, `tools/` and `deploy/README.md` are *source*, not site content, and
**`SITE-SPEC.md` is an internal document** — this one. None of them are uploaded:
`tools/build.js` copies a named list into `dist/` rather than excluding a blocklist,
so anything new added to the repo root is private by default and has to be opted in.
Add a directory the site actually needs and you must add it to `COPY_DIRS` there, or
it will 404 on the live site while working perfectly under `npm run serve`.

### Every command, in one place

**They are all in § 12**, at the end of this document — npm scripts, wrangler,
git, and the URLs. Deliberately one table and not two: a command list that
appears twice is a command list that disagrees with itself by next month.

---

## 9. Deployment

The site is on **Cloudflare Pages** at a temporary `*.pages.dev` address, behind a
password, for as long as it is unfinished. The operational runbook — creating the
project, setting the password, rolling back, going public — is
[`deploy/README.md`](deploy/README.md), next to the files it describes. This section
is the design behind it: the things worth understanding before you change anything.

### Git and deployment are deliberately not connected

The Pages project is a **Direct Upload** project. Cloudflare has no access to the
repository, no webhook, and no knowledge that it exists.

```
git push          ->  GitHub only. Live site untouched.
npm run deploy    ->  Live site updated. Git untouched.
```

The alternative — Cloudflare's Git integration — republishes on every push to
`master`, and that is the wrong shape for this project. This is a work-in-progress
site being shown to a client; commit hygiene and "is this fit to be seen" are
different questions and must stay on different triggers. Version control should
cost nothing to use.

The corollary is that deploying does not require committing first, so a half-finished
experiment can be put in front of someone without touching history. **Do not connect
the repo in the Cloudflare dashboard**, and note that a deploy uploads your working
tree as it is on disk, not the last commit — if the two have drifted, what you see
live is the former.

### `npm run deploy`

Three steps, and it stops at the first failure:

1. **`npm run check`** — the same partials and colour checks the pre-commit hook runs
   (§ 4, § 5). A page with a stale header or a stray colour literal cannot reach the
   live site, which is the whole reason the check is wired in here as well as at commit
   time; the two triggers are independent and neither implies the other.
2. **`npm run build`** — [`tools/build.js`](tools/build.js) wipes `dist/` and copies in
   the pages, `assets/`, `css/`, `js/`, and the contents of `deploy/`. Nothing is
   transformed or minified; the deployed pages are byte-for-byte the ones you preview
   locally. Wiping rather than overwriting means a file deleted from the repo cannot
   survive in `dist/` and keep being published.
3. **`wrangler pages deploy`** — uploads `dist/`. Only changed files transfer, so after
   the first run it takes seconds.

Wrangler is invoked with `npx`, so there is still **nothing in `node_modules/` and no
dependency in `package.json`** — npm remains a task runner.

**The version is pinned exactly (`wrangler@4.115.0`), and that matters more than it
looks.** A range like `wrangler@4` cannot be resolved without asking the registry, so
npm re-resolves on *every* invocation: a network round trip each time, and the warning
`the following package was not found and will be installed` on every deploy, even
though the package is cached and nothing is downloaded. An exact version is answerable
from the local npx cache, so it runs silently and offline. The reliable win is the
removed network dependency and the removed warning — startup time is ~5–7 s either way,
dominated by npx and wrangler's own boot, so do not expect the pin to feel faster.

To upgrade wrangler, change the number in `package.json` **and** in
[`deploy/README.md`](deploy/README.md), then run it once to populate the cache. Note
that each distinct spec string gets its own ~170 MB cache entry under
`$(npm config get cache)/_npx`, so changing it repeatedly is worth a periodic
`npm cache clean --force`.

Every deploy is retained, and any earlier one can be promoted back to live from the
Cloudflare dashboard without touching git. That is the rollback path.

#### Every deploy produces two URLs, and wrangler prints the wrong one

- **`fifl-site.pages.dev`** is the live site — always the newest *production*
  deployment. This is the link you give people.
- **`<hash>.fifl-site.pages.dev`** is an immutable snapshot of one single deploy, kept
  forever. It is what makes rollback possible.

Wrangler's closing line prints only the hash URL, which reads as though production was
skipped and a throwaway link created instead. It wasn't; the two are created together.
The `postdeploy` script exists purely to print the live URL afterwards and settle the
question, because this looks like a bug every time and is not one.

The authority on what is live is Cloudflare, not the terminal — `pages deployment list
--project-name=fifl-site` has an `Environment` column, and anything serving the live URL
reads `Production`. **`Preview` in that column is the one genuine failure mode**: it
means the `--branch` in the deploy script has stopped matching the project's production
branch (`master`), and only then does the live URL really not move. A stale-looking live
URL with `Production` in that column is a browser cache; hard-reload it.

### The password gate

[`deploy/_worker.js`](deploy/_worker.js) runs at Cloudflare's edge in front of every
request, and serves nothing at all — not a page, not `robots.txt` — without HTTP Basic
credentials. Search engines therefore cannot index the site, because they cannot read
it; `robots.txt` and the `X-Robots-Tag` header on authenticated responses are the
polite second and third layers, not the mechanism.

Three properties of it are load-bearing:

- **It fails closed.** If `PREVIEW_PASSWORD` is missing from the environment the worker
  returns 503. A misconfiguration takes the site *down*, never *public*. Any change to
  this file must preserve that; "serve it anyway if the password isn't set" is the one
  edit that would defeat the entire arrangement.

  **What "closed" means inverts at launch, and the worker already handles both
  sides.** The `GATE_WHOLE_SITE` constant at the top of the file is `true` today,
  so a missing secret takes the whole site down — correct, because the risk being
  guarded against is accidental publication. Set to `false` on launch day, a
  missing secret takes down only `/edits` and `/api/edits` and leaves the public
  site serving — correct then, because taking a live company website offline over
  an unset notification variable would be the bug, not the safeguard. Do not
  collapse the two back into one blanket check.
- **The password is never in the repo.** It is a Cloudflare secret, stored encrypted,
  injected as `env.PREVIEW_PASSWORD`. Locally it comes from `.dev.vars`, which is
  gitignored. Do not add a default password to `_worker.js` as a convenience.
- **`tools/build.js` refuses to build if `_worker.js` is absent**, so the gate cannot go
  missing quietly and leave a deploy publishing the unfinished site in the open.

It is the site's only server-side code, and the only file in the project written as an
ES module against the browser `fetch` API rather than as a CommonJS Node script — it
runs on Cloudflare's runtime, not on Node.

**It is no longer only a gate.** The same file now carries click-to-edit mode —
the `?edit` script injection, the `/api/edits` endpoint, the `/edits` review page,
and the `notify()` seam the contact form will share (§ 6). That is why it survives
launch instead of being deleted; the full consequences are in § 11 and in the
*Going live* checklist in [`deploy/README.md`](deploy/README.md).

### One behaviour that differs from `npm run serve`

Cloudflare's static-asset serving is not the same as `tools/serve.js`, and the
difference is worth knowing before it surprises you:

- **`about.html` is served at `/about`**, and `/about.html` 308-redirects there. Every
  link in the site says `about.html`, so each navigation costs one extra redirect. It
  works and the address bar just shows the tidier URL. Rewriting the links to
  extensionless form would remove the hop but break opening pages from the file
  system, which is a worse trade for this site.

There used to be a second item here — the **soft 404**. Pages fell back to serving
`index.html` with a `200 OK` because the site root had no `404.html`, and now it has one
(§ 3, § 4). An ordinary page, not host configuration.

**Verified against Cloudflare's runtime** (`wrangler pages dev dist`), since the host is the
half that was broken and the local server cannot reproduce it:

| Request | Before | Now |
|---|---|---|
| `/nope.html` | `200` + full homepage | `404` + the 404 page |
| `/deep/missing/path` | `200` + full homepage | `404` + the 404 page |
| `/css/base.css` (through the gate) | — | `200 text/css` — so the page is *styled* at depth |
| `/a/b/c` with no credentials | — | `401`; the gate is unaffected by any of this |

The status survives the password gate because `_worker.js` re-wraps the asset response as
`new Response(asset.body, asset)`, and a `Response` passed as the init argument carries its
`status` over. Worth knowing if that line is ever edited — dropping the second argument
would silently turn every 404 back into a 200.

---

## 10. Future / TODO (not in this skeleton)

> **Done since this list was written:** `404.html` (§ 4, § 9). Pages used to fall back to
> serving `index.html` with a `200 OK` for any unmatched URL — a soft 404 that hid broken
> links entirely, since nothing ever reported an error. It is a normal page now, with the
> four markers and root-relative paths, verified against Cloudflare's runtime (§ 9).

### Everything else

- Real content, copy, and photography.
- **Settle the font.** Public Sans is active but not final (§ 5). Once it is: delete the
  unused candidates (three deletions each, listed in `css/fonts.css`), and add the preload
  *plus* its `check-preload.js` guard — one job, both halves, for the reason in § 5.
- Real logo — replacing **both** copies, the standalone file and the inline one in the
  header partial (§ 5).
- Real copy and photography for the four **Services** bands (structure is in place; text is lorem).
- Wire up the contact form to a handler.
- Real email address and phone number on **Contact** (the address and map are done).
- **When going public:** set `GATE_WHOLE_SITE = false` in `deploy/_worker.js` and delete
  `deploy/robots.txt`. A surviving `robots.txt` would keep the finished site out of
  Google indefinitely, and it is the failure mode nobody notices for months. Full
  checklist in [`deploy/README.md`](deploy/README.md).

  > **This item used to read "delete `deploy/_worker.js`", and that is now wrong.**
  > The worker carries edit mode as well as the gate (§ 9, § 11), and edit mode has
  > to keep working — and stay private — after launch. The `_worker.js` guard in
  > `tools/build.js` stays for the same reason, but its failure message needs
  > rewording: it says "refusing to build an unprotected site", which stops being
  > true the day the site is meant to be public.

- **Gallery bulk drop.** Photos work one slot at a time (§ 11). The gallery is nine
  near-identical tiles where position barely matters, and dropping twenty photos one
  at a time is the wrong shape for it — that wants a single drop zone, not nine
  targets. Not built.
- **Client logos in the strip.** A different problem from photography: transparent
  PNG/SVG, sized for logos, and currently plain text (§ 3). Later, or never.
- **Decide `<img>` vs CSS background per slot, and write the first one.** There are
  still no `<img>` elements on this site. Recommendation stands from § 5: `<img>` for
  anything that is content, CSS background only for the four expertise cards where
  text sits on top — because a background cannot be lazy-loaded. The hero also wants
  `object-fit: cover` with the `object-position` the client sends, so one file serves
  both its 1:1 and 16:9 crops.
- **Turn the notification on.** `notify()` is written and inert until FIFL's domain is
  onboarded to Cloudflare Email Sending, which cannot be done from a `pages.dev`
  address. Four environment values and no code change — see `deploy/README.md`.
- Content-hashed asset filenames, **paired with** the long-lived `_headers` cache rules
  sketched in § 2. One job: the headers are only safe once the filenames change with
  their contents. Neither half alone is an improvement.
- Optional: graduate `tools/sync-partials.js` into a real static-site generator
  (**Eleventy** is the closest fit to this site's philosophy — plain HTML in, plain HTML
  out, no client-side runtime). Worth doing only when *more* than the header/footer is
  duplicated — repeated card markup, or ~10+ pages with per-page `<title>`/meta to manage.
  The `partials/` files carry over unchanged, so this is not a rewrite.
- Additional pages as requested by the client.

---

## 11. Click-to-edit mode

The client edits his own copy by clicking the words on the real page, and adds his
own photos by dropping them on a picture box. He gets one link, uses the password
he already has, installs nothing, and learns nothing.

```
https://fifl-site.pages.dev/?edit      him — edit the site
https://fifl-site.pages.dev/edits      you — read what he sent
```

**Everything he does is a proposal.** No file in this repo is written by any of
it, and there is deliberately no command that merges one. You read `/edits`, make
the changes by hand, and `npm run deploy` as usual. That is not a missing feature;
it is the point. It also means he cannot break anything, which is what makes it
safe to hand to someone non-technical without supervision.

### The pieces

| | |
|---|---|
| [`js/edit.js`](js/edit.js) | The editor. Never referenced by any page — injected at the edge. |
| [`deploy/_worker.js`](deploy/_worker.js) | Injects it under `?edit`; receives `/api/edits` and `/api/upload`; serves `/api/photo`; renders `/edits`; holds `notify()`. |
| KV namespace `EDITS` | Where a sent batch lands. |
| R2 bucket `UPLOADS` | Where a photo lands. |

Both bindings are added in the Cloudflare dashboard — see `deploy/README.md`. A
missing binding degrades that half of edit mode and **never touches the site**.

```
typing        ->  localStorage, on HIS machine only
a photo       ->  R2 immediately, metadata to localStorage
"Send"        ->  POST /api/edits  ->  KV  ->  /edits  ->  you, by hand  ->  deploy
```

Text never leaves his browser until he presses Send. A **photo does** — it uploads
the moment he picks it, because a half-megabyte image cannot live in localStorage
and because failing while he is looking at the photo is far kinder than failing in
a batch ten minutes later. What Send transmits for a photo is only its metadata.

Nothing reaches a file in this repo, ever.

### The one design rule: no annotations in the markup

There is no `data-edit="hero.subheader"` scheme, and **adding one later would be a
regression.** Editable elements are found by walking the DOM at load.

This site's layout is expected to change often, and a keyed scheme makes every
restructure a two-part job — move the markup, carry the keys — where forgetting
the second half silently makes an element uneditable with nothing on screen to say
so. Runtime discovery has no such failure mode: rewrite a page from scratch and the
editor follows it on the next load; add a paragraph and it is editable the moment it
exists.

**This is only affordable because edits are applied by hand.** Nothing has to
survive a machine merge, so nothing needs a stable machine-readable id. The
previous text is the handle, and a human can find that however the markup around it
has moved. The two decisions hold each other up — automating the apply step would
drag the annotations back in with it.

### What is editable

Everything inside `<main>` that is a **text-bearing leaf**: `h1`–`h6`, `p`, `li`,
`figcaption`, `blockquote`, `dt`, `dd`, `td`, `th`. Three exclusions, each on purpose:

- **Anything outside `<main>`** — which excludes the header and footer for free. They
  are generated from `partials/` and overwritten by the next `npm run sync` (§ 4), so
  an edit made there could not be held.
- **Elements containing markup other than `<br>`.** A paragraph with a link inside is
  skipped rather than offered and then flattened on save. That trades some coverage
  for the guarantee that editing can never destroy markup. It costs nothing today —
  every piece of copy inside `<main>` is currently a plain-text leaf. If that changes
  and something important stops being editable, widen `isEditable()` deliberately;
  **do not reach for `innerHTML`.**
- **`<div>` and `<a>`.** A div is a layout box — every `.placeholder` on the site is
  one — and link text is usually design rather than content. All links inside `<main>`
  are also click-suppressed while editing, because the expertise cards wrap their own
  editable heading and paragraph and a click meant to place a cursor would otherwise
  navigate away mid-sentence. The header nav still works and is how he moves around.

`<br>` survives a round trip as a newline, so the hero title's deliberate line break
is his to control with the Enter key rather than something the editor silently eats.

### Photos

A **slot** is any `<img>` or any `.placeholder` inside `<main>`. `.placeholder` is
the site's own convention for "a picture goes here" (§ 5), which is why targeting
it needs no annotation and survives a restyle. He clicks a slot to open the
ordinary file dialog, or drags a file onto it — the click matters, because
drag-and-drop is not obvious to everyone and is impossible on a tablet.

#### The crop is never baked

**The full frame is uploaded and his framing travels as a number.** He drags
inside a filled slot to slide the photo around; that produces an
`object-position` percentage pair and nothing else. No crop tool, no zoom, no
destroyed pixels.

This is worth protecting. On the real site the crop is going to be CSS anyway —
`object-fit: cover` plus `object-position` is what makes one file serve the hero's
1:1 desktop and 16:9 mobile ratios (§ 5). So storing his intent as a value rather
than as a cropped file means:

- you keep every pixel and can re-crop for a layout that does not exist yet;
- changing the hero to 3:2 next month needs no re-upload and no asking him again;
- he judges what the photo is *of*, and you judge what the slot needs — neither
  of you does the other's job.

#### What happens to the file

Decoded, downscaled to a 2400px longest edge, re-encoded to WebP, uploaded. The
re-encode is doing three useful things beyond shrinking a 5–12 MB camera original
to ~500 KB: it strips EXIF (phone photos carry GPS, and publishing the shop
floor's coordinates is a small but real leak), it bakes in the orientation flag so
nothing arrives sideways, and it yields the exact pixel dimensions to write into
`width`/`height`.

2400px is deliberately generous — this is a **working master, not a site asset**.
Even cropping to a third of the frame leaves ~800px, more than any slot in a
1120px column needs. What ships to `assets/` is what *you* produce from it.

#### He is asked what the photo is

Once, in the toolbar, right after it uploads. He is the only person who knows the
thing in the picture is a stainless auger conveyor for a bread line, and that
answer becomes the `alt` text. Asking at the one moment anyone knows the answer
beats inventing it later.

#### HEIC

Browsers cannot decode it, so an iPhone set to *High Efficiency* defeats the
resize. When decoding fails the **original uploads untouched** and is flagged on
`/edits` as needing conversion. He is never blocked by a file format and you are
never surprised by a missing photo. Converting server-side would need either
Cloudflare Images (paid) or a WASM decoder (a dependency); neither fits.

#### One accepted cost

A photo he uploads and then discards leaves an orphan object in R2. That is the
price of uploading on drop rather than on Send. It is invisible — only photos
named by a submitted batch are ever shown at `/edits` — and it is a few hundred
KB against a 10 GB free tier.

### What a batch looks like to you

**The review page's job is to be pasteable, not to be a merge tool.** *Copy all as
text* produces one block covering both kinds of change, so a photo arrives as an
instruction rather than as a mystery file:

```
[Hero]  div.placeholder.placeholder--square.hero__image
  PHOTO:        index-hero-image-0731.webp   (2400 × 1600)
  POSITION:     50% 32%
  DESCRIPTION:  Stainless auger conveyor for a bread line
```

Everything needed to write the `<img>` without opening the file — the name it
downloads under, the dimensions for `width`/`height`, the `object-position` you
would otherwise have had to guess, and his own words for the `alt`. The image
files come down separately via *Download all photos*, named to match.

Operational detail — the order to do things in, and the two traps when pasting
copy back — is in [`deploy/README.md`](deploy/README.md), next to the rest of the
runbook.

### Reconciliation — how it survives you changing the site

On every page load, each stored edit is checked against the page as it now is:

| Live text is… | What happens |
|---|---|
| the **new** text | You applied it. The record is deleted. His browser tidies itself. |
| the **old** text | Not applied yet. His override is re-drawn so his work still shows. |
| **neither** | The source moved on underneath him. Kept, **not applied**, and counted in the toolbar as "no longer matches the page". |

The third row is the honest answer to "the layout changed". His proposal is neither
silently discarded nor silently pasted over your newer copy — it is set aside and
reported. Elements are re-found by CSS selector first and by previous text second, so
an edit stays attached through a restructure that a selector alone would not survive.

**Photos follow the same three cases, keyed on the slot rather than the text.** If
the slot is gone and the batch was already sent, you almost certainly replaced the
`.placeholder` with a real `<img>` — so the record is dropped. If the slot is gone
and it was *not* sent, that is a layout change and the record is kept and reported.
Either way the file itself is safe in R2; this only decides what his browser keeps
showing him.

### Deliberate behaviours worth knowing

- **His overrides are kept after Send, not cleared.** Wiping them would snap every
  paragraph back to the old copy the instant he pressed the button, which reads as
  "it did not work". They clear themselves via the table above.
- **A slot is painted from the server copy, never from a `blob:` URL.** A blob URL
  dies on reload and these records are persisted, so using one would leave every
  slot blank the next time he opened the page. It also means a slot only ever
  shows a photo the server really has.
- **The toolbar lives in a shadow root.** The site is restyled often and a rule in
  `base.css` for `button` or `p` must never be able to reshape the one control he
  needs to press. Nothing leaks the other way either.
- **Paste is plain-text.** `contenteditable="plaintext-only"` where supported, with a
  paste handler as fallback, so a paste out of Word cannot smuggle in inline styles.
- **Emptying a block is undone.** An empty `<p>` is not a proposal anyone can act on,
  and it is almost always a slip.
- **The editor's colours are deliberately not the site's** — the bar and the outlines
  have to look foreign so an editing session is never mistaken for the finished page.
  `js/edit.js` is therefore listed in `EXEMPT_FILES` in `tools/check-colours.js`, with
  the reasoning at that constant. Pointing them at `--color-accent` would be a real
  regression, not a tidy-up.

### Testing it

Only through the worker — `npm run serve` knows nothing about edit mode, and that is
deliberate (a second injection implementation is exactly the serve-versus-Cloudflare
divergence § 9 warns about). Commands in § 12.

Worth checking after a layout change: open `?edit`, confirm the new or moved copy has
a dashed outline, and confirm the header and footer do **not**.

---

## 12. Command reference

Everything needed to work on this site, in one place. There are **no npm
dependencies** — `npm` is a task runner and nothing else, so every `npm run x` is
equally `node tools/x.js`. Requires Node (any recent version).

### Every day

| Command | What it does |
|---|---|
| `npm run serve` | Local preview on `:8080`. The day-to-day tool. Web fonts do not load over `file://` (§ 5), and neither does `404.html` (§ 4). Any unmatched URL serves `404.html` with a real `404`. |
| `npm run serve -- 3000` | Same, on another port. |
| `npm run sync` | Rewrites every page's header/footer from `partials/`. Run after editing a partial (§ 4). |
| `npm run deploy` | check → build → upload. **The only thing that changes the live site** (§ 9). |

### Checks — all write nothing, all exit non-zero on failure

| Command | What it does |
|---|---|
| `npm run check` | Both of the below. Run by the pre-commit hook *and* by `npm run deploy`. |
| `npm run check:partials` | Fails if any page has drifted from `partials/` (§ 4). |
| `npm run check:colours` | Fails if a colour literal appears outside `theme.css` (§ 5). |

### Build & deploy

| Command | What it does |
|---|---|
| `npm run build` | Assembles `dist/`. Rarely run alone — `deploy` calls it. |
| `npm run deploy` | The whole pipeline. Uploads your **working tree**, not the last commit. |
| `npm run postdeploy` | Automatic after `deploy`. Prints the live URL, because wrangler prints a different one (§ 9). |
| `npx wrangler@4.115.0 pages deployment list --project-name=fifl-site` | Which deploy is actually live. The `Environment` column is the authority, not the terminal. |

### One-time setup

After a fresh `git clone`, one command — Git never installs hooks itself:

```
git config core.hooksPath tools/hooks
```

Everything else is per-Cloudflare-account, and the full runbook with explanations is
[`deploy/README.md`](deploy/README.md):

| Command | What it does |
|---|---|
| `npx wrangler@4.115.0 login` | Authorise wrangler in a browser. |
| `npx wrangler@4.115.0 pages project create fifl-site --production-branch=master` | Create the Pages project. |
| `npx wrangler@4.115.0 pages secret put PREVIEW_PASSWORD --project-name=fifl-site` | Set the preview password. Repeat to change it. |
| `npx wrangler@4.115.0 kv namespace create fifl-edits` | Create the store for client edits. Then bind it as **`EDITS`** in the dashboard. |
| `npx wrangler@4.115.0 r2 bucket create fifl-uploads` | Create the store for client photos. Then bind it as **`UPLOADS`** in the dashboard. |

> **Keep the version pinned exactly.** `wrangler@4` is a semver range, which npm
> cannot resolve without a network round trip on every single invocation (§ 9). To
> upgrade, change the number in `package.json` **and** in `deploy/README.md`.

### Testing the worker locally

`npm run serve` does not run the worker, so it cannot show you the password gate,
the 404 status, or edit mode. For those:

```
echo PREVIEW_PASSWORD=whatever > .dev.vars     # gitignored; delete when done
npm run build
npx wrangler@4.115.0 pages dev dist --kv EDITS --r2 UPLOADS --compatibility-date=2026-07-29
```

`--kv EDITS` and `--r2 UPLOADS` give you throwaway local stores under
`.wrangler/` — nothing touches Cloudflare. Then visit `http://localhost:8788/`
plus `?edit`, and `/edits`.

**If a restart seems to change nothing, look for an orphaned `workerd`.** Ctrl+C
does not always take wrangler's runtime down with it, and the survivor keeps the
port — so the *old* worker answers while the terminal says the new one is ready.
That looks exactly like your edit having no effect. `deploy/README.md` has the
command to find and kill the tree.

**`--compatibility-date` is required, and the error without it is misleading.**
Wrangler defaults it to *today*, but the workerd runtime inside the pinned
`wrangler@4.115.0` only understands dates up to **2026-07-29**, so it refuses to
boot with *"This Worker requires compatibility date … but the newest date
supported by this server binary is …"* — which reads like a broken install and is
not one. Local dev only; the deployed site takes its date from the Pages project.
It disappears when wrangler is upgraded (§ 9).

### URLs

| URL | Who | What |
|---|---|---|
| `fifl-site.pages.dev` | you, the client | The live preview. Always the newest production deploy. |
| `fifl-site.pages.dev/?edit` | **the client** | Edit mode. Give him this one as a desktop shortcut (§ 11). |
| `fifl-site.pages.dev/edits` | **you** | What he has sent. Same password. |
| `<hash>.fifl-site.pages.dev` | you | Immutable snapshot of one deploy. What makes rollback possible (§ 9). |
| `localhost:8080` | you | `npm run serve`. |
| `localhost:8788` | you | `wrangler pages dev`. |
