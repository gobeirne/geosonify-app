/*
  geosonify-starpin-groups-integration.js v0.1 — wires the sharing stack into
  the existing starpin-demo.html (NOT FROZEN, UNTESTED IN BROWSER)

  Design goals:
    - ADDITIVE. The shipping app must keep working untouched if this file (or its
      crypto dependency) is absent or the PROFILE isn't frozen yet.
    - One place. All the wiring lives here, not scattered through the 2,750-line
      inline script. The inline script gains only a few tiny, clearly-marked hooks.
    - Honest gating. Real over-the-air sharing needs Argon2id + XChaCha20 (which
      the app doesn't currently bundle) AND a frozen PROFILE. Until BOTH are
      present, sharing UI shows as "not enabled yet" instead of throwing.

  ── What the inline script must provide (tiny hooks; see the diff notes) ──────
    window.StarpinGroupsHost = {
      log:  <the existing `log` object from line ~1000>,
      $:    <the existing $ id-lookup helper>,
      el:   <the existing el() element helper>            // optional; falls back
    };
  and then call, once, after the app has booted:
      StarpinGroups.init();
  and at the two hook points:
      StarpinGroups.onRecordLogged(record);   // inside logIt(), after log.add(...)
      StarpinGroups.renderHere(container, target);  // inside showInfo(), per target

  ── The crypto dependency (you choose the build) ─────────────────────────────
  Provide Argon2id + XChaCha20 as window.StarpinCrypto before init(), e.g. from
  @noble ESM:
      import { argon2id } from '.../@noble/hashes/argon2';
      import { xchacha20poly1305 } from '.../@noble/ciphers/chacha';
      window.StarpinCrypto = { argon2id, xchacha20poly1305 };
  If absent, sharing stays disabled (the app is unaffected).
*/
'use strict';

var StarpinGroups = (function () {

  var ctrl = null, sharing = null, selfsync = null, portable = null, ready = false, reason = '';
  var host = null;

  function $(id) { return host && host.$ ? host.$(id) : document.getElementById(id); }
  function el(tag, cls, txt) {
    if (host && host.el) return host.el(tag, cls, txt);
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;   // textContent only — never innerHTML with data
    return e;
  }

  // Is everything present to do REAL sharing? (deps loaded + PROFILE frozen)
  function readiness() {
    if (typeof GeosonifyStarpinGroup === 'undefined') return 'sharing modules not loaded';
    if (typeof window === 'undefined' || !window.StarpinCrypto ||
        typeof window.StarpinCrypto.argon2id !== 'function' ||
        typeof window.StarpinCrypto.xchacha20poly1305 !== 'function')
      return 'crypto build (Argon2id + XChaCha20) not provided';
    if (!GeosonifyStarpinGroup.PROFILE || GeosonifyStarpinGroup.PROFILE.frozen !== true)
      return 'PROFILE not frozen — sharing disabled until Argon2/padding/JCS are finalised';
    if (!window.StarpinGroupsHost || !window.StarpinGroupsHost.log)
      return 'host log not provided';
    return '';   // ready
  }

  function init() {
    host = (typeof window !== 'undefined') ? window.StarpinGroupsHost : null;
    reason = readiness();
    if (reason) { ready = false; return { ready: false, reason: reason }; }

    var C = window.StarpinCrypto;
    var group = GeosonifyStarpinGroup.create({
      // NOTE: no allowProvisional — real sharing requires a frozen PROFILE, so if
      // we got here the fuse is already open. Provisional sealing stays test-only.
      argon2id: function (pw, salt, o) { return C.argon2id(pw, salt, { t: o.t, m: o.m, p: o.p, dkLen: o.dkLen }); },
      xchacha20poly1305: function (k, n) {
        return { encrypt: function (pt, aad) { return C.xchacha20poly1305(k, n, aad).encrypt(pt); },
                 decrypt: function (ct, aad) { return C.xchacha20poly1305(k, n, aad).decrypt(ct); } };
      }
      // HKDF + SHA-256 default to WebCrypto inside the sealing module
    });
    var sha256 = function (b) { return crypto.subtle.digest('SHA-256', b).then(function (buf) { return new Uint8Array(buf); }); };

    // storage: the live Firestore adapter if firebase is wired, else in-memory
    // (so the UI is exercisable offline without a backend).
    var store;
    if (typeof GeosonifyStarpinFirebase !== 'undefined' && window.__starpinStore) {
      store = window.__starpinStore;   // set by the firebase init (see demo harness)
    } else {
      store = GeosonifyStarpinStorage.memory({ sha256: sha256 });
    }

    var log = host.log;
    sharing  = GeosonifyStarpinSharing.create({ group: group, store: store, log: log, localStorage: window.localStorage });
    selfsync = GeosonifyStarpinSelfSync.create({ group: group, store: store, log: log, localStorage: window.localStorage });
    portable = GeosonifyStarpinPortable.create({ argon2id: C.argon2id, xchacha20poly1305: C.xchacha20poly1305, sha256: sha256 });
    ctrl     = GeosonifyStarpinGroups.create({ sharing: sharing, invite: GeosonifyStarpinInvite, log: log,
                                               portable: portable, store: store,
                                               baseUrl: 'https://geosonify.org/starpin-demo.html' });
    ready = true;

    // auto-prompt if this page was opened from an invite link
    try {
      var inv = ctrl.inviteFromLocation ? ctrl.inviteFromLocation() : null;
      if (inv) promptJoin(inv);
    } catch (e) {}

    return { ready: true, controller: ctrl };
  }

  // --- hook: called from logIt() after a record is added --------------------
  // Non-blocking. If not ready, does nothing (app unaffected).
  function onRecordLogged(record) {
    if (!ready || !record || !record.record_id) return;
    var groups = ctrl.myGroups();
    if (!groups.length) return;                 // nothing to share to
    // Offer a lightweight "share this find" affordance rather than auto-sharing.
    showShareOffer(record, groups);
  }

  // --- hook: called from showInfo() to render "who's been here" -------------
  function renderHere(container, target) {
    if (!container) return;
    container.textContent = '';
    if (!ready) {
      // Silent unless there are groups; keep the shipping UI clean.
      return;
    }
    var groups = ctrl.myGroups();
    if (!groups.length) return;
    groups.forEach(function (g) {
      var block = el('div', 'sp-here');
      container.appendChild(block);
      ctrl.onTargetView(g.groupUuid, target).then(function (view) {
        renderHereView(block, g, view);
      }).catch(function () {});
    });
  }

  function renderHereView(block, g, view) {
    block.textContent = '';
    block.appendChild(el('div', 'sp-here-title', (g.label || 'group') + ' — who\u2019s been here'));
    if (!view.count) { block.appendChild(el('div', 'sp-muted', 'No visits recorded here in ' + (g.label || 'this group') + ' yet.')); return; }
    var ul = el('ul', 'sp-here-list');
    view.visitors.forEach(function (v) {
      var li = el('li', v.you ? 'sp-here-you' : null);
      li.appendChild(el('span', 'sp-ord', '#' + v.ordinal));
      li.appendChild(el('span', 'sp-who', v.you ? (v.handle + ' (you)') : v.handle));
      if (v.time_ms) li.appendChild(el('span', 'sp-when', new Date(v.time_ms).toLocaleDateString()));
      if (v.comment) li.appendChild(el('div', 'sp-cmt', v.comment));   // textContent → safe
      ul.appendChild(li);
    });
    block.appendChild(ul);
    if (view.youArePresent) block.appendChild(el('div', 'sp-muted', 'You\u2019re #' + view.yourOrdinal + ' here in ' + (g.label || 'this group') + '.'));
  }

  // --- minimal share offer (kept tiny; the full panel is groups-ui.js) ------
  function showShareOffer(record, groups) {
    var host$ = $('info') || document.body;
    var bar = el('div', 'sp-share-offer');
    bar.appendChild(el('span', null, 'Share this find with '));
    groups.forEach(function (g) {
      var b = el('button', 'sp-btn sp-btn-sm', g.label || 'group');
      b.addEventListener('click', function () {
        var comment = window.prompt('Add a comment (optional):', '') || '';
        ctrl.share(g.groupUuid, record, { comment: comment }).then(function (r) {
          bar.textContent = r.skipped ? 'Already shared to ' + (g.label || 'group') + '.'
                                      : 'Shared to ' + (g.label || 'group') + '.';
        }).catch(function (e) { bar.textContent = 'Could not share: ' + e.message; });
      });
      bar.appendChild(b);
    });
    var dismiss = el('button', 'sp-link', 'not now');
    dismiss.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
    bar.appendChild(dismiss);
    host$.appendChild(bar);
  }

  function promptJoin(preview) {
    var wrap = el('div', 'sp-modal');
    var sheet = el('div', 'sp-join-sheet');
    sheet.appendChild(el('div', null, (preview.alreadyJoined ? 'Already in ' : 'Join ') + '\u201C' + (preview.label || 'group') + '\u201D?'));
    var codeIn = null;
    if (preview.needsCode) { codeIn = el('input', 'sp-in'); codeIn.placeholder = 'enter the code you were given'; sheet.appendChild(codeIn); }
    var go = el('button', 'sp-btn sp-btn-primary', preview.alreadyJoined ? 'Re-join' : 'Join');
    go.addEventListener('click', function () {
      ctrl.joinFromLink(location.href, codeIn ? codeIn.value.trim() : undefined)
        .then(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          // strip the invite from the visible URL/history (privacy: don't leave
          // a descriptor/code sitting in history or a screenshot)
          try { history.replaceState(null, '', location.pathname); } catch (e) {} })
        .catch(function (e) { sheet.appendChild(el('div', 'sp-warn', 'Could not join: ' + e.message)); });
    });
    sheet.appendChild(go);
    var cancel = el('button', 'sp-link', 'cancel');
    cancel.addEventListener('click', function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); });
    sheet.appendChild(cancel);
    wrap.appendChild(sheet); document.body.appendChild(wrap);
  }

  return {
    init: init,
    readiness: readiness,
    onRecordLogged: onRecordLogged,
    renderHere: renderHere,
    controller: function () { return ctrl; },
    isReady: function () { return ready; }
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = StarpinGroups; }
