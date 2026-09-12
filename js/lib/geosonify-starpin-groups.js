/*
  geosonify-starpin-groups.js v0.1 — groups controller (NOT FROZEN)

  The DOM-free brain behind the group UI. It composes the tested layers —
  invite (link encode/decode), sharing (seal/store/sync), and the record log —
  into the three things a person actually does:

    1. createGroup   → make a group, get a shareable invite link
    2. joinFromLink  → open someone's link, join their group
    3. onTargetView  → "who's been here" at a starpin/cornerstone, in this group

  It holds no crypto and no DOM. Everything below it is already proven; this file
  is orchestration plus the one piece of genuine logic — shaping the on-target
  view (dedup, sort, visibility-relative firstness, "you" marking).

  Wire it with the pieces built earlier:

    var ctrl = GeosonifyStarpinGroups.create({
      sharing:  GeosonifyStarpinSharing.create({ group, store, log, localStorage }),
      invite:   GeosonifyStarpinInvite,
      log:      theRecordLog,
      baseUrl:  'https://geosonify.org/starpin-demo.html'
    });
*/
'use strict';

var GeosonifyStarpinGroups = (function () {

  function create(deps) {
    deps = deps || {};
    var sharing = deps.sharing;
    var invite  = deps.invite;
    var log     = deps.log;
    var baseUrl = deps.baseUrl || 'https://geosonify.org/starpin-demo.html';
    if (!sharing) throw new Error('groups: sharing controller required');
    if (!invite)  throw new Error('groups: invite module required');
    if (!log)     throw new Error('groups: record log required');

    // ---- 1. create a group and hand back an invite link ------------------
    // opts: { label, code?, generateCode?, mode:'descriptor'|'full', endpoint? }
    // Returns { groupUuid, code, link, mode }. The code is the bearer secret;
    // in 'descriptor' mode it is NOT in the link and must be shared separately.
    async function createGroup(opts) {
      opts = opts || {};
      var code = opts.code;
      if (!code && opts.generateCode !== false) code = invite.generateHumanCode();
      if (!code) throw new Error('groups.createGroup: need a code or generateCode');

      var made = await sharing.createGroup({ code: code, label: opts.label || '', endpoint: opts.endpoint || null });

      var linkMode = (opts.mode === 'full' || opts.mode === 'fragment') ? opts.mode : 'descriptor';
      var link = invite.makeInvite({
        baseUrl: baseUrl,
        groupUuid: made.groupUuid,
        epoch: made.epoch,
        endpoint: opts.endpoint || null,
        label: opts.label || '',
        mode: linkMode,
        code: (linkMode === 'full' || linkMode === 'fragment') ? code : undefined
      });

      return { groupUuid: made.groupUuid, code: code, link: link,
               mode: linkMode,
               codeBits: invite.estimateBits(code) };
    }

    // Re-issue a link for an existing group (e.g. to invite one more person, or
    // to switch modes). Needs the code again for 'full' mode — the controller
    // does NOT store the raw code (only the derived key lives in the group store),
    // so 'full' re-issue requires the creator to re-enter it.
    function inviteLink(groupUuid, opts) {
      opts = opts || {};
      var g = sharing.getGroup(groupUuid);
      if (!g) throw new Error('groups.inviteLink: unknown group');
      if (opts.mode === 'full' && !opts.code)
        throw new Error('groups.inviteLink: full mode needs the code re-entered');
      return invite.makeInvite({
        baseUrl: baseUrl, groupUuid: groupUuid, epoch: g.epoch,
        endpoint: g.endpoint, label: g.label,
        mode: opts.mode === 'full' ? 'full' : 'descriptor',
        code: opts.mode === 'full' ? opts.code : undefined
      });
    }

    // ---- 2. join from a link ---------------------------------------------
    // Step A: preview — parse the link, tell the UI what it is and whether a
    // code still needs typing. Never joins. Returns null if not an invite link.
    function previewInvite(url) {
      var parsed = invite.parseInvite(url);
      if (!parsed) return null;
      var already = !!sharing.getGroup(parsed.descriptor.groupUuid);
      var hasCode = (parsed.mode === 'full' || parsed.mode === 'fragment-full') && !!parsed.code;
      return {
        label: parsed.descriptor.label,
        groupUuid: parsed.descriptor.groupUuid,
        epoch: parsed.descriptor.epoch,
        endpoint: parsed.descriptor.endpoint,
        codeInLink: hasCode,
        needsCode: !hasCode,
        alreadyJoined: already,
        _code: parsed.code            // present only when the link carried it
      };
    }

    // Step B: complete — actually join. If the link carried the code, codeArg is
    // ignored; otherwise codeArg is required (the one typed by the joiner).
    async function joinFromLink(url, codeArg) {
      var p = previewInvite(url);
      if (!p) throw new Error('groups.joinFromLink: not an invite link');
      var code = p.codeInLink ? p._code : codeArg;
      if (!code) throw new Error('groups.joinFromLink: this link needs a code');
      var r = await sharing.joinGroup({
        groupUuid: p.groupUuid, code: code, epoch: p.epoch,
        endpoint: p.endpoint, label: p.label
      });
      return { groupUuid: r.groupUuid, label: p.label, rejoined: p.alreadyJoined };
    }

    // Detect an invite in the current page URL (for auto-prompt on load).
    function inviteFromLocation(href) {
      var url = href || (typeof location !== 'undefined' ? location.href : '');
      return url ? previewInvite(url) : null;
    }

    // ---- 3. share one of my records to a group ---------------------------
    async function share(groupUuid, record, opts) {
      return sharing.shareRecord(groupUuid, record, opts || {});
    }

    // ---- 4. the on-target "who's been here" view -------------------------
    // Syncs the target (pulls any new group shares, merges records into the log),
    // then builds the visitor list FROM the local sync store + log. Returns a
    // shape ready to render.
    //
    // Firstness is VISIBILITY-RELATIVE: position is among people in THIS group we
    // can see — never a global "first human ever here" claim.
    async function onTargetView(groupUuid, target, opts) {
      opts = opts || {};
      var g = sharing.getGroup(groupUuid);
      if (!g) throw new Error('groups.onTargetView: unknown group');

      if (opts.sync !== false) {
        try { await sharing.syncTarget(groupUuid, target); }
        catch (e) { /* offline / storage error: fall back to what we already have */ }
      }

      var ct = sharing.canonicalTarget(
        typeof target === 'string' ? parseTargetString(target) : target
      );

      // Records to consider: MY authoritative log PLUS this group's non-
      // authoritative cache of others' shares (kept in separate stores by the
      // data-safety invariant — group data never enters the personal log).
      var mine = log.all ? log.all() : (log.current ? log.current() : []);
      var cached = sharing.groupRecordsAt ? sharing.groupRecordsAt(groupUuid) : [];
      var records = mine.concat(cached);
      var visitors = [];
      var seen = {};
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (!rec || !rec.target) continue;
        var rct;
        try { rct = sharing.canonicalTarget(rec.target); } catch (e) { continue; }
        if (rct !== ct) continue;

        var entries = sharing.sharesOf(rec.record_id);
        var ownEntry = null, anyEntry = null;
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].group_uuid !== groupUuid) continue;
          anyEntry = anyEntry || entries[j];
          // owned iff this device produced that exact ciphertext.
          if (entries[j].content_hash && sharing.ownsContentHash &&
              sharing.ownsContentHash(entries[j].content_hash)) ownEntry = entries[j];
        }
        var entry = ownEntry || anyEntry;
        if (!entry) continue;                          // not shared in this group
        if (seen[rec.record_id]) continue;             // dedup by event
        seen[rec.record_id] = true;

        visitors.push({
          record_id: rec.record_id,
          handle: entry.handle || 'someone',
          comment: entry.comment || null,
          time_ms: (rec.event && rec.event.time_ms) || 0,
          you: !!ownEntry,
          publication_id: entry.publication_id || null
        });
      }

      // sort by visit time ascending; firstness = ordinal in this ordering
      visitors.sort(function (a, b) { return a.time_ms - b.time_ms; });
      visitors.forEach(function (v, idx) { v.ordinal = idx + 1; });

      var youIndex = -1;
      for (var k = 0; k < visitors.length; k++) if (visitors[k].you) { youIndex = k; break; }

      return {
        groupUuid: groupUuid,
        label: g.label,
        canonicalTarget: ct,
        visitors: visitors,                 // chronological, each with .ordinal + .you
        count: visitors.length,
        youArePresent: youIndex >= 0,
        yourOrdinal: youIndex >= 0 ? youIndex + 1 : null,
        // visibility-relative phrasing helper, never global:
        firstnessNote: visitors.length === 0
          ? 'No visits recorded here in ' + (g.label || 'this group') + ' yet.'
          : 'Showing ' + visitors.length + ' visit' + (visitors.length === 1 ? '' : 's') +
            ' in ' + (g.label || 'this group') + '.'
      };
    }

    // group list for the UI, with a share-count summary
    function myGroups() {
      var groups = sharing.listGroups();
      return Object.keys(groups).map(function (uuid) {
        return { groupUuid: uuid, label: groups[uuid].label, epoch: groups[uuid].epoch,
                 endpoint: groups[uuid].endpoint };
      });
    }

    // A target may arrive as a canonical string ("starpin|starpin:…") or a raw
    // id; normalise a bare string into a {starpin|cornerstone} object so
    // canonicalTarget can handle it uniformly.
    function parseTargetString(s) {
      if (s.indexOf('starpin|') === 0)     return { starpin: s.slice('starpin|'.length) };
      if (s.indexOf('cornerstone|') === 0) return { cornerstone: s.slice('cornerstone|'.length) };
      if (s.indexOf('starpin:') === 0)     return { starpin: s };
      return { cornerstone: s };
    }

    // ---- 5. portability: move / back up this identity --------------------
    // Needs a portable instance (geosonify-starpin-portable) and, for the relay,
    // the storage backend. Both optional — methods that need them throw clearly
    // if absent. "Port everything" includes the log AND sync state by default,
    // so the destination device is a faithful clone as of the snapshot.
    var portable = deps.portable || null;
    var store = deps.store || null;

    function requirePortable() {
      if (!portable) throw new Error('groups: no portable module wired (pass deps.portable)');
      return portable;
    }

    // Export → an encrypted vault object, plus file/string helpers.
    async function exportIdentity(opts) {
      opts = opts || {};
      if (!opts.passphrase) throw new Error('groups.exportIdentity: passphrase required');
      var bundle = sharing.snapshotIdentity({
        includeLog:  opts.includeLog  !== false,   // default: bring your finds
        includeSync: opts.includeSync !== false    // default: bring share state
      });
      var vault = await requirePortable().sealVault(bundle, opts.passphrase);
      return {
        vault: vault,
        file: portable.toFile(vault),
        string: portable.toString(vault),
        groups: Object.keys(bundle.groups || {}).length,
        records: bundle.log ? bundle.log.records.length : 0
      };
    }

    // Import ← a vault object OR a STARPIN1: string OR file text.
    async function importIdentity(vaultOrText, passphrase, opts) {
      var p = requirePortable();
      var vault = vaultOrText;
      if (typeof vaultOrText === 'string') {
        vault = vaultOrText.indexOf('STARPIN1:') === 0 ? p.fromString(vaultOrText) : p.fromFileText(vaultOrText);
      }
      var bundle = await p.openVault(vault, passphrase);
      return sharing.restoreIdentity(bundle, { mode: (opts && opts.mode) || 'safe' });
    }

    // Relay push: generate a transfer code (or use a given one), push the vault,
    // return the code to show the user. Includes log+sync by default.
    async function pushTransfer(opts) {
      opts = opts || {};
      if (!store) throw new Error('groups.pushTransfer: no storage backend wired (pass deps.store)');
      var p = requirePortable();
      var code = opts.transferCode || p.generateTransferCode();
      var bundle = sharing.snapshotIdentity({
        includeLog:  opts.includeLog  !== false,
        includeSync: opts.includeSync !== false
      });
      var r = await p.pushTransfer(store, code, bundle);
      return { transferCode: code, bytes: r.bytes };
    }

    // Relay pull: fetch + restore using a transfer code.
    async function pullTransfer(transferCode, opts) {
      if (!store) throw new Error('groups.pullTransfer: no storage backend wired');
      var p = requirePortable();
      var bundle = await p.pullTransfer(store, transferCode);
      return sharing.restoreIdentity(bundle, { mode: (opts && opts.mode) || 'safe' });
    }

    return {
      createGroup: createGroup, inviteLink: inviteLink,
      previewInvite: previewInvite, joinFromLink: joinFromLink,
      inviteFromLocation: inviteFromLocation,
      share: share, onTargetView: onTargetView, myGroups: myGroups,
      exportIdentity: exportIdentity, importIdentity: importIdentity,
      pushTransfer: pushTransfer, pullTransfer: pullTransfer
    };
  }

  return { create: create };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinGroups;
}
