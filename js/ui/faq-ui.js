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

    // ── Credits — native .card matching original style ──
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

})(typeof window !== 'undefined' ? window : this);
