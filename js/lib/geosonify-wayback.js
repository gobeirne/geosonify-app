/*
  geosonify-wayback.js  v1.0  — Esri World Imagery Wayback, by date

  Esri keeps every published release of its World Imagery basemap (the
  "Aerial" preset) since 20 February 2014. Each release is a complete Web
  Mercator tile pyramid, addressed by a release number:

    https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/
      WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/{release}/{z}/{y}/{x}

  The list of releases is one JSON catalogue Esri publishes for its own
  Wayback app and for @esri/wayback-core (keys are release numbers, each with
  an itemTitle such as "World Imagery (Wayback 2014-02-20)").

  LINKS SAY A DATE, NOT A RELEASE NUMBER. ?basemap=aerial@2019-06-26 resolves
  to the release published on that date or, failing that, the latest one
  before it (or the earliest, for a date before 2014-02-20). Dates are what a
  person reads, and they survive any renumbering on Esri's side.

  The date is the RELEASE date: when that version of the mosaic was published,
  not when its photographs were taken. Within one release, different places
  were photographed at different times.

  OFFLINE / BLOCKED CATALOGUE. A snapshot of the releases up to 2024-10-10 is
  built in, so dated links still resolve if the catalogue can't be fetched.
  Snapshot source: a published third-party copy of the catalogue, cross-checked
  against Esri's own examples (2014-02-20 = 10, 2022-12-14 = 45134,
  2023-12-07 = 56102). The live catalogue, when it loads, replaces it.

  Nothing here touches a code or a frozen format.
*/
(function (global) {
  'use strict';

  var VERSION = 'v1.0';
  var CATALOGUE_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
  var TILE_URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/{release}/{z}/{y}/{x}';
  var TIMEOUT_MS = 8000;

  // YYYYMMDD:release, newest first.
  var SNAPSHOT =
    '20241010:56450 20240919:20337 20240815:32553 20240627:39767 20240606:12428 20240509:52930 20240328:13968 ' +
    '20240307:60013 20240208:37965 20240118:41468 20231207:56102 20231101:12457 20231011:1034 20230831:64776 ' +
    '20230810:17632 20230629:47963 20230613:25982 20230503:46399 20230405:37890 20230315:44873 20230223:57965 ' +
    '20230111:11475 20221214:45134 20221102:7110 20221012:44988 20220921:47471 20220831:45441 20220810:17825 ' +
    '20220720:13851 20220629:4905 20220608:44710 20220518:5314 20220427:16245 20220406:48232 20220316:10321 ' +
    '20220224:10312 20220202:26083 20220112:42663 20211221:26120 20211130:48624 20211103:42403 20211013:16749 ' +
    '20210922:51313 20210901:47568 20210811:51423 20210721:8432 20210630:13534 20210609:48376 20210519:15423 ' +
    '20210428:27659 20210408:6863 20210317:5359 20210224:9812 20210113:1049 20201216:29260 20201118:20753 ' +
    '20201014:119 20200923:19187 20200902:9181 20200812:6049 20200722:9549 20200701:18289 20200610:11135 ' +
    '20200520:32645 20200429:15045 20200408:26751 20200323:16062 20200220:8495 20200130:21485 20200108:23001 ' +
    '20191212:4756 20191030:11060 20191009:11351 20190918:9892 20190828:30442 20190807:17216 20190717:16681 ' +
    '20190626:645 20190605:12576 20190515:9598 20190424:18063 20190403:18691 20190313:4383 20190221:17677 ' +
    '20190131:25944 20190109:6036 20181214:23448 20181129:239 20181107:3201 20181017:18820 20180926:14426 ' +
    '20180906:2168 20180815:1858 20180725:14829 20180627:11334 20180606:8249 20180516:32337 20180425:1296 ' +
    '20180411:20399 20180328:7072 20180314:8255 20180223:13067 20180131:10768 20180118:13045 20180108:13161 ' +
    '20171116:25521 20171025:23264 20171004:15212 20170913:18358 20170830:25379 20170810:14035 20170714:3319 ' +
    '20170627:4073 20170614:14765 20170531:14342 20170517:20365 20170503:784 20170419:1052 20170329:5205 ' +
    '20170315:29387 20170227:31026 20170208:27946 20170125:9486 20170111:577 20161220:18966 20161207:6678 ' +
    '20161116:21750 20161025:4222 20161012:13770 20160914:6984 20160831:9175 20160811:23601 20160720:5097 ' +
    '20160706:13240 20160613:11509 20160511:8551 20160428:5769 20160420:388 20160316:19085 20160302:20443 ' +
    '20160217:11262 20160204:6354 20160113:3515 20151216:28163 20151118:8781 20151028:11092 20151014:10850 ' +
    '20150930:3630 20150916:1431 20150902:30584 20150819:28219 20150708:24007 20150624:11952 20150513:19930 ' +
    '20150430:23880 20150415:9203 20150325:2730 20150318:15084 20150218:10443 20150121:20222 20141230:5844 ' +
    '20141218:14720 20141203:23383 20141112:30195 20141029:11019 20141001:22692 20140917:25586 20140730:5232 ' +
    '20140702:3026 20140625:11033 20140611:31144 20140514:16513 20140430:19819 20140326:4230 20140220:10';

  function parseSnapshot() {
    return SNAPSHOT.split(' ').map(function (p) {
      var a = p.split(':');
      return { date: a[0].slice(0, 4) + '-' + a[0].slice(4, 6) + '-' + a[0].slice(6, 8), release: +a[1] };
    });
  }

  var releases = parseSnapshot();     // [{date, release}], newest first
  var source = 'snapshot';
  var loading = null;

  // The catalogue: { "<release>": { itemTitle: "World Imagery (Wayback YYYY-MM-DD)", ... }, ... }
  function fromCatalogue(cfg) {
    var out = [];
    Object.keys(cfg || {}).forEach(function (k) {
      if (!/^\d+$/.test(k)) return;
      var t = cfg[k] && cfg[k].itemTitle;
      var m = typeof t === 'string' && t.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) out.push({ date: m[1], release: +k });
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return out;
  }

  /** Fetch the live catalogue once; resolves to the release list either way. */
  function load() {
    if (loading) return loading;
    loading = new Promise(function (resolve) {
      if (typeof fetch !== 'function') return resolve(releases);
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
      fetch(CATALOGUE_URL, { credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (cfg) {
          var live = fromCatalogue(cfg);
          // Sanity: the live list must be at least as long as the snapshot.
          if (live.length >= releases.length) { releases = live; source = 'live'; }
        })
        .catch(function () { /* keep the snapshot */ })
        .then(function () { clearTimeout(t); resolve(releases); });
    });
    return loading;
  }

  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

  /** The release on or latest before `date` (or the earliest one). Sync, on the current list. */
  function resolve(date) {
    if (!isDate(date) || !releases.length) return null;
    for (var i = 0; i < releases.length; i++) {
      if (releases[i].date <= date) return releases[i];
    }
    return releases[releases.length - 1];
  }

  function tileUrl(release) { return TILE_URL.replace('{release}', String(release)); }

  /** 'aerial@2019-06-26' → '2019-06-26'; anything else → null. */
  function dateOf(source) {
    var m = String(source || '').trim().toLowerCase().match(/^aerial@(\d{4}-\d{2}-\d{2})$/);
    return m ? m[1] : null;
  }

  var API = {
    VERSION: VERSION,
    load: load,
    list: function () { return releases.slice(); },
    source: function () { return source; },
    resolve: resolve,
    tileUrl: tileUrl,
    dateOf: dateOf,
    isDate: isDate,
    _fromCatalogue: fromCatalogue
  };
  global.GeosonifyWayback = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
