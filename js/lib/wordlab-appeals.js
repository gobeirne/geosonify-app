/*
  wordlab-appeals.js v1 — "I think this is fine": send a rejected Word Lab
  sentence for review.

  A player who believes a sentence the grammar rejects is good English can
  send it to the operator. The appeal is one Firestore document in
  /wordlab_appeals, written with an anonymous Firebase session. It holds only
  what the reviewer needs: the words, the grammar version, what the grammar
  said, an optional one-line note, and the time. It does NOT hold the
  anonymous identifier (the rules forbid any other field), so an appeal cannot
  be linked back to a player or to Starpin data. Players cannot read, change
  or delete appeals; only the reviewer (wordlab-appeals.html) can.

  Loaded on demand by the game (dynamic import), so pages that never send an
  appeal never contact Firebase.

  Usage:
    const {sendAppeal} = await import('./js/lib/wordlab-appeals.js');
    await sendAppeal({words: [...], version: 'phase0-0.2.1', reason: 'grammar_conflict',
                      summary: '…', note: 'Can you bless? Yes, I can bless.'});
*/

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

// Same public client config as geosonify-starpin-firebase.js (project
// geosonify-starpin). It identifies the project; the rules protect the data.
export const firebaseConfig = {
  apiKey:            'AIzaSyCna8NRmXsc-m0lCDb9t_KJQ3lzORoZUoQ',
  authDomain:        'geosonify-starpin.firebaseapp.com',
  projectId:         'geosonify-starpin',
  storageBucket:     'geosonify-starpin.firebasestorage.app',
  messagingSenderId: '306324213252',
  appId:             '1:306324213252:web:8d382c496a2467040eef51'
};

// Limits, mirrored in firestore.rules.
export const LIMITS = Object.freeze({words: 40, word: 24, note: 280, summary: 600, version: 40, reason: 40});
const REASONS = ['grammar_conflict', 'outside_supported_grammar'];

function app() { return getApps()[0] || initializeApp(firebaseConfig); }

function anonSession(auth) {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) { unsub(); resolve(user); }
    }, err => { unsub(); reject(err); });
    signInAnonymously(auth).catch(err => { unsub(); reject(err); });
  });
}

// Validate and trim on the client so a rule rejection is never the first
// sign of a malformed appeal.
export function buildAppeal({words, version, reason, summary, note}) {
  if (!Array.isArray(words) || !words.length) throw new Error('No words to send.');
  const w = words.map(x => String(x).toLowerCase().slice(0, LIMITS.word)).slice(0, LIMITS.words);
  if (!REASONS.includes(reason)) throw new Error('Only sentences the grammar rejected can be appealed.');
  return {
    words: w,
    version: String(version || '').slice(0, LIMITS.version),
    reason,
    summary: String(summary || '').slice(0, LIMITS.summary),
    note: String(note || '').trim().slice(0, LIMITS.note),
    status: 'open',
    createdAt: serverTimestamp()
  };
}

export async function sendAppeal(input) {
  const doc = buildAppeal(input);
  const a = app(), auth = getAuth(a);
  if (!auth.currentUser) await anonSession(auth);
  const ref = await addDoc(collection(getFirestore(a), 'wordlab_appeals'), doc);
  return ref.id;
}
