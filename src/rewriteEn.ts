// rewriteEn.ts — the English Transmutation Chamber, rebuilt over nounsing-pro
// primitives with the Russian side's scored-ranking architecture.
//
//   stress — candidates share the source's exact stress contour;
//   rhyme  — candidates rhyme with the source (perfect; or, with fuzzyRhyme,
//            the wider family/assonant tiers of nounsing's rhyme typology —
//            many words have one or zero perfect rhyme-mates: temperate ↔
//            intemperate is the whole perfect pool);
//   phones — candidates share the opening two phonemes.
//
// Gates (preserved semantics from nounsing's built-in rewrites):
//   posPrecision 0–3 — Penn-tag prefix match.  The SOURCE word's tag comes
//     from the scansion engine's CONTEXTUAL tagger by default (parseDocument:
//     UDPipe-in-context with clitic re-merging and archaic forms — "frame" in
//     "Could frame thy fearful symmetry" gates as VB, not the dictionary's
//     NN); candidates are dictionary-tagged (they occur in no context).
//     `dictPos: true` reverts the source side to dictionary tags (fast path,
//     no per-line parse).
//   freqThreshold    — Zipf floor (≥ 1.0 enables).
//
// Grounding score (new, composed like src/russian/rewrite.ts):
//   morphGround      — derivational-suffix match (-ness/-tion/-ing/-ly …)
//                      + the augmented CMU's morphology classes (suffixType,
//                      prefixType, simple/complex), + same-root avoidance;
//   registerFidelity — 0–4 slider: −r·|Δzipf| penalty, so a rare word swaps
//                      for a similarly rare word and a common one for a
//                      common one (register/diction banding);
//   fuzzy rhyme tiers — perfect +8 > family +5 > assonant +2, so perfect
//                      rhymes still win wherever they exist.
//
// Unlike nounsing's built-ins (lowercased whitespace-join), this rewriter
// replaces words in place — punctuation, spacing, and capitalisation survive.

import {
  lexicon, morphology, phonesForWord, stresses, search, searchStresses,
  rhymes, familyRhyme, assonantRhyme,
} from 'nounsing-pro';
import { parseDocument, isPunctuation } from './parser.js';
import { lexicon as enLexicon } from 'en-lexicon';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/** Words attested lowercase in Webster's 2nd (web2 ∩ lexicon, de-inflected
 *  at build time — tools note: regenerate src/data/en_common_words.json from
 *  /usr/share/dict/words if the lexicon changes; tsc does NOT copy it to
 *  dist/data/).  The CMU is ~half proper names that carry NO tag/frequency
 *  marker (aaron is NN at Zipf 4.2), so dictionary-attestation is the one
 *  signal that separates eagle/warrior/chorus from aaron/melcher/salisbury. */
let _commonWords: Set<string> | null = null;
function commonWords(): Set<string> {
  if (_commonWords) return _commonWords;
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'data', 'en_common_words.json');
    _commonWords = new Set(JSON.parse(readFileSync(p, 'utf8')) as string[]);
  } catch { _commonWords = new Set(); }
  return _commonWords;
}

// ── Grounding helpers ─────────────────────────────────────────────────

/** English derivational suffixes, longest-first.  Surface match beats the
 *  CMU's class-level fields for register: brightness → sweetness keeps the
 *  deadjectival-abstract cast even when Penn tags already agree. */
const DERIV_SUFFIXES = [
  'ability', 'ibility', 'ization', 'fulness', 'ousness',
  'ation', 'ition', 'iness', 'ingly', 'ement', 'ships',
  'ness', 'tion', 'sion', 'ment', 'able', 'ible', 'ance', 'ence',
  'ship', 'hood', 'ward', 'wise', 'less', 'ful', 'ous', 'ive',
  'ity', 'ism', 'ist', 'ize', 'ise', 'ify', 'ard', 'dom',
  'ing', 'est', 'eth', 'ess', 'ly', 'ed', 'er', 'en',
];
const _sufCache = new Map<string, string>();
function derivSuffix(word: string): string {
  const hit = _sufCache.get(word);
  if (hit !== undefined) return hit;
  let out = '';
  for (const s of DERIV_SUFFIXES) {
    if (word.length - s.length >= 3 && word.endsWith(s)) { out = s; break; }
  }
  _sufCache.set(word, out);
  return out;
}

interface MorphClass { suffixType: string; prefixType: string; morphology: string }
function morphClassOf(word: string): MorphClass | null {
  const m = morphology(word);
  if (!m || m.length === 0) return null;
  return {
    suffixType: m[0].suffixType ?? 'NA',
    prefixType: m[0].prefixType ?? 'NA',
    morphology: m[0].morphology ?? 'NA',
  };
}

function zipfOf(word: string): number | null {
  const lex = lexicon(word);
  if (!lex || lex.length === 0) return null;
  const f = parseFloat(lex[0].freq);
  return Number.isNaN(f) ? null : f;
}

function posOf(word: string): string | null {
  const lex = lexicon(word);
  const pos = lex?.[0]?.pos;
  return pos && pos !== 'NA' ? pos.toUpperCase() : null;
}

/** Candidate-side tag SET, from the FinNLP en-lexicon (112k words, full
 *  Penn tag distributions: burning → NN|VBG|JJ) with nounsing's single
 *  first-profile tag as fallback.  Two wins over first-profile-only:
 *  a VB source no longer rejects "frame" (NN|VBP|VB), and en-lexicon
 *  tags proper names as NNP (aaron, jake, kyle) where the augmented CMU
 *  calls them NN — the name signal no other resource carries. */
const _tagSetCache = new Map<string, string[]>();
function tagSetOf(word: string): string[] {
  const hit = _tagSetCache.get(word);
  if (hit) return hit;
  // Own-property + type guard: the lexicon is a plain object, so bare
  // indexing with "constructor" (a real CMU word!) returns the Object
  // constructor function — .toUpperCase() then crashes the cast.
  const entry = Object.prototype.hasOwnProperty.call(enLexicon, word)
    ? enLexicon[word] : undefined;
  let out: string[];
  if (typeof entry === 'string' && entry) {
    out = entry.toUpperCase().split('|');
  } else {
    const p = posOf(word);
    out = p ? [p] : [];
  }
  _tagSetCache.set(word, out);
  return out;
}

/** Same-root detector: English derives at both edges (night→nightly,
 *  more→anymore, temperate→intemperate), so containment at either edge
 *  flags the pair.  Applied unconditionally — a same-root cast is a
 *  transmutation in name only, and temperate's sole perfect rhyme is
 *  its own negation. */
function sameRoot(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 3) return false;
  return a.endsWith(b) || b.endsWith(a) || a.startsWith(b) || b.startsWith(a);
}

// ── Closed-class scaffolding (active at posPrecision ≥ 1) ─────────────
//
// The Russian side's quality edge is exactly this: function words are the
// grammatical scaffolding, and swapping them through the open-class pipeline
// yields "of → would've" and "the → an call".  Closed-class tags are KEPT;
// pronouns and modals — where swaps stay grammatical — transmute only
// WITHIN curated sets that respect case and possession (Penn's PRP covers
// he AND him, so the tag alone can't guard case).

const KEEP_TAGS = new Set([
  'DT', 'IN', 'CC', 'TO', 'EX', 'POS', 'RP', 'PDT',
  'WDT', 'WP', 'WP$', 'WRB', 'UH', 'CD', 'LS', 'SYM', 'FW',
]);
const PRON_NOM = ['i', 'he', 'she', 'we', 'they', 'thou', 'ye', 'you', 'it'];
const PRON_ACC = ['me', 'him', 'her', 'us', 'them', 'thee', 'you', 'it'];
const PRON_POSS = ['my', 'thy', 'his', 'her', 'its', 'our', 'their', 'your'];
const MODALS = ['can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would'];

function closedClassSet(tag: string, lower: string): string[] | null {
  if (tag === 'MD') return MODALS;
  if (tag === 'PRP$') return PRON_POSS;
  if (tag === 'PRP') {
    if (PRON_NOM.includes(lower)) return PRON_NOM;
    if (PRON_ACC.includes(lower)) return PRON_ACC;
    return [];   // unknown pronoun form — keep it
  }
  return null;
}

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// ── The transmutation ────────────────────────────────────────────────

export interface EnRewriteOptions {
  /** rhyme mode: widen the pool to family and assonant rhyme tiers. */
  fuzzyRhyme?: boolean;
  /** derivational-suffix + CMU-morphology-class grounding. */
  morphGround?: boolean;
  /** 0–4: weight of the |Δzipf| register-band penalty (0 = off). */
  registerFidelity?: number;
  /** use dictionary POS for source words instead of the contextual tagger. */
  dictPos?: boolean;
}

const MAX_SCORED = 4000;   // sample cap before scoring very large pools

function pickReplacement(
  mode: 'stress' | 'rhyme' | 'phones',
  lower: string,
  ctxTag: string | null,
  posPrecision: number,
  zipfFloor: number,
  opts: EnRewriteOptions,
): string | null {
  const prons = phonesForWord(lower);
  if (prons.length === 0) return null;

  // Candidate pool, with rhyme-tier tags in fuzzy rhyme mode.
  let pool: { word: string; tier: number }[];
  if (mode === 'stress') {
    const pat = stresses(prons[0]);
    if (!pat) return null;
    pool = searchStresses('^' + pat + '$').map(w => ({ word: w, tier: 0 }));
  } else if (mode === 'rhyme') {
    const perfect = rhymes(lower);
    if (opts.fuzzyRhyme) {
      const seen = new Set<string>(perfect);
      pool = perfect.map(w => ({ word: w, tier: 8 }));
      for (const w of familyRhyme(lower)) {
        if (!seen.has(w)) { seen.add(w); pool.push({ word: w, tier: 5 }); }
      }
      for (const w of assonantRhyme(lower)) {
        if (!seen.has(w)) { seen.add(w); pool.push({ word: w, tier: 2 }); }
      }
    } else {
      pool = perfect.map(w => ({ word: w, tier: 0 }));
    }
  } else {
    const first2 = prons[0].split(' ').slice(0, 2).join(' ');
    pool = search('^' + first2).map(w => ({ word: w, tier: 0 }));
  }
  if (pool.length === 0) return null;

  // Gates (same semantics as nounsing's built-in rewrites).  The source tag
  // prefers the contextual parse; dictionary POS is the fallback (and the
  // whole story when dictPos is set).
  const srcPos = ctxTag ?? posOf(lower);
  const posPrefix = posPrecision > 0 && srcPos ? srcPos.slice(0, posPrecision) : null;

  // Closed-class scaffolding: prepositions, determiners, conjunctions etc.
  // survive untouched; pronouns and modals transmute only within their
  // curated sets — the mode constraint already lives in the pool, so
  // could→should/would in rhyme mode, he→she/thee/we, thy→her/our.
  if (posPrecision > 0 && srcPos) {
    if (KEEP_TAGS.has(srcPos)) return null;
    const set = closedClassSet(srcPos, lower);
    if (set) {
      const members = pool.filter(c => c.word !== lower && set.includes(c.word));
      if (members.length === 0) return null;
      return members[(Math.random() * members.length) | 0].word;
    }
  }

  // Sample very large pools before the scoring pass.
  if (pool.length > MAX_SCORED) {
    for (let i = pool.length - 1; i > pool.length - 1 - MAX_SCORED; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool = pool.slice(pool.length - MAX_SCORED);
  }

  const srcSuffix = opts.morphGround ? derivSuffix(lower) : '';
  const srcMorph = opts.morphGround ? morphClassOf(lower) : null;
  const srcZipf = (opts.registerFidelity ?? 0) > 0 ? zipfOf(lower) : null;
  const rFid = opts.registerFidelity ?? 0;
  const srcNsylls = mode !== 'stress' ? (lexicon(lower)?.[0]?.nsylls ?? null) : null;

  const scored: { word: string; s: number; r: number }[] = [];
  for (const { word: cand, tier } of pool) {
    if (cand === lower) continue;
    // Letters only, two or more: kills CMU noise (a42128), tokenisation
    // shards (ca), and the apostrophe entries (morris', would've, it'll)
    // that read as junk in a cast.
    if (!/^[a-z][a-z]+$/.test(cand)) continue;
    const candZipf = zipfOf(cand);
    if (zipfFloor >= 1.0 && (candZipf === null || candZipf < zipfFloor)) continue;
    // Tag-set gate: the candidate passes if ANY of its readings matches the
    // source tag at the requested precision (precision 3 = EXACT tag — a
    // prefix slice conflated PRP with PRP$; thy→me was a case wreck).
    // Proper-noun readings are struck first when the source isn't proper:
    // jake is NNP-only and vanishes; frank keeps JJ|NN|VB and stays.
    let primaryMatch = false;
    if (posPrefix && srcPos) {
      let tags = tagSetOf(cand);
      if (!srcPos.startsWith('NNP')) {
        tags = tags.filter(t => !t.startsWith('NNP'));
        if (tags.length === 0) continue;
      }
      const match = (t: string) =>
        posPrecision >= 3 ? t === srcPos : t.slice(0, posPrecision) === posPrefix;
      if (!tags.some(match)) continue;
      // The dominant (first-listed) reading matching is worth a bonus —
      // "frame" as VB is its secondary reading, "blame" its primary.
      primaryMatch = match(tags[0]);
    }
    let s = tier;
    if (primaryMatch) s += 2;
    // Attestation penalty (not a hard filter — thin pools still cast):
    // unattested candidates are overwhelmingly the CMU's untagged proper
    // names.  Skipped for proper-noun sources, where names are the point.
    if (posPrecision > 0 && (!srcPos || !srcPos.startsWith('NNP')) && commonWords().size > 0
        && !commonWords().has(cand)) s -= 7;
    if (opts.morphGround) {
      if (srcSuffix && derivSuffix(cand) === srcSuffix) s += 4;
      if (srcMorph) {
        const cm = morphClassOf(cand);
        if (cm) {
          if (cm.suffixType === srcMorph.suffixType) s += 2;
          if (cm.morphology === srcMorph.morphology) s += 1;
          if (cm.prefixType === srcMorph.prefixType) s += 1;
        }
      }
    }
    if (sameRoot(lower, cand)) s -= 6;
    if (srcZipf !== null && candZipf !== null) {
      // Quantised to half-Zipf bands: a continuous penalty would leave a
      // unique argmax and kill the dice — candidates within a band tie,
      // and the random tiebreak keeps each cast fresh.
      s -= rFid * (Math.round(Math.abs(srcZipf - candZipf) * 2) / 2);
    }
    // Rhyme/phones pools ignore length, so meter breaks worst on long
    // lines (hand→understand, frame→francisco).  Prefer same-syllable
    // casts without forcing them — rhyme pools can be thin.
    if (srcNsylls !== null) {
      const cn = lexicon(cand)?.[0]?.nsylls;
      if (cn) s -= 1.5 * Math.min(Math.abs(cn - srcNsylls), 3);
    }
    scored.push({ word: cand, s, r: Math.random() });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.s - a.s || a.r - b.r);
  return scored[0].word;
}

const WORD_RE = /[A-Za-z][A-Za-z'’]*/g;

/** a/an agreement post-pass: articles survive (closed class), but the noun
 *  after them changes, so "an call" and "a hour" need re-agreement.  The
 *  first PHONE decides (an hour, a unicorn), with a letter fallback. */
function startsWithVowelSound(word: string): boolean {
  const p = phonesForWord(word.toLowerCase().replace(/[’]/g, "'"))[0];
  if (p) return /^[AEIOU]/.test(p);
  return /^[aeiou]/i.test(word);
}

function fixArticles(line: string): string {
  return line.replace(/\b([Aa])(n?)(\s+)([A-Za-z][A-Za-z'’]*)/g, (_m, a, _n, sp, next) => {
    return (startsWithVowelSound(next) ? a + 'n' : a) + sp + next;
  });
}

/** Normalised lookup key: lowercase, straight apostrophe (parseDocument
 *  normalises curly apostrophes before tokenising, so keys must match). */
function keyOf(s: string): string {
  return s.toLowerCase().replace(/[‘’ʼ′]/g, "'");
}

/** Rewrite English verse in place — spacing, punctuation, and case survive
 *  (nounsing's built-ins lowercase and drop punctuation). */
export function rewriteEnglishText(
  text: string,
  mode: 'stress' | 'rhyme' | 'phones',
  posPrecision = 1,
  freqThreshold = 0,
  opts: EnRewriteOptions = {},
): string {
  return text.split('\n').map(line => {
    if (!line.trim()) return line;

    // Contextual tagging (default): one parse per line; the aligner walks
    // the parsed words in order, matching surface forms within a small
    // window (clitic re-merging keeps contractions whole on both sides).
    let ctxWords: { form: string; tag: string }[] = [];
    if (posPrecision > 0 && !opts.dictPos) {
      try {
        ctxWords = parseDocument(line).sentences
          .flatMap(s => s.words)
          .filter(w => !isPunctuation(w.lexicalClass))
          .map(w => ({ form: keyOf(w.word), tag: w.lexicalClass.toUpperCase() }));
      } catch { /* dictionary fallback for the whole line */ }
    }
    let ti = 0;
    const nextTag = (surface: string): string | null => {
      const target = keyOf(surface);
      for (let k = ti; k < Math.min(ctxWords.length, ti + 6); k++) {
        if (ctxWords[k].form === target) {
          ti = k + 1;
          return ctxWords[k].tag;
        }
      }
      return null;
    };

    return fixArticles(line.replace(WORD_RE, (surface) => {
      const ctxTag = nextTag(surface);
      const lower = keyOf(surface);
      const repl = pickReplacement(mode, lower, ctxTag, posPrecision, freqThreshold, opts);
      return repl ? matchCase(surface, repl) : surface;
    }));
  }).join('\n');
}
