/**
 * hpwords-spoken-profiles-draft.js — DRAFT spoken profiles for HEALPix words.
 *
 * STATUS: DRAFT, NOT LOADED BY index.html, NOT ACCEPTED BY ANY DECODER.
 * Vocabulary approval is a separate step (native-speaker review + listening
 * tests). Until a profile is approved, nothing here changes what any code means.
 *
 * Source of the confusion groups: the "REMOVED WORDS" notes that justified the
 * 2025-word legacy grids (geosonify-grids-data.js), transcribed 2026-09-29 as
 * confusion table v0. Groups are about SPEECH; a group may contain off-list words.
 *
 * Semantics (see geosonify-hpwords.js, "spoken profiles"):
 *   aliases      heard-as token → OFFICIAL word (receiver side, typed in full)
 *   substitutes  OFFICIAL word  → spoken token  (sender side) — EMPTY until approved
 * Run `node spec/hpwords-checksum-eval.js --profiles` to validate these drafts.
 */
const HPWORDS_SPOKEN_PROFILES = {
  'english-spoken-draft0': {
    lang: 'english', status: 'draft', confusionTable: 'v0',
    aliases: { to: 'two', too: 'two', won: 'one', no: 'know', son: 'sun', dear: 'deer', flea: 'flee',
      sale: 'sail', stake: 'steak', steal: 'steel', seen: 'scene', weight: 'wait', waist: 'waste',
      weigh: 'way', male: 'mail', cell: 'sell', knight: 'night', serial: 'cereal', enquiry: 'inquiry' },
    substitutes: {},
    confusionGroups: [['right', 'write'], ['where', 'wear'], ['pear', 'pair'], ['peace', 'piece'],
      ['two', 'to', 'too'], ['one', 'won'], ['know', 'no'], ['sun', 'son'], ['deer', 'dear'], ['flee', 'flea'],
      ['sail', 'sale'], ['steak', 'stake'], ['steel', 'steal'], ['scene', 'seen'], ['wait', 'weight'],
      ['waste', 'waist'], ['way', 'weigh'], ['mail', 'male'], ['sell', 'cell'], ['night', 'knight'],
      ['cereal', 'serial'], ['inquiry', 'enquiry']]
  },
  'italian-spoken-draft0': {
    lang: 'italian', status: 'draft', confusionTable: 'v0',
    aliases: { fatto: 'fato', comma: 'coma', eco: 'ecco', canne: 'cane', moto: 'motto', cheto: 'ceto',
      detto: 'etto', molle: 'mole', pennare: 'penare', preso: 'peso', vetro: 'vero', esse: 'esso',
      usare: 'osare', hanno: 'anno' },
    substitutes: {},
    confusionGroups: [['baco', 'abaco'], ['paolo', 'palo'], ['anca', 'ancora'], ['lirica', 'lira'], ['atono', 'atomico'],
      ['fato', 'fatto'], ['coma', 'comma'], ['ecco', 'eco'], ['cane', 'canne'], ['motto', 'moto'], ['ceto', 'cheto'],
      ['etto', 'detto'], ['mole', 'molle'], ['penare', 'pennare'], ['peso', 'preso'], ['vero', 'vetro'],
      ['esso', 'esse'], ['osare', 'usare'], ['anno', 'hanno']]
  },
  'spanish-spoken-draft0': {
    lang: 'spanish', status: 'draft', confusionTable: 'v0', aliases: {}, substitutes: {},
    confusionGroups: 'suelo/sueño duelo/dueño consejo/conejo cajón/cañón rincón/riñón salmón/salón jabón/jamón bufón/buzón marco/marzo res/mes sed/red vena/pena vaso/paso rato/gato lata/pata gota/nota ola/cola vía/guía acto/alto aguja/agua barro/barco toser/tocar'.split(' ').map(g => g.split('/'))
  },
  'french-spoken-draft0': {
    lang: 'french', status: 'draft', confusionTable: 'v0', aliases: {}, substitutes: {},
    confusionGroups: 'emporter/apporter invasion/évasion invoquer/évoquer inhaler/inhiber bruyant/brillant cirer/crier effrayer/effacer émotion/émission implorer/employer sonnette/sonore songeur/sonde entendre/tendre subvenir/survie'.split(' ').map(g => g.split('/'))
  },
  'german-spoken-draft0': {
    lang: 'german', status: 'draft', confusionTable: 'v0', aliases: {}, substitutes: {},
    confusionGroups: 'sieb/sieg gelb/geld leib/leid grab/grad erbe/erde bube/bude rand/rang rind/ring land/lang beige/beide zahm/zahn darm/damm stumm/sturm hemd/herd reim/rein ende/ente seide/seite wanne/wanze dame/damm halde/halle'.split(' ').map(g => g.split('/'))
  },
  'korean-spoken-draft0': {
    lang: 'korean', status: 'draft', confusionTable: 'v0', aliases: {}, substitutes: {},
    confusionGroups: '생신/생선 이성/이상 심정/심장 최상/최선/최신 식기/식구 사설/사실 예감/예금 진료/진로 이곳/이것 저곳/저것 공원/공연 주문/주민 연속/연습 지갑/지각 반발/반말 해설/해석 기관/기간 관람/관련 면담/명단 장군/장관 정류장/정거장'.split(' ').map(g => g.split('/'))
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = HPWORDS_SPOKEN_PROFILES;
