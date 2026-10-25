/*
  faq-ui.js
  Geosonify FAQ/Examples/Credits tab renderer.

  Reads from window.GEOSONIFY_FAQ (populated by faq-content.js or a translated equivalent).
  Call GeosonifyFAQ.init('container-element-id') after DOM ready.

  The tab in index.html needs:
    - The "Examples" tab renamed to "FAQ" in the nav (data-tab="examples", span text "FAQ")
    - The tab-content div #tab-examples to contain: <div id="faq-root"></div>
    - This script and faq-content.js (or translation) loaded before DOMContentLoaded fires,
      OR call GeosonifyFAQ.init() after load.

  v1.2: two sub-tabs at the top, FAQ and Examples. FAQ holds the questions,
  then the credits; Examples holds the example buttons. The last sub-tab
  chosen is remembered on the device. A link to a question (#faq-<id>)
  always opens the FAQ sub-tab.

  v1.3: the Map imagery controls (Standard / Aerial / Topographic / Sky) live
  on the main screen, in the collapsible card #mapImageryMount beside Encoding
  Mode and Precision. If that mount is missing they fall back to a card in the
  FAQ pane, so nothing is lost on an older index.html.

  v1.4: the main-screen card is the four chips and nothing else (minimalism:
  the explanation is in the FAQ's Sky and Map imagery answers). Pasting your
  own imagery URL is a small card at the bottom of the FAQ pane. Choosing
  Standard, Aerial or Topographic while the sky is showing turns back down to
  Earth with the same animation as the Earth button, with the chosen imagery
  already loading underneath, so the ground arrives in it.

  v1.10: the Aerial list no longer jumps back to the top while it fills in:
  labels change in place, and any reordering waits until it is closed.
  A failing dated Aerial or local layer falls back to Aerial, not Standard.

  v1.9: a curated local layer gives way to plain Aerial when the map settles
  somewhere its coverage doesn't reach (no part of the view touches it).

  v1.8: the Aerial date list also offers the curated local historical layers
  covering the map's centre (js/lib/geosonify-imagery-catalogue.js),
  interleaved with Esri's editions by photograph date; choosing one keeps the
  Aerial chip and the list. The edition that is the current picture is no
  longer listed twice, and editions with the same capture date are merged.

  v1.7: the Aerial date list offers only the releases in which the imagery at
  the map's centre changed, labelled with when those photographs were taken
  (GeosonifyWayback.localChanges / captureInfo), rebuilt when the map settles
  while the list is showing; "Every release…" gives the full list.

  v1.6: imagery travels with every link (?basemap=, built in index.html from
  GeosonifyBasemap.shareInfo()); applyFromURL honours it on any link, not
  only display links. A pasted source is remembered on the device and offered
  as a Custom chip before Sky. While Aerial is showing, a row offers Esri
  World Imagery Wayback releases by date ('aerial@YYYY-MM-DD'). Holding the
  Standard chip shows the streets over the imagery (GeosonifySkyFlip.peekEarth).

  v1.5: a pasted ArcGIS …/MapServer URL is inspected by MapManager before it
  is drawn (any projection; see map-manager v1.1), so applying it can be
  pending: the card says it is checking, then reports the result. The active
  basemap is recorded only once it is actually showing, and cleared again if
  the source falls back to the standard map.

  No external dependencies.
*/

(function(global) {
  'use strict';

  const __FAQ_UI_VER__ = 'v1.10';
  try { console.log('[geosonify] faq-ui ' + __FAQ_UI_VER__ + ' loaded'); } catch(e) {}

  const SUBTAB_KEY = 'geosonify_faq_subtab';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── CSS (injected once) ────────────────────────────────────────────────────

  const CSS = `
  #faq-root {
    padding: 0 0 32px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
    color: var(--ios-text, #000);
  }

  /* ── Sub-tabs (FAQ | Examples) ── */
  .faq-subtabs {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 2px;
    margin: 12px 16px 4px;
    padding: 2px;
    border-radius: 9px;
    background: var(--ios-light-gray, #f2f2f7);
    box-shadow: 0 0 0 0.5px var(--ios-separator, #c6c6c8);
  }
  .faq-subtab {
    flex: 1 1 0;
    padding: 8px 12px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--ios-secondary, #3c3c43);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .faq-subtab[aria-selected="true"] {
    background: var(--ios-card, #fff);
    color: var(--kereru-teal, #325756);
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }
  .faq-subtab:focus-visible { outline: 2px solid var(--kereru-teal, #325756); outline-offset: 1px; }
  .faq-pane[hidden] { display: none; }

  /* ── Section headings ── */
  .faq-section-heading {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--kereru-teal, #325756);
    padding: 24px 16px 6px;
    margin: 0;
  }

  /* ── Accordion items ── */
  .faq-item {
    background: var(--ios-card, #fff);
    border-bottom: 0.5px solid var(--ios-separator, #c6c6c8);
  }
  .faq-item:first-of-type {
    border-top: 0.5px solid var(--ios-separator, #c6c6c8);
  }

  .faq-question {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    background: none;
    border: none;
    padding: 14px 16px;
    text-align: left;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    color: var(--ios-text, #000);
    line-height: 1.35;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s;
  }
  .faq-question:active {
    background: var(--ios-light-gray, #f2f2f7);
  }

  .faq-chevron {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    color: var(--kereru-teal, #325756);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .faq-item.open .faq-chevron {
    transform: rotate(180deg);
  }

  /* ── Answer panel ── */
  .faq-answer-wrap {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .faq-item.open .faq-answer-wrap {
    grid-template-rows: 1fr;
  }
  .faq-answer-inner {
    overflow: hidden;
  }
  .faq-answer {
    padding: 0 16px 18px 16px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--ios-secondary, #3c3c43);
  }

  /* Answer typography */
  .faq-answer h4 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--kereru-teal, #325756);
    margin: 16px 0 6px;
  }
  .faq-answer p { margin: 0 0 10px; }
  .faq-answer ul, .faq-answer ol {
    margin: 0 0 10px;
    padding-left: 20px;
  }
  .faq-answer li { margin-bottom: 4px; }
  .faq-answer pre {
    background: var(--ios-light-gray, #f2f2f7);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
    font-family: 'SF Mono', ui-monospace, monospace;
    overflow-x: auto;
    margin: 8px 0 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .faq-answer code {
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 12px;
    background: var(--ios-light-gray, #f2f2f7);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .faq-answer pre code {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  .faq-answer a {
    color: var(--kereru-teal, #325756);
    text-decoration: underline;
  }

  /* Answer tables */
  .faq-answer table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin: 10px 0 14px;
    overflow-x: auto;
    display: block;
  }
  .faq-answer th {
    background: var(--kereru-teal, #325756);
    color: #fff;
    font-weight: 600;
    padding: 7px 10px;
    text-align: left;
    white-space: nowrap;
  }
  .faq-answer td {
    padding: 6px 10px;
    border-bottom: 0.5px solid var(--ios-separator, #c6c6c8);
  }
  .faq-answer tr:last-child td { border-bottom: none; }
  .faq-answer tr:nth-child(even) td {
    background: var(--ios-light-gray, #f9f9f9);
  }

  /* ── Scope nth-child colour selectors to examples-section wrapper ──
     Overrides the unscoped .card:nth-child(n) rules in geosonify-styles.css
     so FAQ accordion items don't interfere with the colour cycle. ── */
  .examples-section { display: contents; }
  .examples-section .card:nth-child(1) .example-link { background: linear-gradient(135deg, var(--kereru-pink) 0%, var(--kereru-lavender) 100%); }
  .examples-section .card:nth-child(2) .example-link { background: linear-gradient(135deg, var(--kereru-green) 0%, var(--kereru-teal) 100%); }
  .examples-section .card:nth-child(3) .example-link { background: linear-gradient(135deg, var(--kereru-blue) 0%, var(--kereru-purple) 100%); }
  .examples-section .card:nth-child(4) .example-link { background: linear-gradient(135deg, var(--kereru-teal) 0%, var(--kereru-green) 100%); }
  .examples-section .card:nth-child(5) .example-link { background: linear-gradient(135deg, var(--kereru-purple) 0%, var(--kereru-pink) 100%); }
  .examples-section .card:nth-child(6) .example-link { background: linear-gradient(135deg, var(--kereru-blue) 0%, var(--kereru-teal) 100%); }
  .examples-section .card:nth-child(7) .example-link { background: linear-gradient(135deg, var(--kereru-pink) 0%, var(--kereru-green) 100%); }

  @media (prefers-color-scheme: dark) {
    .faq-answer pre,
    .faq-answer code {
      background: #2c2c2e;
    }
    .faq-answer tr:nth-child(even) td {
      background: #2c2c2e;
    }
  }

  /* ── Basemap / imagery control ── */
  .basemap-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 14px;
  }
  .basemap-chip {
    flex: 1 1 auto;
    min-width: 88px;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1.5px solid var(--ios-separator, #C6C6C8);
    background: var(--ios-card, #fff);
    color: var(--ios-text, #000);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
    transition: border-color .12s, background .12s;
  }
  .basemap-chip:hover { border-color: var(--kereru-teal, #325756); }
  .basemap-chip.active {
    border-color: var(--kereru-teal, #325756);
    background: var(--kereru-teal, #325756);
    color: #fff;
  }
  .basemap-chip { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  .basemap-chip.peeking { outline: 2px dashed var(--kereru-teal, #325756); outline-offset: 2px; }
  .basemap-wayback-row { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font-size: 13px; color: var(--ios-secondary, #3C3C43); }
  .basemap-wayback-row select {
    flex: 1 1 auto; min-width: 0; padding: 6px 8px; font-size: 14px;
    border: 1.5px solid var(--ios-separator, #C6C6C8); border-radius: 8px;
    background: var(--ios-card, #fff); color: var(--ios-text, #000);
  }
  .basemap-forget {
    padding: 9px 12px; border-radius: 10px; font-size: 14px; cursor: pointer;
    border: 1.5px solid var(--ios-separator, #C6C6C8);
    background: var(--ios-card, #fff); color: var(--ios-text, #000);
  }
  .basemap-paste-row { display: flex; gap: 8px; margin: 0 0 8px; }
  .basemap-paste-row input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 9px 12px;
    font-size: 14px;
    border: 1.5px solid var(--ios-separator, #C6C6C8);
    border-radius: 10px;
    background: var(--ios-card, #fff);
    color: var(--ios-text, #000);
    box-sizing: border-box;
  }
  .basemap-apply {
    flex: 0 0 auto;
    padding: 9px 16px;
    border-radius: 10px;
    border: none;
    background: var(--kereru-teal, #325756);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .basemap-note {
    font-size: 12px;
    line-height: 1.5;
    color: var(--ios-secondary, #3C3C43);
    margin: 0;
  }
  .basemap-warn {
    font-size: 12.5px;
    line-height: 1.5;
    color: #8a5a00;
    background: #fff5e0;
    border-radius: 8px;
    padding: 8px 10px;
    margin: 8px 0 0;
    display: none;
  }
  .basemap-warn.show { display: block; }
  @media (prefers-color-scheme: dark) {
    .basemap-warn { color: #ffcf80; background: #3a2e12; }
  }

  /* ── Social image (below credits) ── */
  .faq-social-image {
    text-align: center;
    padding: 28px 16px 40px;
  }
  .faq-social-image img {
    max-width: 100%;
    height: auto;
    border-radius: var(--border-radius-lg, 12px);
  }
  `;

  function injectCSS() {
    if (document.getElementById('faq-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'faq-ui-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── Chevron SVG ────────────────────────────────────────────────────────────

  const CHEVRON = `<svg class="faq-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 8 10 13 15 8"/></svg>`;

  // ── Sub-tabs ───────────────────────────────────────────────────────────────

  function readSubtab() {
    // A link to a question always means the FAQ.
    try { if (/^#faq-/.test(global.location.hash || '')) return 'faq'; } catch (e) {}
    try { return localStorage.getItem(SUBTAB_KEY) === 'examples' ? 'examples' : 'faq'; } catch (e) { return 'faq'; }
  }

  function showSubtab(rootEl, which) {
    which = which === 'examples' ? 'examples' : 'faq';
    rootEl.querySelectorAll('.faq-subtab').forEach(b => {
      const on = b.dataset.subtab === which;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    rootEl.querySelectorAll('.faq-pane').forEach(p => { p.hidden = p.dataset.pane !== which; });
    try { localStorage.setItem(SUBTAB_KEY, which); } catch (e) {}
  }

  function wireSubtabs(rootEl) {
    const tabs = Array.from(rootEl.querySelectorAll('.faq-subtab'));
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => showSubtab(rootEl, b.dataset.subtab));
      // Arrow keys move between tabs, as tablists do.
      b.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        showSubtab(rootEl, next.dataset.subtab);
        next.focus();
      });
    });
    showSubtab(rootEl, readSubtab());
  }

  // ── Map imagery panel ──────────────────────────────────────────────────────
  // Sky is the fourth choice. It is NOT imagery: it changes what the codes
  // mean (the same digits name a direction in the sky), so unlike the other
  // three it travels in share links as ?frame=icrs. The note says so; the
  // full explanation is one tap away in the FAQ.

  const IMAGERY_MOUNT_ID = 'mapImageryMount';

  // The main-screen card: the chips (Custom joins them, before Sky, once
  // there is a custom source), the Aerial date row (shown only while Aerial
  // is the imagery), and a warning line that is empty (and takes no space)
  // unless something needs saying.
  function imageryChipsHTML() {
    return `
    <div class="basemap-presets" id="basemapPresets" style="margin:0;">
      <button class="basemap-chip active" data-basemap="osm" title="Tap for the street map. Hold to see the streets over other imagery.">Standard</button>
      <button class="basemap-chip" data-basemap="aerial">Aerial</button>
      <button class="basemap-chip" data-basemap="topo">Topographic</button>
      <button class="basemap-chip" data-basemap="sky">Sky</button>
    </div>
    <div class="basemap-wayback-row" id="basemapWaybackRow" style="display:none;">
      <label for="basemapWaybackSelect" id="basemapWaybackLabel">Aerial as published</label>
      <select id="basemapWaybackSelect"><option value="">Latest</option></select>
    </div>
    <p class="basemap-warn" id="basemapWarn"></p>`;
  }

  // In the FAQ pane: paste your own tile source.
  function ownImageryHTML() {
    return `
    <div class="basemap-paste-row">
      <input type="text" id="basemapPasteInput" placeholder="Paste imagery URL (…/{z}/{x}/{y} or …/MapServer)" autocomplete="off" spellcheck="false">
      <button class="basemap-apply" id="basemapApplyBtn">Apply</button>
      <button class="basemap-forget" id="basemapForgetBtn" style="display:none;">Forget</button>
    </div>
    <p class="basemap-note">Any XYZ tile URL, or an ArcGIS map service URL ending in /MapServer, in any projection. Once applied it stays on this device as <strong>Custom</strong> on the Map imagery card. Links you share carry the imagery you are showing.</p>
    <p class="basemap-warn" id="basemapPasteWarn"></p>`;
  }

  // Open one FAQ answer from elsewhere in the app: switch to the FAQ tab and
  // sub-tab, expand the answer and bring it into view.
  function openFaqItem(id) {
    try { if (typeof switchToTab === 'function') switchToTab('examples'); } catch (e) {}
    const rootEl = document.getElementById('faq-root');
    if (rootEl) showSubtab(rootEl, 'faq');
    const item = document.getElementById('faq-' + id);
    if (!item) return;
    item.classList.add('open');
    const q = item.querySelector('.faq-question');
    if (q) q.setAttribute('aria-expanded', 'true');
    setTimeout(() => { try { item.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {} }, 60);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderFAQ(rootEl, data) {
    if (!data) {
      rootEl.innerHTML = '<p style="padding:24px 16px;color:#888;">FAQ content not loaded.</p>';
      return;
    }

    const hasExamples = !!(data.examples && data.examples.length);
    const parts = [];

    if (hasExamples) {
      parts.push(`
<div class="faq-subtabs" role="tablist" aria-label="FAQ and examples">
  <button class="faq-subtab" role="tab" id="faq-subtab-faq" data-subtab="faq" aria-controls="faq-pane-faq" aria-selected="true">FAQ</button>
  <button class="faq-subtab" role="tab" id="faq-subtab-examples" data-subtab="examples" aria-controls="faq-pane-examples" aria-selected="false" tabindex="-1">Examples</button>
</div>`);
    }

    // ════ FAQ pane: questions, then Map imagery, then credits ════
    parts.push(`<div class="faq-pane" data-pane="faq" id="faq-pane-faq" role="tabpanel" aria-labelledby="faq-subtab-faq">`);

    for (const section of (data.sections || [])) {
      parts.push(`<p class="faq-section-heading" id="faq-sec-${esc(section.id)}">${esc(section.title)}</p>`);
      for (const item of (section.items || [])) {
        parts.push(`
<div class="faq-item" id="faq-${esc(item.id)}">
  <button class="faq-question" aria-expanded="false" data-faq-id="${esc(item.id)}">
    <span>${esc(item.q)}</span>
    ${CHEVRON}
  </button>
  <div class="faq-answer-wrap" id="faq-wrap-${esc(item.id)}">
    <div class="faq-answer-inner">
      <div class="faq-answer">${item.a}</div>
    </div>
  </div>
</div>`);
      }
    }

    // The chips live on the main screen when its mount exists (see init);
    // otherwise they come here. Pasting your own imagery is always here.
    if (!document.getElementById(IMAGERY_MOUNT_ID)) {
      parts.push(`
<div class="card">
  <div class="card-header">Map imagery</div>
  <div class="card-body">${imageryChipsHTML()}</div>
</div>`);
    }
    parts.push(`
<div class="card" id="faq-own-imagery">
  <div class="card-header">Your own map imagery</div>
  <div class="card-body">${ownImageryHTML()}</div>
</div>`);

    if (data.credits && data.credits.lines && data.credits.lines.length) {
      parts.push(`
<div class="card">
  <div class="card-header">Credits &amp; Attribution</div>
  <div class="card-body" style="font-size:13px; line-height:1.6;">`);
      for (const line of data.credits.lines) {
        parts.push(`    <p style="margin:0 0 4px 0;">${line}</p>`);
      }
      parts.push(`  </div>
</div>`);
    }

    // ── Social image — its own section below the credits ──
    if (data.socialImage && data.socialImage.src) {
      parts.push(`
<div class="faq-social-image">
  <img src="${esc(data.socialImage.src)}" alt="${esc(data.socialImage.alt || '')}" loading="lazy">
</div>`);
    }

    parts.push(`</div>`);   // end FAQ pane

    // ════ Examples pane ════
    // Wrapped in its own container so .card:nth-child() colour selectors in
    // geosonify-styles.css fire correctly (count resets inside the wrapper).
    if (hasExamples) {
      parts.push(`<div class="faq-pane" data-pane="examples" id="faq-pane-examples" role="tabpanel" aria-labelledby="faq-subtab-examples" hidden>`);
      parts.push(`<div class="examples-section">`);
      for (const cat of data.examples) {
        parts.push(`
<div class="card">
  <div class="card-header">${esc(cat.category)}</div>
  <div class="card-body">
    <div class="examples-grid">`);
        for (const ex of cat.items) {
          parts.push(`      <a class="example-link" href="${esc(ex.href)}">${esc(ex.label)}<code>${esc(ex.code)}</code></a>`);
        }
        parts.push(`    </div>
  </div>
</div>`);
      }
      parts.push(`</div>`);
      parts.push(`</div>`);   // end Examples pane
    }

    rootEl.innerHTML = parts.join('\n');

    if (hasExamples) wireSubtabs(rootEl);

    // ── Wire up accordions ──
    rootEl.querySelectorAll('.faq-question').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.faqId;
        const item = document.getElementById('faq-' + id);
        const isOpen = item.classList.contains('open');

        // Optionally close others in same section (comment out for multi-open)
        // const section = item.closest('.faq-section');
        // section.querySelectorAll('.faq-item.open').forEach(el => {
        //   el.classList.remove('open');
        //   el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        // });

        item.classList.toggle('open', !isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    // ── Example links: let them navigate normally (href handles it) ──
    // Native <a href> navigation works without JS intervention.

  }

  // ── Sky: open / close the sky view ──────────────────────────────────────────
  // Always through GeosonifySkyView, never by setting the frame directly:
  // open()/close() call setFrame(), which is what tells the word-entry modules
  // to stop sending positions to the street geocoder, gates the Earth-only
  // cards, and makes share links carry ?frame=.

  function skyIsOpen() {
    return typeof GeosonifySkyView !== 'undefined' && GeosonifySkyView.isOpen && GeosonifySkyView.isOpen();
  }

  // Through the turn (geosonify-sky-flip.js) when it is loaded: it animates
  // when the map is on screen and switches straight over when it is not, and
  // either way keeps the map's scale for the way back.
  function _flip() {
    const F = global.GeosonifySkyFlip;
    return (F && F.isAvailable && F.isAvailable()) ? F : null;
  }

  function openSky() {
    if (typeof GeosonifySkyView === 'undefined' || !GeosonifySkyView.isAvailable || !GeosonifySkyView.isAvailable()) {
      return { ok: false, error: 'Sky view could not load.' };
    }
    const F = _flip();
    // Sky mode: the map gains its Sky / Earth button and the HEALPix lattice,
    // and the map turns over into the sky.
    if (F) { F.setSkyMode(true); F.toSky(); return { ok: true }; }
    return { ok: !!GeosonifySkyView.open() };
  }

  /*
    Leave Sky mode for an Earth imagery choice.

    `apply` sets the new imagery. If the sky is showing, the imagery is set
    FIRST (the map is hidden behind the sky, so nothing visibly changes) and
    then the view turns back down to Earth with the same animation as the
    Earth button: the tiles load during the turn and the ground arrives in the
    chosen imagery. Sky mode (its map button, its lattice) is switched off once
    the turn has finished. If the sky is not showing, or the turn is busy or
    unavailable, it simply switches straight over, as before.

    Returns apply()'s result immediately, so the caller can report an error.
  */
  function leaveSkyThen(apply) {
    const F = _flip();
    const open = skyIsOpen();
    if (F && open && !(F.isBusy && F.isBusy()) && F.toEarth) {
      const res = apply();
      if (res && res.ok === false) return res;          // bad URL: stay in the sky
      Promise.resolve(F.toEarth()).catch(() => {}).then(() => {
        try { F.setSkyMode(false); } catch (e) {}
        _resyncChips();
      });
      return res;
    }
    if (F) { try { F.setSkyMode(false); } catch (e) {} }
    else if (open) GeosonifySkyView.close();
    return apply();
  }

  function skyModeOn() {
    const F = _flip();
    return !!(F && F.isSkyMode && F.isSkyMode());
  }

  // ── Basemap: shared apply logic, used by UI and by URL param ───────────────

  // Heuristic: does this imagery URL carry a credential that would be exposed
  // to anyone the share link reaches?
  function _basemapHasSecret(url) {
    return /[?&](token|apikey|api_key|key|access_token|signature)=/i.test(String(url || ''));
  }

  // What kind of imagery a source string is.
  //   'osm' | 'aerial' | 'topo'  presets
  //   'wayback'                  'aerial@YYYY-MM-DD' (Esri World Imagery Wayback)
  //   'custom'                   a pasted URL
  function _kindOf(source) {
    const s = String(source || '').trim().toLowerCase();
    if (!s || s === 'osm') return 'osm';
    if (s === 'aerial' || s === 'topo') return s;
    if (/^aerial@\d{4}-\d{2}-\d{2}$/.test(s)) return 'wayback';
    return 'custom';
  }

  // A layer of the curated historical imagery catalogue counts as Aerial: the
  // Aerial chip stays lit and the date list stays open while one is showing.
  function _catEntry(url) {
    const C = global.GeosonifyImageryCatalogue;
    return (C && C.isLoaded() && url) ? C.byUrl(url) : null;
  }
  function _isAerialFamily(source) {
    const k = _kindOf(source);
    return k === 'aerial' || k === 'wayback' || (k === 'custom' && !!_catEntry(source));
  }

  function _hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  // ── The remembered custom source (sticky across visits, this device only) ──
  //
  // Only a URL the person PASTED is remembered. Imagery arriving in a link is
  // shown (and lights the Custom chip) but never overwrites it; it stays the
  // Custom choice for the rest of the visit, so it can be toggled back to.
  const CUSTOM_KEY = 'geosonify_custom_basemap';
  function _loadCustom() {
    try {
      const v = JSON.parse(global.localStorage.getItem(CUSTOM_KEY) || 'null');
      return (v && typeof v.url === 'string' && v.url) ? v : null;
    } catch (e) { return null; }
  }
  function _saveCustom(url, label) {
    try { global.localStorage.setItem(CUSTOM_KEY, JSON.stringify({ url: url, label: label || '' })); } catch (e) {}
  }
  function _forgetCustom() {
    try { global.localStorage.removeItem(CUSTOM_KEY); } catch (e) {}
  }
  // A custom source shown from a link this visit, with its label once known.
  let _linkCustom = null;     // { url, label }

  // The custom source the Custom chip stands for right now: the one showing
  // (if custom), else this visit's linked one, else the remembered one.
  function _currentCustom() {
    const active = global.__GEOSONIFY_BASEMAP_ACTIVE;
    if (_kindOf(active) === 'custom' && !_catEntry(active)) {
      const mine = _loadCustom();
      if (mine && mine.url === active) return mine;
      if (_linkCustom && _linkCustom.url === active) return _linkCustom;
      return { url: active, label: '' };
    }
    return (_linkCustom && !_catEntry(_linkCustom.url) ? _linkCustom : null) || _loadCustom();
  }

  function _applyBasemap(source, attribution, ui) {
    if (typeof MapManager === 'undefined' || !MapManager.setBasemap) return { ok: false, error: 'Map not ready.' };
    // A dated Aerial or a local layer from the Aerial list that fails falls
    // back to plain Aerial (you were in Aerial); anything else to Standard.
    const fallback = (_kindOf(source) === 'wayback' || _catEntry(source)) ? 'aerial' : 'osm';
    const res = MapManager.setBasemap(source, {
      attribution: attribution,
      fallback: fallback,
      onError: (msg, fellBackTo) => {
        if (ui && ui.warn) { ui.warn.textContent = msg; ui.warn.classList.add('show'); }
        // The map went back: don't keep claiming the failed source.
        _writeBasemapParam(fellBackTo === 'aerial' ? 'aerial' : null);
      }
    });
    return res;
  }

  // Which chip should look active: Sky in Sky mode (either face), otherwise
  // the Earth imagery in use. A dated Aerial lights Aerial; any pasted or
  // linked URL lights Custom.
  function syncChips(presets) {
    if (!presets) return;
    _renderCustomChip(presets);
    const chips = presets.querySelectorAll('.basemap-chip');
    chips.forEach(c => c.classList.remove('active'));
    let want = 'osm';
    if (skyIsOpen() || skyModeOn()) {
      want = 'sky';
    } else {
      const a = global.__GEOSONIFY_BASEMAP_ACTIVE;
      const k = _kindOf(a);
      want = _isAerialFamily(a) ? 'aerial' : k;
    }
    chips.forEach(c => { if (c.dataset.basemap === want) c.classList.add('active'); });
    _syncWaybackRow();
  }

  function _resyncChips() {
    syncChips(document.getElementById('basemapPresets'));
    _syncPasteCard();
  }

  // The Custom chip sits before Sky, and exists only while there is a custom
  // source to show (remembered, or arrived in a link).
  function _renderCustomChip(presets) {
    const cur = _currentCustom();
    let chip = presets.querySelector('.basemap-chip[data-basemap="custom"]');
    if (!cur) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('button');
      chip.className = 'basemap-chip';
      chip.dataset.basemap = 'custom';
      chip.textContent = 'Custom';
      const sky = presets.querySelector('.basemap-chip[data-basemap="sky"]');
      presets.insertBefore(chip, sky || null);
      _wireChip(chip, presets);
    }
    chip.title = cur.label || _hostOf(cur.url) || 'Your own imagery';
  }

  function _warner(el) {
    return (msg) => {
      if (!el) return;
      if (!msg) { el.classList.remove('show'); el.textContent = ''; return; }
      el.textContent = msg;
      el.classList.add('show');
    };
  }

  // Apply a source chosen in the UI (a chip, the date list, the paste box) and
  // report through `setWarn`. Records it as active only once it is showing.
  // `then(r)` runs after success (r is MapManager's result).
  function _choose(source, setWarn, ui, then) {
    const res = leaveSkyThen(() => _applyBasemap(source, '', ui));
    if (!res.ok) { setWarn(res.error); _resyncChips(); return; }
    const done = (r) => {
      _writeBasemapParam(_kindOf(source) === 'osm' ? null : source);
      if (then) then(r || res);
      _resyncChips();
    };
    if (!res.pending) { done(res); return; }
    res.promise.then(r => {
      if (!r || r.stale) return;
      if (!r.ok) { setWarn(r.error); _resyncChips(); return; }
      done(r);
    });
  }

  // ── Hold Standard: the streets over the imagery ────────────────────────────
  //
  // Holding the Standard chip while other imagery is showing draws the street
  // map over it (geosonify-sky-flip.js peekEarth) until released. A tap still
  // switches to Standard, as always.
  const HOLD_MS = 350;
  function _wireHoldPeek(chip) {
    let timer = null, peeking = false, suppressClick = false;
    const F = () => global.GeosonifySkyFlip;
    const canPeek = () => {
      if (skyIsOpen()) return false;
      const k = _kindOf(global.__GEOSONIFY_BASEMAP_ACTIVE);
      return k !== 'osm' && !!(F() && F().peekEarth);
    };
    const start = (e) => {
      if (e.button != null && e.button !== 0) return;
      if (!canPeek()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try { peeking = !!F().peekEarth(true); } catch (err) { peeking = false; }
        if (peeking) { suppressClick = true; chip.classList.add('peeking'); }
      }, HOLD_MS);
    };
    const end = () => {
      clearTimeout(timer); timer = null;
      if (!peeking) return;
      peeking = false;
      chip.classList.remove('peeking');
      try { F().peekEarth(false); } catch (err) {}
    };
    chip.addEventListener('pointerdown', start);
    ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(ev => chip.addEventListener(ev, end));
    chip.addEventListener('contextmenu', e => { if (peeking || timer) e.preventDefault(); });
    // A hold that peeked is not also a tap.
    chip.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }

  // One chip's tap.
  function _wireChip(chip, presets) {
    const scope = presets.parentNode || document;
    const warn = scope.querySelector('#basemapWarn');
    const setWarn = _warner(warn);
    const ui = { warn };
    chip.addEventListener('click', () => {
      const which = chip.dataset.basemap;
      if (which === 'sky') {
        const res = openSky();
        setWarn(res.ok ? '' : res.error);
        _resyncChips();
        return;
      }
      let source = which;
      if (which === 'custom') {
        const cur = _currentCustom();
        if (!cur) { _resyncChips(); return; }
        source = cur.url;
      }
      // Earth imagery: back down from the sky first (animated), then show it.
      setWarn(which === 'custom' ? 'Loading your imagery…' : '');
      _choose(source, setWarn, ui, (r) => {
        setWarn(which === 'custom' && _basemapHasSecret(source)
          ? 'Heads up: this imagery URL contains a key or token, and links you share include it.' : '');
        if (which === 'custom' && r && r.label) {
          const mine = _loadCustom();
          if (mine && mine.url === source && !mine.label) _saveCustom(source, r.label);
        }
      });
      // Light the chosen chip now; the sky one goes off when the turn ends.
      presets.querySelectorAll('.basemap-chip').forEach(c => c.classList.toggle('active', c === chip));
    });
    if (chip.dataset.basemap === 'osm') _wireHoldPeek(chip);
  }

  // The chips (main screen, or the FAQ fallback).
  function wireChips(scope) {
    const presets = scope.querySelector('#basemapPresets');
    if (!presets) return;
    presets.querySelectorAll('.basemap-chip').forEach(chip => _wireChip(chip, presets));
    _wireWayback(scope);
    _resyncChips();
  }

  // ── Aerial by date (Esri World Imagery Wayback) ────────────────────────────
  //
  // A row under the chips, shown while Aerial is the imagery: "Latest" or a
  // published release date. The list loads the first time it is needed.
  function _wireWayback(scope) {
    const row = scope.querySelector('#basemapWaybackRow');
    const sel = scope.querySelector('#basemapWaybackSelect');
    if (!row || !sel) return;
    const setWarn = _warner(scope.querySelector('#basemapWarn'));
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v === '__all') { _wbShowAll = true; _wbKey = null; _syncWaybackRow(); return; }
      if (/^c:\d+$/.test(v)) {
        const e = _wbCatItems[v];
        if (!e) return;
        setWarn('Loading ' + e.l + ' · ' + e.r + '…');
        _choose(e.u, setWarn, {}, () => setWarn(''));
        return;
      }
      const source = v ? 'aerial@' + v : 'aerial';
      setWarn(v ? 'Loading Aerial imagery from ' + v + '…' : '');
      _choose(source, setWarn, {}, () => setWarn(''));
    });
  }

  /*
    The date list offers the releases in which the imagery at the MAP'S CENTRE
    actually changed (GeosonifyWayback.localChanges: one small request per real
    change), each labelled with when its photographs were taken there, where
    Esri says ("2019-06-26 · photos 2015-03"). It is rebuilt when the map
    settles, only while the row is showing, and cached per tile. "Every
    release…" switches to the full list. If the change service can't be
    reached, the full list is shown, as before.
  */
  /*
    v1.8: the list also holds the CURATED LOCAL LAYERS covering the map's centre
    (GeosonifyImageryCatalogue.near: a test against boxes baked into the
    catalogue, no network), interleaved with Esri's editions by when the
    photographs were taken: an Esri edition by its capture date where known
    (else its published date), a local layer by its year. Two tidy-ups: the
    edition whose picture is the current one is not listed again under Latest,
    and consecutive editions with the same capture date are one (the earliest
    kept: when that photography first appeared). Layers whose coverage could
    not be checked pixel by pixel ("loaded") are offered only if their boxes are
    small, so a national box does not put a rail-corridor layer everywhere.
  */
  let _wbShowAll = false, _wbKey = null, _wbSeq = 0, _wbTimer = null, _wbMapHooked = false;
  let _wbCatItems = {};
  const WB_LOADED_MAX_AREA = 0.5;           // deg² of boxes, for layers whose footprint is unverified

  function _wbCentre() {
    try {
      const m = (typeof MapManager !== 'undefined' && MapManager.getMap) ? MapManager.getMap() : null;
      if (!m) return null;
      const c = m.getCenter();
      return { lat: c.lat, lon: ((c.lng + 180) % 360 + 360) % 360 - 180, zoom: m.getZoom(), map: m };
    } catch (e) { return null; }
  }
  function _esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Local layers to offer at (lat, lon), plus the one showing (even if the
  // map has moved off it).
  function _wbLocal(c, activeEntry) {
    const C = global.GeosonifyImageryCatalogue;
    if (!C || !C.isLoaded()) return activeEntry ? [activeEntry] : [];
    const area = e => (e.b || []).reduce((t, b) => t + Math.abs((b[2] - b[0]) * (b[3] - b[1])), 0);
    const list = C.near(c.lat, c.lon).filter(e => e.s !== 'loaded' || area(e) <= WB_LOADED_MAX_AREA);
    if (activeEntry && !list.includes(activeEntry)) list.push(activeEntry);
    return list;
  }

  // Build the <select>. esri: [{date, label, photo}] newest first; local:
  // catalogue entries. wantValue: the value to keep selected.
  // note.final: every capture date has arrived. Until then the order and the
  // merging stay as first drawn (by published date), and only the labels
  // change, so the list does not reshuffle under someone scrolling it.
  function _wbRender(sel, esri, local, note, wantValue, c) {
    // Esri tidy-ups.
    let ed = esri.slice();
    if (ed.length && (!note.latestPhoto || !ed[0].photo || ed[0].photo === note.latestPhoto)) ed = ed.slice(1);   // = Latest
    if (note.final) ed = ed.filter((e, i) => !(e.photo && ed[i + 1] && ed[i + 1].photo === e.photo));         // keep the earliest of a run
    const rows = ed.map(e => ({ key: ((note.final && e.photo) || e.date).slice(0, 7), value: e.date, label: e.label }));
    _wbCatItems = {};
    local.forEach(e => {
      const v = 'c:' + e.i;
      _wbCatItems[v] = e;
      const out = c && !global.GeosonifyImageryCatalogue.covers(e, c.lat, c.lon);
      const zoomIn = c && e.zr && e.zr[0] != null && c.zoom < e.zr[0];
      rows.push({ key: e.year ? String(e.year) + '-07' : '9999', value: v,
        label: e.l + ' · ' + e.r + (out ? ' (not here)' : zoomIn ? ' (zoom in)' : '') });
    });
    rows.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    const opts = [{ value: '', label: note.latest || 'Latest' }].concat(rows.map(r => ({ value: r.value, label: r.label })));
    if (wantValue && !rows.some(r => r.value === wantValue) && !/^c:/.test(wantValue)) {
      const current = esri.length && esri[0].date === wantValue;
      opts.splice(1, 0, { value: wantValue, label: wantValue + (current ? ' (the current picture)' : ' (no change here)') });
    }
    if (!_wbShowAll) opts.push({ value: '__all', label: 'Every release…' });
    _wbApply(sel, opts, wantValue);
  }

  /*
    Put the options into the list without moving it under the reader (v1.10).
    Same options in the same order: only labels change, in place. Different
    options while the list is open (being scrolled): held back and put in when
    it closes. Otherwise rebuilt.
  */
  let _wbPending = null, _wbBlurHooked = false;
  function _wbApply(sel, opts, want) {
    const open = document.activeElement === sel;
    const same = sel.options.length === opts.length && opts.every((o, i) => sel.options[i].value === o.value);
    if (same) {
      opts.forEach((o, i) => { if (sel.options[i].textContent !== o.label) sel.options[i].textContent = o.label; });
      if (!open) sel.value = want || '';
      _wbPending = null;
      return;
    }
    if (open) {
      _wbPending = { opts, want };
      if (!_wbBlurHooked) {
        _wbBlurHooked = true;
        const flush = () => { const p = _wbPending; _wbPending = null; if (p) _wbApply(sel, p.opts, sel.value && sel.value !== '__all' ? sel.value : p.want); };
        sel.addEventListener('blur', () => setTimeout(flush, 0));
      }
      return;
    }
    sel.innerHTML = opts.map(o => '<option value="' + _esc(o.value) + '">' + _esc(o.label) + '</option>').join('');
    sel.value = want || '';
    _wbPending = null;
  }

  function _fillWayback(sel, wantValue, activeEntry) {
    const W = global.GeosonifyWayback, C = global.GeosonifyImageryCatalogue;
    const lab = document.getElementById('basemapWaybackLabel');
    if (!W || !sel) return;
    const c = _wbCentre();
    if (c && !_wbMapHooked) {
      _wbMapHooked = true;
      c.map.on('moveend', () => {
        const row = document.getElementById('basemapWaybackRow');
        if (!row || row.style.display === 'none' || _wbShowAll) return;
        clearTimeout(_wbTimer);
        _wbTimer = setTimeout(_syncWaybackRow, 600);
      });
    }
    // The catalogue loads the first time the list is shown; draw again then.
    if (C && !C.isLoaded()) C.load().then(() => { _wbKey = null; _syncWaybackRow(); }, () => {});
    const all = () => {
      if (lab) lab.textContent = 'Aerial as published';
      const local = c ? _wbLocal(c, activeEntry) : (activeEntry ? [activeEntry] : []);
      const esri = W.list().map(r => ({ date: r.date, label: r.date }));
      _wbRender(sel, [{ date: '' }].concat(esri), local, {}, wantValue, c);   // full list: nothing is "Latest" twice
    };
    if (_wbShowAll || !c) { all(); return; }
    const tz = Math.max(10, Math.min(19, Math.round(c.zoom))), t = W._tileOf(c.lat, c.lon, tz);
    const key = t.z + '/' + t.y + '/' + t.x + '/' + (wantValue || '') + '/' + (C && C.isLoaded() ? 1 : 0);
    if (key === _wbKey) { sel.value = wantValue || ''; return; }
    _wbKey = key;
    const seq = ++_wbSeq;
    const local = _wbLocal(c, activeEntry);
    if (lab) lab.textContent = 'Aerial: finding changes here…';
    W.localChanges(c.lat, c.lon, c.zoom).then(list => {
      if (seq !== _wbSeq) return;
      if (lab) lab.textContent = 'Aerial, changes here';
      const items = list.map(r => ({ date: r.date, label: r.date, release: r.release, photo: '' }));
      const note = {};
      const draw = () => _wbRender(sel, items, local, note, sel.value && sel.value !== '__all' ? sel.value : wantValue, c);
      draw();
      if (!W.hasCaptureDates()) return;
      const latest = W.list()[0];
      const jobs = (latest ? [{ release: latest.release, latest: true }] : []).concat(items);
      let i = 0, done = 0;
      const next = () => {
        if (seq !== _wbSeq || i >= jobs.length) return;
        const j = jobs[i++];
        W.captureInfo(j.release, c.lat, c.lon, c.zoom).then(info => {
          if (seq !== _wbSeq) return;
          if (info && info.date) {
            const photos = 'photos ' + info.date.slice(0, 7);
            if (j.latest) { note.latest = 'Latest · ' + photos; note.latestPhoto = info.date.slice(0, 7); }
            else { j.label = j.date + ' · ' + photos; j.photo = info.date.slice(0, 7); }
          }
          if (++done === jobs.length) note.final = true;           // all in: order by photo date, merge
          draw();
          next();
        });
      };
      if (!jobs.length) { note.final = true; draw(); }
      next(); next();
    }).catch(() => {
      if (seq !== _wbSeq) return;
      all();                                             // change service unreachable: every release
    });
  }

  function _syncWaybackRow() {
    const row = document.getElementById('basemapWaybackRow');
    const sel = document.getElementById('basemapWaybackSelect');
    if (!row || !sel) return;
    const active = global.__GEOSONIFY_BASEMAP_ACTIVE;
    const k = _kindOf(active);
    const show = _isAerialFamily(active) && !skyIsOpen() && !skyModeOn() && !!global.GeosonifyWayback;
    row.style.display = show ? 'flex' : 'none';
    if (!show) { _wbKey = null; return; }
    let want = '', entry = null;
    if (k === 'wayback') {
      const r = global.GeosonifyWayback.resolve(String(active).slice(7));
      want = r ? r.date : '';
    } else if (k === 'custom') {
      entry = _catEntry(active);
      if (entry) want = 'c:' + entry.i;
    }
    _fillWayback(sel, want, entry);
  }

  // ── The paste-your-own card in the FAQ pane ────────────────────────────────
  function wirePaste(scope) {
    const input = scope.querySelector('#basemapPasteInput');
    const applyBtn = scope.querySelector('#basemapApplyBtn');
    const forgetBtn = scope.querySelector('#basemapForgetBtn');
    if (!input || !applyBtn) return;
    const warn = scope.querySelector('#basemapPasteWarn');
    const setWarn = _warner(warn);
    const ui = { warn };

    const applyPasted = () => {
      const source = input.value.trim();
      if (!source) { setWarn('Paste an imagery URL first.'); return; }
      if (_kindOf(source) !== 'custom') { setWarn('That is one of the built-in choices: use its button on the main screen.'); return; }
      setWarn('Checking this imagery…');
      _choose(source, setWarn, ui, (r) => {
        _saveCustom(source, r && r.label);
        _linkCustom = null;          // your own paste is the Custom choice now
        const host = _hostOf(source);
        setWarn(_basemapHasSecret(source)
          ? 'Heads up: this URL contains a key or token. Links you share include it, so anyone you send one to can see it.'
          : ((r && r.note) || 'Applied. The map now shows this imagery.') +
            ' It stays available as Custom on the Map imagery card' +
            (host ? ', and links you share now show it too (from ' + host + ').' : '.'));
      });
    };
    applyBtn.addEventListener('click', applyPasted);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') applyPasted(); });
    if (forgetBtn) {
      forgetBtn.addEventListener('click', () => {
        const mine = _loadCustom();
        _forgetCustom();
        if (mine && _linkCustom && _linkCustom.url === mine.url) _linkCustom = null;
        if (mine && global.__GEOSONIFY_BASEMAP_ACTIVE === mine.url) {
          _choose('osm', setWarn, ui);
        }
        input.value = '';
        setWarn('Forgotten. Custom is gone from the Map imagery card.');
        _resyncChips();
      });
    }
    _syncPasteCard();
  }

  // The paste box shows the remembered source, and Forget only while there is one.
  function _syncPasteCard() {
    const input = document.getElementById('basemapPasteInput');
    const forgetBtn = document.getElementById('basemapForgetBtn');
    const mine = _loadCustom();
    if (forgetBtn) forgetBtn.style.display = mine ? '' : 'none';
    if (input && mine && !input.value && document.activeElement !== input) input.value = mine.url;
  }

  /*
    Keep the chips honest when the sky is opened or closed from somewhere else:
    the sky view's own close button, Escape, or a ?frame=icrs link. Every one of
    those goes through setFrame(), so watching the frame catches them all.
    Subscribed once for the page; finds the chips by id each time because the
    FAQ re-renders.
  */
  let _frameWatch = false;
  function watchFrame() {
    if (_frameWatch) return;
    try {
      if (global.AppState && global.AppState.subscribe) {
        global.AppState.subscribe('frame', _resyncChips);
        // Sky mode can stay on while the Earth face is showing.
        global.addEventListener('geosonify:skymode', _resyncChips);
        _frameWatch = true;
      }
    } catch (e) {}
  }

  // Record the active basemap in memory (null = back to default) and tell the
  // page: every share link and the address bar carry it as ?basemap= (built in
  // index.html from __GEOSONIFY_BASEMAP_ACTIVE), so they are rebuilt on each
  // change. (Sky is never recorded here: it is a frame, carried as ?frame=.)
  function _writeBasemapParam(source) {
    const v = source || null;
    const changed = global.__GEOSONIFY_BASEMAP_ACTIVE !== v;
    global.__GEOSONIFY_BASEMAP_ACTIVE = v;
    if (changed) {
      try { global.dispatchEvent(new CustomEvent('geosonify:basemap', { detail: { source: v } })); } catch (e) {}
    }
    if (_catEntry(v)) _hookLeaveCheck();
    _resyncChips();
  }

  /*
    Leaving a local layer's coverage (v1.9). When the map settles somewhere
    that a curated local layer doesn't cover at all (no part of the view
    touches its coverage — e.g. Track jumps from Cockburn to Christchurch),
    the imagery goes back to plain Aerial (Latest) rather than leaving a blank
    map, and says so. Only curated layers, whose coverage is known; a pasted
    source or a dated Aerial is never switched.
  */
  let _leaveHooked = false, _leaveTimer = null, _leaveNotBefore = 0;
  // A link applies its imagery while the map is still travelling to the shape
  // (and the display viewer re-fits), so give it a moment before judging.
  const LEAVE_SETTLE_MS = 3000;
  function _viewTouches(entry, m) {
    const b = m.getBounds(), c = m.getCenter();
    const shift = 360 * Math.round(c.lng / 360);                 // the world copy the view is on
    const s = b.getSouth(), n = b.getNorth(), w = b.getWest() - shift, e = b.getEast() - shift;
    return (entry.b || []).some(x => x[0] <= n && x[2] >= s && x[1] <= e && x[3] >= w);
  }
  function _leaveCheck() {
    const wait = _leaveNotBefore - Date.now();
    if (wait > 0) { clearTimeout(_leaveTimer); _leaveTimer = setTimeout(_leaveCheck, wait + 50); return; }
    const active = global.__GEOSONIFY_BASEMAP_ACTIVE;
    const entry = _catEntry(active);
    if (!entry || skyIsOpen()) return;
    const m = (typeof MapManager !== 'undefined' && MapManager.getMap) ? MapManager.getMap() : null;
    if (!m || _viewTouches(entry, m)) return;
    const warnEl = document.getElementById('basemapWarn');
    const setWarn = _warner(warnEl);
    _choose('aerial', setWarn, { warn: warnEl }, () => {
      const msg = 'Outside the ' + entry.l + ' ' + entry.r + ' imagery — back to Aerial.';
      if (typeof global.showToast === 'function') { try { global.showToast(msg); } catch (e) { setWarn(msg); } }
      else setWarn(msg);
    });
  }
  function _hookLeaveCheck() {
    if (_leaveHooked) return;
    const m = (typeof MapManager !== 'undefined' && MapManager.getMap) ? MapManager.getMap() : null;
    if (!m) return;
    _leaveHooked = true;
    m.on('moveend', () => { clearTimeout(_leaveTimer); _leaveTimer = setTimeout(_leaveCheck, 400); });
  }

  /**
   * Apply a basemap from the URL. ?basemap= is honoured on EVERY link (it
   * used to be display links only): the sender's imagery is part of what they
   * are showing. Call after MapManager.init, and again after an ?enc= link is
   * decrypted (its imagery is inside the blob).
   * Returns the source applied, or null.
   */
  function applyFromURL() {
    _leaveNotBefore = Date.now() + LEAVE_SETTLE_MS;
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) { return null; }
    const source = params.get('basemap');
    if (!source) return null;
    if (typeof MapManager === 'undefined' || !MapManager.setBasemap) return null;
    const kind = _kindOf(source);
    const res = MapManager.setBasemap(source, {
      onError: () => { _writeBasemapParam(null); }
    });
    const shown = (r) => {
      if (kind === 'custom') {
        _linkCustom = { url: source, label: (r && r.label) || '' };
        // Is it one of the curated layers? Then it is Aerial (chip, date list).
        const C = global.GeosonifyImageryCatalogue;
        if (C && !C.isLoaded()) C.load().then(() => { if (_catEntry(source)) _hookLeaveCheck(); _resyncChips(); }, () => {});
        const host = _hostOf(source);
        if (host && typeof global.showToast === 'function') {
          try { global.showToast('Showing map imagery from ' + host); } catch (e) {}
        }
      }
      _writeBasemapParam(kind === 'osm' ? null : source);
    };
    if (!res || res.ok === false) {
      try { console.warn('[geosonify] basemap from link not shown: ' + (res && res.error)); } catch (e) {}
      return null;
    }
    if (!res.pending) { shown(res); return source; }
    res.promise.then(r => {
      if (!r || r.stale) return;
      if (!r.ok) {
        try { console.warn('[geosonify] basemap from link not shown: ' + r.error); } catch (e) {}
        return;
      }
      shown(r);
    });
    return source;
  }

  /** For index.html: what a share link should say about the imagery, and why it might leak. */
  function shareInfo() {
    const active = global.__GEOSONIFY_BASEMAP_ACTIVE;
    const kind = _kindOf(active);
    return {
      source: kind === 'osm' ? null : active,
      kind: kind,
      host: kind === 'custom' ? _hostOf(active) : '',
      secret: kind === 'custom' && _basemapHasSecret(active)
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init(rootId) {
    injectCSS();
    const rootEl = document.getElementById(rootId || 'faq-root');
    if (!rootEl) {
      console.warn('[faq-ui] Root element not found:', rootId);
      return;
    }
    const data = global.GEOSONIFY_FAQ;
    // Main-screen imagery card first, so renderFAQ knows not to add its own.
    const mount = document.getElementById(IMAGERY_MOUNT_ID);
    if (mount && !mount.querySelector('#basemapPresets')) mount.innerHTML = imageryChipsHTML();
    renderFAQ(rootEl, data);
    wireChips(mount && mount.querySelector('#basemapPresets') ? mount : rootEl);
    wirePaste(rootEl);
    watchFrame();
  }

  global.GeosonifyFAQ = {
    init,
    version: __FAQ_UI_VER__,
    // For other code that wants to send the reader to one side (e.g. a future
    // "see an example" link from an answer).
    // Open one answer from elsewhere in the app (switches to the FAQ tab).
    openItem: openFaqItem,
    showSubtab: function (which, rootId) {
      const rootEl = document.getElementById(rootId || 'faq-root');
      if (rootEl) showSubtab(rootEl, which);
    }
  };
  global.GeosonifyBasemap = { applyFromURL: applyFromURL, shareInfo: shareInfo, kindOf: _kindOf };

})(typeof window !== 'undefined' ? window : this);
