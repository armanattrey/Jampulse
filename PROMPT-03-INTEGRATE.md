# PROMPT 3 — The integration trigger. Paste after you have picked a direction

**Use this as website page** — Direction **<NUMBER / NAME>**.

Integrate it into the real JamPulse site now, following the integration protocol exactly:
- One paste-ready CSS block appended at the **end of `frontend/style.css`**, namespaced, winning over the existing override layers.
- Minimal before/after snippets for `frontend/index.html` only — hero, filter strip, map wrapper, and the skeleton the grid renders into.
- Any JS as one self-contained block that survives `renderCards()` replacing `#jamsFeedContainer`'s inner HTML (delegated events or a `MutationObserver`), and that keeps the existing hooks alive: `.jam-card`, `.contact-host-trigger`, `.rsvp-trigger`, `.jam-save-trigger`, plus the existing ids `#jamsFeedContainer`, `#resultsCount`, `#radiusFilterSlider`, `#genreFilterSelect`, `#sortFilterSelect`, `#btnShowList`, `#btnShowMap`, `#leafletMap`.
- Do not break: the Leaflet map init, the auth modals, the location pill, the mobile bottom nav, or the Capacitor bundle in `frontend/www/`.

Then finish with:
1. A list of files changed, in save order, and the hard-refresh step.
2. A compatibility report: every place the old style layers could fight the new design, and what you wrote to beat them.
3. A short "what to test" checklist — desktop, 380px mobile, reduced-motion, and the map/list toggle.
4. A note on whether `frontend/www/` (the Android bundle copy) needs the same change, and if so, the exact patch.
