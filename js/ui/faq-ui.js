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

  No external dependencies.
*/

(function(global) {
  'use strict';

  const __FAQ_UI_VER__ = 'v1.0';
  try { console.log('[geosonify] faq-ui ' + __FAQ_UI_VER__ + ' loaded'); } catch(e) {}

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

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderFAQ(rootEl, data) {
    if (!data) {
      rootEl.innerHTML = '<p style="padding:24px 16px;color:#888;">FAQ content not loaded.</p>';
      return;
    }

    const parts = [];

    // ── FAQ sections ──
    if (data.sections && data.sections.length) {
      parts.push(`<p class="faq-section-heading">FAQ</p>`);
    }
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

    // ── Examples — wrapped in own container so .card:nth-child() colour selectors
    //    in geosonify-styles.css fire correctly (count resets inside the wrapper) ──
    if (data.examples && data.examples.length) {
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
    }

    // ── Basemap / imagery — between examples and credits ──
    parts.push(`
<div class="card">
  <div class="card-header">Map imagery</div>
  <div class="card-body">
    <p class="basemap-note" style="margin-bottom:12px;">Choose what the map shows underneath your codes. Aerial is satellite/aerial imagery; Standard is the plain street map. You can also paste any XYZ tile URL or ArcGIS hosted-tile URL. This is your own viewing preference — it isn't baked into a normal share link. When you build a display link from the Output tab, your basemap choice travels with it so the viewer sees the same imagery.</p>
    <div class="basemap-presets" id="basemapPresets">
      <button class="basemap-chip active" data-basemap="osm">Standard</button>
      <button class="basemap-chip" data-basemap="aerial">Aerial</button>
      <button class="basemap-chip" data-basemap="topo">Topographic</button>
    </div>
    <div class="basemap-paste-row">
      <input type="text" id="basemapPasteInput" placeholder="Paste imagery URL (…/{z}/{x}/{y} or …/MapServer)" autocomplete="off" spellcheck="false">
      <button class="basemap-apply" id="basemapApplyBtn">Apply</button>
    </div>
    <p class="basemap-warn" id="basemapWarn"></p>
  </div>
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

    rootEl.innerHTML = parts.join('\n');

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

    // ── Basemap control wiring ──
    wireBasemapControl(rootEl);
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

  function wireBasemapControl(rootEl) {
    const presets = rootEl.querySelector('#basemapPresets');
    const input = rootEl.querySelector('#basemapPasteInput');
    const applyBtn = rootEl.querySelector('#basemapApplyBtn');
    const warn = rootEl.querySelector('#basemapWarn');
    if (!presets || !input || !applyBtn) return;
    const ui = { warn };

    const clearActive = () => presets.querySelectorAll('.basemap-chip').forEach(c => c.classList.remove('active'));
    const setWarn = (msg, kind) => {
      if (!warn) return;
      if (!msg) { warn.classList.remove('show'); warn.textContent = ''; return; }
      warn.textContent = msg;
      warn.classList.add('show');
    };

    presets.querySelectorAll('.basemap-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const source = chip.dataset.basemap;
        const attrib = chip.dataset.attrib || '';
        const res = _applyBasemap(source, attrib, ui);
        if (!res.ok) { setWarn(res.error); return; }
        clearActive();
        chip.classList.add('active');
        setWarn('');
        input.value = '';
        _writeBasemapParam(source === 'osm' ? null : source);
      });
    });

    const applyPasted = () => {
      const source = input.value.trim();
      if (!source) { setWarn('Paste an imagery URL first.'); return; }
      const res = _applyBasemap(source, '', ui);
      if (!res.ok) { setWarn(res.error); return; }
      clearActive();
      if (_basemapHasSecret(source)) {
        setWarn('Heads up: this URL contains a key or token. It will be visible to anyone you share the link with.');
      } else {
        setWarn('');
      }
      _writeBasemapParam(source);
    };
    applyBtn.addEventListener('click', applyPasted);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') applyPasted(); });

    // Reflect any basemap already chosen via URL param into the UI.
    if (global.__GEOSONIFY_BASEMAP_ACTIVE) {
      const active = global.__GEOSONIFY_BASEMAP_ACTIVE;
      let matched = false;
      presets.querySelectorAll('.basemap-chip').forEach(chip => {
        if (chip.dataset.basemap === active) { clearActive(); chip.classList.add('active'); matched = true; }
      });
      if (!matched) { clearActive(); input.value = active; }
    }
  }

  // Record the active basemap in memory only. It is intentionally NOT written
  // to the live URL: in normal full-app use the basemap is a personal viewing
  // preference, not part of the shareable state. It becomes URL-relevant only
  // when the user builds a display link, where the display-link builder reads
  // __GEOSONIFY_BASEMAP_ACTIVE and emits ?basemap=. null = back to default.
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
    renderFAQ(rootEl, data);
  }

  global.GeosonifyFAQ = { init, version: __FAQ_UI_VER__ };
  global.GeosonifyBasemap = { applyFromURL: applyFromURL };

})(typeof window !== 'undefined' ? window : this);
