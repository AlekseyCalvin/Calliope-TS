/* Calliope — front-end. Vanilla JS; talks to POST /api/analyze. */
'use strict';

/* ═══════════════════ Reference data (plain-language glossaries) ═══════════════════ */

const TIERS = {
  x: { name: 'zero-provision', color: 'var(--tier-x)', hint: 'maximally reduced function words: the, a, of, and, to' },
  w: { name: 'weak',           color: 'var(--tier-w)', hint: 'unstressed syllables of content words; unreduced function words' },
  n: { name: 'low',            color: 'var(--tier-n)', hint: 'lightly stressed syllables; pronouns and modals said with citation stress' },
  m: { name: 'moderate',       color: 'var(--tier-m)', hint: 'secondary stresses; stresses demoted by a stronger neighbour' },
  s: { name: 'strong',         color: 'var(--tier-s)', hint: 'primary stresses, phrase peaks, line-final nuclei' },
};

const LEX_NAMES = { 0: 'unstressed', 1: 'secondary stress', 2: 'primary stress', 3: 'boosted primary' };

/* meter family hues — one ink-strength set for parchment, one bright set for the terminal */
const METER_HUE_INK = {
  iambic: '#2f5e9e', trochaic: '#a06818', dactylic: '#1f6b47', amphibrachic: '#a04a78',
  anapestic: '#b3402e', bacchic: '#5d3f8e', spondaic: '#5a544a', pyrrhic: '#5a544a',
  'free verse': '#6b6355', free: '#6b6355',
};
const METER_HUE_TERM = {
  iambic: '#57a7ff', trochaic: '#f0a848', dactylic: '#46d17e', amphibrachic: '#ff85c0',
  anapestic: '#ff6b5e', bacchic: '#b39df1', spondaic: '#9a9a9a', pyrrhic: '#9a9a9a',
  'free verse': '#9a9a9a', free: '#9a9a9a',
};
let METER_HUE = METER_HUE_TERM;
const METER_DEF = {
  iambic:       { feet: '˘ ¯',   eg: 'be-LOW',      hint: 'rising duple — an offbeat then a beat' },
  trochaic:     { feet: '¯ ˘',   eg: 'TY-ger',      hint: 'falling duple — a beat then an offbeat' },
  anapestic:    { feet: '˘ ˘ ¯', eg: 'in-ter-VENE', hint: 'rising triple — two offbeats then a beat' },
  dactylic:     { feet: '¯ ˘ ˘', eg: 'MUR-mur-ing', hint: 'falling triple — a beat then two offbeats' },
  amphibrachic: { feet: '˘ ¯ ˘', eg: 'a-MA-zing',   hint: 'a beat cradled by offbeats' },
  bacchic:      { feet: '˘ ¯ ¯', eg: 'a-BOVE-BOARD',hint: 'one offbeat then two beats' },
  spondaic:     { feet: '¯ ¯',   eg: 'HEART-BREAK', hint: 'two beats side by side' },
  pyrrhic:      { feet: '˘ ˘',   eg: 'of the',      hint: 'two offbeats — a resting foot' },
};

const RHYME_TYPES = {
  perfect:   'the classic full rhyme — stressed vowel and everything after it match (grace / face)',
  rich:      'a perfect rhyme that also shares the consonant before the vowel (stationary / stationery)',
  identical: 'the very same word (or homophone) repeated at line-end',
  family:    'final consonants are siblings — same manner, different voicing (bat / bad)',
  assonant:  'the vowels agree but the consonants after them differ (lake / fate)',
  consonant: 'the consonants agree but the vowels differ (blank / think)',
  augmented: 'the rhyme extended by one final consonant (bray / brave, grow / sown)',
  diminished:'the mirror of augmented — the final consonant dropped (stained / rain)',
  grammatical:'stressed vowel matches at the roots; the tails are inflections (pun / running, fun / funny)',
  mosaic:    'one word’s rhyme spans SEVERAL words on the other line (tenderly / slender — see?)',
  wrenched:  'a stressed syllable rhymed against an unstressed one (wing / dancing)',
  eye:       'looks like a rhyme on the page but not in the mouth (love / move)',
};

const POS_GLOSS = {
  NN: 'noun', NNS: 'plural noun', NNP: 'proper noun', NNPS: 'plural proper noun',
  VB: 'verb (base form)', VBD: 'verb (past tense)', VBG: 'verb (-ing form)',
  VBN: 'verb (past participle)', VBP: 'verb (present)', VBZ: 'verb (he/she/it form)',
  MD: 'modal verb', JJ: 'adjective', JJR: 'comparative adjective', JJS: 'superlative adjective',
  RB: 'adverb', RBR: 'comparative adverb', RBS: 'superlative adverb',
  DT: 'determiner', PDT: 'predeterminer', CD: 'number',
  PRP: 'personal pronoun', 'PRP$': 'possessive pronoun',
  WDT: 'wh-determiner', WP: 'wh-pronoun', 'WP$': 'possessive wh-pronoun', WRB: 'wh-adverb',
  IN: 'preposition / subordinator', TO: 'infinitival “to”', CC: 'coordinating conjunction',
  RP: 'particle', EX: 'existential “there”', POS: 'possessive ending', UH: 'interjection', FW: 'foreign word',
};
const POS_EG = {
  NN: 'table, water', NNS: 'tables, waters', NNP: 'London, Pound', NNPS: 'Americans',
  VB: 'throw, run', VBD: 'threw, ran', VBG: 'throwing', VBN: 'thrown', VBP: '(I) throw', VBZ: 'throws',
  MD: 'can, must', JJ: 'green, large', JJR: 'greener', JJS: 'greenest',
  RB: 'quickly, very', RBR: 'faster', RBS: 'fastest',
  DT: 'the, a, an', PDT: 'all (the books)', CD: 'one, two',
  PRP: 'I, you, they', 'PRP$': 'my, their',
  WDT: 'which, that', WP: 'who, what', 'WP$': 'whose', WRB: 'when, why',
  IN: 'in, of, although', TO: 'to (go)', CC: 'and, but, or',
  RP: 'up (give up)', EX: 'there (is)', POS: '’s', UH: 'oh, wow', FW: 'je ne sais quoi',
};

const DEP_GLOSS = {
  nsubj: 'subject of', nsubjpass: 'passive subject of', csubj: 'clausal subject of',
  dobj: 'direct object of', obj: 'object of', iobj: 'indirect object of',
  pobj: 'object of preposition', obl: 'oblique complement of',
  ccomp: 'clausal complement of', xcomp: 'open complement of',
  advcl: 'adverbial clause under', acl: 'clause modifying', 'acl:relcl': 'relative clause on',
  amod: 'adjective modifying', advmod: 'adverb modifying', nummod: 'number on',
  nmod: 'noun modifying', 'nmod:poss': 'possessor of', poss: 'possessor of',
  appos: 'in apposition to', det: 'determiner of', 'det:predet': 'predeterminer of',
  prep: 'preposition attached to', case: 'case marker of',
  aux: 'auxiliary of', 'aux:pass': 'passive auxiliary of', auxpass: 'passive auxiliary of',
  cop: 'linking verb of', cc: 'conjunction joining', conj: 'conjoined with',
  mark: 'clause marker for', prt: 'particle of', 'compound:prt': 'particle of',
  compound: 'compounded with', flat: 'part of the name', fixed: 'fixed phrase with',
  expl: 'expletive for', discourse: 'discourse marker in', intj: 'interjection in',
  vocative: 'vocative in', parataxis: 'set beside', dep: 'loosely attached to',
  root: 'the root of the clause', punct: 'punctuation',
};

const FEAT_KEY_GLOSS = {
  Tense: 'tense', Number: 'number', Person: 'person', Mood: 'mood', VerbForm: 'verb form',
  Degree: 'degree', PronType: 'pronoun type', Definite: 'definiteness', Voice: 'voice',
  Case: 'case', NumType: 'number type', Poss: 'possessive', Gender: 'gender',
  Foreign: 'foreign', Abbr: 'abbreviation', Reflex: 'reflexive', Polarity: 'polarity',
  ExtPos: 'phrase role', Style: 'register', Typo: 'typo',
};
const FEAT_VAL_GLOSS = {
  Past: 'past', Pres: 'present', Fut: 'future', Sing: 'singular', Plur: 'plural',
  Ind: 'indicative', Imp: 'imperative', Sub: 'subjunctive', Cnd: 'conditional',
  Fin: 'finite', Inf: 'infinitive', Part: 'participle', Ger: 'gerund',
  Pos: 'positive', Cmp: 'comparative', Sup: 'superlative',
  Prs: 'personal', Art: 'article', Dem: 'demonstrative', Int: 'interrogative',
  Rel: 'relative', Neg: 'negative', Tot: 'total', Ind_: 'indefinite',
  Def: 'definite', Nom: 'nominative', Acc: 'accusative', Gen: 'genitive',
  Card: 'cardinal', Ord: 'ordinal', Mult: 'multiplicative',
  Act: 'active', Pass: 'passive', Yes: 'yes', Masc: 'masculine', Fem: 'feminine', Neut: 'neuter',
  '1': '1st', '2': '2nd', '3': '3rd', Arch: 'archaic', Expr: 'expressive',
};

const RHYME_PAL_INK = ['#1f6b47', '#5d3f8e', '#b3402e', '#a06818', '#2f5e9e', '#a04a78', '#4f7a1f', '#0f7a8a', '#8a3f9e', '#8c1015'];
const RHYME_PAL_TERM = ['#46d17e', '#b39df1', '#ff6b5e', '#f0a848', '#57a7ff', '#ff85c0', '#a3d465', '#3ecfe0', '#d78cff', '#ff9d9d'];
let RHYME_LETTER_PALETTE = RHYME_PAL_TERM;

const GRAD_STOPS = [
  [0.00, [0x6a, 0x8c, 0xc7]], [0.30, [0x5f, 0xc7, 0xc0]], [0.55, [0xd9, 0xc2, 0x4d]],
  [0.78, [0xe0, 0x91, 0x3f]], [1.00, [0xe0, 0x56, 0x4b]],
];
function grad(t) {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRAD_STOPS.length; i++) {
    const [t1, c1] = GRAD_STOPS[i - 1], [t2, c2] = GRAD_STOPS[i];
    if (x <= t2) {
      const f = t2 === t1 ? 0 : (x - t1) / (t2 - t1);
      return '#' + c1.map((v, k) => Math.round(v + (c2[k] - v) * f).toString(16).padStart(2, '0')).join('');
    }
  }
  return '#e0564b';
}

const SAMPLES = [
  { name: 'Shakespeare · Sonnet 130', text:
`My mistress' eyes are nothing like the sun;
Coral is far more red than her lips' red;
If snow be white, why then her breasts are dun;
If hairs be wires, black wires grow on her head.
I have seen roses damasked, red and white,
But no such roses see I in her cheeks;
And in some perfumes is there more delight
Than in the breath that from my mistress reeks.
I love to hear her speak, yet well I know
That music hath a far more pleasing sound;
I grant I never saw a goddess go;
My mistress, when she walks, treads on the ground.
And yet, by heaven, I think my love as rare
As any she belied with false compare.` },
  { name: 'Coleridge · Ancient Mariner (opening)', text:
`It is an ancient Mariner,
And he stoppeth one of three.
"By thy long grey beard and glittering eye,
Now wherefore stopp'st thou me?` },
  { name: 'Blake · The Tyger (two stanzas)', text:
`Tyger Tyger, burning bright,
In the forests of the night;
What immortal hand or eye,
Could frame thy fearful symmetry?

In what distant deeps or skies,
Burnt the fire of thine eyes?
On what wings dare he aspire?
What the hand, dare seize the fire?` },
  { name: 'Wyatt · They flee from me (stanza)', text:
`They flee from me that sometime did me seek
With naked foot, stalking in my chamber.
I have seen them gentle, tame, and meek,
That now are wild and do not remember
That sometime they put themself in danger
To take bread at my hand; and now they range,
Busily seeking with a continual change.` },
  { name: 'Dickinson · Because I could not stop', text:
`Because I could not stop for Death –
He kindly stopped for me –
The Carriage held but just Ourselves –
And Immortality.

We slowly drove – He knew no haste
And I had put away
My labor and my leisure too,
For His Civility –` },
  { name: 'Lear · a limerick', text:
`There was an Old Man with a beard,
Who said, "It is just as I feared!
Two Owls and a Hen,
Four Larks and a Wren,
Have all built their nests in my beard!"` },
  { name: 'Frost · Mending Wall (opening)', text:
`Something there is that doesn't love a wall,
That sends the frozen-ground-swell under it,
And spills the upper boulders in the sun;
And makes gaps even two can pass abreast.` },
];

const VEIL_LINES = [
  'Sounding the syllables…', 'Weighing every beat…', 'Listening for the caesurae…',
  'Grouping words the way speech groups them…', 'Auditioning seven meters…',
  'Consulting the pronouncing dictionary…', 'Tracing the dependency tree…',
];

/* ═══════════════════ State & elements ═══════════════════ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  data: null,
  engine: 'calliope',
  tint: 'rel',
  showFeet: false,
  pinned: null,          // { s, l, w }
  theme: localStorage.getItem('calliope-theme') || 'terminal',
};

function applyTheme() {
  const term = state.theme === 'terminal';
  document.body.classList.toggle('theme-terminal', term);
  METER_HUE = term ? METER_HUE_TERM : METER_HUE_INK;
  RHYME_LETTER_PALETTE = term ? RHYME_PAL_TERM : RHYME_PAL_INK;
}
applyTheme();

const els = {
  input: $('#poem-input'),
  analyze: $('#btn-analyze'),
  scriptorium: $('#scriptorium'),
  editStrip: $('#edit-strip'),
  reopen: $('#btn-reopen'),
  resultsZone: $('#results-zone'),
  codex: $('#codex'),
  synopsis: $('#synopsis-card'),
  phono: $('#phonopoetics-card'),
  inspectorBody: $('#inspector-body'),
  inspectorHint: $('#inspector-hint'),
  emptyHint: $('#empty-hint'),
  tooltip: $('#tooltip'),
  veil: $('#veil'),
  veilText: $('#veil-text'),
  legend: $('#legend'),
  legendBody: $('#legend-body'),
  toast: $('#toast'),
  sampleSelect: $('#sample-select'),
  tintSelect: $('#tint-select'),
  feetToggle: $('#feet-toggle'),
  engineNote: $('#engine-note'),
};

/* ═══════════════════ Small helpers ═══════════════════ */

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

const meterFamily = (name) => (name || '').split(' ')[0].toLowerCase();
const meterColor = (name) => METER_HUE[meterFamily(name)] ?? METER_HUE.free;
const letterColor = (letter) => {
  const code = (letter || 'A').toUpperCase().charCodeAt(0) - 65;
  return RHYME_LETTER_PALETTE[((code % RHYME_LETTER_PALETTE.length) + RHYME_LETTER_PALETTE.length) % RHYME_LETTER_PALETTE.length];
};

/** Colour any meter-family words inside a plain string (for synopsis rows). */
function tintMeterNames(str) {
  return esc(str).replace(
    /\b(iambic|trochaic|dactylic|amphibrachic|anapestic|bacchic|spondaic|pyrrhic|iamb|troch|dact|amph|anap|bacch|spon|pyrr)\b/gi,
    (w) => {
      const k = w.toLowerCase();
      const fam = k.startsWith('iamb') ? 'iambic' : k.startsWith('troch') ? 'trochaic'
        : k.startsWith('dact') ? 'dactylic' : k.startsWith('amph') ? 'amphibrachic'
        : k.startsWith('anap') ? 'anapestic' : k.startsWith('bacch') ? 'bacchic'
        : k.startsWith('spon') ? 'spondaic' : 'pyrrhic';
      return `<span style="color:${METER_HUE[fam]}">${w}</span>`;
    });
}

function featPhrase(key, val) {
  const k = FEAT_KEY_GLOSS[key] ?? key;
  const v = FEAT_VAL_GLOSS[val] ?? val;
  return { k, v };
}

function depPhrase(word) {
  if (!word.dep) return null;
  if (word.dep.isRoot) return { rel: 'root', text: 'the root of the clause — everything else hangs from it' };
  const gloss = DEP_GLOSS[word.dep.rel] ?? `“${word.dep.rel}” of`;
  return { rel: word.dep.rel, text: `${gloss} “${word.dep.govWord}”` };
}

function caesuraGlyph(c) {
  const glyph = c.strength < 0.34 ? '·' : (c.kind === 'hard' ? '‖' : '¦');
  const label = c.kind === 'hard' ? 'caesura — a real spoken pause here' : 'lighter, inferred phrase break';
  return { glyph, color: grad(c.strength), label: `${label} (strength ${(c.strength * 100) | 0}%)` };
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, 4200);
}

/* ═══════════════════ Analyze flow ═══════════════════ */

let veilTimer = null;
function showVeil() {
  let i = 0;
  els.veilText.textContent = VEIL_LINES[0];
  els.veil.hidden = false;
  veilTimer = setInterval(() => { els.veilText.textContent = VEIL_LINES[++i % VEIL_LINES.length]; }, 1400);
}
function hideVeil() { clearInterval(veilTimer); els.veil.hidden = true; }

async function analyze() {
  const text = els.input.value.trim();
  if (!text) { toast('Give Calliope a line or two first.'); return; }
  els.analyze.disabled = true;
  showVeil();
  try {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, engine: state.engine }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `server said ${r.status}`);
    state.data = data;
    state.pinned = null;
    renderAll();
    els.scriptorium.hidden = true;
    els.editStrip.hidden = false;
    els.resultsZone.hidden = false;
    els.emptyHint.hidden = true;
    els.engineNote.textContent = `${data.engine === 'clio' ? 'Clio (legacy parse)' : 'Calliope'} · ${data.elapsedMs} ms`;
  } catch (err) {
    console.error(err);
    const netFail = err instanceof TypeError || /fetch/i.test(err.message);
    toast(netFail
      ? 'The engine isn’t answering — start it with `npm run web` and open http://localhost:4321.'
      : 'The scansion faltered: ' + err.message);
  } finally {
    hideVeil();
    els.analyze.disabled = false;
  }
}

/* ═══════════════════ Rendering: the codex ═══════════════════ */

/* grammatical status: root / argument / modifier / functor / satellite */
const ARG_RELS = new Set(['nsubj', 'nsubjpass', 'csubj', 'obj', 'dobj', 'iobj']);
const MOD_RELS = new Set(['amod', 'advmod', 'nmod', 'nummod', 'acl', 'acl:relcl', 'advcl', 'appos', 'poss', 'nmod:poss', 'obl', 'pobj']);
function wordStatus(w) {
  if (!w.dep) return { label: 'unattached', hint: 'no dependency edge parsed', color: 'var(--sepia)' };
  if (w.dep.isRoot) return { label: 'root', hint: 'the head of the whole clause — everything else relies on it', color: 'var(--viridian)' };
  const r = w.dep.rel;
  if (ARG_RELS.has(r)) return { label: 'argument', hint: `a core argument (${r}) — who or what the predicate involves`, color: 'var(--blue)' };
  if (MOD_RELS.has(r)) return { label: 'modifier', hint: `a modifier (${r}) — colours its companion without being required by it`, color: 'var(--rose)' };
  if (!w.isContent) return { label: 'functor', hint: `grammatical machinery (${r}) — a function word in service of the phrase`, color: 'var(--amber)' };
  return { label: r, hint: DEP_GLOSS[r] ?? r, color: 'var(--sepia)' };
}

/* poem-wide sound roles: end/caesural/head rhymes + alliteration, per word */
function buildPoemRoles() {
  const roles = new Map();   // lowercase word → [{label, hint, color}]
  const add = (word, role) => {
    const k = String(word).toLowerCase();
    if (!roles.has(k)) roles.set(k, []);
    if (!roles.get(k).some(r => r.label === role.label)) roles.get(k).push(role);
  };
  const p = state.data?.phonopoetics;
  if (p) {
    const KIND_HINT = { end: 'an end rhyme — binds line-ends', caesural: 'a caesural rhyme — lands just before a mid-line pause', head: 'a head rhyme — rings at line-openings' };
    for (const kind of ['end', 'caesural', 'head']) {
      for (const r of p[kind] ?? []) {
        const hintA = `${KIND_HINT[kind]}; ${r.type ?? ''} rhyme with “${r.toWord}” (${r.toLabel})`;
        const hintB = `${KIND_HINT[kind]}; ${r.type ?? ''} rhyme with “${r.fromWord}” (${r.fromLabel})`;
        add(r.fromWord, { label: `${kind} rhyme ${r.letter}`, hint: hintA, color: letterColor(r.letter) });
        add(r.toWord, { label: `${kind} rhyme ${r.letter}`, hint: hintB, color: letterColor(r.letter) });
      }
    }
    for (const a of p.alliteration ?? []) {
      for (const word of a.words) {
        add(word, { label: `alliterates (${a.label})`, hint: `alliterates with: ${a.words.join(', ')}`, color: 'var(--teal)' });
      }
    }
  }
  state.poemRoles = roles;
}
function rolesFor(w) {
  const keys = [w.norm?.toLowerCase(), (w.text || '').toLowerCase().replace(/[^a-z'’-]/g, '')];
  for (const k of keys) { if (k && state.poemRoles?.has(k)) return state.poemRoles.get(k); }
  return [];
}
function dependentsOf(line, wordIdx) {
  return (line.deps ?? [])
    .filter(d => d.to === wordIdx && d.from !== wordIdx)
    .map(d => ({ word: line.words[d.from]?.text ?? '?', rel: d.rel }));
}

/* Zipf reading: nounsing lexicon freq is on the Zipf scale (~1–7) */
function zipfGloss(f) {
  const z = Number(f);
  if (!isFinite(z)) return null;
  const band = z >= 5 ? 'everyday-common' : z >= 4 ? 'common' : z >= 3 ? 'moderately common' : z >= 2 ? 'uncommon' : 'rare';
  return `Zipf ${z.toFixed(2)} — ${band}`;
}

function renderAll() {
  buildPoemRoles();
  renderCodex();
  renderSynopsis();
  renderPhonopoetics();
  renderInspector();
}

function tintClass() {
  return { rel: 'tint-rel', lex: 'tint-lex', class: 'tint-class', off: 'tint-off' }[state.tint];
}

function renderCodex() {
  const data = state.data;
  els.codex.innerHTML = '';
  els.codex.className = 'codex panel ' + tintClass();
  const multi = data.stanzas.length > 1;
  let poemLineNo = 0;

  data.stanzas.forEach((st, sIdx) => {
    const stanza = el('div', { class: 'stanza' });
    if (multi || st.formNote) {
      stanza.append(el('div', { class: 'stanza-head' },
        multi ? el('span', { class: 'stanza-no', text: `Stanza ${sIdx + 1}` }) : null,
        st.formNote ? el('span', { class: 'form-note', text: st.formNote, title: 'the stanza’s poetic form' }) : null,
      ));
    }
    st.lines.forEach((line, lIdx) => {
      poemLineNo++;
      stanza.append(renderLine(line, sIdx, lIdx, poemLineNo));
    });
    els.codex.append(stanza);
  });
}

function renderLine(line, sIdx, lIdx, no) {
  const row = el('div', { class: 'vline', 'data-s': sIdx, 'data-l': lIdx });
  const main = el('div', { class: 'vline-main' });
  main.append(el('span', { class: 'vline-no', text: String(no) }));

  if (!line.parsed) {
    main.append(el('span', { class: 'vline-text' }, el('span', { class: 'gap', text: line.raw })));
    main.append(el('span', { class: 'vline-noparse', text: '(no parse)' }));
    row.append(main);
    return row;
  }

  main.append(renderLineText(line, sIdx, lIdx));
  main.append(el('span', { class: 'vline-lead', 'aria-hidden': 'true' }));
  main.append(renderChips(line, sIdx, lIdx));
  row.append(main);
  return row;
}

function renderLineText(line, sIdx, lIdx) {
  const wrap = el('span', { class: 'vline-text' });

  // marks to insert AFTER the chunk holding global syllable g:
  const caesAfter = new Map();          // g -> caesura info
  for (const c of line.caesurae) if (c.after > 0) caesAfter.set(c.after - 1, c);
  const footAfter = new Set();          // g -> foot boundary (except line end)
  if (line.feet.length > 1) {
    for (let f = 0; f < line.feet.length - 1; f++) {
      const syls = line.feet[f].cells.filter(c => c.s !== undefined);
      if (syls.length) footAfter.add(syls[syls.length - 1].s);
    }
  }

  const markNodes = (g) => {
    const out = [];
    if (!state.showFeet) return out;
    const c = caesAfter.get(g);
    if (c) {
      const { glyph, color, label } = caesuraGlyph(c);
      out.push(el('span', { class: 'caesmark', text: ` ${glyph} `, title: label, style: { color } }));
    } else if (footAfter.has(g)) {
      out.push(el('span', { class: 'footmark', text: '|', title: 'foot boundary' }));
    }
    return out;
  };

  for (const seg of line.segments) {
    if (seg.t === 'gap') { wrap.append(el('span', { class: 'gap', text: seg.text })); continue; }
    const w = line.words[seg.w];
    const wordSpan = el('span', {
      class: `word ${w.isContent ? 'is-content' : 'is-function'}`,
      'data-s': sIdx, 'data-l': lIdx, 'data-w': seg.w,
    });
    for (const ch of seg.chunks) {
      const syl = w.syls[ch.si] ?? w.syls[0];
      const g = w.firstSyl + ch.si;
      wordSpan.append(el('span', {
        class: `chunk t-${syl?.rel ?? 'w'} l-${Math.min(3, syl?.lex ?? 0)}`,
        'data-g': g, text: ch.text,
      }));
      wordSpan.append(...markNodes(g));
    }
    wrap.append(wordSpan);
  }
  return wrap;
}

function renderChips(line, sIdx, lIdx) {
  const d = line.detail;
  const chips = el('span', { class: 'vline-chips', title: 'open this line’s detailed scan' });

  const fam = meterFamily(d.meterName === 'free verse' ? 'free verse' : d.meter);
  const famColor = meterColor(d.meter);
  const meterChip = el('span', { class: 'meter-chip' },
    el('span', { class: 'meter-dot', style: { background: famColor, boxShadow: `0 0 8px ${famColor}66` } }),
    el('span', { style: { color: famColor } }, d.meterName === 'free verse' ? 'free verse' : fam),
    d.footCount > 0 ? el('span', { class: 'fit-pct', text: `×${d.footCount}` }) : null,
    el('span', { class: 'fit-pct', text: `${d.certainty}%` }),
  );
  chips.append(meterChip);

  const rhymeCluster = el('span', { class: 'rhyme-cluster' });
  if (d.rhyme) {
    for (const iw of d.rhyme.internal ?? []) {
      rhymeCluster.append(el('span', {
        class: 'rhyme-chip', text: `(${iw.letter})`,
        style: { color: letterColor(iw.letter), borderColor: letterColor(iw.letter) + '55' },
        title: `internal rhyme before the caesura: “${iw.word}”${iw.type ? ' — ' + iw.type + ' rhyme' : ''}`,
      }));
    }
    if (d.rhyme.letter && d.rhyme.letter !== '·') {
      rhymeCluster.append(el('span', {
        class: 'rhyme-chip', text: d.rhyme.letter,
        style: { color: letterColor(d.rhyme.letter), borderColor: letterColor(d.rhyme.letter) + '55' },
        title: `end-rhyme “${d.rhyme.endWord}” — scheme letter ${d.rhyme.letter}${d.rhyme.type ? ', ' + d.rhyme.type + ' rhyme' : ''}${d.rhyme.matchedLine != null ? ', first bound at line ' + (d.rhyme.matchedLine + 1) : ''}`,
      }));
    } else if (!(d.rhyme.internal ?? []).length) {
      rhymeCluster.append(el('span', { class: 'rhyme-chip unrhymed', text: '·', title: `“${d.rhyme.endWord}” — unrhymed` }));
    }
  }
  chips.append(rhymeCluster);

  chips.append(el('span', { class: 'lab-caret', text: '▸ SCAN', title: 'open this line’s detailed scan' }));

  const notes = el('span', { class: 'note-cluster' });
  if (d.rhythmNote) notes.append(el('span', { class: 'note-glyph', text: '♪', style: { color: METER_HUE.amphibrachic }, title: d.rhythmNote }));
  if (d.standaloneMeter) notes.append(el('span', { class: 'note-glyph', text: '≈', style: { color: 'var(--heliotrope)' }, title: `continuity: read with the stanza; standalone best fit is ${d.standaloneMeter}` }));
  if (d.consensusMeter) notes.append(el('span', { class: 'note-glyph', text: '↔', style: { color: 'var(--heliotrope)' }, title: `aligns with stanza ${d.consensusMeter}` }));
  if (d.metricalityNote) notes.append(el('span', { class: 'note-glyph', text: '¶', style: { color: 'var(--sepia)' }, title: d.metricalityNote }));
  chips.append(notes);
  chips.addEventListener('click', (e) => { e.stopPropagation(); toggleLab(sIdx, lIdx); });
  return chips;
}

/* ═══════════════════ The line laboratory ═══════════════════ */

function lineRowEl(sIdx, lIdx) {
  return $(`.vline[data-s="${sIdx}"][data-l="${lIdx}"]`, els.codex);
}

function toggleLab(sIdx, lIdx) {
  const row = lineRowEl(sIdx, lIdx);
  if (!row) return;
  const existing = $('.lab', row);
  if (existing) { existing.remove(); row.classList.remove('is-open'); return; }
  const line = state.data.stanzas[sIdx].lines[lIdx];
  const lab = buildLab(line, sIdx, lIdx);
  row.append(lab);
  row.classList.add('is-open');
  drawDepArcs(lab, line);
}

function labHeader(title, sub) {
  return el('h4', {}, title, sub ? el('span', { class: 'whisper', text: sub }) : null);
}

function buildLab(line, sIdx, lIdx) {
  const d = line.detail;
  const lab = el('div', { class: 'lab' });

  /* ── verdict ── */
  lab.append(labHeader('Best reading', 'what meter this line is, and how surely'));
  const famColor = meterColor(d.meter);
  const verdict = el('div', { class: 'verdict' });
  verdict.append(el('span', { class: 'verdict-meter' },
    el('span', { style: { color: famColor } }, d.meter),
    d.footCount > 0 ? el('span', { class: 'foot-ct', text: `${d.footCount} feet` }) : null,
  ));
  verdict.append(el('span', { class: 'fitbar', title: 'fit: the share of the line realized by clean, unsubstituted feet' },
    el('i', { style: { width: `${d.certainty}%` } })));
  verdict.append(el('span', { class: 'fit-label', text: `${d.certainty}% fit` }));

  const notes = el('div', { class: 'verdict-notes' });
  if (d.standaloneMeter) notes.append(el('span', { class: 'verdict-note', html: `≈ read with the stanza for continuity — on its own this line fits <b>${esc(d.standaloneMeter)}</b> a hair better.` }));
  if (d.consensusMeter) notes.append(el('span', { class: 'verdict-note', html: `↔ compatible with the stanza’s <b>${esc(d.consensusMeter)}</b>.` }));
  if (d.rhythmNote) notes.append(el('span', { class: 'verdict-note rhythm', html: `♪ ${esc(d.rhythmNote)} — a steady count of strong beats over a varying syllable count.` }));
  if (d.metricalityNote) notes.append(el('span', { class: 'verdict-note hedge', text: '¶ ' + d.metricalityNote }));
  if (d.rhyme && d.rhyme.letter !== '·' && d.rhyme.matchedLine != null) {
    notes.append(el('span', { class: 'verdict-note', html: `rhymes “<b>${esc(d.rhyme.endWord)}</b>” with line ${d.rhyme.matchedLine + 1}${d.rhyme.type ? ` — a <b>${esc(d.rhyme.type)}</b> rhyme` : ''}.` }));
  }
  if (notes.children.length) verdict.append(notes);
  lab.append(verdict);

  /* ── candidate ranking ── */
  if (d.ranking?.length) {
    lab.append(labHeader('Candidate meters', 'all seven auditioned — in the engine’s ranked order (arbitration can outrank a raw score)'));
    const maxScore = Math.max(...d.ranking.map(r => r.score), 0.001);
    const rankBox = el('div', { class: 'ranking' });
    d.ranking.slice(0, 5).forEach(r => {
      rankBox.append(el('div', { class: 'rank-row' },
        el('span', { class: 'rank-name', text: r.meter, style: { color: meterColor(r.meter) } }),
        el('span', { class: 'rank-bar' }, el('i', { style: { width: `${(r.score / maxScore) * 100}%`, background: meterColor(r.meter) } })),
        el('span', { class: 'rank-score', text: r.score.toFixed(2) }),
      ));
    });
    lab.append(rankBox);
  }

  /* ── feet ── */
  lab.append(labHeader('Scansion, foot by foot', `map: ${d.scansion}`));
  lab.append(buildFeetTrack(line));

  /* ── syllable matrix ── */
  lab.append(labHeader('Syllable anatomy', 'every layer of every syllable — hover the poem for the same data'));
  lab.append(buildMatrix(line));

  /* ── prosodic phrasing ── */
  lab.append(labHeader('Prosodic phrasing', 'how speech strands & braids the words: κ clitic group · ϕ phrase · ι intonational unit'));
  lab.append(buildBracketing(line));
  lab.append(buildHierTree(line));

  /* ── key stresses ── */
  if (line.keyStresses?.length) {
    lab.append(labHeader('Key stresses', 'right-edge evidence, weighted by unit size — hover to see where'));
    const ksRow = el('div', { class: 'keystress-row' });
    const UNIT_NAME = { IU: 'intonational unit', PP: 'phrase', CP: 'clitic group', PW: 'word' };
    for (const ks of line.keyStresses) {
      const chip = el('span', { class: 'ks-chip', title: `end of a ${UNIT_NAME[ks.unitType] ?? ks.unitType} — weight ${ks.weight}` },
        el('span', { class: 'kst', text: ks.unitType, style: { color: ks.unitType === 'IU' ? 'var(--viridian)' : ks.unitType === 'PP' ? 'var(--blue)' : ks.unitType === 'CP' ? 'var(--rose)' : 'var(--sepia)' } }),
        el('span', { text: ks.pattern }),
        el('span', { class: 'ksw', text: `×${ks.weight}` }),
      );
      chip.addEventListener('mouseenter', () => highlightSyls(sIdx, lIdx, ks.positions, true));
      chip.addEventListener('mouseleave', () => highlightSyls(sIdx, lIdx, ks.positions, false));
      ksRow.append(chip);
    }
    lab.append(ksRow);
  }

  /* ── syntax ── */
  if (line.deps?.length) {
    lab.append(labHeader('Syntax', 'bonds of reliance — the phrasal dependency tree, from UDPipe'));
    const stage = el('div', { class: 'dep-stage' });
    stage.append(el('div', { class: 'dep-svg-slot' }));
    const wordsRow = el('div', { class: 'dep-words' });
    line.words.forEach(w => {
      wordsRow.append(el('div', { class: `dep-word ${w.isContent ? 'is-content' : 'is-function'}`, 'data-w': w.i },
        el('span', { class: 'dw-text', text: w.text }),
        el('span', { class: 'dw-pos', text: w.pos, title: POS_GLOSS[w.pos] ?? w.pos }),
      ));
    });
    stage.append(wordsRow);
    lab.append(stage);
  }

  /* ── scandroid (fully independent second opinion) ── */
  if (line.scandroid) {
    const sd = line.scandroid;
    lab.append(labHeader('Scandroid’s second opinion', 'Charles Hartman’s classic scanner — its own dictionary, syllabifier, and algorithms, reading only the raw line'));
    const rows = el('div', { class: 'scandroid-rows' });
    const lengthTxt = sd.lineFeetSet ? sd.lineLengthName : `${sd.lineLengthName} (variable)`;
    rows.append(el('div', { html: `<b>Metron</b> · ${esc(sd.metronName)} ${esc(lengthTxt)}` }));
    const footRow = (label, f) => {
      if (!f) return;
      const failTag = f.ok ? '' : ` <span class="scandroid-fail">FAIL${f.failReason ? ` (${esc(f.failReason)})` : ''}</span>`;
      rows.append(el('div', { html: `<b>${esc(label)}</b> · ${esc(f.scanString)}${failTag}` }));
    };
    footRow('Verdict', sd.verdict);
    if (sd.verdict) rows.append(el('div', { class: 'scandroid-marks', html: `marks · ${esc(sd.verdict.marksString)} · ${sd.verdict.substitutions} substitution(s)` }));
    footRow('Corral the Weird', sd.corralTheWeird);
    footRow('Maximize the Normal', sd.maximizeTheNormal);
    lab.append(rows);
  }

  /* ── Fabb–Halle bracketed grid ── */
  if (line.fabbHalle) {
    const fh = line.fabbHalle;
    lab.append(labHeader('Fabb–Halle bracketed grid', 'Meter in Poetry (2008): counting-first gridline scansion — * projects, ( groups rightward, ) leftward'));
    const wrap = el('div', { class: 'fh-grid' });
    wrap.append(el('div', {
      text: fh.rule,
      style: { color: 'var(--whisper, #888)', fontSize: '12px', marginBottom: '4px' },
    }));
    const texts = line.syllables.map(s => s.text);
    const colW = texts.map((t, i) =>
      Math.max((t || '').length, ...fh.rows.map(r => (r[i] || '').length)) + 1);
    const padTo = (t, w) => t + ' '.repeat(Math.max(0, w - t.length));
    const maxSet = new Set(fh.maxima);
    const violSet = new Set(fh.violations);
    const sylRow = texts.map((t, i) => {
      const cell = esc(padTo(t || '', colW[i]));
      if (violSet.has(i)) return `<span style="color:#e06c5a">${cell}</span>`;
      if (maxSet.has(i)) return `<span style="color:#d4b653">${cell}</span>`;
      return cell;
    }).join('');
    let gridHtml = `<span style="opacity:.55">Syl: </span>${sylRow}\n`;
    fh.rows.forEach((row, g) => {
      gridHtml += `<span style="opacity:.55">G${g}:  </span>` +
        esc(row.map((m, i) => padTo(m || '', colW[i])).join('')) + '\n';
    });
    wrap.append(el('pre', {
      html: gridHtml,
      style: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px', lineHeight: '1.5', overflowX: 'auto',
        margin: '4px 0', whiteSpace: 'pre',
      },
    }));
    const verdict = fh.looseFeet != null
      ? `${fh.looseFeet} feet — in a loose meter the foot count IS the meter; maxima anchor the feet, unfooted syllables are free`
      : fh.maxima.length === 0
        ? 'no maxima in this line — vacuously metrical'
        : fh.violations.length === 0
          ? `${fh.maxima.length} maxim${fh.maxima.length === 1 ? 'um' : 'a'}, all project to gridline 1 → metrical`
          : `${fh.violations.length} of ${fh.maxima.length} maxima fail to project → unmetrical under these rules`;
    wrap.append(el('div', {
      text: verdict,
      style: { fontSize: '12px', color: fh.metrical ? '#7fb069' : '#e06c5a' },
    }));
    lab.append(wrap);
  }

  return lab;
}

function buildFeetTrack(line) {
  const track = el('div', { class: 'feet-track' });
  const caesAtCount = new Map(line.caesurae.map(c => [c.after, c]));
  let count = 0;
  line.feet.forEach((foot, fi) => {
    const cell = el('div', { class: 'foot-cell', title: `foot ${fi + 1}: ${foot.pattern}` });
    for (const c of foot.cells) {
      if (c.silent) {
        cell.append(el('span', { class: 'foot-syl silent', title: 'silent beat — a rest inserted to part two clashing stresses' },
          el('span', { class: 'fs-text', text: '·' }), el('span', { class: 'fs-mark', text: '—', style: { color: 'var(--whisper)' } })));
        continue;
      }
      const syl = line.syllables[c.s];
      count++;
      const color = `var(--tier-${syl?.rel ?? 'w'})`;
      cell.append(el('span', { class: 'foot-syl', title: syl ? `${TIERS[syl.rel]?.name} · ${syl.phones}` : '' },
        el('span', { class: 'fs-text', text: syl?.text ?? '?', style: { color } }),
        el('span', { class: 'fs-mark', text: c.mark, style: { color } })));
    }
    track.append(cell);
    const caes = caesAtCount.get(count);
    if (caes) {
      const { glyph, color, label } = caesuraGlyph(caes);
      track.append(el('span', { class: 'caes-cell', text: glyph, title: label, style: { color } }));
    } else if (fi < line.feet.length - 1) {
      track.append(el('span', { class: 'foot-sep', text: '|' }));
    }
  });
  return track;
}

function buildMatrix(line) {
  const wrap = el('div', { class: 'matrix-wrap' });
  const table = el('table', { class: 'matrix' });

  const trWord = el('tr', {}, el('th', { class: 'rowlab', text: 'word' }));
  const trPhrase = el('tr', {}, el('th', { class: 'rowlab', text: 'phrase rank', title: 'cyclic compound + nuclear stress: 1 = the utterance’s strongest word' }));
  line.words.forEach(w => {
    const span = Math.max(1, w.syls.length);
    trWord.append(el('td', { class: 'wordhead', colspan: span },
      w.text, el('span', { class: 'pos', text: w.pos, title: POS_GLOSS[w.pos] ?? '' })));
    const ps = w.phraseStress || 0;
    const psColor = ps === 1 ? 'var(--green-hi)' : ps > 0 && ps <= 3 ? 'var(--green)' : 'var(--whisper)';
    trPhrase.append(el('td', { colspan: span, text: ps === 0 ? '—' : String(ps), style: { color: psColor }, title: ps === 1 ? 'the strongest word of the utterance' : ps === 0 ? 'no phrase stress' : `phrase-prominence rank ${ps} (1 = strongest)` }));
  });

  const rows = {
    syl: el('tr', {}, el('th', { class: 'rowlab', text: 'syllable' })),
    phones: el('tr', {}, el('th', { class: 'rowlab', text: 'phones', title: 'ARPAbet transcription from the CMU dictionary (via Nounsing Pro)' })),
    weight: el('tr', {}, el('th', { class: 'rowlab', text: 'weight', title: 'H = heavy syllable (long vowel or closed), L = light' })),
    lex: el('tr', {}, el('th', { class: 'rowlab', text: 'lexical', title: 'dictionary stress: 0 none · 1 secondary · 2 primary · 3+ boosted' })),
    rel: el('tr', {}, el('th', { class: 'rowlab', text: 'relative', title: 'the five-tier phonological scale after phrase rules: x w n m s' })),
  };
  const LEXCOL = { 0: '#5c6da0', 1: '#7a4fa0', 2: '#b3402e', 3: '#8c1015' };
  line.words.forEach(w => {
    w.syls.forEach(s => {
      const g = w.firstSyl + s.si;
      rows.syl.append(el('td', { class: 'syltext', 'data-g': g, text: s.text || '·' }));
      rows.phones.append(el('td', { class: 'phones', 'data-g': g, text: s.phones.replace(/[()]/g, '') }));
      rows.weight.append(el('td', { 'data-g': g, text: s.weight ?? '—', title: s.weight === 'H' ? 'heavy' : s.weight === 'L' ? 'light' : '' }));
      rows.lex.append(el('td', { 'data-g': g, text: String(s.lex), style: { color: LEXCOL[Math.min(3, s.lex)] }, title: LEX_NAMES[Math.min(3, s.lex)] }));
      rows.rel.append(el('td', { 'data-g': g, text: s.rel, style: { color: `var(--tier-${s.rel})`, fontWeight: 600 }, title: TIERS[s.rel]?.name }));
    });
    if (!w.syls.length) {
      rows.syl.append(el('td', { text: '—' })); rows.phones.append(el('td', { text: '' }));
      rows.weight.append(el('td', { text: '' })); rows.lex.append(el('td', { text: '' })); rows.rel.append(el('td', { text: '' }));
    }
  });

  table.append(trWord, rows.syl, rows.phones, rows.weight, rows.lex, rows.rel, trPhrase);
  wrap.append(table);
  return wrap;
}

function buildBracketing(line) {
  const box = el('div', { class: 'bracketing' });
  const KAPPA_COLOR = '#7a8fc9';
  const key = (m, lvl) => !m ? 'x' : lvl === 'cp' ? `${m.iu}.${m.pp}.${m.cp}` : lvl === 'pp' ? `${m.iu}.${m.pp}` : `${m.iu}`;
  let phiOrd = -1;
  let phiColor = 'var(--heliotrope)';
  let iotaColor = 'var(--viridian)';

  line.words.forEach((w, wi) => {
    const m = line.unitOf[wi];
    const prev = wi > 0 ? line.unitOf[wi - 1] : null;
    const next = wi < line.words.length - 1 ? line.unitOf[wi + 1] : null;
    const firstPP = !prev || key(prev, 'pp') !== key(m, 'pp');
    const firstIU = !prev || key(prev, 'iu') !== key(m, 'iu');
    const firstCP = !prev || key(prev, 'cp') !== key(m, 'cp');
    const lastPP = !next || key(next, 'pp') !== key(m, 'pp');
    const lastIU = !next || key(next, 'iu') !== key(m, 'iu');
    const lastCP = !next || key(next, 'cp') !== key(m, 'cp');

    if (firstPP) {
      phiOrd++;
      const st = line.boundaries?.phi?.[phiOrd]?.strength ?? 0;
      phiColor = grad(st);
      if (firstIU) iotaColor = phiColor;
    }
    if (wi > 0) box.append(' ');
    if (firstIU) box.append(el('span', { class: 'br', text: '<', style: { color: iotaColor }, title: 'ι — intonational unit begins' }));
    if (firstPP) box.append(el('span', { class: 'br', text: '{', style: { color: phiColor }, title: 'ϕ — phonological phrase begins (tint = boundary strength)' }));
    if (firstCP) box.append(el('span', { class: 'br', text: '[', style: { color: KAPPA_COLOR }, title: 'κ — clitic group: a content word plus its little satellites' }));

    const wordSpan = el('span', {});
    w.syls.forEach(s => wordSpan.append(el('span', { text: s.text, style: { color: `var(--tier-${s.rel})` } })));
    if (!w.syls.length) wordSpan.append(w.text);
    box.append(wordSpan);

    if (lastCP) box.append(el('span', { class: 'br', text: ']', style: { color: KAPPA_COLOR } }));
    if (lastPP) box.append(el('span', { class: 'br', text: '}', style: { color: phiColor } }));
    if (lastIU) box.append(el('span', { class: 'br', text: '>', style: { color: iotaColor } }));
  });
  return box;
}

function buildHierTree(line) {
  const tree = el('div', { class: 'hier-tree' });
  line.hierarchy.forEach((iu, ii) => {
    const iuRow = el('div', { class: 'iu-row' }, el('span', { class: 'unit-tag iu', text: `ι ${ii + 1}` }));
    iu.pps.forEach((pp, pi) => {
      const ppRow = el('div', { class: 'pp-row' }, el('span', { class: 'unit-tag pp', text: `ϕ ${ii + 1}.${pi + 1}` }));
      pp.cps.forEach((cp) => {
        const cpSpan = el('span', { class: 'cp-inline' }, el('span', { class: 'unit-tag cp', text: 'κ' }));
        cp.forEach(wi => {
          const w = line.words[wi];
          if (w) cpSpan.append(el('span', { class: 'cw', text: w.text, style: { fontStyle: w.isContent ? 'normal' : 'italic', color: w.isContent ? 'var(--ink)' : 'var(--sepia)' } }));
        });
        ppRow.append(cpSpan);
      });
      iuRow.append(ppRow);
    });
    tree.append(iuRow);
  });
  return tree;
}

function highlightSyls(sIdx, lIdx, positions, on) {
  const row = lineRowEl(sIdx, lIdx);
  if (!row) return;
  for (const p of positions) {
    $$(`[data-g="${p}"]`, row).forEach(n => n.classList.toggle('hl', on));
  }
}

/* ── dependency arcs (SVG drawn after layout) ── */

function drawDepArcs(lab, line) {
  const stage = $('.dep-stage', lab);
  if (!stage) return;
  const slot = $('.dep-svg-slot', stage);
  const wordsRow = $('.dep-words', stage);
  const wordEls = $$('.dep-word', wordsRow);
  if (!wordEls.length) return;

  const stageRect = wordsRow.getBoundingClientRect();
  const centers = wordEls.map(we => {
    const r = we.getBoundingClientRect();
    return r.left - stageRect.left + r.width / 2;
  });

  const arcs = line.deps.filter(dp => dp.to >= 0 && dp.from !== dp.to && centers[dp.from] != null && centers[dp.to] != null);
  const root = line.deps.find(dp => dp.to === -1);

  // stack heights: shorter spans lower
  const spans = arcs.map(a => Math.abs(a.from - a.to));
  const H = 30 + Math.min(4, Math.max(...spans, 1)) * 16;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'dep-svg');
  svg.setAttribute('width', String(Math.max(wordsRow.scrollWidth, stageRect.width)));
  svg.setAttribute('height', String(H + 26));   // clear air between arrowheads and the words

  const ARC_COLORS = document.body.classList.contains('theme-terminal')
    ? ['#b39df1', '#46d17e', '#57a7ff', '#ff85c0', '#f0a848', '#3ecfe0']
    : ['#5d3f8e', '#1f6b47', '#2f5e9e', '#a04a78', '#a06818', '#0f7a8a'];
  arcs.forEach((a, i) => {
    const x1 = centers[a.from], x2 = centers[a.to];
    const span = Math.abs(a.from - a.to);
    const h = Math.min(H - 6, 18 + span * 15);
    const y = H + 8;
    const midX = (x1 + x2) / 2;
    const color = ARC_COLORS[i % ARC_COLORS.length];

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', `M ${x1} ${y} C ${x1} ${y - h}, ${x2} ${y - h}, ${x2} ${y}`);
    path.setAttribute('class', 'dep-arc');
    path.setAttribute('stroke', color);
    svg.append(path);

    // arrowhead at the DEPENDENT end (x1)
    const arrow = document.createElementNS(svgNS, 'path');
    arrow.setAttribute('d', `M ${x1 - 3.4} ${y - 6} L ${x1} ${y} L ${x1 + 3.4} ${y - 6}`);
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', color);
    arrow.setAttribute('stroke-width', '1.4');
    svg.append(arrow);

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', String(midX));
    label.setAttribute('y', String(y - h * 0.75 - 4));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'dep-arc-label');
    label.setAttribute('fill', color);
    label.textContent = a.rel;
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `“${line.words[a.from]?.text}” is ${DEP_GLOSS[a.rel] ?? a.rel} “${line.words[a.to]?.text}”`;
    label.append(title);
    svg.append(label);
  });

  if (root && centers[root.from] != null) {
    const x = centers[root.from];
    const mark = document.createElementNS(svgNS, 'text');
    mark.setAttribute('x', String(x));
    mark.setAttribute('y', '12');
    mark.setAttribute('text-anchor', 'middle');
    mark.setAttribute('class', 'dep-root-mark');
    mark.textContent = '▾ root';
    svg.append(mark);
    const stem = document.createElementNS(svgNS, 'line');
    stem.setAttribute('x1', String(x)); stem.setAttribute('x2', String(x));
    stem.setAttribute('y1', '16'); stem.setAttribute('y2', String(H + 8));
    stem.style.stroke = 'var(--viridian)'; stem.setAttribute('stroke-dasharray', '2 3');
    svg.append(stem);
  }

  slot.innerHTML = '';
  slot.append(svg);
}

/* ═══════════════════ Rail: synopsis · phonopoetics · inspector ═══════════════════ */

function renderSynopsis() {
  const { synopsis, enjambment, engine, elapsedMs } = state.data;
  const card = els.synopsis;
  card.innerHTML = '';
  card.append(el('h3', { class: 'rail-title' }, 'Poem Synopsis'));
  const rows = [...(synopsis ?? [])];
  if (enjambment) rows.push({ label: 'Enjambment', value: enjambment });
  if (!rows.length) {
    card.append(el('p', { class: 'whisper', text: 'A single line has no poem-wide story — paste a few more.' }));
  }
  for (const r of rows) {
    if (/scheme/i.test(r.label)) {   // rhyme-scheme strings: colored letters, wrapped, never overflowing
      card.append(el('div', { class: 'synopsis-row' },
        el('span', { class: 'lab-l', text: r.label }),
        el('span', { class: 'lab-v scheme-letters' },
          ...[...String(r.value)].map(ch => el('span', { text: ch, style: { color: /[A-Za-z]/.test(ch) ? letterColor(ch) : 'var(--sepia)' } }))),
      ));
      continue;
    }
    let html = tintMeterNames(r.value).replace(/~\d+%/g, m => `<span class="pct">${m}</span>`);
    card.append(el('div', { class: 'synopsis-row' },
      el('span', { class: 'lab-l', text: r.label }),
      el('span', { class: 'lab-v', html }),
    ));
  }
  card.append(el('p', { class: 'whisper', style: { marginTop: '.7rem' }, text: `read by ${engine === 'clio' ? 'Clio (the legacy parse)' : 'Calliope'} in ${elapsedMs} ms` }));
}

function rhymeRelNode(r) {
  const lc = `var(--tier-${r.topStress ?? 's'})`;
  return el('div', { class: 'rhyme-rel' },
    el('span', { class: 'rw', text: r.fromWord }), ' ',
    el('span', { class: 'rmeta' }, '[', el('span', { class: 'rletter', text: r.letter, style: { color: lc } }), `|${r.fromLabel}${r.kind !== 'end' ? '|' + r.kind : ''}]`),
    el('span', { class: 'rmeta', text: ' → ' }),
    el('span', { class: 'rw', text: r.toWord }), ' ',
    el('span', { class: 'rmeta' }, '[', el('span', { class: 'rletter', text: r.letter, style: { color: lc } }), `|${r.toLabel}]`),
    r.type ? el('span', { class: 'rtype', text: ' ' + r.type }) : null,
  );
}

function renderPhonopoetics() {
  const p = state.data.phonopoetics;
  const card = els.phono;
  card.innerHTML = '';
  card.append(el('h3', { class: 'rail-title violet' }, 'Phonopoetics'));

  const groups = [];
  if (p?.endScheme) groups.push(el('div', { class: 'phono-group' },
    el('div', { class: 'phono-label', text: 'End-rhyme scheme' }),
    el('div', { class: 'scheme-letters' },
      ...[...p.endScheme].map(ch => el('span', { text: ch, style: { color: /[A-Za-z]/.test(ch) ? letterColor(ch) : 'var(--sepia)' } }))),
  ));
  const rel = (label, items, title) => {
    if (!items?.length) return;
    groups.push(el('div', { class: 'phono-group' },
      el('div', { class: 'phono-label', text: label, title }),
      el('div', { class: 'phono-items' }, items.map(rhymeRelNode)),
    ));
  };
  rel('End rhymes', p?.end, 'rhymes binding line-ends');
  rel('Caesural rhymes', p?.caesural, 'internal rhymes landing just before a mid-line pause');
  rel('Head rhymes', p?.head, 'rhymes at line-openings');
  if (p?.alliteration?.length) {
    groups.push(el('div', { class: 'phono-group' },
      el('div', { class: 'phono-label', text: 'Alliteration' }),
      el('div', { class: 'phono-items' }, p.alliteration.map(a =>
        el('div', { class: 'rhyme-rel allit-run' },
          el('span', { class: 'rw', text: a.words.join(' ') }),
          el('span', { class: 'rmeta', text: ` (${a.label})` })))),
    ));
  }
  if (p?.acrostics?.length) {
    groups.push(el('div', { class: 'phono-group' },
      el('div', { class: 'phono-label', text: 'Acrostic' }),
      el('div', { class: 'phono-items' }, p.acrostics.map(a =>
        el('div', { class: 'rhyme-rel' },
          el('span', { class: 'rmeta', text: a.labels.map((l, i) => `[${l}:${a.firsts[i]}]`).join('') }),
          el('span', { class: 'rmeta', text: ' → ' }),
          el('span', { class: 'rw', text: a.word, style: { color: 'var(--amber)' } })))),
    ));
  }
  if (!groups.length) {
    card.append(el('p', { class: 'whisper', text: 'No rhyme-work, alliteration runs, or acrostics surfaced in this piece.' }));
  } else {
    groups.forEach(g => card.append(g));
  }
}

/* ═══════════════════ Word cards: tooltip & inspector ═══════════════════ */

function wordCardContent(line, w, hoveredG = null, forInspector = false) {
  const frag = document.createDocumentFragment();
  frag.append(el(forInspector ? 'h4' : 'div', { class: forInspector ? '' : 'tip-title', text: w.text }));

  const dep = depPhrase(w);
  frag.append(el('div', { class: forInspector ? 'badge-row' : 'tip-sub' },
    ...(forInspector ? [
      el('span', { class: `badge ${w.isContent ? 'content' : 'function'}`, text: w.isContent ? 'content word' : 'function word' }),
      el('span', { class: 'badge pos-badge', text: `${w.pos} · ${POS_GLOSS[w.pos] ?? 'tag'}` }),
      w.flags.person ? el('span', { class: 'badge flag', text: 'person name' }) : null,
      w.flags.place ? el('span', { class: 'badge flag', text: 'place name' }) : null,
      w.flags.given ? el('span', { class: 'badge flag', text: 'discourse-given', title: 'repeated from an earlier line — may be prosodically subordinated' }) : null,
      w.flags.coordGiven ? el('span', { class: 'badge flag', text: 'given in coordination' }) : null,
      (() => { const st = wordStatus(w); return el('span', { class: 'badge', text: st.label, title: st.hint, style: { color: st.color, borderColor: st.color } }); })(),
      ...rolesFor(w).map(r => el('span', { class: 'badge', text: r.label, title: r.hint, style: { color: r.color, borderColor: r.color } })),
    ] : [ `${POS_GLOSS[w.pos] ?? w.pos} · ${w.isContent ? 'content word' : 'function word'}` ]),
  ));

  const addRow = (k, vNode) => frag.append(el('div', { class: forInspector ? 'insp-section' : 'tip-row' },
    el('span', { class: forInspector ? 'insp-label' : 'tip-k', text: k }),
    forInspector ? vNode : el('span', { class: 'tip-v' }, vNode),
  ));

  if (dep) {
    addRow('grammar', forInspector
      ? el('div', { class: 'insp-text', html: `${esc(dep.text)} <span class="mono">(←${esc(dep.rel)})</span>` })
      : el('span', { html: `${esc(dep.text)} <span class="mono">←${esc(dep.rel)}</span>` }));
  }
  if (forInspector) {
    const deps = dependentsOf(line, w.i);
    if (deps.length) {
      addRow('governs', el('div', { class: 'insp-text', html: deps.map(d => `${esc(d.word)} <span class="mono">←${esc(d.rel)}</span>`).join(' · ') }));
    }
  }
  if (w.feats) {
    const chips = el('div', { class: 'feat-chips' },
      Object.entries(w.feats).map(([k, v]) => {
        const { k: kk, v: vv } = featPhrase(k, v);
        return el('span', { class: 'feat-chip', html: `${esc(kk)}: <b>${esc(vv)}</b>` });
      }));
    addRow('morphology', chips);
  }
  if (w.morph) {
    addRow('stem split', el('span', { class: forInspector ? 'insp-text' : '', text: [w.morph.prefix && `prefix “${w.morph.prefix}”`, w.morph.suffix && `suffix “${w.morph.suffix}”`].filter(Boolean).join(' · ') + ' (out-of-dictionary word, stressed by rule)' }));
  }
  const ps = w.phraseStress || 0;
  if (ps > 0) {
    addRow('phrase rank', el('span', { class: forInspector ? 'insp-text' : '', text: ps === 1 ? '1 — the strongest word of the utterance' : `${ps} (1 = strongest)` }));
  }

  // syllables
  if (forInspector) {
    const table = el('table', { class: 'syl-mini' },
      el('tr', {}, el('th', { text: 'syllable' }), el('th', { text: 'phones' }), el('th', { text: 'weight' }), el('th', { text: 'lexical' }), el('th', { text: 'relative' })),
      w.syls.map(s => el('tr', {},
        el('td', { class: 'stx', text: s.text || '·', style: { color: `var(--tier-${s.rel})` } }),
        el('td', { text: s.phones.replace(/[()]/g, '') }),
        el('td', { text: s.weight === 'H' ? 'H · heavy' : s.weight === 'L' ? 'L · light' : '—' }),
        el('td', { text: `${s.lex} · ${LEX_NAMES[Math.min(3, s.lex)]}` }),
        el('td', { text: `${s.rel} · ${TIERS[s.rel]?.name}`, style: { color: `var(--tier-${s.rel})` } }),
      )));
    addRow('syllables', table);
    if (w.syls.some(s => s.extrametrical)) {
      addRow('extrametrical', el('span', { class: 'insp-text', text: w.syls.filter(s => s.extrametrical).map(s => `“${s.text}” (${s.extrametrical})`).join(', ') + ' — kept outside the stress count' }));
    }
  } else {
    // role badges: grammatical status + poem-wide sound roles
    const roleRow = el('div', {});
    const status = wordStatus(w);
    roleRow.append(el('span', { class: 'tip-role', text: status.label, title: status.hint, style: { color: status.color, borderColor: status.color } }));
    for (const role of rolesFor(w)) {
      roleRow.append(el('span', { class: 'tip-role', text: role.label, title: role.hint, style: { color: role.color, borderColor: role.color } }));
    }
    frag.append(roleRow);

    const dependents = dependentsOf(line, w.i);
    if (dependents.length) {
      frag.append(el('div', { class: 'tip-row' },
        el('span', { class: 'tip-k', text: 'governs' }),
        el('span', { class: 'tip-v', html: dependents.map(d => `${esc(d.word)} <span class="mono">←${esc(d.rel)}</span>`).join(' · ') })));
    }

    const sylRow = el('div', { class: 'tip-syls' },
      w.syls.map(s => {
        const g = w.firstSyl + s.si;
        return el('span', { class: 'tip-syl', style: hoveredG === g ? { borderColor: `var(--tier-${s.rel})` } : {} },
          el('span', { class: 't', text: s.text || '·', style: { color: `var(--tier-${s.rel})` } }),
          el('span', { class: 'p', text: s.phones.replace(/[()]/g, '') }),
          el('span', { class: 'p', text: `${s.weight ?? ''} ${s.rel}·${TIERS[s.rel]?.name}` }),
        );
      }));
    frag.append(sylRow);

    // fine-grained anatomy of the hovered syllable
    const hovered = hoveredG != null ? w.syls.find(s => w.firstSyl + s.si === hoveredG) : null;
    if (hovered?.ph) {
      const p = hovered.ph;
      frag.append(el('div', { class: 'tip-sylcard' },
        el('div', { class: 'tsc-head', text: `this syllable · “${hovered.text}” (${hovered.pos})` }),
        el('div', { class: 'tsc-row', html: `onset <b>${esc(p.onset)}</b> ${p.onset === '0' ? '(null onset)' : `(${p.onset.length}-consonant ${p.onset.length > 1 ? 'cluster' : 'singleton'})`} · nucleus <b>${esc(p.nucleus)}</b>, ${esc(p.vlen)} vowel` }),
        el('div', { class: 'tsc-row', html: `rime <b>${esc(p.rime)}</b> · ${p.open ? 'open (no coda)' : `closed by ${p.codaC}-consonant coda`} · weight <b>${hovered.weight === 'H' ? 'H heavy' : hovered.weight === 'L' ? 'L light' : '—'}</b>` }),
      ));
    }

    // async Nounsing strip fills in below (hover handler)
    frag.append(el('div', { class: 'tip-nounsing-slot' }));
    frag.append(el('div', { class: 'tip-hint', text: 'click to pin the full anatomy in the Inspector →' }));
  }
  return frag;
}

/* ── Nounsing Pro dossier: deep morpho-phonological word data ── */

const dossierCache = new Map();
async function fetchDossier(word) {
  const key = word.toLowerCase();
  if (dossierCache.has(key)) return dossierCache.get(key);
  const r = await fetch('/api/word?w=' + encodeURIComponent(key));
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'dossier failed');
  dossierCache.set(key, j);
  return j;
}

const FOOT_GLYPHS = {
  iambic: '˘ ¯', trochaic: '¯ ˘', spondaic: '¯ ¯', pyrrhic: '˘ ˘',
  dactylic: '¯ ˘ ˘', anapestic: '˘ ˘ ¯', amphibrachic: '˘ ¯ ˘', bacchic: '˘ ¯ ¯',
  cretic: '¯ ˘ ¯', antibacchic: '¯ ¯ ˘', monosyllabic: '¯',
};
const SUFFIX_TYPE_GLOSS = {
  noshiftOneSyll: 'a one-syllable suffix that never moves the stress',
  noshiftTwoSyll: 'a two-syllable suffix that never moves the stress',
  shift: 'a stress-shifting suffix — it drags the accent toward itself',
  neutral: 'stress-neutral', noSuffix: 'no productive suffix',
};

function dossierRow(k, vNode, title) {
  return el('div', { class: 'dossier-row', title },
    el('span', { class: 'dr-k', text: k }),
    el('span', { class: 'dr-v' }, vNode));
}

function renderDossier(d) {
  const box = el('div', { class: 'dossier' });
  box.append(el('div', { class: 'dossier-title', text: 'Nounsing Pro record' }));

  if (!d.phonemics && !d.scansion && !d.lexicon) {
    box.append(el('p', { class: 'dossier-oov', text: 'This word is beyond the augmented CMU lexicon — its stresses were conjured by rule (the quantity-sensitive English Stress Rule), so no deep record exists for it.' }));
    return box;
  }

  // the word's own foot
  if (d.scansion?.label) {
    const glyph = FOOT_GLYPHS[d.scansion.label] ?? '';
    box.append(el('div', { class: 'dossier-foot' },
      el('span', { class: 'df-label', text: d.scansion.label,
        style: { color: METER_HUE[d.scansion.label] ?? METER_HUE[d.scansion.label + 'ic'] ?? 'var(--madder)' } }),
      glyph ? el('span', { class: 'df-pattern', text: glyph }) : null,
      el('span', { class: 'df-pattern', text: `contour ${d.scansion.contour} · weights ${d.scansion.weightPattern}`,
        title: 'the word’s own metrical shape: stress contour (1 primary · 2 secondary · 0 none) and heavy/light syllable pattern' }),
    ));
  }

  const g = el('div', { class: 'dossier-grid' });
  if (d.lexicon) {
    g.append(dossierRow('lexicon', `${d.lexicon.nsylls} syllable${d.lexicon.nsylls === 1 ? '' : 's'} · ${zipfGloss(d.lexicon.freq) ?? 'frequency unknown'}`,
      'from the augmented CMU lexicon: syllable count and Zipf-scale word frequency (1 = vanishingly rare, 7 = “the”)'));
  }
  if (d.phonemics) {
    g.append(dossierRow('syllabified', d.phonemics.syllabification,
      'the dictionary’s phonemic syllabification (maximal-onset)'));
    g.append(dossierRow('structure', `${d.phonemics.syllStruct} · ${d.phonemics.vowelLength === 'shortV' ? 'short vowels' : d.phonemics.vowelLength === 'longV' ? 'long vowels' : d.phonemics.vowelLength}`,
      'C = consonant, L = light/short nucleus; per-syllable shape'));
  }
  if (d.onsetParse) {
    g.append(dossierRow('CV skeleton', `${d.onsetParse.cvStructure}${d.onsetParse.isPenultClosed ? ' · penult closed' : ''}`,
      'the consonant-vowel skeleton after the Maximal Onset Principle'));
  }
  if (d.weights?.pattern) {
    g.append(dossierRow('weights', d.weights.pattern.join(' '),
      'H = heavy syllable (attracts stress), L = light'));
  }
  if (d.edges) {
    const bits = [];
    if (d.edges.finalComplexOnset && d.edges.finalComplexOnset !== 'simple') bits.push(`complex final onset (${d.edges.finalComplexOnset})`);
    bits.push(`coda “${(d.edges.coda ?? '').trim() || '∅'}” (${d.edges.codaLength} consonant${d.edges.codaLength === 1 ? '' : 's'})`);
    g.append(dossierRow('edges', bits.join(' · '), 'onset & coda geometry of the word’s final syllable'));
  }
  if (d.codaComplexity?.isComplex) {
    g.append(dossierRow('rare coda', `${d.codaComplexity.complexity} — ${d.codaComplexity.phonemes}`,
      'a rare complex coda cluster'));
  }
  if (d.vowelQualities) {
    const vq = d.vowelQualities;
    g.append(dossierRow('vowels', `${vq.diphthongs} diphthong${vq.diphthongs === 1 ? '' : 's'} · ${vq.monophthongs} monophthong${vq.monophthongs === 1 ? '' : 's'}${vq.allMonophthong ? ' — pure monophthong word' : ''}`,
      'gliding (diphthong) vs steady (monophthong) vowel qualities'));
  }
  if (d.morphology) {
    const m = d.morphology;
    const bits = [`${m.morphology}`];
    if (m.prefix && m.prefix !== 'noPrefix') bits.push(`prefix ${m.prefix}`);
    if (m.suffix && m.suffix !== 'noSuffix') bits.push(SUFFIX_TYPE_GLOSS[m.suffixType] ?? `suffix (${m.suffixType})`);
    g.append(dossierRow('morphology', bits.join(' · '), 'morpho-phonological build of the word'));
  }
  if (d.suffixShift) {
    g.append(dossierRow('suffix shift', d.suffixShift.shiftLikely
      ? 'a further suffix would likely DRAG the stress rightward'
      : 'stress stays put under suffixation',
      'would adding a suffix force a stress shift?'));
  }
  if (d.extrametricals?.status && d.extrametricals.status !== 'none') {
    g.append(dossierRow('extrametrical', `${d.extrametricals.status}${d.extrametricals.isIrregular ? ' (irregular)' : ''}`,
      'edge material (like plural -s) standing outside the weight count'));
  }
  if (d.rhymeProfile) {
    g.append(dossierRow('rime', el('span', {},
      el('span', { text: d.rhymeProfile.rhymingPhones + ' ' }),
      el('span', { text: `(${d.rhymeProfile.weight === 'H' ? 'heavy' : 'light'} rime${d.rhymeProfile.hasExtrametricalS ? ', extrametrical -s' : ''})` })),
      'the exact phoneme string a perfect rhyme must echo'));
  }
  box.append(g);

  if (d.insets && Object.keys(d.insets).length) {
    const insetBox = el('div', { class: 'insp-section' },
      el('div', { class: 'insp-label', text: 'feet hiding inside the word' }));
    const list = el('div', { class: 'inset-feet' });
    for (const [foot, groups] of Object.entries(d.insets)) {
      for (const run of groups) {
        list.append(el('div', { class: 'inset-row' },
          el('span', { class: 'if-name', text: foot, style: { color: METER_HUE[foot + 'ic'] ?? METER_HUE[foot] ?? 'var(--heliotrope)' } }),
          el('span', { class: 'if-syls', text: run.map(x => x.syll).join(' ') })));
      }
    }
    insetBox.append(list);
    box.append(insetBox);
  }

  if (d.rhymes?.length) {
    const rBox = el('div', { class: 'insp-section' },
      el('div', { class: 'insp-label', text: 'strict rhymes, from the lexicon' }),
      el('div', { class: 'rhyme-cloud' }, d.rhymes.map(r => el('span', { class: 'rc', text: r }))));
    box.append(rBox);
  }
  return box;
}

function renderInspector() {
  const body = els.inspectorBody;
  body.innerHTML = '';
  $$('.word.pinned', els.codex).forEach(n => n.classList.remove('pinned'));
  if (!state.pinned) { els.inspectorHint.hidden = false; return; }
  const { s, l, w } = state.pinned;
  const line = state.data.stanzas[s]?.lines[l];
  const word = line?.words?.[w];
  if (!word) { state.pinned = null; els.inspectorHint.hidden = false; return; }
  els.inspectorHint.hidden = true;
  const box = el('div', { class: 'inspector-word' });
  box.append(wordCardContent(line, word, null, true));

  const dossierSlot = el('div', {});
  box.append(dossierSlot);
  const wanted = word.norm;
  fetchDossier(wanted).then(d => {
    if (state.pinned && state.pinned.s === s && state.pinned.l === l && state.pinned.w === w) {
      dossierSlot.append(renderDossier(d));
    }
  }).catch(() => {
    dossierSlot.append(el('p', { class: 'dossier-oov', text: 'The Nounsing record could not be fetched.' }));
  });

  box.append(el('button', { class: 'ghost-btn unpin-btn', text: 'unpin', onclick: () => { state.pinned = null; renderInspector(); } }));
  body.append(box);
  const wordEl = $(`.word[data-s="${s}"][data-l="${l}"][data-w="${w}"]`, els.codex);
  if (wordEl) wordEl.classList.add('pinned');
}

/* ── tooltip behaviour ── */

let tipTarget = null;
els.codex ?. addEventListener('mouseover', (e) => {
  const wordEl = e.target.closest('.word');
  if (!wordEl || !els.codex.contains(wordEl)) return;
  if (tipTarget === wordEl) return;
  tipTarget = wordEl;
  const s = +wordEl.dataset.s, l = +wordEl.dataset.l, w = +wordEl.dataset.w;
  const line = state.data?.stanzas[s]?.lines[l];
  const word = line?.words?.[w];
  if (!word) return;
  const g = e.target.classList?.contains('chunk') ? +e.target.dataset.g : null;
  els.tooltip.innerHTML = '';
  els.tooltip.append(wordCardContent(line, word, g, false));
  els.tooltip.hidden = false;
  positionTip(e);

  // async: the compact Nounsing Pro strip (cached after first hover)
  const strip = els.tooltip.querySelector('.tip-nounsing-slot');
  if (strip) {
    fetchDossier(word.norm).then(d => {
      if (tipTarget !== wordEl || !strip.isConnected) return;
      const lines = [];
      if (d.scansion?.label) lines.push(`as a foot: <b>${esc(d.scansion.label)}</b> <span class="mono">${esc(FOOT_GLYPHS[d.scansion.label] ?? '')}</span>`);
      if (d.phonemics) lines.push(`syllabified <span class="mono">${esc(d.phonemics.syllabification)}</span>`);
      if (d.weights?.pattern) lines.push(`weights <b>${esc(d.weights.pattern.join(' '))}</b>${d.vowelQualities ? ` · ${d.vowelQualities.diphthongs} diphthong${d.vowelQualities.diphthongs === 1 ? '' : 's'}` : ''}`);
      const z = d.lexicon ? zipfGloss(d.lexicon.freq) : null;
      if (z) lines.push(`frequency: <b>${esc(z)}</b>`);
      if (d.morphology) lines.push(`morphology: <b>${esc(d.morphology.morphology)}</b>${d.suffixShift ? ` · suffix stress-shift ${d.suffixShift.shiftLikely ? '<b>likely</b>' : 'unlikely'}` : ''}`);
      if (d.rhymeProfile) lines.push(`rime to echo: <span class="mono">${esc(d.rhymeProfile.rhymingPhones)}</span> (${d.rhymeProfile.weight === 'H' ? 'heavy' : 'light'})`);
      if (d.rhymes?.length) lines.push(`lexicon rhymes: <i>${esc(d.rhymes.slice(0, 6).join(', '))}${d.rhymes.length > 6 ? '…' : ''}</i>`);
      if (!lines.length) return;
      const box = el('div', { class: 'tip-nounsing' }, lines.map(h => el('div', { class: 'tn-line', html: h })));
      strip.append(box);
      positionTip(e);
    }).catch(() => { /* hover strip is best-effort */ });
  }
});
els.codex ?. addEventListener('mousemove', (e) => { if (!els.tooltip.hidden) positionTip(e); });
els.codex ?. addEventListener('mouseout', (e) => {
  if (tipTarget && !tipTarget.contains(e.relatedTarget)) { tipTarget = null; els.tooltip.hidden = true; }
});
els.codex ?. addEventListener('click', (e) => {
  const wordEl = e.target.closest('.word');
  if (!wordEl) return;
  const s = +wordEl.dataset.s, l = +wordEl.dataset.l, w = +wordEl.dataset.w;
  if (state.pinned && state.pinned.s === s && state.pinned.l === l && state.pinned.w === w) state.pinned = null;
  else state.pinned = { s, l, w };
  renderInspector();
});

function positionTip(e) {
  const tip = els.tooltip;
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
  tip.style.left = Math.max(6, x) + 'px';
  tip.style.top = Math.max(6, y) + 'px';
}

/* ═══════════════════ Legend ═══════════════════ */

function buildLegend() {
  const b = els.legendBody;
  b.innerHTML = '';

  b.append(el('h3', { text: 'How to read this page' }));
  b.append(el('p', { html: 'Calliope works out how the poem would be <em>said aloud</em> — dictionary stress, the way speech strands and braids the words, where the voice peaks — and only then listens for the regular beat that saying settles into. Every syllable in the poem is tinted by the stress it carries. Hover over any word for detailed info. Click a word to latch its profile to the side board. Click a line’s meter tag for its detailed scan.' }));

  b.append(el('h3', { text: 'The five stress tiers' }));
  const tierGrid = el('div', { class: 'legend-grid' });
  for (const [k, t] of Object.entries(TIERS)) {
    tierGrid.append(el('div', { class: 'legend-item' },
      el('span', { class: 'tier-dot', style: { background: t.color } }),
      el('span', { class: 'li-key', text: k, style: { color: t.color } }),
      el('span', {}, el('span', { class: 'li-name', text: t.name + ' — ' }), el('span', { class: 'li-eg', text: t.hint }))));
  }
  b.append(tierGrid);

  b.append(el('h3', { text: 'Marks & brackets' }));
  const marks = [
    ['|', 'foot boundary — the meter’s repeating unit'],
    ['‖', 'strong caesura — a real spoken pause (clause end, heavy punctuation)'],
    ['¦', 'lighter phrase break, inferred for punctuation-free lines'],
    ['·', 'silent beat — a rest keeping two clashing stresses apart'],
    ['[ ]', 'κ · clitic group — one content word plus its little function-word satellites'],
    ['{ }', 'ϕ · phonological phrase — clitic groups joined by syntax (tinted cold→warm by boundary strength)'],
    ['< >', 'ι · intonational unit — a whole spoken contour, bounded by major punctuation'],
  ];
  const markGrid = el('div', { class: 'legend-grid' });
  marks.forEach(([k, name]) => markGrid.append(el('div', { class: 'legend-item' },
    el('span', { class: 'li-key', text: k, style: { color: 'var(--violet-hi)' } }),
    el('span', { class: 'li-name', text: name }))));
  b.append(markGrid);

  b.append(el('h3', { text: 'The seven meters' }));
  b.append(el('p', { text: '¯ marks a beat, ˘ an offbeat. A meter’s name plus its foot count names the line: five iambs make iambic pentameter.' }));
  const meterGrid = el('div', { class: 'legend-grid' });
  for (const [name, def] of Object.entries(METER_DEF)) {
    meterGrid.append(el('div', { class: 'legend-item' },
      el('span', { class: 'tier-dot', style: { background: METER_HUE[name] } }),
      el('span', { class: 'li-key', text: def.feet, style: { color: METER_HUE[name] } }),
      el('span', {}, el('span', { class: 'li-name', text: name + ' — ' + def.hint + ' ' }), el('span', { class: 'li-eg', text: `(${def.eg})` }))));
  }
  b.append(meterGrid);

  b.append(el('h3', { text: 'Beyond classical meters' }));
  b.append(el('p', { html: 'When a stanza keeps a steady <em>count of strong beats</em> while its syllable count wanders, it is read as <b>accentual verse</b> (♪): a <b>dolnik</b> lets 1–2 weak syllables fall between beats, a <b>taktovik</b> 1–3, and free accentual verse constrains only the beat count. This is the native rhythm of ballads, folk verse, and much modern poetry.' }));

  b.append(el('h3', { text: 'Rhyme types' }));
  const rhymeGrid = el('div', { class: 'legend-grid' });
  for (const [name, hint] of Object.entries(RHYME_TYPES)) {
    rhymeGrid.append(el('div', { class: 'legend-item' },
      el('span', { class: 'li-key', text: name, style: { color: 'var(--green)' } }),
      el('span', { class: 'li-eg', text: hint })));
  }
  b.append(rhymeGrid);

  b.append(el('h3', { text: 'Part-of-speech tags' }));
  const posGrid = el('div', { class: 'legend-grid' });
  for (const [tag, name] of Object.entries(POS_GLOSS)) {
    posGrid.append(el('div', { class: 'legend-item' },
      el('span', { class: 'li-key', text: tag, style: { color: 'var(--met-iambic)' } }),
      el('span', {}, el('span', { class: 'li-name', text: name + ' ' }), el('span', { class: 'li-eg', text: POS_EG[tag] ? `· ${POS_EG[tag]}` : '' }))));
  }
  b.append(posGrid);

  b.append(el('h3', { text: 'Grammatical dependencies' }));
  b.append(el('p', { text: 'Each word hangs from a governor: “←amod← Mariner” reads “an adjective modifying Mariner”. The root is the word everything else ultimately hangs from.' }));
  const depGrid = el('div', { class: 'legend-grid' });
  for (const [rel, name] of Object.entries(DEP_GLOSS)) {
    depGrid.append(el('div', { class: 'legend-item' },
      el('span', { class: 'li-key', text: rel, style: { color: 'var(--violet-hi)' } }),
      el('span', { class: 'li-name', text: name })));
  }
  b.append(depGrid);
}

/* ═══════════════════ Controls ═══════════════════ */

els.analyze.addEventListener('click', analyze);
els.input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') analyze();
});
els.reopen.addEventListener('click', () => {
  els.scriptorium.hidden = false;
  els.scriptorium.scrollIntoView({ behavior: 'smooth', block: 'center' });
  els.input.focus();
});

SAMPLES.forEach((s, i) => els.sampleSelect.append(el('option', { value: String(i), text: s.name })));
els.sampleSelect.addEventListener('change', () => {
  const i = els.sampleSelect.value;
  if (i === '') return;
  els.input.value = SAMPLES[+i].text;
});

els.tintSelect.addEventListener('change', () => {
  state.tint = els.tintSelect.value;
  if (state.data) els.codex.className = 'codex panel ' + tintClass();
});
els.feetToggle.addEventListener('change', () => {
  state.showFeet = els.feetToggle.checked;
  if (state.data) { renderCodex(); renderInspector(); }
});

/* ── settings popover (engine choice lives here — Clio is the understudy) ── */
const settingsBtn = $('#btn-settings');
const settingsPop = $('#settings-pop');
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPop.hidden = !settingsPop.hidden;
  settingsBtn.setAttribute('aria-expanded', String(!settingsPop.hidden));
});
document.addEventListener('click', (e) => {
  if (!settingsPop.hidden && !settingsPop.contains(e.target) && e.target !== settingsBtn) settingsPop.hidden = true;
});
$$('input[name="display"]', settingsPop).forEach(radio => {
  radio.checked = radio.value === state.theme;
  radio.addEventListener('change', () => {
    if (!radio.checked || radio.value === state.theme) return;
    state.theme = radio.value;
    localStorage.setItem('calliope-theme', state.theme);
    applyTheme();
    if (state.data) renderAll();
  });
});
$$('input[name="engine"]', settingsPop).forEach(radio => radio.addEventListener('change', () => {
  if (!radio.checked || radio.value === state.engine) return;
  state.engine = radio.value;
  $('#engine-note-pop').textContent = radio.value === 'clio'
    ? 'Clio will read the next scan — expect a rawer, occasionally contrarian parse.'
    : 'Calliope will read the next scan.';
  if (state.data && els.input.value.trim()) analyze();
}));

/* ── the cycling sigil: thirteen figures, each with its own motion ── */
const SIGILS = [
  { f: 'Logo_Var_2_Tunnel_SVG.svg',            a: 'sg-vortex' },
  { f: 'Logo_Var_3_Triskelion_SVG.svg',        a: 'sg-spin-slow' },
  { f: 'Logo_Var_6_Triskelion2_SVG.svg',       a: 'sg-spin-rev' },
  { f: 'Logo_Var_10_Celtic_Knot_SVG.svg',      a: 'sg-breathe' },
  { f: 'Logo_Var_13_Crescents_SVG.svg',        a: 'sg-spin-slow' },
  { f: 'Logo_Var_11_Graph_SVG.svg',            a: 'sg-sway', disc: true },
  { f: 'Logo_Var_8_Radial_Labyrinth_SVG.svg',  a: 'sg-spin' },
  { f: 'Logo_Var_9_Radial_Labyrinth_2_SVG.svg', a: 'sg-spin-rev' },
  { f: 'Logo_Var_5_Penrose_Pentagram_SVG.svg', a: 'sg-breathe' },
  { f: 'Logo_Var_7_SixfoldSpirals_SVG.svg',    a: 'sg-spin' },
  { f: 'Logo_Var_1_Spiral_SVG.svg',            a: 'sg-spin-rev', disc: true },
  { f: 'Logo_Var_12_Limacon_Knot_SVG.svg',     a: 'sg-sway', disc: true },
  { f: 'Logo_Var_4_Quinquetra_PNG.png',        a: 'sg-breathe' },
];
const BRAND_STYLES = ['', 'bw-popelka', 'bw-myra', 'bw-wicky', 'bw-midcase', 'bw-vremena'];
let sigilIdx = Math.floor(Math.random() * SIGILS.length);
let brandIdx = Math.floor(Math.random() * BRAND_STYLES.length);
function nextSigil() {
  const s = SIGILS[sigilIdx];
  const box = $('#brand-sigil'), img = $('#sigil-img'), word = $('#brand-word');
  img.style.opacity = '0';
  setTimeout(() => {
    img.src = 'assets/logos/' + s.f;
    box.className = 'brand-sigil ' + s.a + (s.disc ? ' disc' : '');
    img.style.opacity = '1';
    word.className = BRAND_STYLES[brandIdx];
  }, 460);
  sigilIdx = (sigilIdx + 1) % SIGILS.length;
  brandIdx = (brandIdx + 1) % BRAND_STYLES.length;
}
nextSigil();
setInterval(nextSigil, 16000);

/* butterflies stir when an instrument is played */
['#btn-analyze', '#forge-go', '#meter-go', '#rw-go', '#syn-go'].forEach(sel => {
  const b = $(sel);
  if (!b) return;
  b.addEventListener('click', () => {
    $$('.mode:not([hidden]) .bfly').forEach(n => {
      n.classList.remove('flap');
      void n.offsetWidth;
      n.classList.add('flap');
      n.addEventListener('animationend', () => n.classList.remove('flap'), { once: true });
    });
  });
});

/* ── the CLI-style stress map, copyable whole ── */
function buildStressMap() {
  const out = [];
  state.data.stanzas.forEach((st, si) => {
    out.push(`Stanza ${si + 1}${st.formNote ? '  ¶ ' + st.formNote : ''}`);
    st.lines.forEach((ln, li) => {
      const tag = `S${si + 1}L${li + 1}`;
      if (!ln.parsed) { out.push(`  ${tag}  (no parse)  ${ln.raw}`); return; }
      const d = ln.detail;
      const top = (d.ranking ?? []).slice(0, 3).map(r => `${r.meter.slice(0, 5)} ${r.score.toFixed(2)}`).join(' · ');
      const rhyme = d.rhyme?.letter && d.rhyme.letter !== '·'
        ? `  ${d.rhyme.letter}${d.rhyme.type ? '(' + d.rhyme.type + ')' : ''}` : '';
      const notes = [d.rhythmNote ? '♪' : '', d.standaloneMeter ? `≈ standalone: ${d.standaloneMeter}` : ''].filter(Boolean).join(' ');
      out.push(`  ${tag}  ${d.scansion}  ${d.meter}${top ? ' | ' + top : ''}${rhyme}${notes ? '  ' + notes : ''}`);
    });
    out.push('');
  });
  return out.join('\n').trimEnd() + '\n';
}
$('#btn-copymap').addEventListener('click', async () => {
  if (!state.data) { toast('Scan a poem first.'); return; }
  try {
    await navigator.clipboard.writeText(buildStressMap());
    toast('Stress map copied — every line’s keys.');
  } catch {
    toast('The clipboard refused — select and copy from the codex instead.');
  }
});

/* ── mode tabs ── */
$$('.mode-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.mode-tab').forEach(t => {
    const on = t === tab;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
  ['scansion', 'forge', 'rewrites', 'syntax'].forEach(m => {
    $(`#mode-${m}`).hidden = m !== tab.dataset.mode;
  });
  els.tooltip.hidden = true;
}));

/* ── the Rhyme Forge ── */
async function runForge() {
  const word = $('#forge-word').value.trim();
  const out = $('#forge-out');
  if (!word) { toast('Give the forge a word first.'); return; }
  out.innerHTML = '';
  out.append(el('p', { class: 'tool-note', text: 'forging…' }));
  try {
    const syll = $('#forge-syll').value;
    const url = '/api/word?w=' + encodeURIComponent(word) + (syll ? '&syll=' + syll : '');
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'no answer');
    out.innerHTML = '';
    // the word's dossier, reusing the Inspector's renderer
    out.append(renderDossier(d));
    const pool = syll ? d.rhymesBySyll : d.rhymes;
    const label = syll ? `strict rhymes of exactly ${syll} syllable${syll === '1' ? '' : 's'}` : 'strict rhymes';
    out.append(el('div', { class: 'insp-section' },
      el('div', { class: 'insp-label', text: label }),
      pool?.length
        ? el('div', { class: 'word-cloud' }, pool.map(x => rcChip(x, () => { $('#forge-word').value = x; runForge(); })))
        : el('p', { class: 'tool-note', text: 'none in the lexicon — try loosening the syllable filter.' })));
  } catch (err) {
    out.innerHTML = '';
    out.append(el('p', { class: 'tool-note', text: 'The forge went cold: ' + err.message }));
  }
}
function rcChip(text, onclick) {
  return el('span', { class: 'rc', text, title: 'click to forge this word', onclick });
}
$('#forge-go').addEventListener('click', runForge);
$('#forge-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') runForge(); });

async function runMeterMatch() {
  const pattern = $('#meter-pattern').value.replace(/[^012]/g, '');
  const out = $('#meter-out');
  if (!pattern) { toast('A pattern needs digits: 0, 1, 2.'); return; }
  out.innerHTML = '';
  out.append(el('p', { class: 'tool-note', text: 'summoning…' }));
  try {
    const r = await fetch('/api/meter?pattern=' + pattern);
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'no answer');
    out.innerHTML = '';
    out.append(el('p', { class: 'tool-note', text: `${d.total} words in the lexicon carry the contour ${d.pattern} — a fresh handful each casting:` }));
    out.append(el('div', { class: 'word-cloud' }, d.words.map(x => rcChip(x, () => { $('#forge-word').value = x; runForge(); window.scrollTo({ top: 0, behavior: 'smooth' }); }))));
  } catch (err) {
    out.innerHTML = '';
    out.append(el('p', { class: 'tool-note', text: 'The summoning failed: ' + err.message }));
  }
}
$('#meter-go').addEventListener('click', runMeterMatch);
$('#meter-pattern').addEventListener('keydown', (e) => { if (e.key === 'Enter') runMeterMatch(); });

/* ── the Transmutation Chamber ── */
$('#rw-pos').addEventListener('input', () => { $('#rw-pos-val').textContent = $('#rw-pos').value; });
$('#rw-freq').addEventListener('input', () => { $('#rw-freq-val').textContent = Number($('#rw-freq').value).toFixed(2); });
async function runRewrite() {
  const text = $('#rw-input').value.trim();
  const out = $('#rw-out');
  if (!text) { toast('The chamber is empty — give it some verse.'); return; }
  const btn = $('#rw-go');
  btn.disabled = true;
  try {
    const r = await fetch('/api/rewrite', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text, mode: $('#rw-mode').value,
        posPrecision: +$('#rw-pos').value,
        freqThreshold: +$('#rw-freq').value,
      }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'no answer');
    const result = el('div', { class: 'rw-result', text: d.output });
    out.prepend(result);
    while (out.children.length > 4) out.lastChild.remove();   // keep the last few castings
  } catch (err) {
    toast('The transmutation fizzled: ' + err.message);
  } finally { btn.disabled = false; }
}
$('#rw-go').addEventListener('click', runRewrite);

/* ── the Parse Observatory ── */
async function runSyntax() {
  let text = $('#syn-input').value.trim();
  const out = $('#syn-out');
  if (!text) { toast('Give the observatory a sentence or a stanza.'); return; }
  if ($('#syn-fuse').checked) text = text.replace(/\s*\n+\s*/g, ' ');
  out.innerHTML = '';
  out.append(el('p', { class: 'tool-note', text: 'parsing…' }));
  try {
    const r = await fetch('/api/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, engine: state.engine }),
    });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'no answer');
    out.innerHTML = '';
    d.stanzas.forEach(st => st.lines.forEach(line => {
      if (!line.parsed) return;
      const block = el('div', { class: 'syn-line' });
      block.append(el('div', { class: 'syn-raw', text: line.raw }));
      // arcs, reusing the laboratory's renderer
      const stage = el('div', { class: 'dep-stage' }, el('div', { class: 'dep-svg-slot' }),
        el('div', { class: 'dep-words' }, line.words.map(w =>
          el('div', { class: `dep-word ${w.isContent ? 'is-content' : 'is-function'}` },
            el('span', { class: 'dw-text', text: w.text }),
            el('span', { class: 'dw-pos', text: w.pos, title: POS_GLOSS[w.pos] ?? w.pos })))));
      block.append(stage);
      // the register: word · POS · features · bond
      const table = el('table', { class: 'syn-table' },
        el('tr', {},
          el('th', { text: 'word' }),
          el('th', { text: 'part of speech', title: 'Penn Treebank tag, converted from UDPipe’s UPOS' }),
          el('th', { text: 'features', title: 'UD morphological FEATS from UDPipe' }),
          el('th', { text: 'grammatical bond', title: 'the dependency relation to its governor' })),
        line.words.map(w => el('tr', {},
          el('td', { class: 'w', text: w.text }),
          el('td', {}, el('abbr', { text: w.pos, title: POS_GLOSS[w.pos] ?? w.pos })),
          el('td', {}, w.feats
            ? Object.entries(w.feats).map(([k, v]) => {
                const { k: kk, v: vv } = featPhrase(k, v);
                return el('span', { class: 'feat-chip', title: `${k}=${v}`, html: `${esc(kk)}: <b>${esc(vv)}</b>` });
              })
            : el('span', { text: '—' })),
          el('td', {}, w.dep
            ? el('abbr', { text: w.dep.isRoot ? 'root' : `←${w.dep.rel}← ${w.dep.govWord}`, title: w.dep.isRoot ? DEP_GLOSS.root : `${DEP_GLOSS[w.dep.rel] ?? w.dep.rel} “${w.dep.govWord}”` })
            : el('span', { text: '—' })))));
      block.append(table);
      out.append(block);
      drawDepArcs(block, line);
    }));
  } catch (err) {
    out.innerHTML = '';
    out.append(el('p', { class: 'tool-note', text: 'The parse clouded over: ' + err.message }));
  }
}
$('#syn-go').addEventListener('click', runSyntax);

/* ── served-from-disk guard: fetch can never reach the engine on file:// ── */
if (location.protocol === 'file:') {
  $('#file-warning').hidden = false;
  $('#btn-analyze').disabled = true;
}

$('#btn-legend').addEventListener('click', () => { els.legend.hidden = false; });
$('#btn-legend-close').addEventListener('click', () => { els.legend.hidden = true; });
els.legend.addEventListener('click', (e) => { if (e.target === els.legend) els.legend.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') els.legend.hidden = true; });

buildLegend();
