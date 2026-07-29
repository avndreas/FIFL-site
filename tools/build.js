#!/usr/bin/env node
/* ============================================================================
   build.js — assemble dist/, the exact set of files that goes to Cloudflare
   ----------------------------------------------------------------------------
   The site is written to be opened straight from the repo, which means the repo
   root is also full of things that must never be published: SITE-SPEC.md,
   tools/, the partials/ sources (already spliced into every page), package.json,
   .claude/. Uploading the root would put every one of them on the public web.

   So deployment gets its own directory. This copies the publishable files into
   dist/ and nothing else:

       *.html              the pages themselves
       assets/ css/ js/    everything those pages reference
       deploy/*            _worker.js (the password gate) and robots.txt —
                           flattened into the dist ROOT, where Cloudflare
                           looks for them

   Nothing is transformed; the deployed pages are byte-for-byte the ones you
   preview locally. dist/ is disposable and gitignored, and is wiped and rebuilt
   from scratch on every run, so a file deleted from the repo cannot linger.

   Usage:
       npm run build       (or: node tools/build.js)
       npm run deploy      check, build, then upload dist/ to Cloudflare Pages
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DEPLOY = path.join(ROOT, "deploy");

/** Directories copied wholesale into dist/. */
const COPY_DIRS = ["assets", "css", "js"];

/** Files in deploy/ that document the setup rather than ship with the site. */
const DEPLOY_EXCLUDE = new Set(["README.md"]);

let copied = 0;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fail(message) {
  console.error("ERROR: " + message);
  process.exit(1);
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
  console.log("  " + rel(dest));
}

function copyDir(src, dest, exclude) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude && exclude.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to, null);
    else copyFile(from, to);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

// The gate is not optional. Without it a deploy would publish the unfinished
// site to the open web, so refuse to build rather than let that happen.
if (!fs.existsSync(path.join(DEPLOY, "_worker.js"))) {
  fail("deploy/_worker.js is missing — refusing to build an unprotected site.");
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
if (pages.length === 0) fail("no .html pages found in " + ROOT);
for (const page of pages) copyFile(path.join(ROOT, page), path.join(DIST, page));

for (const dir of COPY_DIRS) {
  const from = path.join(ROOT, dir);
  if (!fs.existsSync(from)) fail("missing directory " + dir + "/");
  copyDir(from, path.join(DIST, dir), null);
}

copyDir(DEPLOY, DIST, DEPLOY_EXCLUDE);

console.log("\nBuilt dist/ — " + copied + " files, " + pages.length + " pages.");
