#!/usr/bin/env node
/* ============================================================================
   check-colours.js — theme.css is the ONLY place colours are defined
   ----------------------------------------------------------------------------
   SITE-SPEC says "nothing else hard-codes a colour". This enforces it, so the
   claim can't quietly rot again: edit theme.css, and the whole site follows.

   Fails if a colour literal (hex, rgb()/hsl()/lab()/oklch()…, or a common
   named colour) appears anywhere except css/theme.css.

   Usage:
       npm run check:colours     (or: node tools/check-colours.js)

   Where it looks:
       css/*.css        — declaration VALUES only, so selectors like #main and
                          class names like .btn--ghost can't false-positive.
       *.html           — inline style="", <style> blocks, and SVG paint
       partials/*.html    attributes (fill/stroke/stop-color/…).
       js/*.js          — colour literals assigned at runtime.

   Where it does NOT look, and why:
       css/theme.css    — the token file. This is where colours belong.
       assets/*.svg     — standalone artwork (favicons, social cards, print) is
                          used OUTSIDE any page, where CSS variables do not
                          resolve, so it must carry baked-in colours. Artwork
                          that IS page chrome should be inlined into a partial
                          instead — see the logo in partials/header.html.
       deploy/          — not site content. _worker.js runs at Cloudflare's edge
                          and renders one page of its own (the /edits review
                          page), which is a private tool rather than part of the
                          site and is bound by none of its design rules. Listed
                          here so the omission is a decision, not an oversight.
       js/edit.js       — see EXEMPT_FILES below.

   Escape hatch: put `theme-exempt` in a comment on the offending line.
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** Values that are keywords, not colour choices. */
const ALLOW = new Set([
  "none", "transparent", "currentcolor", "inherit", "initial", "unset", "revert",
]);

/** Common CSS named colours. Not the full 148 — just the plausible ones. */
const NAMED = [
  "white", "black", "red", "green", "blue", "gray", "grey", "silver", "navy",
  "teal", "olive", "lime", "aqua", "cyan", "magenta", "fuchsia", "purple",
  "maroon", "yellow", "orange", "pink", "brown", "beige", "ivory", "khaki",
  "gold", "tan", "salmon", "coral", "crimson", "indigo", "violet", "turquoise",
  "darkgreen", "lightgreen", "seagreen", "forestgreen", "whitesmoke",
];

/**
 * Files inside a scanned directory that are tooling rather than site content.
 *
 * js/edit.js paints the client-facing edit toolbar (SITE-SPEC § 11). Its
 * colours are deliberately NOT the site's: the bar and the outlines around
 * editable text have to look foreign to this design, so that nobody can mistake
 * an editing session for the finished page. Pointing them at --color-accent
 * would be an actual regression, and it never ships to a visitor — the file is
 * injected by deploy/_worker.js only when a page is requested with ?edit.
 *
 * Prefer `theme-exempt` on a line for one-off cases. A whole-file entry here is
 * for files where every colour is exempt for the same reason.
 */
const EXEMPT_FILES = new Set([path.join("js", "edit.js")]);

const RE_HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RE_FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/g;
const RE_NAMED = new RegExp("\\b(?:" + NAMED.join("|") + ")\\b", "gi");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Blank out a region but keep newlines, so byte offsets stay line-accurate. */
function blank(match) {
  return match.replace(/[^\n]/g, " ");
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, blank);
}

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, blank);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

/** Lines carrying an opt-out marker. */
function exemptLines(text) {
  const out = new Set();
  text.split("\n").forEach((line, i) => {
    if (line.includes("theme-exempt")) out.add(i + 1);
  });
  return out;
}

/**
 * Find colour literals in `chunk`, reporting positions offset by `base`
 * so they map back to the original file.
 */
function scanChunk(chunk, base, hits) {
  for (const re of [RE_HEX, RE_FUNC, RE_NAMED]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(chunk)) !== null) {
      const value = m[0].replace(/\s*\($/, "()");
      if (ALLOW.has(value.toLowerCase())) continue;
      hits.push({ index: base + m.index, value });
    }
  }
}

/** CSS: only declaration values, never selectors or at-rule preludes. */
function scanCss(text) {
  const src = stripCssComments(text);
  const hits = [];
  const decl = /:\s*([^;{}]*)(?=[;}])/g;
  let m;
  while ((m = decl.exec(src)) !== null) {
    scanChunk(m[1], m.index + m[0].length - m[1].length, hits);
  }
  return hits;
}

/** HTML: inline styles, <style> blocks, and SVG paint attributes. */
function scanHtml(text) {
  const src = stripHtmlComments(text);
  const hits = [];

  const styleAttr = /\bstyle\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = styleAttr.exec(src)) !== null) {
    scanChunk(m[1], m.index + m[0].indexOf(m[1]), hits);
  }

  const styleBlock = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlock.exec(src)) !== null) {
    const base = m.index + m[0].indexOf(m[1]);
    for (const hit of scanCss(m[1])) {
      hits.push({ index: base + hit.index, value: hit.value });
    }
  }

  const paint =
    /\b(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*"([^"]*)"/gi;
  while ((m = paint.exec(src)) !== null) {
    const value = m[1].trim();
    if (!value || ALLOW.has(value.toLowerCase())) continue;
    if (/^(?:var|url)\s*\(/i.test(value)) continue;
    scanChunk(m[1], m.index + m[0].indexOf(m[1]), hits);
  }

  return hits;
}

/** JS: colour literals set at runtime. Selector-ish strings are ignored. */
function scanJs(text) {
  const src = stripCssComments(text).replace(/\/\/[^\n]*/g, blank);
  const hits = [];
  scanChunk(src, 0, hits);
  // '#abc' alone is far more likely a querySelector id than a colour.
  return hits.filter((h) => !/^#[A-Za-z_-]/.test(h.value));
}

function listFiles(dir, ext) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const TOKEN_FILE = path.join("css", "theme.css");

const targets = [
  ...listFiles("css", ".css")
    .filter((f) => f !== TOKEN_FILE)
    .map((f) => ({ file: f, scan: scanCss })),
  ...listFiles(".", ".html").map((f) => ({ file: f, scan: scanHtml })),
  ...listFiles("partials", ".html").map((f) => ({ file: f, scan: scanHtml })),
  ...listFiles("js", ".js").map((f) => ({ file: f, scan: scanJs })),
].filter((t) => !EXEMPT_FILES.has(t.file));

if (!fs.existsSync(path.join(ROOT, TOKEN_FILE))) {
  console.error("ERROR: missing " + TOKEN_FILE);
  process.exit(1);
}

let total = 0;

for (const { file, scan } of targets) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
  const exempt = exemptLines(text);

  const hits = scan(text)
    .map((h) => ({ line: lineOf(text, h.index), value: h.value }))
    .filter((h) => !exempt.has(h.line))
    .sort((a, b) => a.line - b.line || a.value.localeCompare(b.value));

  // One report per line, even if a line holds several literals.
  const seen = new Set();
  for (const hit of hits) {
    const key = hit.line + "|" + hit.value;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error("  " + file + ":" + hit.line + "  " + hit.value);
    total++;
  }
}

if (total > 0) {
  console.error(
    "\n" + total + " hard-coded colour(s) outside " + TOKEN_FILE + ".\n" +
    "Add a token to " + TOKEN_FILE + " and reference it with var(--color-…).\n" +
    "If the literal genuinely belongs where it is, mark the line `theme-exempt`."
  );
  process.exit(1);
}

console.log(
  "All colours come from " + TOKEN_FILE + " (" + targets.length + " files checked)."
);
