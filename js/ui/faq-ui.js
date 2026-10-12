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

  No external dependencies.
*/

(function(global) {
  'use strict';

  const __FAQ_UI_VER__ = 'v1.4';
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

  // The main-screen card: the four chips, and a warning line that is empty
  // (and takes no space) unless something fails.
  function imageryChipsHTML() {
    return `
    <div class="basemap-presets" id="basemapPresets" style="margin:0;">
      <button class="basemap-chip active" data-basemap="osm">Standard</button>
      <button class="basemap-chip" data-basemap="aerial">Aerial</button>
      <button class="basemap-chip" data-basemap="topo">Topographic</button>
      <button class="basemap-chip" data-basemap="sky">Sky</button>
    </div>
    <p class="basemap-warn" id="basemapWarn"></p>`;
  }

  // In the FAQ pane: paste your own tile source.
  function ownImageryHTML() {
    return `
    <div class="basemap-paste-row">
      <input type="text" id="basemapPasteInput" placeholder="Paste imagery URL (…/{z}/{x}/{y} or …/MapServer)" autocomplete="off" spellcheck="false">
      <button class="basemap-apply" id="basemapApplyBtn">Apply</button>
    </div>
    <p class="basemap-note">Any XYZ tile URL, or an ArcGIS hosted-tile URL ending in /MapServer. Imagery is your own viewing preference: it isn't part of a normal share link, but it does travel with a display link built on the Output tab.</p>
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
    return /[?&](token|apikey|api_key|key|access_token)=/i.test(String(url || ''));
  }

  function _applyBasemap(source, attribution, ui) {
    if (typeof MapManager === 'undefined' || !MapManager.setBasemap) return { ok: false, error: 'Map not ready.' };
    const res = MapManager.setBasemap(source, {
      attribution: attribution,
      onError: msg => { if (ui && ui.warn) { ui.warn.textContent = msg; ui.warn.classList.add('show'); } }
    });
    return res;
  }

  // Which chip should look active: Sky in Sky mode (either face), otherwise
  // the Earth imagery in use (a pasted URL lights no chip).
  function syncChips(presets, input) {
    if (!presets) return;
    const chips = presets.querySelectorAll('.basemap-chip');
    chips.forEach(c => c.classList.remove('active'));
    let want = 'osm';
    if (skyIsOpen() || skyModeOn()) {
      want = 'sky';
    } else if (global.__GEOSONIFY_BASEMAP_ACTIVE) {
      want = global.__GEOSONIFY_BASEMAP_ACTIVE;
    }
    let matched = false;
    chips.forEach(c => { if (c.dataset.basemap === want) { c.classList.add('active'); matched = true; } });
    if (!matched && input && want !== 'sky') input.value = want;
  }

  function _resyncChips() {
    syncChips(document.getElementById('basemapPresets'), document.getElementById('basemapPasteInput'));
  }

  function _warner(el) {
    return (msg) => {
      if (!el) return;
      if (!msg) { el.classList.remove('show'); el.textContent = ''; return; }
      el.textContent = msg;
      el.classList.add('show');
    };
  }

  // The four chips (main screen, or the FAQ fallback).
  function wireChips(scope) {
    const presets = scope.querySelector('#basemapPresets');
    if (!presets) return;
    const warn = scope.querySelector('#basemapWarn');
    const setWarn = _warner(warn);
    const ui = { warn };

    presets.querySelectorAll('.basemap-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const source = chip.dataset.basemap;
        if (source === 'sky') {
          const res = openSky();
          setWarn(res.ok ? '' : res.error);
          _resyncChips();
          return;
        }
        // Earth imagery: back down from the sky first (animated), then show it.
        const res = leaveSkyThen(() => _applyBasemap(source, chip.dataset.attrib || '', ui));
        if (!res.ok) { setWarn(res.error); _resyncChips(); return; }
        setWarn('');
        const input = document.getElementById('basemapPasteInput');
        if (input) input.value = '';
        _writeBasemapParam(source === 'osm' ? null : source);
        // Light the chosen chip now; the sky one goes off when the turn ends.
        presets.querySelectorAll('.basemap-chip').forEach(c => c.classList.toggle('active', c === chip));
        if (!skyIsOpen()) _resyncChips();
      });
    });
    _resyncChips();
  }

  // The paste-your-own card in the FAQ pane.
  function wirePaste(scope) {
    const input = scope.querySelector('#basemapPasteInput');
    const applyBtn = scope.querySelector('#basemapApplyBtn');
    if (!input || !applyBtn) return;
    const warn = scope.querySelector('#basemapPasteWarn');
    const setWarn = _warner(warn);
    const ui = { warn };

    const applyPasted = () => {
      const source = input.value.trim();
      if (!source) { setWarn('Paste an imagery URL first.'); return; }
      const res = leaveSkyThen(() => _applyBasemap(source, '', ui));
      if (!res.ok) { setWarn(res.error); return; }
      setWarn(_basemapHasSecret(source)
        ? 'Heads up: this URL contains a key or token. It will be visible to anyone you share the link with.'
        : 'Applied. The map now shows this imagery.');
      _writeBasemapParam(source);
      _resyncChips();
    };
    applyBtn.addEventListener('click', applyPasted);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') applyPasted(); });
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

  // Record the active basemap in memory only. It is intentionally NOT written
  // to the live URL: in normal full-app use the basemap is a personal viewing
  // preference, not part of the shareable state. It becomes URL-relevant only
  // when the user builds a display link, where the display-link builder reads
  // __GEOSONIFY_BASEMAP_ACTIVE and emits ?basemap=. null = back to default.
  // (Sky is never recorded here: it is a frame, carried as ?frame=.)
  function _writeBasemapParam(source) {
    global.__GEOSONIFY_BASEMAP_ACTIVE = source || null;
  }

  /**
   * Apply a basemap from a URL param at load time. Call after MapManager.init.
   * The ?basemap= param is a sender's "show the viewer this" instruction, so it
   * is honored ONLY on display links (those carrying ?display). A plain shape
   * link opens in the recipient's own current/default basemap and ignores it.
   * Returns the active source (or null for default/OSM, or non-display links).
   */
  function applyFromURL() {
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) { return null; }
    // Only display links carry an intended basemap for the recipient.
    if (!params.has('display')) return null;
    const source = params.get('basemap');
    if (!source) return null;
    global.__GEOSONIFY_BASEMAP_ACTIVE = source;
    if (typeof MapManager !== 'undefined' && MapManager.setBasemap) {
      MapManager.setBasemap(source, {
        onError: () => { global.__GEOSONIFY_BASEMAP_ACTIVE = null; }
      });
    }
    return source;
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
  global.GeosonifyBasemap = { applyFromURL: applyFromURL };

})(typeof window !== 'undefined' ? window : this);
