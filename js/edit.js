/* ============================================================================
   edit.js — click-to-edit mode for the password-gated preview
   ----------------------------------------------------------------------------
   Loaded ONLY when a page is requested with ?edit, and only by deploy/_worker.js,
   which splices the <script> tag in at the edge. No page in this repo references
   this file, so the public site never fetches it and the "almost no JavaScript"
   promise in SITE-SPEC § 2 is untouched.

   What it is for: the client edits his own copy by clicking the words on the
   real page, and adds his own photos by dropping them on an image slot, rather
   than describing either in an email. Nothing he does reaches a file. Every
   change is a PROPOSAL — see § 11 of SITE-SPEC.md.

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
       a photo       ->  R2 immediately (see uploadPhoto), metadata to localStorage
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

  /* One flat map, keyed by page + kind + selector, holding both kinds of
     record. `kind` is "text" or "photo"; everything that treats them
     differently branches on it explicitly. */
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
    return Array.prototype.slice.call(main.querySelectorAll("img, .placeholder"));
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

     A photo he later discards leaves an orphan object in R2. That is the
     accepted cost of this ordering — it is invisible (only photos named by a
     submitted batch are ever shown at /edits) and it is a few hundred KB. */
  function uploadPhoto(name, type, blob) {
    return fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": type, "X-Photo-Name": name },
      body: blob,
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
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
    el.setAttribute("data-fifl-changed", "");
  }

  /* Drag inside a filled slot to reposition. This only ever produces a pair of
     percentages — no zoom, no crop box, nothing destructive. */
  function makeDraggable(el, rec, store, onChange) {
    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startPos = [50, 50];

    function parsePos() {
      var m = String(rec.position || "50% 50%").match(/(-?[\d.]+)%\s+(-?[\d.]+)%/);
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : [50, 50];
    }

    el.addEventListener("pointerdown", function (ev) {
      if (!rec.file) return;
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      startPos = parsePos();
      el.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });

    el.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      var box = el.getBoundingClientRect();
      // Inverted: dragging the image right should reveal what is on its left.
      var x = startPos[0] - ((ev.clientX - startX) / box.width) * 100;
      var y = startPos[1] - ((ev.clientY - startY) / box.height) * 100;
      x = Math.max(0, Math.min(100, x));
      y = Math.max(0, Math.min(100, y));
      rec.position = Math.round(x) + "% " + Math.round(y) + "%";
      paintSlot(el, rec.url, rec.position);
    });

    function end() {
      if (!dragging) return;
      dragging = false;
      rec.sent = false; // repositioned since the last submission
      save(store);
      onChange();
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
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

      if (rec.kind === "photo") {
        /* A slot that has vanished after the batch was sent almost always means
           you placed the photo and replaced the placeholder with a real <img>.
           Drop it. Unsent, the same disappearance is a layout change and the
           record is kept so it can still be reported. The FILE is safe in R2
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

    var key = pageName() + "|photo|" + selectorFor(el);
    var stem = slotStem(el, allSlots);

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

    el.addEventListener("click", function (ev) {
      if (store[key] && store[key].file) return; // filled: clicks reposition
      ev.preventDefault();
      picker.click();
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
          save(store);

          paintSlot(el, rec.url, rec.position);
          makeDraggable(el, rec, store, onChange);
          onChange();

          if (done.out.raw) {
            ui.say("Added — but this format needs converting on our end.", "warn");
          }
          ui.askDescription(rec, store, onChange);
        })
        .catch(function () {
          ui.say("Could not add that photo — try again.", "bad");
        });
    }

    // Already-filled slots get their drag behaviour back after a reload.
    if (store[key] && store[key].file) {
      makeDraggable(el, store[key], store, onChange);
    }
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
      ".ask{display:none;align-items:center;gap:12px;padding:0 16px;height:" +
      BAR_HEIGHT + "px;background:#0f1115;color:#f2f4f8;" +
      "border-top:2px solid #00a3c4;box-sizing:border-box;}" +
      ".ask.on{display:flex}" +
      ".ask span{flex:none;color:#9aa3b2}" +
      "@media (max-width:640px){.label{display:none}button{padding:10px 12px}" +
      ".ask span{display:none}}" +
      "</style>" +
      '<div class="ask" id="ask">' +
      "<span>What is this a photo of?</span>" +
      '<input id="desc" type="text" placeholder="e.g. Stainless auger conveyor for a bread line">' +
      '<button class="send" id="descok" type="button">Done</button>' +
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
        askEl.classList.add("on");
        document.body.style.paddingBottom = BAR_HEIGHT * 2 + 16 + "px";
        descEl.focus();

        okEl.onclick = function () {
          rec.description = descEl.value.trim();
          rec.sent = false;
          save(store);
          askEl.classList.remove("on");
          document.body.style.paddingBottom = BAR_HEIGHT + 16 + "px";
          ui.say(rec.description ? "Photo added" : "Photo added", "ok");
          onChange();
        };
        descEl.onkeydown = function (ev) {
          if (ev.key === "Enter") okEl.onclick();
        };
      },
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
      var words = all.length - photos;
      var pages = {};
      all.forEach(function (e) {
        pages[e.page] = 1;
      });

      var parts = [];
      if (words) parts.push("<b>" + words + "</b> text change" + (words === 1 ? "" : "s"));
      if (photos) parts.push("<b>" + photos + "</b> photo" + (photos === 1 ? "" : "s"));

      var text = all.length === 0
        ? "Click any text to edit it, or any picture box to add a photo."
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
