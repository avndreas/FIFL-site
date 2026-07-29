/* ============================================================================
   _worker.js — the password gate in front of the work-in-progress site
   ----------------------------------------------------------------------------
   This runs on Cloudflare's edge, in front of every request. Nobody sees a byte
   of the site without the password, which means Google cannot index it and a
   guessed URL shows a login box rather than an unfinished site.

   It is the ONE file here that is not plain Node: Cloudflare Workers use ES
   modules and the browser fetch API, so `export default` and `Response` below
   are correct and `require` would not be.

   How it gets there:
       tools/build.js copies this into dist/ ; Cloudflare Pages treats a file
       named _worker.js at the root of a deployment as "handle every request
       with this", and hands us env.ASSETS to serve the real files afterwards.

   The password lives in Cloudflare, never in this repo — see deploy/README.md.
   Remove this file (and the robots.txt beside it) on the day the site goes
   public; the build refuses to run without it, so it cannot go missing quietly.
   ========================================================================== */

/** Shown in the browser's login dialog. */
const REALM = "Food Industry Fabrication — preview";

/** Username, if PREVIEW_USER is not set in Cloudflare. */
const DEFAULT_USER = "fifl";

/**
 * Compare without leaking, through response timing, how much of the password
 * was right. Length is allowed to leak; every character is always compared.
 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The 401 that makes the browser show its login dialog. */
function challenge() {
  return new Response("401 — this preview is password protected.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="' + REALM + '", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorised(request, user, password) {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Basic ")) return false;

  let decoded;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false; // not valid base64
  }

  // Split on the FIRST colon only — a password may legitimately contain one.
  const colon = decoded.indexOf(":");
  if (colon === -1) return false;

  const okUser = safeEqual(decoded.slice(0, colon), user);
  const okPass = safeEqual(decoded.slice(colon + 1), password);
  return okUser && okPass;
}

export default {
  async fetch(request, env) {
    const password = env.PREVIEW_PASSWORD;

    // Fail closed. If the secret is missing the site is NOT served in the open;
    // it is better to be broken than to be public by accident.
    if (!password) {
      return new Response(
        "503 — preview password is not configured on this deployment.",
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!isAuthorised(request, env.PREVIEW_USER || DEFAULT_USER, password)) {
      return challenge();
    }

    // Past the gate: serve the real file, plus a belt-and-braces instruction to
    // any crawler that somehow gets this far (robots.txt is the other half).
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return response;
  },
};
