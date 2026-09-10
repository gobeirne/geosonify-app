/*
  geosonify-starpin-groups-ui.js v0.1 — group UI panel (NOT FROZEN)

  ⚠️ UNTESTED IN A BROWSER. Every layer BELOW this is Node-tested (sealing,
  storage, sharing, invite, controller). This file is the DOM skin over the
  controller and could only be exercised in a real browser, which wasn't
  available when it was written. Treat it as a careful first draft: the logic it
  calls is proven; the wiring of that logic to elements is not.

  It renders three things into a container you provide:
    - a groups list + "New group" / "Join by link"
    - a create-group form (label, human code, descriptor|full mode) → a link to send
    - a join sheet (auto-shown if the page URL is an invite)
  and exposes renderOnTarget(container, groupUuid, target) for the starpin/
  cornerstone screen's "who's been here" block.

  Style: classic-script global, matching the other geosonify-starpin-* modules.
  It builds DOM with createElement + textContent (NEVER innerHTML with data) so
  a member handle or comment can never inject markup — the app-wide rule.

  Wire it:
    var ui = GeosonifyStarpinGroupsUI.create({ controller: ctrl });
    ui.mountPanel(document.getElementById('groups-panel'));
    ui.maybePromptJoinFromURL();                 // call on load
    // on a starpin screen:
    ui.renderOnTarget(document.getElementById('here-block'), groupUuid, target);
*/
'use strict';

var GeosonifyStarpinGroupsUI = (function () {

  // ---- tiny DOM helpers (textContent only; no innerHTML with data) --------
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k === 'on' ) Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function create(deps) {
    deps = deps || {};
    var ctrl = deps.controller;
    if (!ctrl) throw new Error('groups-ui: controller required');
    var onChange = deps.onChange || function () {};   // called after joins/creates
    var toast = deps.toast || function (m) { try { console.log('[groups] ' + m); } catch (_) {} };

    // ------------------------------------------------------------------ panel
    function mountPanel(container) {
      clear(container);
      container.appendChild(el('div', { class: 'sp-groups' }, [
        el('div', { class: 'sp-groups-head' }, [
          el('h3', { text: 'Groups' }),
          el('div', { class: 'sp-groups-actions' }, [
            el('button', { text: 'New group', class: 'sp-btn', on: { click: function () { renderCreate(container); } } }),
            el('button', { text: 'Join by link', class: 'sp-btn', on: { click: function () { renderJoinPaste(container); } } })
          ])
        ]),
        renderGroupList()
      ]));
    }

    function renderGroupList() {
      var groups = ctrl.myGroups();
      if (!groups.length)
        return el('p', { class: 'sp-muted', text: 'No groups yet. Make one and send the link to your people.' });
      var list = el('ul', { class: 'sp-group-list' });
      groups.forEach(function (g) {
        list.appendChild(el('li', {}, [
          el('span', { class: 'sp-group-label', text: g.label || '(unnamed group)' }),
          el('button', { text: 'Invite', class: 'sp-btn sp-btn-sm',
            on: { click: function () { showReinvite(g); } } })
        ]));
      });
      return list;
    }

    // ----------------------------------------------------------- create form
    function renderCreate(container) {
      var labelIn = el('input', { class: 'sp-in', type: 'text', placeholder: 'Group name (e.g. Family)' });
      var codeIn  = el('input', { class: 'sp-in', type: 'text', placeholder: 'auto-generated if blank' });
      var modeFull = el('input', { type: 'checkbox' });
      var out = el('div', { class: 'sp-create-out' });

      var form = el('div', { class: 'sp-card' }, [
        el('h4', { text: 'New group' }),
        el('label', { class: 'sp-lbl', text: 'Name' }), labelIn,
        el('label', { class: 'sp-lbl', text: 'Code (leave blank to generate a memorable one)' }), codeIn,
        el('label', { class: 'sp-check' }, [ modeFull,
          el('span', { text: ' Put the code in the link too (one-tap join — only over a channel you trust)' }) ]),
        el('button', { text: 'Create & get link', class: 'sp-btn sp-btn-primary', on: { click: function () {
          ctrl.createGroup({
            label: labelIn.value.trim(),
            code: codeIn.value.trim() || undefined,
            generateCode: codeIn.value.trim() ? false : true,
            mode: modeFull.checked ? 'full' : 'descriptor'
          }).then(function (res) {
            renderInviteResult(out, res);
            onChange();
          }).catch(function (e) { toast('Could not create: ' + e.message); });
        } } }),
        out,
        el('button', { text: '← back', class: 'sp-link', on: { click: function () { mountPanel(container); } } })
      ]);
      clear(container); container.appendChild(form);
    }

    function renderInviteResult(out, res) {
      clear(out);
      var kids = [
        el('p', { class: 'sp-ok', text: 'Group ready.' }),
        field('Code (say this to your people)', res.code),
        field('Invite link', res.link)
      ];
      if (res.mode === 'descriptor')
        kids.push(el('p', { class: 'sp-muted', text:
          'Descriptor link: the code is NOT in it. Send the link, then tell them the code separately.' }));
      else
        kids.push(el('p', { class: 'sp-warn', text:
          'One-tap link: the code IS in this link. Anyone who sees the link can join — send it only over a trusted channel.' }));
      kids.push(el('p', { class: 'sp-muted', text:
        'Note: a short code is a convenience secret (~' + Math.round(res.codeBits) +
        ' bits). Fine for family; not a fortress. Anyone with the code can read the group and post as any name.' }));
      kids.forEach(function (k) { out.appendChild(k); });
    }

    function field(label, value) {
      var val = el('input', { class: 'sp-in sp-mono', type: 'text', value: value, readonly: 'readonly' });
      val.addEventListener('focus', function () { val.select(); });
      return el('div', { class: 'sp-field' }, [
        el('label', { class: 'sp-lbl', text: label }),
        el('div', { class: 'sp-field-row' }, [ val,
          el('button', { text: 'Copy', class: 'sp-btn sp-btn-sm', on: { click: function () {
            copy(value).then(function () { toast('Copied'); }); } } }) ])
      ]);
    }

    function showReinvite(g) {
      // re-issue a descriptor link immediately; full mode needs the code re-typed.
      try {
        var link = ctrl.inviteLink(g.groupUuid, { mode: 'descriptor' });
        var box = el('div', { class: 'sp-card' }, [
          el('h4', { text: 'Invite to ' + (g.label || 'group') }),
          field('Invite link (descriptor)', link),
          el('p', { class: 'sp-muted', text: 'Send this, then tell them the code separately. For a one-tap link, re-enter the code in “New group”.' })
        ]);
        var host = document.querySelector('.sp-groups'); if (host) host.appendChild(box);
      } catch (e) { toast(e.message); }
    }

    // ------------------------------------------------------------- join flows
    function renderJoinPaste(container) {
      var linkIn = el('input', { class: 'sp-in', type: 'text', placeholder: 'Paste an invite link' });
      var codeWrap = el('div');
      var card = el('div', { class: 'sp-card' }, [
        el('h4', { text: 'Join a group' }),
        linkIn,
        el('button', { text: 'Look at link', class: 'sp-btn', on: { click: function () {
          showJoinPreview(codeWrap, linkIn.value.trim(), container);
        } } }),
        codeWrap,
        el('button', { text: '← back', class: 'sp-link', on: { click: function () { mountPanel(container); } } })
      ]);
      clear(container); container.appendChild(card);
    }

    function showJoinPreview(wrap, link, container) {
      clear(wrap);
      var p;
      try { p = ctrl.previewInvite(link); } catch (e) { wrap.appendChild(el('p', { class: 'sp-warn', text: 'That link is not valid: ' + e.message })); return; }
      if (!p) { wrap.appendChild(el('p', { class: 'sp-warn', text: 'That doesn’t look like an invite link.' })); return; }

      var kids = [ el('p', { text: (p.alreadyJoined ? 'You are already in ' : 'Join ') + '“' + (p.label || 'this group') + '”?' }) ];
      var codeIn = null;
      if (p.needsCode) {
        codeIn = el('input', { class: 'sp-in', type: 'text', placeholder: 'Enter the code you were given' });
        kids.push(el('label', { class: 'sp-lbl', text: 'This link needs the code (sent to you separately)' }));
        kids.push(codeIn);
      } else {
        kids.push(el('p', { class: 'sp-muted', text: 'This is a one-tap link — the code is included.' }));
      }
      kids.push(el('button', { text: p.alreadyJoined ? 'Re-join' : 'Join', class: 'sp-btn sp-btn-primary', on: { click: function () {
        ctrl.joinFromLink(link, codeIn ? codeIn.value.trim() : undefined)
          .then(function (r) { toast('Joined ' + (r.label || 'group')); mountPanel(container); onChange(); })
          .catch(function (e) { toast('Could not join: ' + e.message); });
      } } }));
      kids.forEach(function (k) { wrap.appendChild(k); });
    }

    // Auto-prompt if the page was opened from an invite link.
    function maybePromptJoinFromURL(hrefOpt) {
      var p;
      try { p = ctrl.inviteFromLocation(hrefOpt); } catch (e) { return null; }
      if (!p) return null;
      var host = el('div', { class: 'sp-join-sheet' });
      showJoinPreview(host, hrefOpt || (typeof location !== 'undefined' ? location.href : ''), host);
      document.body.appendChild(el('div', { class: 'sp-modal' }, [ host ]));
      return p;
    }

    // -------------------------------------------------- on-target "who's here"
    // Renders into `container` for a given group + target. Async (it syncs).
    function renderOnTarget(container, groupUuid, target) {
      clear(container);
      container.appendChild(el('p', { class: 'sp-muted', text: 'Checking who’s been here…' }));
      return ctrl.onTargetView(groupUuid, target).then(function (view) {
        clear(container);
        var head = el('div', { class: 'sp-here-head' }, [
          el('span', { class: 'sp-here-title', text: view.label || 'Group' }),
          el('button', { text: 'Refresh', class: 'sp-btn sp-btn-sm',
            on: { click: function () { renderOnTarget(container, groupUuid, target); } } })
        ]);
        container.appendChild(head);
        if (!view.count) {
          container.appendChild(el('p', { class: 'sp-muted', text: view.firstnessNote }));
          return view;
        }
        var ul = el('ul', { class: 'sp-here-list' });
        view.visitors.forEach(function (v) {
          var when = v.time_ms ? new Date(v.time_ms).toLocaleDateString() : '';
          var line = el('li', { class: v.you ? 'sp-here-you' : '' }, [
            el('span', { class: 'sp-ord', text: '#' + v.ordinal }),
            el('span', { class: 'sp-who', text: v.you ? (v.handle + ' (you)') : v.handle }),
            when ? el('span', { class: 'sp-when', text: when }) : null
          ]);
          if (v.comment) line.appendChild(el('div', { class: 'sp-cmt', text: v.comment }));  // textContent → safe
          ul.appendChild(line);
        });
        container.appendChild(ul);
        if (view.youArePresent)
          container.appendChild(el('p', { class: 'sp-muted', text: 'You’re #' + view.yourOrdinal + ' here in ' + (view.label || 'this group') + '.' }));
        return view;
      }).catch(function (e) {
        clear(container);
        container.appendChild(el('p', { class: 'sp-warn', text: 'Couldn’t load group visits: ' + e.message }));
      });
    }

    // ---- platform bits -----------------------------------------------------
    function copy(text) {
      if (typeof navigator !== 'undefined' && navigator.clipboard)
        return navigator.clipboard.writeText(text).catch(function () {});
      return Promise.resolve();
    }

    return {
      mountPanel: mountPanel,
      maybePromptJoinFromURL: maybePromptJoinFromURL,
      renderOnTarget: renderOnTarget
    };
  }

  return { create: create };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinGroupsUI;
}
