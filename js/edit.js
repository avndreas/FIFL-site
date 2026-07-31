/* ============================================================================
   edit.js — click-to-edit mode for the password-gated preview
   ----------------------------------------------------------------------------
   Loaded ONLY when a page is requested with ?edit, and only by deploy/_worker.js,
   which splices the <script> tag in at the edge. No page in this repo references
   this file, so the public site never fetches it and the "almost no JavaScript"
   promise in SITE-SPEC § 2 is untouched.

   What it is for: the client edits his own copy by clicking the words on the
   real page, and adds, replaces or removes photos by clicking a picture box,
   rather than describing any of it in an email. Nothing he does reaches a file.
   Every change is a PROPOSAL — see § 11 of SITE-SPEC.md.

   ---------------------------------------------------------------------------
   THE ONE DESIGN RULE: NO ANNOTATIONS IN THE MARKUP.
   ---------------------------------------------------------------------------
   There is deliberately no data-edit="hero.subheader" scheme here, and adding
   one later would be a regression. Editable text and image slots alike are
   discovered by walking the DOM at load. The layout of this site is expected to
   change often, and a keyed scheme makes every restructure a two-part job —
   move the markup, carry the keys — where forgetting the second half silently
   makes an element uneditable with nothing on screen to say so.

   Runtime discovery has no such failure mode. Rewrite a page from scratch and
   the editor follows it on the next load.

   This is only affordable because edits are applied BY HAND. Nothing here has
   to survive a machine merge, so nothing needs a stable machine-readable id.

   ---------------------------------------------------------------------------
   WHERE THINGS GO
   ---------------------------------------------------------------------------
       typing        ->  localStorage, on HIS machine only
       a photo       ->  KV immediately (see uploadPhoto), metadata to localStorage
       a removal     ->  localStorage. It is an instruction, not a file.
       "Send"        ->  POST /api/edits  ->  KV  ->  /edits (you)

   Text never leaves the browser until Send. A PHOTO does — it uploads the
   moment he picks it, because a 500 KB image cannot live in localStorage and
   because failing at the moment he acts is far kinder than failing in a batch
   ten minutes later. What Send transmits for a photo is only its metadata.

   Crops are NOT baked. The full frame is uploaded and his framing travels as an
   object-position percentage, so you keep every pixel and can re-crop for a
   layout that does not exist yet. See SITE-SPEC § 11.
   ========================================================================== */
(function () {
  "use strict";

  /* Belt and braces. The worker only injects this script when ?edit is on the
     URL, so this should always pass — but a stray <script> tag or a cached copy
     must never turn the live site editable. */
  if (!/(^|[?&])edit(=|&|$)/.test(location.search)) return;

  var STORAGE_KEY = "fifl.edits.v1";
  var MARK = "data-fifl-edit"; // stamped on discovered text elements
  var SLOT = "data-fifl-slot"; // stamped on discovered image slots
  var BAR_HEIGHT = 64;

  /* Photos are uploaded generously oversized and cropped by YOU, not here.
     2400px is roughly ten times smaller than a camera original while still
     leaving ~800px after cropping to a third of the frame — more than any slot
     in a 1120px column needs. Raise it here if that ever stops being true. */
  var MAX_EDGE = 2400;
  var WEBP_QUALITY = 0.85;

  /* Tags whose contents are copy a client may reasonably want to rewrite.
     Deliberately excludes <div> and <a>: a div is a layout box (every
     .placeholder on the site is one), and an <a> is a control whose text is
     usually design rather than content. */
  var EDITABLE_TAGS = /^(H1|H2|H3|H4|H5|H6|P|LI|FIGCAPTION|BLOCKQUOTE|DT|DD|TD|TH)$/;

  // -------------------------------------------------------------------------
  // storage
  // -------------------------------------------------------------------------

  /* One flat map, keyed by page + kind + selector. `kind` is "text", "photo" or
     "remove"; everything that treats them differently branches on it explicitly.

     Because the kind is part of the key, one slot can hold a "photo" record and
     a "remove" record without them colliding — though in practice it never
     holds both, because each one deletes the other (see attachSlot). */
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {}; // corrupt or unavailable — start clean rather than throw
    }
  }

  function save(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      /* Quota or private browsing. The page still works; the change just will
         not survive a reload. Photos are already safe on the server by this
         point, so this can never lose an upload. */
    }
  }

  // -------------------------------------------------------------------------
  // text in, text out
  // -------------------------------------------------------------------------

  /* <br> is real copy on this site — the hero title's line break is deliberate
     (index.html) — so it survives a round trip as "\n". Everything else is
     stripped: an element only becomes editable if <br> is the sole markup it
     contains (see isEditable), so there is never anything else to lose. */
  function getText(el) {
    var html = el.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
    var decoder = document.createElement("textarea");
    decoder.innerHTML = html; // decodes &amp; &copy; &#8212; etc.
    return decoder.value
      .replace(/[ \t\r]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim();
  }

  /* Built from text nodes, never innerHTML, so nothing he types can be parsed
     as markup. */
  function setText(el, text) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var lines = String(text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (i) el.appendChild(document.createElement("br"));
      el.appendChild(document.createTextNode(lines[i]));
    }
  }

  // -------------------------------------------------------------------------
  // locating an element, for a human
  // -------------------------------------------------------------------------

  function tagAndClasses(el) {
    var out = el.tagName.toLowerCase();
    for (var i = 0; i < el.classList.length; i++) {
      out += "." + (window.CSS && CSS.escape ? CSS.escape(el.classList[i]) : el.classList[i]);
    }
    return out;
  }

  /* The shortest selector that matches this element and nothing else. It is a
     convenience for you (it says roughly where on the page to look) and a
     re-find hint for the next page load — NOT an identity anything depends on.
     reconcile() falls back to matching on the previous text when a layout
     change has invalidated it. */
  function selectorFor(el) {
    var own = tagAndClasses(el);
    if (document.querySelectorAll(own).length === 1) return own;

    var sel = own;
    for (var p = el.parentElement; p && p.tagName !== "BODY"; p = p.parentElement) {
      if (p.id) return "#" + p.id + " " + sel;
      sel = tagAndClasses(p) + " > " + sel;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    // Identical siblings (the clients strip, the Services bands) — pin by index.
    var same = el.parentElement.querySelectorAll(":scope > " + own);
    var n = Array.prototype.indexOf.call(same, el) + 1;
    return tagAndClasses(el.parentElement) + " > " + own + ":nth-of-type(" + n + ")";
  }

  /* Nearest heading above the element, so the review page can say "Industrial
     Sewing" instead of only "section:nth-of-type(4) > p". Purely orientation. */
  function sectionFor(el) {
    var scope = el.closest("section, article, main") || document.body;
    var heads = scope.querySelectorAll("h1, h2, h3");
    var best = "";
    for (var i = 0; i < heads.length; i++) {
      if (heads[i] === el) break;
      if (heads[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
        best = getText(heads[i]);
      }
    }
    return best;
  }

  function pageName() {
    var p = location.pathname;
    if (p.charAt(p.length - 1) === "/") p += "index.html";
    p = p.slice(p.lastIndexOf("/") + 1);
    // Cloudflare Pages serves about.html at /about — put the extension back so
    // the review page names a file you can actually open.
    if (p.indexOf(".") === -1) p += ".html";
    return p;
  }

  // -------------------------------------------------------------------------
  // discovery — text
  // -------------------------------------------------------------------------

  /* Conservative on purpose: an element qualifies only if <br> is the only
     markup inside it. A paragraph containing an <a> or a <span> is skipped
     rather than offered and then flattened on save. That trades some coverage
     for the guarantee that editing can never destroy markup — and today it
     costs nothing, because every piece of copy inside <main> on this site is a
     plain-text leaf. If that changes and something important stops being
     editable, widen this deliberately; do not reach for innerHTML. */
  function isEditable(el) {
    if (!EDITABLE_TAGS.test(el.tagName)) return false;
    if (el.isContentEditable) return false;
    for (var i = 0; i < el.children.length; i++) {
      if (el.children[i].tagName !== "BR") return false;
    }
    return getText(el).length > 0;
  }

  function mainEl() {
    return document.getElementById("main") || document.querySelector("main");
  }

  function discoverText() {
    /* <main> only. That excludes the header and footer for free — and they must
       be excluded, because they are generated from partials/ and overwritten by
       the next `npm run sync` (SITE-SPEC § 4). */
    var main = mainEl();
    if (!main) return [];
    var out = [];
    var all = main.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) if (isEditable(all[i])) out.push(all[i]);
    return out;
  }

  // -------------------------------------------------------------------------
  // discovery — image slots
  // -------------------------------------------------------------------------

  /* Any <img>, plus any .placeholder. The class is the site's OWN convention
     for "a picture goes here" (SITE-SPEC § 5), which is why targeting it needs
     no annotation and survives a restyle: rename the component and you would
     rename it here too, in one place. */
  function discoverSlots() {
    var main = mainEl();
    if (!main) return [];
    var slots = Array.prototype.slice.call(main.querySelectorAll("img, .placeholder"));
    for (var i = 0; i < slots.length; i++) snapshotSlot(slots[i]);
    return slots;
  }

  /* What a slot is showing RIGHT NOW: an <img>'s src, or the url() of a CSS
     background for anything else. Returns "" for a slot with no picture in it —
     note that .placeholder's diagonal hatch is a gradient, not a url(), so an
     empty placeholder correctly reads as empty. */
  function currentSrc(el) {
    if (el.tagName === "IMG") return el.getAttribute("src") || "";
    var bg = window.getComputedStyle(el).backgroundImage;
    var m = bg && bg !== "none" ? bg.match(/url\(["']?([^"')]+)["']?\)/) : null;
    return m ? m[1] : "";
  }

  /* Record what the PAGE has in this slot, before anything in here paints over
     it. That one string is what makes removal possible at all: it is how we
     tell "a photo the site actually ships" from "a photo he added a moment ago"
     — the two need opposite treatment — and it is what a slot is restored to
     when he changes his mind.

     Must run before reconcile(), which is why it lives in discovery. Read after
     a paint it would return the paint. */
  function snapshotSlot(el) {
    if (!el.hasAttribute("data-fifl-original")) {
      el.setAttribute("data-fifl-original", currentSrc(el));
    }
  }

  function originalOf(el) {
    return el.getAttribute("data-fifl-original") || "";
  }

  /* A filename stem that tells you where the photo belongs when it lands in
     your Downloads folder. Prefers a meaningful class (hero__image ->
     "hero-image"); falls back to the container plus an ordinal for grids of
     identical tiles (the gallery -> "gallery-01"). */
  function slotStem(el, allSlots) {
    var meaningful = "";
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (c.indexOf("placeholder") === 0) continue;
      meaningful = c;
    }
    if (!meaningful && el.parentElement && el.parentElement.classList.length) {
      meaningful = el.parentElement.classList[0].replace(/-grid$/, "");
    }
    if (!meaningful) meaningful = el.tagName.toLowerCase();

    var stem = meaningful.replace(/__|--/g, "-").replace(/[^a-z0-9-]/gi, "").toLowerCase();

    // Disambiguate only when it is actually ambiguous.
    var siblings = allSlots.filter(function (other) {
      return slotBase(other) === meaningful;
    });
    if (siblings.length > 1) {
      var n = siblings.indexOf(el) + 1;
      stem += "-" + (n < 10 ? "0" + n : n);
    }
    return pageName().replace(/\.html?$/, "") + "-" + stem;
  }

  function slotBase(el) {
    var meaningful = "";
    for (var i = 0; i < el.classList.length; i++) {
      if (el.classList[i].indexOf("placeholder") === 0) continue;
      meaningful = el.classList[i];
    }
    if (!meaningful && el.parentElement && el.parentElement.classList.length) {
      meaningful = el.parentElement.classList[0].replace(/-grid$/, "");
    }
    return meaningful || el.tagName.toLowerCase();
  }

  // -------------------------------------------------------------------------
  // image processing
  // -------------------------------------------------------------------------

  /* Decode, downscale, re-encode to WebP. The re-encode is doing three useful
     things beyond shrinking the file: it strips EXIF (phone photos carry GPS,
     and publishing the shop floor's coordinates is a small but real leak), it
     bakes in the orientation flag so the image is never sideways, and it gives
     us the exact pixel dimensions to write into width/height later.

     Resolves to {blob, width, height, raw:false}, or {blob:file, raw:true} when
     the browser cannot decode the file at all — which in practice means HEIC.
     In that case the ORIGINAL is uploaded untouched: he is never blocked by a
     format, and you get a file you can convert rather than a failure message. */
  function processImage(file) {
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .then(function (bitmap) {
        var scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        var w = Math.round(bitmap.width * scale);
        var h = Math.round(bitmap.height * scale);

        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
        bitmap.close && bitmap.close();

        return new Promise(function (resolve) {
          canvas.toBlob(
            function (blob) {
              resolve(
                blob
                  ? { blob: blob, width: w, height: h, raw: false }
                  : { blob: file, width: 0, height: 0, raw: true }
              );
            },
            "image/webp",
            WEBP_QUALITY
          );
        });
      })
      .catch(function () {
        return { blob: file, width: 0, height: 0, raw: true };
      });
  }

  /* Uploads immediately rather than on Send. A 500 KB image cannot live in
     localStorage, and a failure at the moment he picks the file is far easier
     to understand than one buried in a batch ten minutes later.

     A photo he later discards or removes leaves an orphan object in KV. That is
     the accepted cost of this ordering — it is invisible (only photos named by a
     submitted batch are ever shown at /edits) and it is a few hundred KB. */
  function uploadPhoto(name, type, blob) {
    return fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": type, "X-Photo-Name": name },
      body: blob,
    }).then(function (res) {
      if (res.ok) return res.json();

      /* Carry the server's reason back to the caller. Collapsing every failure
         into one message once cost an afternoon: photo storage was not
         configured at all, the worker said so plainly in its 503, and the
         editor replaced that with "try again" — advice that could never work
         and hid the actual cause. */
      var err = new Error("HTTP " + res.status);
      err.status = res.status;
      return res.json().then(
        function (body) {
          if (body && body.error) err.detail = body.error;
          throw err;
        },
        function () {
          throw err;
        }
      );
    });
  }

  // -------------------------------------------------------------------------
  // showing a photo in its slot
  // -------------------------------------------------------------------------

  /* An <img> crops with object-*; anything else (every .placeholder today) with
     background-*. Both express the same thing, and both are what you would
     write in CSS afterwards — nothing here bakes a crop into pixels. */
  function paintSlot(el, url, position) {
    if (el.tagName === "IMG") {
      el.src = url;
      el.style.objectFit = "cover";
      el.style.objectPosition = position;
    } else {
      el.style.backgroundImage = 'url("' + url + '")';
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = position;
      el.style.color = "transparent"; // hide the "Placeholder image" label
    }
    el.removeAttribute("data-fifl-gone");
    el.setAttribute("data-fifl-changed", "");
  }

  /* Put the slot back exactly as the page had it. Every property paintSlot and
     blankSlot can set is cleared here, and the <img> gets its own src back from
     the snapshot — so undoing an upload reveals whatever was underneath rather
     than leaving his photo stranded. */
  function unpaintSlot(el) {
    var original = originalOf(el);
    if (el.tagName === "IMG") {
      el.style.objectFit = "";
      el.style.objectPosition = "";
      if (original) el.setAttribute("src", original);
    } else {
      el.style.backgroundImage = "";
      el.style.backgroundSize = "";
      el.style.backgroundPosition = "";
      el.style.color = "";
    }
    el.removeAttribute("data-fifl-changed");
    el.removeAttribute("data-fifl-gone");
  }

  /* Show a slot as it would look with the photo taken out: an empty picture box.
     This is the PREVIEW of a proposal, not a change — the file is untouched and
     the record can be undone with one click.

     For anything with a CSS background, clearing it inline is enough. An <img>
     cannot simply be emptied — remove the src and the box collapses, taking the
     layout with it — so it is pointed at a generated SVG of the same intrinsic
     size instead. The element, its attributes and its CSS are all left alone,
     which is the only way this can be safe on a page whose styling changes. */
  function blankSlot(el) {
    if (el.tagName === "IMG") {
      el.style.objectFit = "";
      el.style.objectPosition = "";
      el.setAttribute("src", emptyBox(el));
    } else {
      el.style.backgroundImage = "none";
      el.style.color = "";
    }
    el.removeAttribute("data-fifl-changed");
    el.setAttribute("data-fifl-gone", "");
  }

  /* A hatched grey box as a data: URI, sized from the <img>'s own width/height
     attributes so the intrinsic ratio — and therefore the layout — is unchanged
     (SITE-SPEC § 5). Deliberately echoes the diagonal hatch of .placeholder in
     components.css, because that is exactly what it stands for. */
  function emptyBox(el) {
    var box = el.getBoundingClientRect();
    var w = Number(el.getAttribute("width")) || Math.round(box.width) || 400;
    var h = Number(el.getAttribute("height")) || Math.round(box.height) || 300;
    var step = Math.max(6, Math.round(Math.max(w, h) / 60));
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<defs><pattern id="h" width="' + step * 2 + '" height="' + step * 2 + '" ' +
      'patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
      '<rect width="' + step * 2 + '" height="' + step * 2 + '" fill="#f2f3f6"/>' +
      '<rect width="' + step + '" height="' + step * 2 + '" fill="#e3e6ec"/>' +
      "</pattern></defs>" +
      '<rect width="100%" height="100%" fill="url(#h)"/></svg>';
    // encodeURIComponent, not a raw string: the "#" of url(#h) would otherwise
    // end the data URI and the pattern would silently not apply.
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /* Drag inside a filled slot to reposition; release without moving to open the
     slot menu. Repositioning only ever produces a pair of percentages — no zoom,
     no crop box, nothing destructive.

     The record is looked up through getRec() on every gesture rather than
     captured once. That is what lets a slot be filled, emptied and refilled
     without ever re-binding these listeners — and it means a deleted record can
     never be resurrected by a stray drag on a slot that no longer has a photo. */
  function makeDraggable(el, getRec, store, onChange, onTap) {
    var rec = null;
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var startPos = [50, 50];

    function parsePos(r) {
      var m = String(r.position || "50% 50%").match(/(-?[\d.]+)%\s+(-?[\d.]+)%/);
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
    }

    el.addEventListener("pointerdown", function (ev) {
      rec = getRec();
      // No photo of his in this slot: nothing to slide, so leave the gesture
      // alone and let the ordinary click handler open the menu or the picker.
      if (!rec) return;
      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      startPos = parsePos(rec);
      el.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });

    el.addEventListener("pointermove", function (ev) {
      if (!dragging || !rec) return;
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      // Under a few pixels this is still a tap. Without the threshold, the hand
      // tremor in any real click would nudge the crop and mark it unsent.
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      var box = el.getBoundingClientRect();
      // Inverted: dragging the image right should reveal what is on its left.
      var x = startPos[0] - (dx / box.width) * 100;
      var y = startPos[1] - (dy / box.height) * 100;
      x = Math.max(0, Math.min(100, x));
      y = Math.max(0, Math.min(100, y));
      rec.position = Math.round(x) + "% " + Math.round(y) + "%";
      paintSlot(el, rec.url, rec.position);
    });

    el.addEventListener("pointerup", function () {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        onTap();
        return;
      }
      if (rec) {
        rec.sent = false; // repositioned since the last submission
        save(store);
        onChange();
      }
    });

    // A cancelled gesture is not a tap and not a drag. Drop it silently.
    el.addEventListener("pointercancel", function () {
      dragging = false;
    });
  }

  // -------------------------------------------------------------------------
  // reconcile stored records against the page as it is now
  // -------------------------------------------------------------------------

  /* Runs once per page load, and is what keeps his browser tidy without either
     of you doing anything. Three cases, for both kinds of record:

       already applied  ->  drop it. Nothing left to propose.
       not yet applied  ->  re-draw it, so his work still shows.
       neither          ->  the source moved on underneath him. Kept, NOT
                            applied, and reported in the toolbar as stale.

     The third case is the honest answer to "the layout changed". His proposal
     is neither silently discarded nor silently pasted over your newer copy. */
  function reconcile(store, elements) {
    var page = pageName();
    var stale = 0;
    var dirty = false;

    for (var key in store) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
      var rec = store[key];
      if (rec.page !== page) continue; // another page's record; leave it alone

      var el = null;
      try {
        el = document.querySelector(rec.selector);
      } catch (e) {
        el = null; // selector no longer parses
      }

      if (rec.kind === "remove") {
        /* A RETRACTION ("ignore the photo I sent for that slot") is a statement
           about a batch you already have, not about the page — the page is
           already showing what he wants. There is nothing to check it against
           and nothing to redraw, so it simply lives until it has been sent. */
        if (!rec.onSite) {
          if (rec.sent) {
            delete store[key];
            dirty = true;
          }
          continue;
        }

        /* A removal of a photo that IS in the markup follows the same three
           cases as everything else, checked against the file it named. Applied
           means the slot has stopped showing it — either you swapped the src,
           or you put the .placeholder back and the selector stopped matching at
           all. Both mean the proposal has been honoured; drop it.

           Unlike a photo record this does not distinguish sent from unsent. A
           removal whose target has already gone has got what it asked for, and
           re-reporting it as "no longer matches the page" would be noise. */
        if (!el || currentSrc(el) !== rec.was) {
          delete store[key];
          dirty = true;
          continue;
        }
        rec.stale = false;
        blankSlot(el);
        continue;
      }

      if (rec.kind === "photo") {
        /* A slot that has vanished after the batch was sent almost always means
           you placed the photo and replaced the placeholder with a real <img>.
           Drop it. Unsent, the same disappearance is a layout change and the
           record is kept so it can still be reported. The FILE is safe in KV
           either way — this only decides what his browser keeps showing. */
        if (!el) {
          if (rec.sent) {
            delete store[key];
          } else {
            rec.stale = true;
            stale++;
          }
          dirty = true;
          continue;
        }
        rec.stale = false;
        paintSlot(el, rec.url, rec.position || "50% 50%");
        continue;
      }

      // --- text ---
      if (!el || !isEditable(el)) {
        el = null;
        for (var i = 0; i < elements.length; i++) {
          if (getText(elements[i]) === rec.before) {
            el = elements[i];
            break;
          }
        }
      }

      if (!el) {
        rec.stale = true;
        stale++;
        dirty = true;
        continue;
      }

      var live = getText(el);
      if (live === rec.after) {
        delete store[key]; // landed on the real site — nothing left to propose
        dirty = true;
      } else if (live === rec.before) {
        setText(el, rec.after);
        el.setAttribute("data-fifl-changed", "");
        rec.stale = false;
      } else {
        rec.stale = true;
        stale++;
        dirty = true;
      }
    }

    if (dirty) save(store);
    return stale;
  }

  // -------------------------------------------------------------------------
  // making text editable
  // -------------------------------------------------------------------------

  /* Chrome, Safari and Firefox 136+ support plaintext-only, which is what stops
     a paste out of Word arriving with a payload of inline styles. Where it is
     unsupported we fall back to plain contenteditable plus a paste handler that
     strips to text — same outcome, one more moving part. */
  var EDIT_MODE = (function () {
    var probe = document.createElement("div");
    probe.setAttribute("contenteditable", "plaintext-only");
    return probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true";
  })();

  function attachText(el, store, onChange) {
    el.setAttribute(MARK, "");
    el.setAttribute("contenteditable", EDIT_MODE);
    el.setAttribute("spellcheck", "true");

    var key = pageName() + "|text|" + selectorFor(el);
    var original = store[key] ? store[key].before : getText(el);

    el.addEventListener("focus", function () {
      if (!store[key]) original = getText(el);
    });

    if (EDIT_MODE === "true") {
      el.addEventListener("paste", function (ev) {
        ev.preventDefault();
        var text = (ev.clipboardData || window.clipboardData).getData("text");
        document.execCommand("insertText", false, text);
      });
    }

    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        el.blur();
        return;
      }
      /* Enter inserts a line break rather than ending the block. Left to itself,
         a browser in the fallback mode splits the <p> in two — producing markup
         the "leaf elements only" rule in isEditable() cannot represent, and
         losing half his sentence out of the record. insertLineBreak behaves the
         same way in both modes, so there is one behaviour to reason about. */
      if (ev.key === "Enter") {
        ev.preventDefault();
        document.execCommand("insertLineBreak");
      }
    });

    el.addEventListener("blur", function () {
      var now = getText(el);

      if (now === original) {
        if (store[key]) {
          delete store[key];
          el.removeAttribute("data-fifl-changed");
        }
      } else if (now === "") {
        // Emptying a block is almost always a slip, and an empty <p> is not a
        // proposal anyone can act on. Put it back.
        setText(el, store[key] ? store[key].after : original);
      } else {
        store[key] = {
          kind: "text",
          page: pageName(),
          selector: selectorFor(el),
          section: sectionFor(el),
          tag: tagAndClasses(el),
          before: original,
          after: now,
          ts: new Date().toISOString(),
          // Always unsent: touching it again after a submission means this
          // wording has not reached you, whatever the previous record said.
          sent: false,
          stale: false,
        };
        el.setAttribute("data-fifl-changed", "");
      }

      save(store);
      onChange();
    });
  }

  // -------------------------------------------------------------------------
  // making a slot accept a photo
  // -------------------------------------------------------------------------

  function attachSlot(el, allSlots, store, onChange, ui) {
    el.setAttribute(SLOT, "");

    var sel = selectorFor(el);
    var key = pageName() + "|photo|" + sel;
    var goneKey = pageName() + "|remove|" + sel;
    var stem = slotStem(el, allSlots);

    /** His photo in this slot, if there is one. */
    function photo() {
      return store[key] && store[key].file ? store[key] : null;
    }

    /** A pending removal for this slot, if there is one. */
    function removal() {
      return store[goneKey] || null;
    }

    /* Click opens a file picker as well as accepting a drop. Drag-and-drop is
       not obvious to everyone and is impossible on a tablet; a click that opens
       the familiar file dialog is the one interaction nobody has to be taught. */
    var picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.style.display = "none";
    document.body.appendChild(picker);

    picker.addEventListener("change", function () {
      if (picker.files && picker.files[0]) take(picker.files[0]);
      picker.value = "";
    });

    /* ONE rule for what a click does, so there is one thing to explain:

         empty box   ->  the file dialog, straight away.
         has a photo ->  a menu, because there is now more than one answer.

       An empty box is the common case and must stay a single click. Anything
       with a picture in it has to offer Remove, and Remove cannot be a gesture
       he might make by accident — hence the menu rather than a second gesture
       on the element itself.

       Note this covers photos the SITE ships as well as photos he added. Before
       this, an <img> that was already on the page could be replaced but never
       taken out, which is the gap the menu closes. */
    var lastTap = 0;

    function activate() {
      /* Both the pointer handler (tap-to-open) and the click handler can arrive
         for one press, depending on how the browser treats preventDefault on
         pointerdown. Opening twice is harmless but the toolbar row visibly
         flickers, so collapse the pair. */
      var now = Date.now();
      if (now - lastTap < 350) return;
      lastTap = now;

      var pending = removal();
      if (pending && pending.onSite) {
        menuRemoved();
      } else if (photo() || originalOf(el)) {
        menuFilled();
      } else {
        picker.click();
      }
    }

    function menuFilled() {
      ui.openSlot(photo() ? "Your photo" : "This picture", [
        {
          text: "Change photo",
          kind: "primary",
          run: function () {
            ui.closeSlot();
            picker.click();
          },
        },
        { text: "Remove photo", kind: "danger", run: removePhoto },
      ]);
    }

    function menuRemoved() {
      ui.openSlot("Marked for removal", [
        { text: "Put it back", kind: "primary", run: undoRemoval },
        {
          text: "Choose a photo",
          kind: "ghost",
          run: function () {
            ui.closeSlot();
            picker.click();
          },
        },
      ]);
    }

    /* Removal is deliberately layered rather than absolute, and the layers come
       off one at a time. If his own photo is sitting on top of one the site
       ships, the first Remove takes HIS off and the original reappears; a second
       Remove then proposes taking that out too.

       That ordering is what makes the button safe. The alternative — one click
       wiping both — means a mis-click on a slot he was only tidying proposes
       deleting a photo he never mentioned, and he would have no way of knowing
       it had happened. Each step is visible in the slot the instant it happens. */
    function removePhoto() {
      var mine = photo();
      var onPage = originalOf(el);

      if (mine) {
        var wasSent = mine.sent;
        delete store[key];
        unpaintSlot(el);

        /* If it never reached you there is nothing to say about it — the record
           just goes, and no proposal is made. If it DID, deleting quietly would
           leave the batch sitting at /edits telling you to place a photo he has
           since changed his mind about, so a retraction takes its place. */
        if (wasSent) {
          store[goneKey] = removalRecord(mine.name, false, onPage);
          ui.say("Removed — Andreas will be told to ignore it.", "ok");
        } else {
          ui.say(onPage ? "Your photo removed — the original is back." : "Photo removed.", "ok");
        }
      } else if (onPage) {
        /* Overwrites any retraction already sitting here, and should: "this box
           should be empty" says everything the retraction did and more. */
        store[goneKey] = removalRecord(onPage, true, "");
        blankSlot(el);
        ui.say("Marked for removal — press Send changes when you are done.", "ok");
      }

      save(store);
      ui.closeSlot();
      onChange();
    }

    function undoRemoval() {
      delete store[goneKey];
      unpaintSlot(el);
      save(store);
      ui.closeSlot();
      ui.say("Put back.", "ok");
      onChange();
    }

    /**
     * @param was    the photo going: a src the site ships, or the name of one he
     *               uploaded.
     * @param onSite true if `was` is in this repo's markup. False means he is
     *               retracting something he sent, and there is nothing on the
     *               page to reconcile it against — see reconcile().
     * @param back   what should be showing instead. "" is the picture placeholder.
     */
    function removalRecord(was, onSite, back) {
      return {
        kind: "remove",
        page: pageName(),
        selector: sel,
        section: sectionFor(el),
        tag: tagAndClasses(el),
        slot: stem,
        was: was,
        onSite: onSite,
        back: back,
        ts: new Date().toISOString(),
        sent: false,
        stale: false,
      };
    }

    el.addEventListener("click", function (ev) {
      ev.preventDefault();
      activate();
    });

    el.addEventListener("dragover", function (ev) {
      ev.preventDefault();
      el.setAttribute("data-fifl-over", "");
    });
    el.addEventListener("dragleave", function () {
      el.removeAttribute("data-fifl-over");
    });
    el.addEventListener("drop", function (ev) {
      ev.preventDefault();
      el.removeAttribute("data-fifl-over");
      var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) take(file);
    });

    function take(file) {
      if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) {
        ui.say("That does not look like a photo.", "bad");
        return;
      }

      ui.say("Preparing photo…", "");

      processImage(file)
        .then(function (out) {
          var ext = out.raw ? (file.name.match(/\.[a-z0-9]+$/i) || [".jpg"])[0] : ".webp";
          var name = stem + "-" + stamp() + ext;
          ui.say("Uploading photo…", "");
          return uploadPhoto(name, out.blob.type || "application/octet-stream", out.blob).then(
            function (res) {
              return { res: res, out: out, name: name };
            }
          );
        })
        .then(function (done) {
          var rec = {
            kind: "photo",
            page: pageName(),
            selector: selectorFor(el),
            section: sectionFor(el),
            tag: tagAndClasses(el),
            slot: stem,
            name: done.name,
            file: done.res.key,
            /* Painted from the server copy, not a local blob: URL. A blob URL
               dies on reload, and this record is persisted — so using one would
               leave every slot blank the next time he opened the page. It also
               means a slot only ever shows a photo the server really has. */
            url: done.res.url,
            width: done.out.width,
            height: done.out.height,
            raw: done.out.raw,
            position: (store[key] && store[key].position) || "50% 50%",
            description: (store[key] && store[key].description) || "",
            ts: new Date().toISOString(),
            sent: false,
            stale: false,
          };
          store[key] = rec;

          /* A photo in the slot answers any pending removal of it, so the two
             never travel together saying different things. Safe even when the
             removal was already sent: this proposal is for the same slot, so
             whichever way you read it, the photo is what he wants there now. */
          delete store[goneKey];
          save(store);

          paintSlot(el, rec.url, rec.position);
          onChange();

          if (done.out.raw) {
            ui.say("Added — but this format needs converting on our end.", "warn");
          }
          ui.askDescription(rec, store, onChange);
        })
        .catch(function (err) {
          /* Distinguish "this will never work" from "this might". A 503 means
             photo storage is not configured, and telling him to try again would
             send him round a loop with no exit. The technical detail goes to the
             console for you, not to him. */
          if (err && err.detail) console.log("upload failed: " + err.detail);
          ui.say(
            err && err.status === 503
              ? "Photo uploads are not switched on yet — let Andreas know."
              : "Could not add that photo — try again.",
            "bad"
          );
        });
    }

    /* Bound once, for every slot, filled or not — it reads the store on each
       gesture. Binding it only for slots that happen to have a photo at load
       used to mean a second upload into the same slot bound a SECOND set of
       listeners, and both then fought over the crop. */
    makeDraggable(el, photo, store, onChange, activate);
  }

  function stamp() {
    var d = new Date();
    return (
      String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0")
    );
  }

  // -------------------------------------------------------------------------
  // page styles (light DOM — these have to reach the site's own elements)
  // -------------------------------------------------------------------------

  function injectStyles() {
    var css = document.createElement("style");
    css.textContent = [
      "[" + MARK + "]{outline:1px dashed #7c5cff;outline-offset:3px;cursor:text;}",
      "[" + MARK + "]:hover{outline-style:solid;background:#7c5cff14;}",
      "[" + MARK + "]:focus{outline:2px solid #7c5cff;background:#7c5cff1f;}",
      "[" + SLOT + "]{outline:2px dashed #00a3c4;outline-offset:3px;cursor:pointer;}",
      "[" + SLOT + "]:hover{outline-style:solid;}",
      "[" + SLOT + "][data-fifl-over]{outline:3px solid #00a3c4;}",
      "[" + SLOT + "][data-fifl-changed]{cursor:move;outline-color:#00b37e;}",
      "[data-fifl-changed]{outline-color:#00b37e !important;}",
      "[data-fifl-changed]:focus{outline:2px solid #00b37e;background:#00b37e1f;}",
      /* Marked for removal. Red rather than the green of an addition, and last
         in the list so it wins on equal specificity — a blanked slot must never
         read as an empty one he simply has not filled in yet. */
      "[" + SLOT + "][data-fifl-gone]{outline:2px dashed #ff6b6b;cursor:pointer;}",
      "body{padding-bottom:" + (BAR_HEIGHT + 16) + "px;}",
    ].join("\n");
    document.head.appendChild(css);
  }

  // -------------------------------------------------------------------------
  // toolbar (shadow DOM — isolated from the site's CSS in both directions)
  // -------------------------------------------------------------------------

  /* In a shadow root deliberately. The site is re-themed and restyled often,
     and a rule in base.css for `button` or `p` must never be able to reshape
     the one control he needs to press. Nothing leaks the other way either. */
  function buildBar() {
    var host = document.createElement("div");
    host.id = "fifl-edit-bar";
    var root = host.attachShadow({ mode: "open" });

    root.innerHTML =
      "<style>" +
      ":host{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;" +
      "font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;}" +
      ".bar{display:flex;align-items:center;gap:16px;padding:0 16px;" +
      "height:" + BAR_HEIGHT + "px;background:#16181d;color:#f2f4f8;" +
      "border-top:2px solid #7c5cff;box-sizing:border-box;}" +
      ".dot{width:10px;height:10px;border-radius:50%;background:#7c5cff;flex:none;}" +
      ".label{font-weight:700;letter-spacing:.02em;flex:none;}" +
      ".count{color:#9aa3b2;flex:1;min-width:0;}" +
      ".count b{color:#f2f4f8;}" +
      ".warn{color:#ffb020;}" +
      "button{font:inherit;font-weight:600;padding:10px 18px;border:0;cursor:pointer;" +
      "border-radius:2px;min-height:44px;}" +
      ".send{background:#7c5cff;color:#fff;}" +
      ".send:disabled{background:#3a3f4b;color:#8b93a1;cursor:default;}" +
      ".ghost{background:transparent;color:#9aa3b2;text-decoration:underline;padding:10px 8px;}" +
      ".msg{flex:none;}" +
      ".ok{color:#00b37e;}" +
      ".bad{color:#ff6b6b;}" +
      "input{font:inherit;flex:1;min-width:0;padding:10px 12px;border:1px solid #3a3f4b;" +
      "background:#0f1115;color:#f2f4f8;border-radius:2px;min-height:44px;}" +
      ".ask,.pick{display:none;align-items:center;gap:12px;padding:0 16px;height:" +
      BAR_HEIGHT + "px;background:#0f1115;color:#f2f4f8;" +
      "border-top:2px solid #00a3c4;box-sizing:border-box;}" +
      ".ask.on,.pick.on{display:flex}" +
      ".ask span{flex:none;color:#9aa3b2}" +
      // The slot menu's label yields all its width to the buttons before they
      // would wrap — on a phone it disappears entirely, which is no loss: he is
      // looking at the box he just tapped.
      ".what{flex:1;min-width:0;color:#9aa3b2;overflow:hidden;" +
      "text-overflow:ellipsis;white-space:nowrap}" +
      ".acts{display:flex;gap:8px;flex:none}" +
      ".primary{background:#7c5cff;color:#fff;}" +
      ".danger{background:#3a1f24;color:#ff9b9b;}" +
      "@media (max-width:640px){.label{display:none}button{padding:10px 12px}" +
      ".ask span,.what{display:none}}" +
      "</style>" +
      '<div class="ask" id="ask">' +
      "<span>What is this a photo of?</span>" +
      '<input id="desc" type="text" placeholder="e.g. Stainless auger conveyor for a bread line">' +
      '<button class="send" id="descok" type="button">Done</button>' +
      "</div>" +
      '<div class="pick" id="pick">' +
      '<span class="what" id="what"></span>' +
      '<span class="acts" id="acts"></span>' +
      "</div>" +
      '<div class="bar">' +
      '<span class="dot"></span>' +
      '<span class="label">Editing</span>' +
      '<span class="count" id="count"></span>' +
      '<span class="msg" id="msg"></span>' +
      '<button class="ghost" id="discard" type="button">Discard all</button>' +
      '<button class="send" id="send" type="button">Send changes</button>' +
      "</div>";

    document.body.appendChild(host);

    var msgEl = root.getElementById("msg");
    var askEl = root.getElementById("ask");
    var descEl = root.getElementById("desc");
    var okEl = root.getElementById("descok");
    var pickEl = root.getElementById("pick");
    var whatEl = root.getElementById("what");
    var actsEl = root.getElementById("acts");

    /* At most one extra row is ever open, and the page's bottom padding tracks
       it, so nothing the toolbar does can bury the last paragraph on the page. */
    function showRow(row) {
      askEl.classList.remove("on");
      pickEl.classList.remove("on");
      row.classList.add("on");
      document.body.style.paddingBottom = BAR_HEIGHT * 2 + 16 + "px";
    }

    function hideRows() {
      askEl.classList.remove("on");
      pickEl.classList.remove("on");
      document.body.style.paddingBottom = BAR_HEIGHT + 16 + "px";
    }

    var ui = {
      count: root.getElementById("count"),
      send: root.getElementById("send"),
      discard: root.getElementById("discard"),
      say: function (text, kind) {
        msgEl.className = "msg" + (kind ? " " + kind : "");
        msgEl.textContent = text;
      },
      /* Alt text, asked at the only moment anyone knows the answer. He is the
         one who can say what the part is; inventing it later is guesswork. */
      askDescription: function (rec, store, onChange) {
        descEl.value = rec.description || "";
        showRow(askEl);
        descEl.focus();

        okEl.onclick = function () {
          rec.description = descEl.value.trim();
          rec.sent = false;
          save(store);
          hideRows();
          ui.say("Photo added", "ok");
          onChange();
        };
        descEl.onkeydown = function (ev) {
          if (ev.key === "Enter") okEl.onclick();
        };
      },

      /* The menu for a slot that already has a picture in it. The buttons are
         rebuilt on every open rather than hidden and re-labelled, because what
         a slot offers depends on what is in it — and a stale handler left on a
         re-labelled button is the kind of bug that removes the wrong photo.
         Close is appended here so no caller can forget it and strand him. */
      openSlot: function (label, actions) {
        whatEl.textContent = label;
        while (actsEl.firstChild) actsEl.removeChild(actsEl.firstChild);

        actions.concat([{ text: "Close", kind: "ghost", run: hideRows }]).forEach(
          function (action) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = action.kind;
            button.textContent = action.text;
            button.addEventListener("click", action.run);
            actsEl.appendChild(button);
          }
        );

        showRow(pickEl);
      },

      closeSlot: hideRows,
    };
    return ui;
  }

  // -------------------------------------------------------------------------
  // keep ?edit on internal links
  // -------------------------------------------------------------------------

  /* Without this, clicking "Services" in the nav drops him out of edit mode
     with no explanation. Only same-origin page links are touched. */
  function carryEditFlag() {
    var links = document.querySelectorAll('a[href]:not([href^="#"])');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var url;
      try {
        url = new URL(a.getAttribute("href"), location.href);
      } catch (e) {
        continue;
      }
      if (url.origin !== location.origin) continue;
      if (!/\.html?$|\/$|^[^.]*$/.test(url.pathname.split("/").pop())) continue;
      url.searchParams.set("edit", "1");
      a.setAttribute("href", url.pathname + url.search + url.hash);
    }
  }

  // -------------------------------------------------------------------------
  // init
  // -------------------------------------------------------------------------

  function start() {
    var store = load();
    var texts = discoverText();
    var slots = discoverSlots();

    injectStyles();
    var stale = reconcile(store, texts);
    carryEditFlag();

    var ui = buildBar();

    for (var i = 0; i < texts.length; i++) attachText(texts[i], store, refresh);
    for (var j = 0; j < slots.length; j++) attachSlot(slots[j], slots, store, refresh, ui);

    /* Every <a> inside <main> is inert while editing. The expertise cards wrap
       their own editable heading and paragraph, so a click meant to place a
       cursor would otherwise navigate away mid-sentence. The header nav still
       works, and is how he moves between pages. */
    var main = mainEl();
    if (main) {
      main.addEventListener("click", function (ev) {
        var a = ev.target.closest ? ev.target.closest("a") : null;
        if (a && main.contains(a)) ev.preventDefault();
      });
    }

    function pending() {
      var out = [];
      for (var k in store) {
        if (!Object.prototype.hasOwnProperty.call(store, k)) continue;
        if (!store[k].stale) out.push(store[k]);
      }
      return out;
    }

    function refresh() {
      var all = pending();
      var unsent = all.filter(function (e) {
        return !e.sent;
      });
      var photos = all.filter(function (e) {
        return e.kind === "photo";
      }).length;
      var gone = all.filter(function (e) {
        return e.kind === "remove";
      }).length;
      var words = all.length - photos - gone;
      var pages = {};
      all.forEach(function (e) {
        pages[e.page] = 1;
      });

      var parts = [];
      if (words) parts.push("<b>" + words + "</b> text change" + (words === 1 ? "" : "s"));
      if (photos) parts.push("<b>" + photos + "</b> photo" + (photos === 1 ? "" : "s"));
      if (gone) parts.push("<b>" + gone + "</b> removed");

      var text = all.length === 0
        ? "Click any text to edit it, or any picture box to add, change or remove a photo."
        : parts.join(" · ") +
          " on " + Object.keys(pages).length + " page" +
          (Object.keys(pages).length === 1 ? "" : "s") +
          (unsent.length ? " · <b>" + unsent.length + " not sent</b>" : " · all sent");

      if (stale) {
        text += ' <span class="warn">· ' + stale +
          " older change" + (stale === 1 ? "" : "s") + " no longer match the page</span>";
      }

      ui.count.innerHTML = text;
      ui.send.disabled = unsent.length === 0;
      ui.discard.style.display = all.length ? "" : "none";
    }

    ui.send.addEventListener("click", function () {
      var batch = pending().filter(function (e) {
        return !e.sent;
      });
      if (!batch.length) return;

      ui.send.disabled = true;
      ui.say("Sending…", "");

      /* Root-relative on purpose. Edit mode only ever runs over http from the
         worker, never from file://, so the reason every link in the site is
         relative (SITE-SPEC § 4) does not apply here. */
      fetch("/api/edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submitted: new Date().toISOString(),
          userAgent: navigator.userAgent,
          edits: batch,
        }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function () {
          /* Mark sent rather than clearing. Wiping his overrides here would
             snap every paragraph back to the old copy the instant he pressed
             the button, which reads as "it did not work". They clear themselves
             in reconcile() once the change is actually live. */
          batch.forEach(function (e) {
            var key = e.page + "|" + e.kind + "|" + e.selector;
            if (store[key]) store[key].sent = true;
          });
          save(store);
          ui.say("Sent — thank you", "ok");
          refresh();
        })
        .catch(function () {
          ui.say("Could not send — try again", "bad");
          refresh();
        });
    });

    ui.discard.addEventListener("click", function () {
      if (!window.confirm("Undo all your changes and start again?")) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
