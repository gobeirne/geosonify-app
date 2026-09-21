/*
  geosonify-starpin-groups-integration.js v0.2 — wires sharing into
  starpin-demo.html (NOT FROZEN, UNTESTED IN BROWSER)

  v0.2 rebuilds the boot model after review. v0.1 inferred readiness from <script>
  order, which is a bug: module scripts defer, so the crypto module ran AFTER the
  classic inline script that called init(). This version uses an explicit async
  readiness promise and never guesses from ordering.

  Safety properties (all from review round on the integration):
    - FAIL CLOSED on storage: no configured persistent store => sharing UNAVAILABLE.
      Never a silent in-memory prod fallback (that "succeeds" then loses shares on
      refresh). Memory only behind explicit allowMemoryStore, for tests.
    - AWAIT init: init() is async and returns a Promise; callers await it. Hooks
      wrap async work so rejections are logged, not swallowed by a sync try/catch.
    - TWO-LAYER PROFILE fuse: seal() refuses a provisional PROFILE; this layer ALSO
      refuses to enable live sharing unless PROFILE.frozen === true.
    - ONE target builder: the host supplies targetForStar/targetForCornerstone; the
      group code never re-implements the Gaia-id parse. No stable id => REFUSE the
      target, never mint starpin:name:unknown.
    - renderHere DEDUPED + CACHED so repeated showInfo()/redraws don't become a
      Firestore-read storm.
    - Never swallow silently: non-fatal, but console.warn so beta debugging works.
*/
'use strict';

var StarpinGroups = (function () {

  var ctrl = null, sharing = null, selfsync = null, portable = null;
  var host = null, ready = false, reason = 'not initialised';
  var provisional = null;      // the active provisionalTag, or null when running frozen
  var renderCache = {};        // key "group|handle" -> { at, promise }
  var CACHE_MS = 15000;

  function el(tag, cls, txt) {
    if (host && host.el) return host.el(tag, cls, txt);
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;      // textContent only
    return e;
  }
  function warn(m, e) { try { console.warn('[starpin] ' + m, e || ''); } catch (_) {} }
  function webSha256(b) { return crypto.subtle.digest('SHA-256', b).then(function (buf) { return new Uint8Array(buf); }); }

  // ── init: explicit, async, no ordering assumptions ──────────────────────
  function init(opts) {
    return Promise.resolve().then(function () {
      opts = opts || {};
      host = opts.host || (typeof window !== 'undefined' ? window.StarpinGroupsHost : null);
      var C = opts.crypto || (typeof window !== 'undefined' ? window.StarpinCrypto : null);

      if (typeof GeosonifyStarpinGroup === 'undefined') return fail('sharing modules not loaded');
      if (!C || typeof C.argon2id !== 'function' || typeof C.xchacha20poly1305 !== 'function')
        return fail('crypto build (Argon2id + XChaCha20) not available');

      // PROFILE gate, two states:
      //   - No provisionalTag => this layer requires a FROZEN profile, so a plain
      //     UI wiring can never mint a PERMANENT blob under placeholder params.
      //   - provisionalTag set => run under a NAMESPACED provisional profile. The
      //     tag is mixed into the Argon2 salt prefix by the sealing module, so this
      //     data derives different handles/keys than the real frozen format ever
      //     will and can never collide with or be mis-decoded as real data. This is
      //     exactly how starpin-groups-trial.html already operates; it lets goals
      //     (a)/(b) be wired and tested NOW, before the Argon2 benchmark/freeze.
      // Untagged behaviour is unchanged: still fail-closed on an unfrozen PROFILE.
      var provisionalTag = opts.provisionalTag || null;
      if (!GeosonifyStarpinGroup.PROFILE || GeosonifyStarpinGroup.PROFILE.frozen !== true) {
        if (!provisionalTag)
          return fail('PROFILE not frozen — sharing disabled until Argon2/padding/JCS are finalised ' +
                      '(pass opts.provisionalTag to run under a namespaced provisional profile)');
        warn('running under PROVISIONAL namespace "' + provisionalTag + '" — data is namespaced and NOT permanent');
      } else if (provisionalTag) {
        // Frozen profile but a tag was passed: refuse rather than silently namespace
        // real data into a provisional bucket (that would strand it after freeze).
        return fail('PROFILE is frozen but a provisionalTag was supplied — refuse to namespace real data');
      }

      if (!host || !host.log) return fail('host log not provided');

      // STORAGE: fail closed.
      var store = opts.store || null;
      if (!store) {
        if (opts.allowMemoryStore === true) {
          store = GeosonifyStarpinStorage.memory({ sha256: webSha256 });
          warn('using in-memory store (allowMemoryStore) — data will NOT persist');
        } else {
          return fail('no persistent store configured — sharing unavailable (fail-closed)');
        }
      }

      var group = GeosonifyStarpinGroup.create({
        provisionalTag: provisionalTag,   // null under a frozen profile; a tag namespaces trial data
        argon2id: function (pw, salt, o) { return C.argon2id(pw, salt, { t: o.t, m: o.m, p: o.p, dkLen: o.dkLen }); },
        xchacha20poly1305: function (k, n) {
          return { encrypt: function (pt, aad) { return C.xchacha20poly1305(k, n, aad).encrypt(pt); },
                   decrypt: function (ct, aad) { return C.xchacha20poly1305(k, n, aad).decrypt(ct); } };
        }
      });
      var lg = host.log;
      sharing  = GeosonifyStarpinSharing.create({ group: group, store: store, log: lg, localStorage: window.localStorage, namespace: provisionalTag });
      selfsync = GeosonifyStarpinSelfSync.create({ group: group, store: store, log: lg, localStorage: window.localStorage, namespace: provisionalTag });
      portable = GeosonifyStarpinPortable.create({ argon2id: C.argon2id, xchacha20poly1305: C.xchacha20poly1305, sha256: webSha256 });
      ctrl     = GeosonifyStarpinGroups.create({ sharing: sharing, invite: GeosonifyStarpinInvite, log: lg,
                                                 portable: portable, store: store,
                                                 realm: provisionalTag || GeosonifyStarpinInvite.REALM_PRODUCTION,
                                                 baseUrl: 'https://geosonify.org/starpin-demo.html' });
      ready = true; reason = ''; provisional = provisionalTag;

      var inv = opts.invite || null;
      try { if (!inv && ctrl.inviteFromLocation) inv = ctrl.inviteFromLocation(); } catch (e) { warn('invite parse failed', e); }
      if (inv && inv.groupUuid) promptJoin(inv);
      return { ready: true };
    });
  }
  function fail(r) { ready = false; reason = r; provisional = null; return { ready: false, reason: r }; }

  // host provides the target builders; the group code never re-derives them.
  function targetForCornerstone(name) {
    if (host && host.targetForCornerstone) return host.targetForCornerstone(name);
    return name ? { cornerstone: name } : null;
  }
  function targetForStar(st) {
    if (host && host.targetForStar) return host.targetForStar(st);
    return null;   // no host builder => refuse rather than mint a pseudo-id
  }

  // ── hook: after a visit is committed locally ────────────────────────────
  // INVARIANT: the local record is already saved before this runs; nothing here
  // may roll back or mutate it. Errors are logged, never thrown upward.
  function onRecordLogged(record) {
    if (!ready || !record || !record.record_id) return Promise.resolve();
    return Promise.resolve().then(function () {
      var groups = ctrl.myGroups();
      if (groups.length) showShareOffer(record, groups);
    }).catch(function (e) { warn('share hook failed (local record is safe)', e); });
  }

  // ── hook: "who's been here" — deduped + cached ──────────────────────────
  function renderHere(container, target) {
    if (!container || !ready) return Promise.resolve();
    return Promise.resolve().then(function () {
      var groups = ctrl.myGroups();
      container.textContent = '';
      if (!groups.length || !target) return;
      groups.forEach(function (g) {
        var block = el('div', 'sp-here');
        container.appendChild(block);
        viewCached(g.groupUuid, target).then(function (view) {
          renderHereView(block, g, view);
        }).catch(function (e) { warn('who\'s-been-here failed', e); });
      });
    }).catch(function (e) { warn('renderHere failed', e); });
  }

  function viewCached(groupUuid, target) {
    var handleKey;
    try { handleKey = sharing.canonicalTarget(typeof target === 'string' ? { starpin: target } : target); }
    catch (e) { return Promise.reject(e); }
    var key = groupUuid + '|' + handleKey;
    var now = Date.now();
    var hit = renderCache[key];
    if (hit && (now - hit.at) < CACHE_MS) return hit.promise;
    var p = ctrl.onTargetView(groupUuid, target);
    renderCache[key] = { at: now, promise: p };
    return p;
  }
  function invalidate(groupUuid, target) {
    try { delete renderCache[groupUuid + '|' + sharing.canonicalTarget(target)]; } catch (e) {}
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
      if (v.comment) li.appendChild(el('div', 'sp-cmt', v.comment));
      ul.appendChild(li);
    });
    block.appendChild(ul);
    if (view.youArePresent) block.appendChild(el('div', 'sp-muted', 'You\u2019re #' + view.yourOrdinal + ' here in ' + (g.label || 'this group') + '.'));
  }

  function showShareOffer(record, groups) {
    var box = (host && host.$ && host.$('info')) || document.body;
    var bar = el('div', 'sp-share-offer');
    bar.appendChild(el('span', null, 'Share this find with '));
    groups.forEach(function (g) {
      var b = el('button', 'sp-btn sp-btn-sm', g.label || 'group');
      b.addEventListener('click', function () {
        var comment = window.prompt('Add a comment (optional):', '') || '';
        ctrl.share(g.groupUuid, record, { comment: comment }).then(function (r) {
          bar.textContent = r.skipped ? 'Already shared to ' + (g.label || 'group') + '.'
                                      : 'Shared to ' + (g.label || 'group') + '.';
          invalidate(g.groupUuid, record.target);
        }).catch(function (e) { bar.textContent = 'Could not share: ' + e.message; warn('share failed', e); });
      });
      bar.appendChild(b);
    });
    var dismiss = el('button', 'sp-link', 'not now');
    dismiss.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
    bar.appendChild(dismiss);
    box.appendChild(bar);
  }

  function promptJoin(preview) {
    var wrap = el('div', 'sp-modal');
    var sheet = el('div', 'sp-join-sheet');
    sheet.appendChild(el('div', null, (preview.alreadyJoined ? 'Already in ' : 'Join ') + '\u201C' + (preview.label || 'group') + '\u201D?'));
    var codeIn = null;
    if (preview.needsCode) { codeIn = el('input', 'sp-in'); codeIn.placeholder = 'enter the code you were given'; sheet.appendChild(codeIn); }
    var go = el('button', 'sp-btn sp-btn-primary', preview.alreadyJoined ? 'Re-join' : 'Join');
    go.addEventListener('click', function () {
      ctrl.joinFromLink(preview._sourceUrl || (typeof location !== 'undefined' ? location.href : ''),
                        codeIn ? codeIn.value.trim() : undefined)
        .then(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); })
        .catch(function (e) { sheet.appendChild(el('div', 'sp-warn', 'Could not join: ' + e.message)); warn('join failed', e); });
    });
    sheet.appendChild(go);
    var cancel = el('button', 'sp-link', 'cancel');
    cancel.addEventListener('click', function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); });
    sheet.appendChild(cancel);
    wrap.appendChild(sheet); document.body.appendChild(wrap);
  }

  return {
    init: init,
    onRecordLogged: onRecordLogged,
    renderHere: renderHere,
    targetForStar: targetForStar,
    targetForCornerstone: targetForCornerstone,
    isReady: function () { return ready; },
    readiness: function () { return reason; },
    provisionalTag: function () { return provisional; },
    isProvisional: function () { return provisional != null; },
    controller: function () { return ctrl; },
    // per-group display name ("how you show up to the group"). Thin passthroughs
    // to the sharing module so the app talks only to StarpinGroups, not the
    // internal sharing object. No-ops safely if sharing isn't ready.
    setName: function (groupUuid, name) {
      if (!sharing) throw new Error('sharing not ready');
      return sharing.setHandle(groupUuid, name);
    },
    getName: function (groupUuid) {
      if (!sharing) return null;
      var id = sharing.getIdentity(groupUuid);
      return id ? id.handle : null;
    },
    // Leave/forget a group on this device (not a global delete — see sharing.js).
    leaveGroup: function (groupUuid) {
      if (!sharing) throw new Error('sharing not ready');
      var res = sharing.leaveGroup(groupUuid);
      try { for (var k in renderCache) if (k.indexOf(groupUuid + '|') === 0) delete renderCache[k]; } catch (_) {}
      return res;
    },
    // The AUTHORITATIVE canonical target identity (same value the handle derives
    // from). Callers gathering "records for this find" MUST use this, not a
    // presentation-layer grouping heuristic, so the share sheet groups exactly as
    // the sharing system keys (avoids reintroducing the gdr3-style identity drift).
    canonicalTarget: function (target) {
      if (!sharing) return null;
      try { return sharing.canonicalTarget(target); } catch (_) { return null; }
    },
    getInvite: function (groupUuid, opts) {
      if (!ctrl) throw new Error('sharing not ready');
      return ctrl.getInvite(groupUuid, opts);
    },
    // ---- activity feed passthroughs ----
    announceActivity: function (groupUuid, items, opts) {
      if (!sharing) throw new Error('sharing not ready');
      return sharing.announceActivity(groupUuid, items, opts);
    },
    postNote: function (groupUuid, text, opts) {
      if (!sharing) throw new Error('sharing not ready');
      return sharing.postNote(groupUuid, text, opts);
    },
    syncActivity: function (groupUuid, opts) {
      if (!sharing) throw new Error('sharing not ready');
      return sharing.syncActivityPeriod(groupUuid, opts);
    },
    // sync every group the user is in, then return the merged newest-first feed
    syncAllActivity: function () {
      if (!sharing) return Promise.resolve([]);
      var groups = ctrl.myGroups();
      var chain = Promise.resolve();
      groups.forEach(function (g) {
        chain = chain.then(function () { return sharing.syncActivityPeriod(g.groupUuid, {}).catch(function () {}); });
      });
      return chain.then(function () { return sharing.listActivity({}); });
    },
    listActivity: function (opts) {
      if (!sharing) return [];
      return sharing.listActivity(opts);
    },
    flushPendingAnnouncements: function () {
      if (!sharing) return Promise.resolve({ flushed: 0, stillPending: 0 });
      return sharing.flushPendingAnnouncements();
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = StarpinGroups; }
