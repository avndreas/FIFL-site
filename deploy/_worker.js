/* ============================================================================
   _worker.js — the password gate, and the client-edit inbox behind it
   ----------------------------------------------------------------------------
   This runs on Cloudflare's edge, in front of every request. It does two jobs:

     1. THE GATE. While the site is unfinished, nobody sees a byte without the
        password, so Google cannot index it and a guessed URL shows a login box
        rather than a work in progress.

     2. EDIT MODE. A page requested with ?edit comes back with js/edit.js
        spliced in, which lets the client rewrite his own copy by clicking the
        words on the real page. What he sends lands in KV and is read at /edits.
        Nothing it receives touches a file in the repo — see SITE-SPEC § 11.

   It is the ONE file here that is not plain Node: Cloudflare Workers use ES
   modules and the browser fetch API, so `export default` and `Response` below
   are correct and `require` would not be.

   How it gets there:
       tools/build.js copies this into dist/ ; Cloudflare Pages treats a file
       named _worker.js at the root of a deployment as "handle every request
       with this", and hands us env.ASSETS to serve the real files afterwards.

   Environment (all set in Cloudflare, never in this repo — see deploy/README.md):
       PREVIEW_PASSWORD   required   the gate. Missing = fail closed.
       PREVIEW_USER       optional   defaults to "fifl"
       EDITS              optional   KV namespace binding. Holds BOTH the sent
                                     batches (key prefix "edit:") and the photo
                                     files themselves (prefix "photo:").
                                     Missing = edit mode is unavailable; the
                                     SITE IS UNAFFECTED.
       NOTIFY_EMAIL       optional   where to email when a batch arrives
       NOTIFY_FROM        optional   sender, on a domain onboarded to Email Sending
       CF_ACCOUNT_ID      optional   for the Email Sending REST call
       CF_API_TOKEN       optional   ditto

   The four NOTIFY_/CF_ values are the deferred half: until all of them exist,
   notify() is a no-op and batches simply wait at /edits. Wiring email up later
   is dashboard work, not a code change.
   ========================================================================== */

/** Shown in the browser's login dialog. */
const REALM = "Food Industry Fabrication — preview";

/** Username, if PREVIEW_USER is not set in Cloudflare. */
const DEFAULT_USER = "fifl";

/* ---------------------------------------------------------------------------
   THE LAUNCH SWITCH.

   `true`  — the whole site is private. Every request needs the password.
   `false` — the site is public; ONLY /edits and /api/edits need the password.

   On the day the site goes live this flips to false. It does NOT mean deleting
   this file: edit mode has to keep working after launch, and its endpoints have
   to stay protected forever. See "Going live" in deploy/README.md.

   Read the fail-closed note in the handler before changing this.
   --------------------------------------------------------------------------- */
const GATE_WHOLE_SITE = true;

/**
 * Paths that require the password even after the site is public.
 *
 * Listed explicitly rather than matching `/api/` wholesale, because the contact
 * form (§ 6) will add a PUBLIC `/api/contact` and it must not silently inherit
 * a login box. Anything private goes here; anything else is open once
 * GATE_WHOLE_SITE is false.
 */
const PRIVATE_PATHS = ["/edits", "/api/edits", "/api/upload", "/api/photo"];

/** Newest batches shown at /edits. Older ones stay in KV, just off the page. */
const REVIEW_LIMIT = 25;

/**
 * Refuse absurd images. A 2400px WebP is ~0.5 MB, so this is generous headroom —
 * and it sits comfortably under KV's own 25 MB ceiling per value, which is the
 * real limit photos are stored against (see receiveUpload).
 */
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/** Refuse absurd payloads outright rather than paying to store them. */
const MAX_BODY_BYTES = 512 * 1024;

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// notification — the seam the contact form will share
// ---------------------------------------------------------------------------

/**
 * Email a one-line summary and the full text of whatever arrived.
 *
 * Deliberately best-effort and deliberately SECOND. The KV write is the record;
 * this is a convenience. A submission that exists only as an email is one
 * delivery failure away from being lost silently, which is unacceptable for the
 * contact form and merely annoying here — so both use this same ordering.
 *
 * Sends via the Email Sending REST API rather than a `send_email` binding,
 * because Pages Direct Upload projects cannot be given that binding type. The
 * token is a Cloudflare secret; nothing is installed and package.json stays at
 * zero dependencies.
 *
 * Returns a reason rather than throwing. Callers must not fail a request
 * because the notification did not go out.
 */
async function notify(env, subject, text) {
  const to = env.NOTIFY_EMAIL;
  const from = env.NOTIFY_FROM;
  const account = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  if (!to || !from || !account || !token) {
    console.log("notify: not configured — " + subject);
    return { sent: false, reason: "not-configured" };
  }

  try {
    const res = await fetch(
      "https://api.cloudflare.com/client/v4/accounts/" + account + "/email/sending/send",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          from: { address: from, name: "FIFL site" },
          subject,
          text,
        }),
      }
    );
    if (!res.ok) {
      console.log("notify: HTTP " + res.status + " — " + (await res.text()).slice(0, 300));
      return { sent: false, reason: "http-" + res.status };
    }
    return { sent: true };
  } catch (err) {
    console.log("notify: threw — " + err.message);
    return { sent: false, reason: "threw" };
  }
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * What a removal asks for, in words.
 *
 * `onSite: false` means the photo it names never reached `assets/` — he is
 * retracting one he sent in an earlier batch, so the only thing to do is not
 * place it. `back` is what should be showing instead; empty means the picture
 * placeholder.
 */
function removalInstead(edit) {
  if (edit.back) return "leave " + edit.back + " as it is";
  return edit.onSite
    ? "put the picture placeholder back"
    : "leave the picture placeholder as it is";
}

/**
 * The plain-text form of a batch. Used for the notification email and for the
 * "Copy all" button, so what you read in your inbox and what you paste into an
 * editor are the same thing.
 */
function batchToText(batch) {
  const lines = [];
  lines.push("Submitted: " + batch.submitted);
  lines.push(batch.edits.length + " change(s)");
  lines.push("");

  const byPage = {};
  for (const edit of batch.edits) (byPage[edit.page] ||= []).push(edit);

  for (const page of Object.keys(byPage).sort()) {
    lines.push("=== " + page + " ===");
    for (const edit of byPage[page]) {
      lines.push("");
      lines.push("[" + (edit.section || "—") + "]  " + edit.tag);

      if (edit.kind === "photo") {
        /* Everything needed to write the <img> without opening the file: the
           name it downloads under, the dimensions for width/height, his framing
           as the object-position you would have had to guess, and his own words
           for the alt text. */
        const size = edit.width ? edit.width + " × " + edit.height : "original, unprocessed";
        lines.push("  PHOTO:        " + edit.name + "   (" + size + ")");
        lines.push("  POSITION:     " + (edit.position || "50% 50%"));
        lines.push("  DESCRIPTION:  " + (edit.description || "(none given)"));
        if (edit.raw) {
          lines.push("  NOTE:         browser could not read this format (HEIC?) —");
          lines.push("                uploaded untouched, needs converting.");
        }
      } else if (edit.kind === "remove") {
        lines.push(
          "  REMOVE:       " +
            edit.was +
            (edit.onSite ? "" : "   (a photo he sent earlier — never on the site)")
        );
        lines.push("  INSTEAD:      " + removalInstead(edit));
      } else {
        lines.push("  OLD: " + edit.before);
        lines.push("  NEW: " + edit.after);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderBatch(key, batch) {
  const byPage = {};
  for (const edit of batch.edits) (byPage[edit.page] ||= []).push(edit);

  let html = '<article class="batch">';
  html += '<header class="batch__head">';
  html += "<h2>" + escapeHtml(new Date(batch.submitted).toUTCString()) + "</h2>";
  html +=
    '<p class="meta">' +
    batch.edits.length +
    " change" +
    (batch.edits.length === 1 ? "" : "s") +
    " · " +
    Object.keys(byPage).length +
    " page" +
    (Object.keys(byPage).length === 1 ? "" : "s") +
    "</p>";
  html += "</header>";

  let photoCount = 0;

  for (const page of Object.keys(byPage).sort()) {
    html += "<h3>" + escapeHtml(page) + "</h3>";
    for (const edit of byPage[page]) {
      html += '<div class="edit">';
      html +=
        '<p class="where">' +
        escapeHtml(edit.section || "—") +
        '  <span class="sel">' +
        escapeHtml(edit.tag) +
        "</span></p>";

      if (edit.kind === "photo") {
        photoCount++;
        const src = "/api/photo?key=" + encodeURIComponent(edit.file);
        html += '<div class="photo">';
        html += '<img src="' + escapeHtml(src) + '" alt="" loading="lazy">';
        html += '<div class="photo__meta">';
        html += "<p><b>" + escapeHtml(edit.name) + "</b></p>";
        html +=
          "<p>" +
          (edit.width
            ? edit.width + " × " + edit.height
            : '<span class="flag">original, unprocessed</span>') +
          "  ·  object-position: " +
          escapeHtml(edit.position || "50% 50%") +
          "</p>";
        html +=
          "<p>" +
          (edit.description
            ? escapeHtml(edit.description)
            : '<span class="muted">no description given</span>') +
          "</p>";
        if (edit.raw) {
          html +=
            '<p class="flag">Browser could not read this format (HEIC?) — ' +
            "uploaded untouched, needs converting.</p>";
        }
        html +=
          '<p><a class="dl" download="' +
          escapeHtml(edit.name) +
          '" href="' +
          escapeHtml(src) +
          '">Download</a></p>';
        html += "</div></div>";
      } else if (edit.kind === "remove") {
        html +=
          '<p class="gone"><b>' +
          (edit.onSite ? "Take this photo out" : "Do not use this photo") +
          "</b> — " +
          escapeHtml(removalInstead(edit)) +
          ".</p>";
        html +=
          '<p class="was">' +
          escapeHtml(edit.was) +
          (edit.onSite
            ? ""
            : ' <span class="muted">— a photo he sent earlier, never on the site</span>') +
          "</p>";
      } else {
        html += '<p class="old"><span>OLD</span>' + escapeHtml(edit.before) + "</p>";
        html += '<p class="new"><span>NEW</span>' + escapeHtml(edit.after) + "</p>";
      }
      html += "</div>";
    }
  }

  html += '<footer class="batch__foot">';
  html +=
    '<textarea class="raw" hidden>' + escapeHtml(batchToText(batch)) + "</textarea>";
  html += '<button type="button" class="copy">Copy all as text</button>';
  if (photoCount) {
    html +=
      '<button type="button" class="all">Download all ' + photoCount + " photos</button>";
  }
  html +=
    '<form method="POST" action="/api/edits/delete" onsubmit="return confirm(\'Delete this batch?\')">' +
    '<input type="hidden" name="key" value="' +
    escapeHtml(key) +
    '"><button type="submit" class="del">Delete</button></form>';
  html += "</footer></article>";
  return html;
}

function renderReviewPage(batches, note) {
  const style = [
    "*{box-sizing:border-box}",
    "body{margin:0;padding:32px 20px 64px;background:#0f1115;color:#e6e9ef;",
    "font:15px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
    ".wrap{max-width:900px;margin:0 auto}",
    "h1{font-size:20px;margin:0 0 4px}",
    ".sub{color:#8b93a1;margin:0 0 28px}",
    ".batch{border:1px solid #2a2f3a;border-radius:3px;margin:0 0 28px;overflow:hidden}",
    ".batch__head{background:#161a21;padding:14px 18px;border-bottom:1px solid #2a2f3a}",
    ".batch__head h2{font-size:15px;margin:0}",
    ".meta{color:#8b93a1;margin:4px 0 0;font-size:13px}",
    "h3{font-size:14px;margin:20px 18px 8px;color:#7c5cff}",
    ".edit{padding:10px 18px;border-top:1px solid #21262f}",
    ".where{color:#8b93a1;font-size:12px;margin:0 0 8px}",
    ".sel{color:#5c6472}",
    ".old,.new{margin:0 0 6px;padding:8px 10px;white-space:pre-wrap;word-break:break-word;border-radius:2px}",
    ".old{background:#2a1a1d;color:#ffb4b4}",
    ".new{background:#12241d;color:#8ce0b8}",
    ".old span,.new span{display:inline-block;width:44px;opacity:.55;user-select:none}",
    ".gone{margin:0 0 6px;padding:8px 10px;border-radius:2px;background:#2a1a1d;color:#ffb4b4}",
    ".gone b{color:#ff8f8f}",
    ".was{margin:0 0 6px;font-size:13px;color:#8b93a1;word-break:break-word}",
    ".batch__foot{display:flex;gap:10px;padding:14px 18px;background:#161a21;",
    "border-top:1px solid #2a2f3a;flex-wrap:wrap}",
    "button{font:inherit;padding:9px 16px;border:0;border-radius:2px;cursor:pointer}",
    ".copy{background:#7c5cff;color:#fff}",
    ".all{background:#00a3c4;color:#fff}",
    ".del{background:transparent;color:#8b93a1;text-decoration:underline}",
    "form{margin:0}",
    ".photo{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}",
    ".photo img{width:200px;height:134px;object-fit:cover;border-radius:2px;",
    "background:#0b0d11;flex:none}",
    ".photo__meta{min-width:0;flex:1}",
    ".photo__meta p{margin:0 0 6px;font-size:13px;word-break:break-word}",
    ".muted{color:#5c6472}",
    ".flag{color:#ffb020}",
    ".dl{color:#7c5cff}",
    ".empty{color:#8b93a1;border:1px dashed #2a2f3a;padding:40px;text-align:center;border-radius:3px}",
    ".note{background:#2a1a1d;color:#ffb4b4;padding:12px 16px;border-radius:3px;margin:0 0 24px}",
  ].join("");

  let body = '<div class="wrap"><h1>Client edits</h1>';
  body +=
    '<p class="sub">Proposals only — nothing here has changed the site. ' +
    "Apply what you want by hand, then deploy.</p>";

  if (note) body += '<p class="note">' + escapeHtml(note) + "</p>";

  body += batches.length
    ? batches.map((b) => renderBatch(b.key, b.batch)).join("")
    : '<p class="empty">Nothing yet.</p>';

  body += "</div>";

  /* One small inline script, for the copy buttons. This page is generated here
     and is not site content, so it is bound by none of the site's rules — no
     partials, no theme tokens, no colour check (tools/check-colours.js does not
     scan deploy/). */
  const script =
    "document.addEventListener('click',function(e){" +
    "if(e.target.classList.contains('copy')){" +
    "var t=e.target.closest('.batch').querySelector('.raw');" +
    "navigator.clipboard.writeText(t.value).then(function(){" +
    "var o=e.target.textContent;e.target.textContent='Copied';" +
    "setTimeout(function(){e.target.textContent=o},1200);});return;}" +
    // Download all: click each link in turn. The browser asks once to allow
    // multiple downloads and then saves them under their real names.
    "if(e.target.classList.contains('all')){" +
    "var links=e.target.closest('.batch').querySelectorAll('.dl');" +
    "links.forEach(function(a,i){setTimeout(function(){a.click()},i*350)});" +
    "var o=e.target.textContent;e.target.textContent='Downloading…';" +
    "setTimeout(function(){e.target.textContent=o},links.length*350+800);}});";

  return (
    "<!DOCTYPE html><html lang=en><head><meta charset=utf-8>" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Client edits — FIFL</title><style>" +
    style +
    "</style></head><body>" +
    body +
    "<script>" +
    script +
    "</script></body></html>"
  );
}

// ---------------------------------------------------------------------------
// edit-mode endpoints
// ---------------------------------------------------------------------------

function noStore(response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function json(data, status = 200) {
  return noStore(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  );
}

function html(markup, status = 200) {
  return noStore(
    new Response(markup, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  );
}

/** Edit mode needs KV. The SITE does not — never let this take the site down. */
function requireStore(env) {
  return env.EDITS
    ? null
    : json(
        {
          error:
            "The EDITS KV namespace is not bound to this Pages project. " +
            "See deploy/README.md.",
        },
        503
      );
}

/**
 * Receive one photo, immediately, as a raw body.
 *
 * Raw rather than multipart because there is nothing else in the request —
 * parsing a multipart envelope to extract a single file would be work with no
 * payoff. The filename rides in a header.
 *
 * The response carries the URL the editor paints with, so a successful upload
 * doubles as proof the file is really readable back out.
 *
 * ---------------------------------------------------------------------------
 * WHY KV AND NOT R2
 * ---------------------------------------------------------------------------
 * R2 is the purpose-built place for blobs and this was written against it
 * first. It is not used because switching R2 on requires a payment method on
 * the Cloudflare account, and this site does not need one: a processed photo is
 * ~0.5 MB against KV's 25 MB per-value ceiling, and one upload is one write
 * against a 1,000/day free allowance.
 *
 * Photos share the EDITS namespace under a "photo:" prefix. Nothing collides,
 * because the review page lists batches with `list({ prefix: "edit:" })` and
 * never sees them.
 *
 * **Move to R2 if the gallery ever holds hundreds of photos**, or if a single
 * image could approach 25 MB. That is a change to these two functions and one
 * binding — deliberately not spread any wider.
 */
async function receiveUpload(request, env) {
  const missing = requireStore(env);
  if (missing) return missing;

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_PHOTO_BYTES) return json({ error: "Photo too large." }, 413);

  const type = request.headers.get("Content-Type") || "application/octet-stream";
  if (!type.startsWith("image/") && type !== "application/octet-stream") {
    return json({ error: "Not an image." }, 400);
  }

  // Keep his readable name for the download, but never let it decide the key.
  const raw = request.headers.get("X-Photo-Name") || "photo";
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  const key = "photo:" + crypto.randomUUID() + "-" + safe;

  /* Buffered rather than streamed: KV needs the length up front, and 12 MB is
     well inside a worker's memory budget. */
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return json({ error: "Photo too large." }, 413);
  }

  await env.EDITS.put(key, bytes, { metadata: { contentType: type, name: safe } });

  return json({ ok: true, key, url: "/api/photo?key=" + encodeURIComponent(key) });
}

/** Serve a stored photo back — for the editor's preview and for your download. */
async function servePhoto(request, env, url) {
  const missing = requireStore(env);
  if (missing) return missing;

  const key = url.searchParams.get("key") || "";
  // Also stops a crafted key reading a batch back out as if it were an image.
  if (!key.startsWith("photo:")) return json({ error: "Not found." }, 404);

  const found = await env.EDITS.getWithMetadata(key, { type: "arrayBuffer" });
  if (!found || !found.value) return json({ error: "Not found." }, 404);

  return new Response(found.value, {
    headers: {
      "Content-Type": (found.metadata && found.metadata.contentType) || "image/webp",
      // Private by definition — it sits behind the password and must not be
      // cached by anything between here and the browser.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function receiveBatch(request, env, ctx) {
  const missing = requireStore(env);
  if (missing) return missing;

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return json({ error: "Too large." }, 413);

  let batch;
  try {
    batch = await request.json();
  } catch {
    return json({ error: "Malformed JSON." }, 400);
  }

  if (!batch || !Array.isArray(batch.edits) || batch.edits.length === 0) {
    return json({ error: "No edits in payload." }, 400);
  }

  /* Keyed by timestamp so a plain KV list() comes back in chronological order;
     the random tail only breaks ties between two submissions in the same
     millisecond. */
  const submitted = new Date().toISOString();
  const key = "edit:" + submitted + ":" + crypto.randomUUID().slice(0, 8);
  const record = { submitted, userAgent: batch.userAgent || "", edits: batch.edits };

  const pages = [...new Set(batch.edits.map((e) => e.page))];

  await env.EDITS.put(key, JSON.stringify(record), {
    // Read back by list() without a get per batch, for the summary line.
    metadata: { submitted, count: batch.edits.length, pages },
  });

  /* After the write, and never in front of it. waitUntil so a slow mail API
     cannot keep him staring at a spinner — the batch is already safe. */
  ctx.waitUntil(
    notify(
      env,
      "FIFL site — " + batch.edits.length + " edit(s) from the client",
      batchToText(record) + "\n\nReview: https://fifl-site.pages.dev/edits\n"
    )
  );

  return json({ ok: true, key, count: batch.edits.length });
}

async function deleteBatch(request, env) {
  const missing = requireStore(env);
  if (missing) return missing;

  const form = await request.formData();
  const key = form.get("key");
  if (typeof key === "string" && key.startsWith("edit:")) await env.EDITS.delete(key);

  return noStore(new Response(null, { status: 303, headers: { Location: "/edits" } }));
}

async function reviewPage(env) {
  if (!env.EDITS) {
    return html(
      renderReviewPage(
        [],
        "The EDITS KV namespace is not bound to this Pages project, so nothing " +
          "can be received or shown yet. See deploy/README.md."
      )
    );
  }

  const listed = await env.EDITS.list({ prefix: "edit:", limit: 1000 });
  const newestFirst = listed.keys.slice().reverse().slice(0, REVIEW_LIMIT);

  const batches = [];
  for (const entry of newestFirst) {
    const value = await env.EDITS.get(entry.name, "json");
    if (value) batches.push({ key: entry.name, batch: value });
  }

  return html(renderReviewPage(batches, null));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const password = env.PREVIEW_PASSWORD;

    const isEditRoute = PRIVATE_PATHS.some(
      (p) => url.pathname === p || url.pathname.startsWith(p + "/")
    );

    /* The gate covers the whole site today and only the edit routes after
       launch. Both cases fail closed — but note carefully what "closed" means
       on each side of the switch:

         GATE_WHOLE_SITE  true  -> a missing secret takes the SITE down. Correct
                                   now: the risk being guarded against is the
                                   unfinished site becoming public by accident.
         GATE_WHOLE_SITE  false -> a missing secret takes EDIT MODE down and
                                   leaves the public site serving. Correct then:
                                   being public is the goal, and taking a live
                                   company website offline over an unset
                                   notification variable would be the bug.

       That inversion is the whole reason this file survives launch. Do not
       "simplify" it back into one blanket check. */
    const needsAuth = GATE_WHOLE_SITE || isEditRoute;

    if (needsAuth) {
      if (!password) {
        return noStore(
          new Response(
            GATE_WHOLE_SITE
              ? "503 — preview password is not configured on this deployment."
              : "503 — edit mode is not configured on this deployment.",
            { status: 503 }
          )
        );
      }
      if (!isAuthorised(request, env.PREVIEW_USER || DEFAULT_USER, password)) {
        return challenge();
      }
    }

    // --- edit-mode endpoints, past the gate -------------------------------
    if (isEditRoute) {
      if (url.pathname === "/edits" && request.method === "GET") {
        return reviewPage(env);
      }
      if (url.pathname === "/api/edits" && request.method === "POST") {
        return receiveBatch(request, env, ctx);
      }
      if (url.pathname === "/api/edits/delete" && request.method === "POST") {
        return deleteBatch(request, env);
      }
      if (url.pathname === "/api/upload" && request.method === "POST") {
        return receiveUpload(request, env);
      }
      if (url.pathname === "/api/photo" && request.method === "GET") {
        return servePhoto(request, env, url);
      }
      return json({ error: "Not found." }, 404);
    }

    // --- the site ----------------------------------------------------------
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");

    /* ?edit turns any page into an editable one by splicing in js/edit.js at
       the edge. Doing it here rather than in the markup is what keeps every
       page in the repo free of any reference to the editor — the public site
       neither loads it nor mentions it.

       Guarded on HTML and 200 so it cannot append a script tag to a stylesheet
       or to the 404 page. */
    const wantsEditor =
      url.searchParams.has("edit") &&
      response.status === 200 &&
      (response.headers.get("Content-Type") || "").includes("text/html");

    if (wantsEditor) {
      response.headers.set("Cache-Control", "no-store");
      return new HTMLRewriter()
        .on("body", {
          element(body) {
            body.append('<script src="/js/edit.js" defer></script>', { html: true });
          },
        })
        .transform(response);
    }

    return response;
  },
};
