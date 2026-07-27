#!/usr/bin/env node
/* ============================================================================
   sync-partials.js — ONE header/footer, copied into every page
   ----------------------------------------------------------------------------
   The site stays a pure static site: no build output, no client-side includes,
   no runtime cost. The shared header/footer live in ONE place —

       partials/header.html
       partials/footer.html

   — and this script splices them into the marked region of every root-level
   *.html page. The pages remain complete, directly-openable HTML files; this
   just stops the copies from drifting apart.

   Usage:
       npm run sync      (or: node tools/sync-partials.js)
           Rewrite every page's HEADER/FOOTER region from the partials.

       npm run check:partials   (or: node tools/sync-partials.js --check)
           Write nothing; exit 1 if any page is out of date.
           This is what the pre-commit hook runs. (`npm run check` runs this
           plus tools/check-colours.js.)

   The active nav tab is handled automatically: the partial ships with no
   aria-current, and this script adds aria-current="page" to the nav link whose
   href matches the page being written. Never hand-edit that attribute.

   Adding a page? Give it the two marker comments (copy them from any existing
   page — the text inside is rewritten, only the HEADER/FOOTER names matter) and
   it joins the rotation automatically. A root page with no markers is an error,
   so nothing can silently opt out; genuine exceptions go in EXCLUDE below.
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PARTIALS_DIR = path.join(ROOT, "partials");

/** Root-level .html files that intentionally have no shared header/footer. */
const EXCLUDE = new Set([
  // "landing-standalone.html",
]);

/** Marker name -> partial file. Order is irrelevant; both are independent. */
const REGIONS = [
  { name: "HEADER", partial: "header.html" },
  { name: "FOOTER", partial: "footer.html" },
];

const checkOnly = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Matches an HTML comment marker like `<!-- ===== HEADER (anything) ===== -->` */
function markerRegex(name) {
  return new RegExp("<!--\\s*=*\\s*" + name + "\\b[\\s\\S]*?-->");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Indent every non-empty line by `indent`. */
function indentBlock(text, indent) {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : indent + line))
    .join("\n");
}

/**
 * Mark the nav link for `pageFile` as the current page.
 * Scoped to <nav class="main-nav"> so the brand/logo link is left alone.
 */
function setActiveTab(block, pageFile) {
  return block.replace(/<nav class="main-nav"[\s\S]*?<\/nav>/, (nav) => {
    // Drop any stray aria-current first, so this is always idempotent.
    const clean = nav.replace(/\s+aria-current="page"/g, "");
    return clean.replace(
      new RegExp('(<a\\s+href="' + escapeRegex(pageFile) + '")', "g"),
      '$1 aria-current="page"'
    );
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const partials = {};
for (const region of REGIONS) {
  const file = path.join(PARTIALS_DIR, region.partial);
  if (!fs.existsSync(file)) {
    console.error("ERROR: missing partial " + path.relative(ROOT, file));
    process.exit(1);
  }
  // Normalise to LF here; per-file line endings are restored on write.
  partials[region.name] = fs
    .readFileSync(file, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/, "");
}

const pages = fs
  .readdirSync(ROOT)
  .filter((f) => f.endsWith(".html") && !EXCLUDE.has(f))
  .sort();

if (pages.length === 0) {
  console.error("ERROR: no .html pages found in " + ROOT);
  process.exit(1);
}

let stale = 0;
let failed = 0;

for (const page of pages) {
  const file = path.join(ROOT, page);
  const original = fs.readFileSync(file, "utf8");
  const usesCRLF = original.includes("\r\n");
  let updated = original.replace(/\r\n/g, "\n");
  let pageFailed = false;

  for (const region of REGIONS) {
    const open = markerRegex(region.name).exec(updated);
    const close = markerRegex("/" + region.name).exec(updated);

    if (!open || !close || close.index < open.index) {
      console.error(
        "ERROR: " + page + " — missing or malformed " + region.name + " markers"
      );
      pageFailed = true;
      continue;
    }

    // Indentation of the line the opening marker sits on.
    const lineStart = updated.lastIndexOf("\n", open.index) + 1;
    const indent = updated.slice(lineStart, open.index);

    let body = indentBlock(partials[region.name], indent);
    if (region.name === "HEADER") body = setActiveTab(body, page);

    const block =
      indent +
      "<!-- ===== " + region.name + " — generated from partials/" +
      region.partial + " · DO NOT EDIT ===== -->\n" +
      body + "\n" +
      indent + "<!-- ===== /" + region.name + " ===== -->";

    updated =
      updated.slice(0, lineStart) +
      block +
      updated.slice(close.index + close[0].length);
  }

  if (pageFailed) {
    failed++;
    continue;
  }

  if (usesCRLF) updated = updated.replace(/\n/g, "\r\n");

  if (updated === original) {
    if (!checkOnly) console.log("  ok       " + page);
    continue;
  }

  stale++;
  if (checkOnly) {
    console.log("  STALE    " + page);
  } else {
    fs.writeFileSync(file, updated, "utf8");
    console.log("  updated  " + page);
  }
}

if (failed > 0) {
  console.error(
    "\n" + failed + " page(s) could not be processed. Add the marker comments " +
    "(copy from any existing page) or list the file in EXCLUDE in tools/sync-partials.js."
  );
  process.exit(1);
}

if (checkOnly) {
  if (stale > 0) {
    console.error(
      "\n" + stale + " page(s) out of sync with partials/. Run:  npm run sync"
    );
    process.exit(1);
  }
  console.log("All " + pages.length + " pages match partials/.");
} else {
  console.log(
    "\nDone — " + stale + " updated, " + (pages.length - stale) + " already current."
  );
}
