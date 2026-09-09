/*
  geosonify-starpin-firebase.js v0.1 — Firebase wiring for the group-v1 beta

  Ties three things together:
    1. your firebaseConfig  (from the console; PASTE it below)
    2. the modular Firebase SDK (loaded from CDN, v12)
    3. the storage adapter (geosonify-starpin-storage.js)

  and hands the app a ready-to-use `store` plus a signed-in anonymous session.

  Nothing above this file knows Firebase exists — it only ever sees the adapter's
  put/get/list interface. Swapping to R2+Workers later means replacing THIS file,
  not the app.

  ── Load order (ES modules, e.g. in starpin-demo.html) ──────────────────────
    <script type="module">
      import { initStarpinFirebase } from './geosonify-starpin-firebase.js';
      const { store, uid } = await initStarpinFirebase();
      // store.put(handle, hash, bytes) / store.get(handle, hash) / store.list(handle, {limit})
    </script>

  This file uses the CDN modular SDK so there's no build step. If you later adopt
  a bundler, change the import URLs to the bare package specifier 'firebase/...'.

  NOTE: the config below is PUBLIC (a client identifier, not a secret). The
  Firestore security rules — not this config — are what protect the data. Never
  put anything genuinely secret here.
*/

// ---- v12 modular SDK from the official CDN (pin the version explicitly) -----
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, collection, query, limit,
  getDocs, startAfter, orderBy, documentId
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

// The storage adapter is a classic-script global (var GeosonifyStarpinStorage).
// If you convert it to an ES module, import it instead of reading the global.
function getStorageFactory() {
  if (typeof GeosonifyStarpinStorage !== 'undefined') return GeosonifyStarpinStorage;
  if (typeof window !== 'undefined' && window.GeosonifyStarpinStorage) return window.GeosonifyStarpinStorage;
  throw new Error('geosonify-starpin-storage.js must load before this file');
}

// ============================================================================
// PASTE YOUR CONFIG HERE — from Firebase console → Project settings → your web
// app. projectId is 'geosonify-starpin'. The apiKey/appId/messagingSenderId are
// generated and cannot be guessed, so they must come from the console verbatim.
// ============================================================================
const firebaseConfig = {
  apiKey:            '"AIzaSyCna8NRmXsc-m0lCDb9t_KJQ3lzORoZUoQ",
  authDomain:        'geosonify-starpin.firebaseapp.com',
  projectId:         'geosonify-starpin',
  storageBucket:     'geosonify-starpin.firebasestorage.app',
  messagingSenderId: '306324213252',
  appId:             '1:306324213252:web:8d382c496a2467040eef51'
};

let _app = null, _auth = null, _db = null, _store = null, _uid = null, _initPromise = null;

// Sign in anonymously and resolve when we have a uid. Handles the case where a
// session already exists (returning device) vs. a fresh anonymous sign-in.
function ensureAnonSession(auth) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user && !settled) { settled = true; unsub(); resolve(user.uid); }
    }, reject);
    // Kick off sign-in if not already signed in. If a session exists, the
    // listener above fires with it and this becomes a no-op.
    signInAnonymously(auth).catch((err) => {
      if (!settled) { settled = true; unsub(); reject(err); }
    });
  });
}

export async function initStarpinFirebase() {
  if (_initPromise) return _initPromise;   // idempotent: one init per page load

  _initPromise = (async () => {
    if (firebaseConfig.apiKey === 'PASTE_FROM_CONSOLE') {
      throw new Error('geosonify-starpin-firebase: fill in firebaseConfig from the console first');
    }

    _app = initializeApp(firebaseConfig);
    _auth = getAuth(_app);

    // Persist the anonymous session across reloads so a device keeps its uid.
    // (RapidPair learned this the hard way — anon tokens expiring mid-flight.)
    try { await setPersistence(_auth, browserLocalPersistence); } catch (_) { /* non-fatal */ }

    _uid = await ensureAnonSession(_auth);
    _db = getFirestore(_app);

    // Build the Firestore-backed adapter by injecting the SDK functions. The
    // adapter never imports Firebase itself — that's what keeps it swappable.
    const Storage = getStorageFactory();
    _store = Storage.firestore({
      db: _db, doc, getDoc, setDoc, collection, query, limit,
      getDocs, startAfter, orderBy, documentId
    });

    return { store: _store, uid: _uid, app: _app, auth: _auth, db: _db };
  })();

  return _initPromise;
}

// Convenience accessors after init (throw if used too early).
export function getStore() { if (!_store) throw new Error('call initStarpinFirebase() first'); return _store; }
export function getUid()   { if (!_uid)   throw new Error('call initStarpinFirebase() first'); return _uid; }
