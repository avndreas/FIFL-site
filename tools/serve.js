#!/usr/bin/env node
/* ============================================================================
   serve.js — a local web server for previewing the site
   ----------------------------------------------------------------------------
   Usage:
       npm run serve            ->  http://localhost:8080
       npm run serve -- 3000    ->  http://localhost:3000

   Why this exists, when every page is a directly-openable .html file:

       Web fonts do not load over file://.

   A font file is subject to CORS, and a page opened by double-clicking has an
   *opaque* origin, so Chrome (and Safari) refuse the request and silently draw
   the fallback stack instead. Double-clicking index.html to compare fonts would
   therefore show you the system font every time, whatever theme.css says.

   Everything else about the site works fine from file://, with one exception:
   404.html uses root-relative paths (it has to — see the note in that file), so
   it only renders correctly over http. Request any made-up URL here to see it.

   Otherwise this is only needed for judging fonts, and for anything else
   CORS-sensitive added later.

   No dependencies — Node's own http module. Nothing here ships to the server.
   ========================================================================== */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";

    // Resolve inside ROOT only — no climbing out with ../
    const file = path.resolve(ROOT, "." + rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(file, (err, body) => {
      if (err) {
        // Serve 404.html, like Cloudflare Pages does — but with a real 404
        // status, which is the half Pages gets wrong (SITE-SPEC § 9). So the
        // page is previewable here (hit any made-up URL) without this server
        // also adopting the host's soft-404 behaviour.
        let page404 = null;
        try {
          page404 = fs.readFileSync(path.join(ROOT, "404.html"));
        } catch (e) {
          /* no 404 page in the project — fall back to plain text */
        }
        res.writeHead(404, {
          "Content-Type": page404 ? TYPES[".html"] : "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(page404 || "404 " + rel);
        console.log("  404  " + rel);
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        // Always revalidate: a preview server must never serve you stale CSS.
        "Cache-Control": "no-cache",
      });
      res.end(body);
      console.log("  200  " + rel + "  (" + body.length + " B)");
    });
  })
  .listen(PORT, () => {
    console.log(
      "\n  Preview:  http://localhost:" + PORT + "/" +
      "\n  404 page: http://localhost:" + PORT + "/a/b/c  (any made-up URL)" +
      "\n            — it uses root-relative paths, so it is the one page that" +
      "\n              does NOT render from file://. Check it here." +
      "\n\n  Ctrl+C to stop.\n"
    );
  });
