/*
 * geosonify-passphrase-ui.js
 *
 * Live strength meter + random passphrase generator for the grid-passphrase
 * modal. Advisory UI only.
 *
 * ── INTEGRATION NOTES ────────────────────────────────────────────────────────
 * - Touches NO frozen format and no encode/decode path.
 * - Deliberately does NOT modify card-renderer.js. That file owns the frozen
 *   shuffle and already has an 'input' listener on #passphraseInput; we attach
 *   an additional, independent listener instead of editing theirs. Both fire.
 * - When "Use this" is clicked we set .value and then dispatch a synthetic
 *   'input' event, so card-renderer's own handler runs normally and the grids
 *   re-shuffle exactly as if the user had typed. Never call card-renderer
 *   internals directly.
 * - Requires geosonify-passphrase-strength.js and geosonify-grids-data.js to
 *   be loaded first (script order in index.html).
 */
'use strict';

(function () {

  const INPUT_ID = 'passphraseInput';
  const HOST_ID = 'passphraseStrengthHost';
  let built = false;
  let wordCount = 6;   // floor for grid mode; 7 recommended if region is guessable
  let lang = null;     // resolved from the browser locale on first build

  function S() {
    return (typeof window !== 'undefined') ? window.PassphraseStrength : null;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function render(value) {
    const api = S();
    const host = document.getElementById(HOST_ID);
    if (!api || !host) return;

    const r = api.estimate(value || '');
    const bar = host.querySelector('.pp-meter-fill');
    const label = host.querySelector('.pp-meter-label');
    const detail = host.querySelector('.pp-meter-detail');
    const warn = host.querySelector('.pp-warnings');

    if (bar) {
      bar.style.width = r.percent + '%';
      bar.style.background = r.colour;
    }

    if (!value) {
      if (label) { label.textContent = 'No passphrase'; label.style.color = '#666'; }
      if (detail) detail.textContent = 'Grids stay in their public order — anyone can decode your codes.';
      if (warn) warn.innerHTML = '';
      return;
    }

    if (label) {
      label.textContent = r.label + ' · ' + r.bits + ' bits';
      label.style.color = r.colour;
    }
    if (detail) {
      detail.textContent = r.meetsRecommended
        ? 'An attacker who knows the region would need ' + r.crackTime.replace(/^in /, '') + '.'
        : 'An attacker who knows the region would find this ' + r.crackTime + '.';
    }
    // Variant near-miss detection. We never rewrite the passphrase silently -
    // that would derive a different location. We only offer a click.
    const vhost = host.querySelector('#ppVariant');
    if (vhost && api.diagnose) {
      const d = api.diagnose(value || '');
      if (d.suggestions.length) {
        const fixed = api.applySuggestions(value, d.suggestions);
        vhost.innerHTML =
          '<div class="pp-variant-msg">Some words look like variant forms that are not in the ' +
          'word list. This is a different passphrase and will decode to a different location:</div>' +
          '<ul class="pp-variant-list">' +
          d.suggestions.map(x => '<li><code>' + escapeHtml(x.from) + '</code> \u2192 <code>' +
            escapeHtml(x.to) + '</code> <span>(' + escapeHtml(x.why) + ')</span></li>').join('') +
          '</ul><button type="button" class="pp-btn pp-btn-ghost" id="ppFixBtn">Correct these</button>';
        vhost.style.display = 'block';
        const fixBtn = vhost.querySelector('#ppFixBtn');
        if (fixBtn) fixBtn.addEventListener('click', () => {
          const inp = document.getElementById(INPUT_ID);
          if (!inp) return;
          inp.value = fixed;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          render(fixed);
        });
      } else {
        vhost.style.display = 'none';
        vhost.innerHTML = '';
      }
    }

    if (warn) {
      const items = r.warnings.slice();
      if (!r.meetsRecommended && value) {
        items.push('Below the recommended strength for grid mode. Use six or more random words, or switch to AES URL encryption.');
      }
      warn.innerHTML = items.length
        ? '<ul class="pp-warn-list">' + items.map(w => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul>'
        : '';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── Suggestion ─────────────────────────────────────────────────────────────

  function newSuggestion() {
    const api = S();
    const el = document.getElementById('ppSuggestionText');
    if (!api || !el) return;
    if (!lang) lang = api.defaultLanguage ? api.defaultLanguage() : 'en';
    const g = api.generate(wordCount, '-', lang);
    if (!g) { el.textContent = '(wordlist unavailable)'; return; }
    el.textContent = g.phrase;
    el.dataset.phrase = g.phrase;

    // When the chosen script needs an IME, always offer an English alternative
    // as well. A passphrase you cannot retype is a passphrase you have lost,
    // and there is no recovery path.
    const alt = document.getElementById('ppAlt');
    const altEl = document.getElementById('ppAltText');
    const ime = document.getElementById('ppImeNote');
    const needsIME = api.needsIME && api.needsIME(g.phrase);
    if (alt && altEl && lang !== 'en') {
      const ga = api.generate(wordCount, '-', 'en');
      if (ga) { altEl.textContent = ga.phrase; altEl.dataset.phrase = ga.phrase; alt.style.display = 'block'; }
    } else if (alt) {
      alt.style.display = 'none';
    }
    if (ime) ime.style.display = needsIME ? 'block' : 'none';
    const conf = document.getElementById('ppConfirm');
    const confIn = document.getElementById('ppConfirmInput');
    const confSt = document.getElementById('ppConfirmStatus');
    if (conf) conf.style.display = needsIME ? 'block' : 'none';
    if (confIn) confIn.value = '';
    if (confSt) { confSt.textContent = ''; confSt.className = 'pp-confirm-status'; }
    const bits = document.getElementById('ppWordBits');
    if (bits) {
      // Shown so the trade-off is legible: the wordlist is public by design,
      // so all the strength is in the number of randomly chosen words.
      bits.textContent = g.bits.toFixed(0) + ' bits of entropy';
      bits.style.color = g.bits >= api.RECOMMENDED_BITS ? '#1a7a4c' : '#b3541e';
    }
  }

  function useSuggestion(sourceId) {
    const el = document.getElementById(sourceId || 'ppSuggestionText');
    const input = document.getElementById(INPUT_ID);
    if (!el || !input || !el.dataset.phrase) return;
    input.value = el.dataset.phrase;
    // Let card-renderer's own listener do the real work.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    render(input.value);
    const note = document.getElementById('ppSaveNote');
    if (note) note.style.display = 'block';
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  function build() {
    if (built) return;
    const input = document.getElementById(INPUT_ID);
    if (!input) return;
    const group = input.closest('.input-group') || input.parentNode;
    if (!group || document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.className = 'pp-host';
    host.innerHTML = [
      '<div class="pp-meter-track"><div class="pp-meter-fill"></div></div>',
      '<div class="pp-meter-row">',
      '  <span class="pp-meter-label">No passphrase</span>',
      '  <span class="pp-meter-detail"></span>',
      '</div>',
      '<div class="pp-warnings"></div>',
      '<div class="pp-variant" id="ppVariant" style="display:none;"></div>',
      '<div class="pp-suggest">',
      '  <div class="pp-suggest-head">Your passphrase — generated on this device, never sent anywhere:</div>',
      '  <div class="pp-langrow" id="ppLangRow"></div>',
      '  <div class="pp-suggest-row">',
      '    <code id="ppSuggestionText" class="pp-suggest-text"></code>',
      '    <button type="button" class="pp-btn pp-btn-inline" id="ppUseBtn">Use this</button>',
      '    <button type="button" class="pp-btn pp-btn-ghost pp-btn-inline" id="ppCopyBtn">Copy</button>',
      '  </div>',
      '  <div class="pp-confirm" id="ppConfirm" style="display:none;">',
      '    <div class="pp-confirm-head">Prove you can retype it. Type the phrase above using your own ',
      '    keyboard and IME \u2014 do not paste it. This catches the commonest mistake, which is entering ',
      '    a different script form of the same words.</div>',
      '    <input type="text" id="ppConfirmInput" class="pp-confirm-input" autocomplete="off" ',
      '      placeholder="Retype the phrase here" />',
      '    <div class="pp-confirm-status" id="ppConfirmStatus"></div>',
      '  </div>',
      '  <div class="pp-alt" id="ppAlt" style="display:none;">',
      '    <div class="pp-alt-head">Or in English, if that is easier to write down and retype:</div>',
      '    <div class="pp-suggest-row">',
      '      <code id="ppAltText" class="pp-suggest-text"></code>',
      '      <button type="button" class="pp-btn pp-btn-ghost pp-btn-inline" id="ppUseAltBtn">Use this</button>',
      '    </div>',
      '  </div>',
      '  <div class="pp-ime-note" id="ppImeNote" style="display:none;">This passphrase needs an input method ',
      '  for its script. You must be able to retype it <strong>exactly</strong>, including the hyphens, on any ',
      '  device where you will decode these codes — substituting a space, an ideographic space, or a different ',
      '  separator produces a different passphrase and silently decodes to the wrong location, with no error.</div>',
      '  <div class="pp-wordcount">',
      '    <span class="pp-wordcount-label">Words:</span>',
      '    <span id="ppWordCount"></span>',
      '    <span class="pp-wordcount-bits" id="ppWordBits"></span>',
      '  </div>',
      '  <div class="pp-suggest-actions">',
      '    <button type="button" class="pp-btn pp-btn-ghost" id="ppRegenBtn">Generate another</button>',
      '  </div>',
      '  <div class="pp-suggest-why"><strong>Use this rather than inventing your own.</strong> Words you ',
      '  think of yourself are worth a fraction of what randomly chosen ones are worth — people cluster ',
      '  heavily around the same few thousand words, and a phrase from a song, book or film is worth almost ',
      '  nothing. Grid passphrases have no key-stretching, and an attacker who can guess the rough region ',
      '  can discard wrong guesses after just one or two characters, so a short or predictable passphrase ',
      '  falls quickly. Six words is the floor; use seven if the location is sensitive.</div>',
      '  <div class="pp-save-note" id="ppSaveNote" style="display:none;">Write this down now. There is no ',
      '  recovery — without the exact passphrase, codes made with it cannot be decoded by anyone, including you.</div>',
      '</div>'
    ].join('');

    group.appendChild(host);

    // Word-count buttons. More words is the only lever that matters here:
    // seven words from this 2025-word list (76.9 bits) is worth essentially the
    // same as six words of EFF diceware (77.5 bits), with no extra asset.
    const wcHost = host.querySelector('#ppWordCount');
    if (wcHost) {
      [5, 6, 7, 8].forEach(n => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pp-wc-btn' + (n === wordCount ? ' pp-wc-active' : '');
        b.textContent = n;
        b.dataset.n = n;
        b.addEventListener('click', () => {
          wordCount = n;
          wcHost.querySelectorAll('.pp-wc-btn').forEach(x =>
            x.classList.toggle('pp-wc-active', +x.dataset.n === wordCount));
          newSuggestion();
        });
        wcHost.appendChild(b);
      });
    }

    // Language selector, populated from whichever BIP39 grids the page loaded.
    const api0 = S();
    const langRow = host.querySelector('#ppLangRow');
    if (api0 && langRow && api0.availableLanguages) {
      const langs = api0.availableLanguages();
      if (!lang) lang = api0.defaultLanguage ? api0.defaultLanguage() : 'en';
      if (langs.length > 1) {
        const sel = document.createElement('select');
        sel.id = 'ppLangSelect';
        sel.className = 'pp-lang-select';
        langs.forEach(L => {
          const o = document.createElement('option');
          o.value = L.code; o.textContent = L.name;
          if (L.code === lang) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => { lang = sel.value; newSuggestion(); });
        const lbl = document.createElement('span');
        lbl.className = 'pp-lang-label';
        lbl.textContent = 'Word language:';
        langRow.appendChild(lbl);
        langRow.appendChild(sel);
        // Every list is 2025 words, so the choice costs nothing in strength.
        const note = document.createElement('span');
        note.className = 'pp-lang-note';
        note.textContent = 'all lists are 2,025 words \u2014 same strength';
        langRow.appendChild(note);
      }
    }

    // Copy is available in EVERY language. Copy-paste is the byte-exact
    // transfer channel; retyping is the lossy one. Withholding copy for CJK
    // would push users toward dictation, which is where variant-form mistakes
    // actually happen - especially for the RECIPIENT, whose IME settings we
    // cannot see. The confirm-retype step below addresses reproducibility
    // without taking away the safe transfer path.
    const copyBtn = document.getElementById('ppCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const el = document.getElementById('ppSuggestionText');
      const text = el && el.dataset.phrase;
      if (!text) return;
      const done = () => { copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => {});
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });

    const confirmInput = document.getElementById('ppConfirmInput');
    if (confirmInput) confirmInput.addEventListener('input', () => {
      const api1 = S();
      const el = document.getElementById('ppSuggestionText');
      const st = document.getElementById('ppConfirmStatus');
      if (!api1 || !el || !st || !api1.compareTyped) return;
      const r = api1.compareTyped(confirmInput.value, el.dataset.phrase || '');
      st.className = 'pp-confirm-status pp-cs-' + r.status;
      if (r.status === 'empty') { st.textContent = ''; return; }
      if (r.status === 'exact') {
        st.textContent = 'Match. You can reproduce this passphrase on this device.';
      } else if (r.status === 'variant') {
        st.innerHTML = 'Same words, but you typed ' + escapeHtml(r.detail) + '. ' +
          '<strong>This is a different passphrase</strong> and decodes to a different location. ' +
          'Either match the form shown above, or use what you typed and be aware that anyone you ' +
          'share it with must copy and paste it \u2014 retyping from a note will not reproduce it. ' +
          '<button type="button" class="pp-btn pp-btn-ghost" id="ppUseTypedBtn">Use what I typed</button>';
        const b = st.querySelector('#ppUseTypedBtn');
        if (b) b.addEventListener('click', () => {
          const inp = document.getElementById(INPUT_ID);
          if (!inp) return;
          inp.value = confirmInput.value.normalize('NFC').trim();
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          render(inp.value);
        });
      } else {
        st.textContent = 'Does not match yet.';
      }
    });

    const useBtn = document.getElementById('ppUseBtn');
    const regenBtn = document.getElementById('ppRegenBtn');
    if (useBtn) useBtn.addEventListener('click', () => useSuggestion('ppSuggestionText'));
    const useAltBtn = document.getElementById('ppUseAltBtn');
    if (useAltBtn) useAltBtn.addEventListener('click', () => useSuggestion('ppAltText'));
    if (regenBtn) regenBtn.addEventListener('click', newSuggestion);

    // Independent listener — card-renderer keeps its own.
    input.addEventListener('input', e => render(e.target.value));

    newSuggestion();
    render(input.value);
    built = true;
  }

  /** Rebuild the suggestion whenever the modal is opened, so the example the
   *  user sees is always freshly generated rather than a stale one. */
  function watchModal() {
    const modal = document.getElementById('passphraseModal');
    if (!modal || typeof MutationObserver === 'undefined') return;
    let wasOpen = false;
    new MutationObserver(() => {
      const open = modal.classList.contains('active') ||
                   (modal.style.display && modal.style.display !== 'none');
      if (open && !wasOpen) {
        build();
        newSuggestion();
        const input = document.getElementById(INPUT_ID);
        render(input ? input.value : '');
        const note = document.getElementById('ppSaveNote');
        if (note) note.style.display = 'none';
      }
      wasOpen = open;
    }).observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  function init() { build(); watchModal(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GeosonifyPassphraseUI = { render, newSuggestion, build };
})();
