/* ============================================================================
   prefetch.js — INSTANT NAVIGATION (McMaster-Carr style)
   ----------------------------------------------------------------------------
   Makes clicks feel instant by fetching the destination page BEFORE the click,
   the moment the user shows intent (hover / touch / focus).

   Two layers of progressive enhancement — the site works fine without either:

     1. Speculation Rules API (modern browsers): the browser prefetches internal
        links on hover automatically. Unsupported browsers ignore this block.
     2. Manual fallback: for browsers without Speculation Rules, we inject a
        <link rel="prefetch"> on hover/touch/focus of same-site links.

   This file is intentionally tiny and dependency-free.
   ========================================================================== */
(function () {
  "use strict";

  // ---- Layer 1: Speculation Rules (modern browsers) ------------------------
  var supportsSpeculationRules =
    HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules");

  if (supportsSpeculationRules) {
    var rules = {
      prefetch: [
        {
          source: "document",
          where: { href_matches: "/*" }, // same-origin internal links
          eagerness: "moderate"          // act on hover/pointer-down intent
        }
      ]
    };
    var s = document.createElement("script");
    s.type = "speculationrules";
    s.textContent = JSON.stringify(rules);
    document.head.appendChild(s);
    return; // Speculation Rules covers it; skip the manual fallback.
  }

  // ---- Layer 2: manual hover/touch prefetch (older browsers) ---------------
  var prefetched = Object.create(null);

  function sameOrigin(url) {
    return url && url.origin === location.origin;
  }

  function prefetch(href) {
    if (prefetched[href]) return;
    prefetched[href] = true;
    var link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    document.head.appendChild(link);
  }

  function onIntent(event) {
    var a = event.target.closest ? event.target.closest("a") : null;
    if (!a || !a.href) return;

    var url;
    try { url = new URL(a.href); } catch (e) { return; }

    if (!sameOrigin(url)) return;            // only our own pages
    if (a.hasAttribute("download")) return;  // not file downloads
    if (url.pathname === location.pathname) return; // not the current page

    // Drop the #fragment: it never reaches the server, so all four home cards
    // pointing into services.html are one prefetch, not four identical ones.
    prefetch(url.origin + url.pathname + url.search);
  }

  // Hover (desktop), touch (mobile), and keyboard focus (accessibility).
  document.addEventListener("mouseover", onIntent, { passive: true });
  document.addEventListener("touchstart", onIntent, { passive: true });
  document.addEventListener("focusin", onIntent, { passive: true });
})();
