# Food Industry Fabrication Ltd. — Website Specification

> **Purpose of this document:** A single reference for the structure, design system,
> and performance approach of the FIFL website. Read this first before making changes.
> Keep it up to date as the site grows.

Last updated: 2026-07-24 · Status: **Skeleton / v0**

---

## 1. What this site is

A **static marketing website** for Food Industry Fabrication Ltd. (FIFL), a machining
company specializing in parts and equipment for food production.

Design goals, in priority order:

1. **Fast** — loads and navigates near-instantly, even on old computers and browsers.
2. **Lightweight** — no frameworks, minimal JavaScript, no web-font downloads.
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
| **Speculation Rules** (modern browsers) | Browsers that support it will prerender likely-next pages. Older browsers simply ignore it and fall back to hover-prefetch. | `js/prefetch.js` |
| **No web fonts** | Uses the OS's own UI font stack — nothing to download, no layout shift. | `css/base.css` |
| **Tiny, cached CSS** | 3 small stylesheets, cached after first load, shared across every page. | `css/` |
| **Almost no JavaScript** | Only the prefetch helper (~1 KB). The site is 100% functional with JS disabled. | `js/prefetch.js` |
| **Sharp, flat design** | No shadows/blur/animation to repaint. Cheap for old GPUs to render. | `css/*` |

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
| Home | `index.html` | Hero (company name title + square placeholder image), lorem subheader, four "areas of expertise" cards with image-background + body text. |
| About Us | `about.html` | Standard about page. Lorem ipsum + placeholders. |
| Gallery | `gallery.html` | Static grid of placeholder images. |
| Services | `services.html` | **Intentionally blank** for now (heading + "coming soon" placeholder). |
| Contact | `contact.html` | Contact form (non-functional placeholder), placeholder email + phone, Google Maps embed placeholder. |

### The four "areas of expertise" (Home cards)
1. Custom Machined Parts
2. Fabricated Components
3. Special Purpose Machine Design
4. Industrial Sewing

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
- The active tab is marked with `aria-current="page"` and styled with a green underline.

### About the duplicated header
Because this is a pure static site (no build step, no server includes), the header &
footer HTML is **copied into each page**. This is deliberate — it keeps the site working
on any browser with zero JavaScript and zero build tooling.

**When you change the header/footer, update it in ALL five HTML files.** Keep them identical.
(If the site later gains a build step or server-side includes, the header can be extracted
into a single partial — see "Future" below.)

---

## 5. Design system

Style direction: **simple, clean, slightly older/industrial** — sharp edges, solid borders,
flat fills, a white + green palette. Not retro, not flashy. Minimal motion.

### Colours — edit `css/theme.css` ONLY
All colours (and core spacing/sizing) live as CSS custom properties in
[`css/theme.css`](css/theme.css). **To re-theme the whole site, edit that one file.**
Nothing else hard-codes a colour.

Current palette:

| Variable | Value | Used for |
|---|---|---|
| `--color-bg` | `#ffffff` | Page background |
| `--color-surface` | `#f3f6f3` | Cards, alternating sections |
| `--color-primary` | `#1f7a3d` | Brand green — headings accents, buttons, active tab |
| `--color-primary-dark` | `#145c2c` | Hover/pressed green |
| `--color-primary-light` | `#e7f1ea` | Tinted backgrounds |
| `--color-accent` | `#3a9d5d` | Secondary green |
| `--color-text` | `#1a1a1a` | Body text |
| `--color-text-muted` | `#555b55` | Secondary text |
| `--color-border` | `#cbd4cb` | Borders, dividers |
| `--color-header-bg` | `#ffffff` | Header background |
| `--color-footer-bg` | `#12331f` | Footer background (dark green) |

Also defined in `theme.css`: spacing scale, max content width, border width, font stacks.

### CSS file organization
Load order matters (later files can rely on earlier variables):

1. **`css/theme.css`** — *variables only.* Colours, spacing, sizes, fonts. The re-theme file.
2. **`css/base.css`** — reset, typography, layout primitives, header, footer, nav.
3. **`css/components.css`** — reusable blocks: hero, expertise cards, gallery grid, forms, buttons, placeholders.

Class-naming convention: simple, readable, block-based (e.g. `.card`, `.card__title`,
`.hero`, `.gallery-grid`). Keep it flat and obvious — no CSS methodology overhead.

### Placeholder images
To stay lightweight and binary-free, placeholders are drawn with CSS/SVG (a labeled box),
not photo files — see the `.placeholder` component in `css/components.css`. The only real
asset is [`assets/logo.svg`](assets/logo.svg), a simple placeholder mark.
Swap these for real images later; keep dimensions similar to avoid layout shift.

---

## 6. Contact form

The form on `contact.html` is **markup only** — it does not submit anywhere yet.
When wiring it up, options (no heavy backend needed):
- A static-host form handler (Netlify Forms, Formspree, Basin), **or**
- A small serverless function / email endpoint.

Placeholder contact details and a placeholder Google Maps embed box are in place; replace
the `src` of the maps `<iframe>` (or the placeholder block) with the client's real embed.

---

## 7. Accessibility & compatibility

- Semantic HTML (`header`, `nav`, `main`, `section`, `footer`, real `<label>`s).
- Works with JavaScript disabled.
- Colour contrast meets WCAG AA for text.
- No reliance on hover-only interactions for core navigation.
- Tested target: works on old/low-end browsers; modern features (sticky, Speculation Rules)
  are progressive enhancements that degrade gracefully.

---

## 8. Directory structure

```
FIFL-site/
├── SITE-SPEC.md          # this file
├── index.html            # Home (landing page)
├── about.html            # About Us
├── gallery.html          # Gallery
├── services.html         # Services (blank for now)
├── contact.html          # Contact
├── css/
│   ├── theme.css         # COLOURS + design tokens — edit here to re-theme
│   ├── base.css          # reset, typography, layout, header/footer/nav
│   └── components.css     # hero, cards, gallery, forms, buttons, placeholders
├── js/
│   └── prefetch.js       # hover/touch prefetch + speculation rules
└── assets/
    └── logo.svg          # placeholder logo mark
```

---

## 9. Future / TODO (not in this skeleton)

- Real content, copy, and photography.
- Real logo.
- Fill in the **Services** page.
- Wire up the contact form to a handler.
- Real Google Maps embed.
- Optional: introduce a build step or server-side includes so the header/footer live in
  ONE partial instead of being copied per page (only worth it once page count grows).
- Optional: content-hashed asset filenames for long-term caching.
- Additional pages as requested by the client.
