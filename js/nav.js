/* ============================================================================
   nav.js — MOBILE MENU TOGGLE
   ----------------------------------------------------------------------------
   Below 640px the five nav tabs collapse behind a three-bar button (the CSS
   lives in css/base.css § MOBILE MENU). This script is the whole behaviour.

   Progressive enhancement, in the site's usual shape: the button ships in the
   HTML with the `hidden` attribute, and only this script takes it off. So a
   browser with JavaScript disabled never gets a dead control — it just keeps
   the plain, always-visible nav. Nothing here runs above 640px either; the
   collapsing is done entirely by the media query, and this only flips the
   attributes the media query reads.

   No "click outside to close" handler: this is a multi-page site, so following
   any link reloads the page and the menu resets on its own.
   ========================================================================== */
(function () {
  "use strict";

  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");

  // Any of these missing means the header markup changed; do nothing rather
  // than half-apply and leave the nav hidden with no way to open it.
  if (!header || !toggle || !nav) return;

  function isOpen() {
    return toggle.getAttribute("aria-expanded") === "true";
  }

  function setOpen(open) {
    // The CSS hides the nav on [data-nav="closed"]; aria-expanded tells screen
    // readers the same thing. Always write both together.
    header.setAttribute("data-nav", open ? "open" : "closed");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  setOpen(false);
  toggle.hidden = false; // safe to show now that it works

  toggle.addEventListener("click", function () {
    setOpen(!isOpen());
  });

  // Escape closes the menu and puts focus back on the button.
  // keyCode is the fallback for browsers predating KeyboardEvent.key.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" && event.keyCode !== 27) return;
    if (!isOpen()) return;
    setOpen(false);
    toggle.focus();
  });
})();
