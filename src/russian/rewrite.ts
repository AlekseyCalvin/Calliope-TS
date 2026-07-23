// rewrite.ts — the Russian Transmutation Chamber.
// Mirrors the English (Nounsing Pro) rewrite engines with Russian resources:
//   stress — replace each word with a lexicon-mate sharing its exact
//            syllable count AND stress position (meter survives verbatim);
//   rhyme  — each word becomes a rhyme of itself (same post-stress tail
//            length + matching phonetic clausula, via rhyme.ts);
//   phones — words sharing the opening two letters (phoneme echo).
//
// Candidate pool: the intersection of the 3.4M-entry stress dictionary with
// the poetry-domain frequency table built from the scanned RussianScan
// corpora (tools/build_ru_word_freq.py) — so every candidate has a known
// stress AND a Zipf-style score standing in for the English side's Zipf
// frequencies ("frequency floor" slider).  Being poetry-derived, the table
// also biases casts toward words that actually live in verse.
//
// POS fidelity uses UPOS (the Russian SynTagRus UDPipe model has no XPOS):
//   0 — none; 1 — same UPOS; 2 — + Number/Gender/VerbForm/Aspect; 3 — + Case/
//   Person/Tense/Mood/Animacy/Degree.  Input words are tagged in line context;
//   candidates are tagged in isolation (cached), which is noisy but serviceable.
//
// Tagger-free grounders (fidelity ≥ 2), composed as a candidate score:
//   inflectional-ending agreement (sharedSuffixLen — Russian's XPOS proxy),
//   derivational-suffix class (-ость/-ени-/-тель/-ическ- … register/abstractness),
//   same-root avoidance (word_segmentation.json prefix-stripped stems).
// Prosodic collocations (по́ лесу — collocations.json) are never replaced.

import { parseRussianText, isRuPunctuation } from './parser.js';
import { countVowels } from './syllabifier.js';
import { getAccents, getAccentsData, loadJson } from './accentuator.js';
import { extractClausula, arePhoneticallyEqual } from './rhyme.js';
import { ensureRussianData } from './download.js';
import type { RuToken } from './types.js';

// ── Lexicon indexes (lazy) ───────────────────────────────────────────

interface CandidateEntry {
  word: string;
  nVowels: number;
  stressPos: number;
  zipf: number;
}

let _freq: Map<string, number> | null = null;
let _entries: CandidateEntry[] | null = null;
let _byStress: Map<string, CandidateEntry[]> | null = null;
let _byOnset: Map<string, CandidateEntry[]> | null = null;
let _byRhyme: Map<string, CandidateEntry[]> | null = null;
let _byFuzzyRhyme: Map<string, CandidateEntry[]> | null = null;
let _segmentation: Record<string, string> | null = null;
let _collocations: Set<string> | null = null;

function freqTable(): Map<string, number> {
  if (_freq) return _freq;
  const raw = loadJson<Record<string, number>>('word_freq.json');
  _freq = new Map(Object.entries(raw));
  return _freq;
}

function entries(): CandidateEntry[] {
  if (_entries) return _entries;
  const data = getAccentsData();
  const out: CandidateEntry[] = [];
  for (const [word, zipf] of freqTable()) {
    if (word.length < 2 || word.includes('-')) continue;
    const nVowels = countVowels(word);
    if (nVowels < 1) continue;
    let stressPos: number;
    if (nVowels === 1) {
      stressPos = 1;
    } else {
      const sp = data.wordAccents.get(word);
      if (sp === undefined || sp <= 0) continue;   // stress unknown → unusable
      stressPos = sp;
    }
    out.push({ word, nVowels, stressPos, zipf });
  }
  _entries = out;
  return out;
}

function byStress(): Map<string, CandidateEntry[]> {
  if (_byStress) return _byStress;
  _byStress = new Map();
  for (const e of entries()) {
    const key = `${e.nVowels}:${e.stressPos}`;
    let arr = _byStress.get(key);
    if (!arr) { arr = []; _byStress.set(key, arr); }
    arr.push(e);
  }
  return _byStress;
}

function byOnset(): Map<string, CandidateEntry[]> {
  if (_byOnset) return _byOnset;
  _byOnset = new Map();
  for (const e of entries()) {
    const key = e.word.slice(0, 2);
    let arr = _byOnset.get(key);
    if (!arr) { arr = []; _byOnset.set(key, arr); }
    arr.push(e);
  }
  return _byOnset;
}

function rhymeKey(word: string, nVowels: number, stressPos: number): string {
  return `${nVowels - stressPos}:${extractClausula(word, stressPos)}`;
}

function byRhyme(): Map<string, CandidateEntry[]> {
  if (_byRhyme) return _byRhyme;
  _byRhyme = new Map();
  for (const e of entries()) {
    const key = rhymeKey(e.word, e.nVowels, e.stressPos);
    let arr = _byRhyme.get(key);
    if (!arr) { arr = []; _byRhyme.set(key, arr); }
    arr.push(e);
  }
  return _byRhyme;
}

/** Fuzzy-rhyme key: tail length + the stressed vowel's phonetic value only.
 *  The Russian fuzzy-rhyme convention (неточная рифма) requires the stressed
 *  vowel to agree while post-stress consonants may vary — post-stress vowels
 *  reduce anyway.  The pool is a superset of the exact-rhyme pool; scoring
 *  still prefers exact and phonetically-near clausulas within it. */
function fuzzyRhymeKey(word: string, nVowels: number, stressPos: number): string {
  const claus = extractClausula(word, stressPos);
  return `${nVowels - stressPos}:${claus[0] ?? ''}`;
}

function byFuzzyRhyme(): Map<string, CandidateEntry[]> {
  if (_byFuzzyRhyme) return _byFuzzyRhyme;
  _byFuzzyRhyme = new Map();
  for (const e of entries()) {
    const key = fuzzyRhymeKey(e.word, e.nVowels, e.stressPos);
    let arr = _byFuzzyRhyme.get(key);
    if (!arr) { arr = []; _byFuzzyRhyme.set(key, arr); }
    arr.push(e);
  }
  return _byFuzzyRhyme;
}

/** Lemma → prefix-stripped stem (word_segmentation.json, 108k lemmas).  Used
 *  to spot same-root candidates so a cast doesn't "replace" поехать with
 *  уехать — prefix variation is the dullest transmutation there is. */
function segStem(word: string): string {
  if (!_segmentation) {
    try { _segmentation = loadJson<Record<string, string>>('word_segmentation.json'); }
    catch { _segmentation = {}; }
  }
  return _segmentation[word] ?? word;
}

/** "prep|noun" pairs whose stress retracts onto the preposition (по́ лесу,
 *  на́ смех — collocations.json).  Swapping the noun would break the
 *  retraction and mis-stress the line, so such pairs are left intact. */
function collocationPairs(): Set<string> {
  if (_collocations) return _collocations;
  try {
    _collocations = new Set(Object.keys(loadJson<Record<string, unknown>>('collocations.json')));
  } catch { _collocations = new Set(); }
  return _collocations;
}

// ── Candidate tagging (isolated-word UDPipe, cached) ─────────────────

const _tagCache = new Map<string, { upos: string; feats: Record<string, string> }>();

function tagWord(word: string): { upos: string; feats: Record<string, string> } {
  const hit = _tagCache.get(word);
  if (hit) return hit;
  let tag = { upos: 'X', feats: {} as Record<string, string> };
  try {
    const tok = parseRussianText(word).flat().find(t => !isRuPunctuation(t.upos));
    if (tok) tag = { upos: tok.upos, feats: tok.feats };
  } catch { /* keep X */ }
  _tagCache.set(word, tag);
  return tag;
}

// Aspect is LEXICAL in Russian (perfective/imperfective are different verbs)
// and Animacy drives accusative syncretism — both belong in the fidelity
// ladder alongside the agreement features.
const POS_FEATS_L2 = ['Number', 'Gender', 'VerbForm', 'Aspect'];
const POS_FEATS_L3 = ['Number', 'Gender', 'VerbForm', 'Aspect', 'Case', 'Person', 'Tense', 'Mood', 'Animacy', 'Degree'];

/** Length of the common SUFFIX of two words.  Russian inflection is
 *  suffixal, so a shared ending is a strong, tagger-free proxy for matching
 *  case/number/gender/conjugation — the closest Russian analogue of the
 *  English side's Penn-XPOS filtration (SynTagRus has no XPOS layer). */
function sharedSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Derivational-suffix classes (the morpheme-level grounder).  A shared
 *  derivational suffix (-ость, -ени-, -тель, -ическ-) grounds register and
 *  abstractness one level deeper than the surface inflectional ending:
 *  бледность → нежность keeps the deadjectival-abstract cast even when the
 *  case endings already agree.  word_segmentation.json is lemma-keyed and
 *  prefix-only, so suffixes come from a curated stem list instead — matched
 *  longest-first, ending within the last 3 chars (the inflectional tail). */
const DERIV_STEMS = [
  'ительн', 'ирова', 'ствова', 'ическ', 'овани', 'евани',
  'ость', 'есть', 'тель', 'ушк', 'юшк', 'ышк', 'еньк', 'оньк',
  'ёнок', 'онок', 'оват', 'еват', 'альн', 'ельн', 'ени', 'ани',
  'аци', 'яци', 'ниц', 'ник', 'щик', 'чик', 'изм', 'ист', 'инк',
  'лив', 'чив', 'озн', 'ичн', 'ыва', 'ива', 'ств', 'енн',
  'ущ', 'ющ', 'ащ', 'ящ', 'вш',
];
const _derivCache = new Map<string, string>();
function derivClass(word: string): string {
  const hit = _derivCache.get(word);
  if (hit !== undefined) return hit;
  let cls = '';
  for (const s of DERIV_STEMS) {
    const i = word.lastIndexOf(s);
    if (i >= 2 && word.length - (i + s.length) <= 3) { cls = s; break; }
  }
  _derivCache.set(word, cls);
  return cls;
}

function posMatches(
  precision: number,
  src: { upos: string; feats: Record<string, string> },
  cand: { upos: string; feats: Record<string, string> },
): boolean {
  if (precision <= 0) return true;
  if (src.upos !== cand.upos) return false;
  if (precision === 1) return true;
  const keys = precision === 2 ? POS_FEATS_L2 : POS_FEATS_L3;
  for (const k of keys) {
    const a = src.feats[k], b = cand.feats[k];
    if (a && b && a !== b) return false;
    if (precision >= 3 && a && !b) return false;
  }
  return true;
}

// ── The transmutation ────────────────────────────────────────────────

/** Function-word UPOS never replaced — keeps the grammatical scaffolding so
 *  the cast still reads as Russian. */
const KEEP_UPOS = new Set(['ADP', 'PART', 'CCONJ', 'SCONJ', 'AUX', 'PRON', 'DET', 'PUNCT', 'SYM', 'X', 'NUM']);

const WORD_RE = /[А-Яа-яЁё][А-Яа-яЁё\-]*/g;

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function pickReplacement(
  mode: 'stress' | 'rhyme' | 'phones',
  lower: string,
  tok: RuToken | null,
  posPrecision: number,
  zipfFloor: number,
  fuzzyRhyme: boolean,
): string | null {
  const nV = countVowels(lower);
  if (nV < 1) return null;
  const accents = getAccents(lower, tok?.feats ?? {}, tok?.upos);
  const stressPos = accents[0]?.stressPos ?? -1;
  if (stressPos <= 0) return null;

  let pool: CandidateEntry[] | undefined;
  if (mode === 'stress') {
    pool = byStress().get(`${nV}:${stressPos}`);
  } else if (mode === 'rhyme') {
    // Fuzzy mode widens the pool to every word sharing the tail length and
    // the stressed vowel (неточная рифма) — many words have no perfect
    // rhyme-mate in the lexicon at all.  Scoring below still prefers exact
    // and phonetically-near clausulas, so perfect rhymes win when they exist.
    pool = fuzzyRhyme
      ? byFuzzyRhyme().get(fuzzyRhymeKey(lower, nV, stressPos))
      : byRhyme().get(rhymeKey(lower, nV, stressPos));
  } else {
    pool = byOnset().get(lower.slice(0, 2));
  }
  if (!pool || pool.length === 0) return null;

  const src = tok ? { upos: tok.upos, feats: tok.feats } : { upos: 'X', feats: {} };
  const usePos = posPrecision > 0 && tok !== null && src.upos !== 'X';

  // Grounding score per candidate (cheap string ops over the whole pool),
  // then a descending-score walk with a random tiebreak — randomness lives
  // WITHIN grounding tiers, so each cast still rolls fresh dice among
  // equally-grounded words.  Tagging stays the costly step, so the budgeted
  // POS filter runs only down the ranked walk.
  const wantSuf = posPrecision >= 2
    ? Math.min(posPrecision, Math.max(1, lower.length - 2))
    : 0;
  const srcDeriv = posPrecision >= 2 ? derivClass(lower) : '';
  const srcStem = segStem(lower);
  const srcClaus = mode === 'rhyme' && fuzzyRhyme ? extractClausula(lower, stressPos) : '';
  const scored: { word: string; s: number; r: number }[] = [];
  for (const cand of pool) {
    if (cand.word === lower) continue;
    if (cand.zipf < zipfFloor) continue;
    let s = 0;
    if (wantSuf > 0) {
      const suf = sharedSuffixLen(lower, cand.word);
      s += Math.min(suf, 6) + (suf >= wantSuf ? 4 : 0);
      // Morpheme-level grounding: same derivational suffix class.
      if (srcDeriv && derivClass(cand.word) === srcDeriv) s += 3;
    }
    // Same-root casts (поехать → уехать) are transmutations in name only.
    if (segStem(cand.word) === srcStem && srcStem !== lower) s -= 5;
    else if (sharedSuffixLen(lower, cand.word) >= lower.length - 1) s -= 5;
    if (srcClaus) {
      const candClaus = extractClausula(cand.word, cand.stressPos);
      if (candClaus === srcClaus) s += 8;                        // perfect rhyme
      else if (arePhoneticallyEqual(candClaus, srcClaus)) s += 5; // near rhyme
    }
    scored.push({ word: cand.word, s, r: Math.random() });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.s - a.s || a.r - b.r);

  let tagBudget = 24;
  const fallback = scored[0].word;
  if (!usePos) return fallback;
  for (const { word } of scored) {
    if (tagBudget-- <= 0) break;
    if (posMatches(posPrecision, src, tagWord(word))) return word;
  }
  // POS filter exhausted its budget — better an off-tag cast than none.
  return fallback;
}

/** Map the webapp's 0–4 frequency slider onto the poetry-domain Zipf table
 *  (observed range ≈ 3.4–7.7, p50 ≈ 3.6, p99 ≈ 5.3). */
function zipfFloorOf(freqThreshold: number): number {
  if (freqThreshold <= 0) return 0;
  return 3.3 + freqThreshold * 0.5;   // 1 → 3.8, 2 → 4.3, 3 → 4.8, 4 → 5.3
}

/** Rewrite Russian verse, line by line, preserving all spacing/punctuation.
 *  fuzzyRhyme (rhyme mode only) widens the rhyme pool to неточная рифма —
 *  same tail length + stressed vowel — for the many words with no perfect
 *  rhyme-mate in the lexicon; perfect rhymes still outrank near ones. */
export async function rewriteRussianText(
  text: string,
  mode: 'stress' | 'rhyme' | 'phones',
  posPrecision = 1,
  freqThreshold = 0,
  fuzzyRhyme = false,
): Promise<string> {
  await ensureRussianData();
  const zipfFloor = zipfFloorOf(freqThreshold);
  return text.split('\n').map(line => {
    if (!line.trim()) return line;

    // Tag the line's words in context so POS fidelity works from real tags.
    let toks: RuToken[] = [];
    try { toks = parseRussianText(line).flat(); } catch { /* tagless */ }
    let ti = 0;
    const nextTok = (surface: string): RuToken | null => {
      const target = surface.toLowerCase().replace(/ё/g, 'е');
      for (let k = ti; k < Math.min(toks.length, ti + 6); k++) {
        if (toks[k].form.toLowerCase().replace(/ё/g, 'е') === target) {
          ti = k + 1;
          return toks[k];
        }
      }
      return null;
    };

    let prevLower = '';
    return line.replace(WORD_RE, (surface) => {
      const lower = surface.toLowerCase();
      const tok = nextTok(surface);
      const prev = prevLower;
      prevLower = lower;
      if (tok && KEEP_UPOS.has(tok.upos)) return surface;
      if (!tok && countVowels(lower) < 2) return surface;   // untagged monosyllables stay
      // Prosodic collocations (по́ лесу, на́ смех): the noun's stress has
      // retracted onto the preposition — a replacement wouldn't retract,
      // so the pair survives the transmutation whole.
      if (prev && collocationPairs().has(`${prev}|${lower}`)) return surface;
      const repl = pickReplacement(mode, lower, tok, posPrecision, zipfFloor, fuzzyRhyme);
      return repl ? matchCase(surface, repl) : surface;
    });
  }).join('\n');
}
