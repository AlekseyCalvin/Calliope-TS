// caesura.ts — Caesura placement, shared by the display and rhyme layers.
//
// A caesura is the line's medial pause.  Two kinds are distinguished:
//  • 'hard' — an overt break at an Intonational-Unit boundary (comma, dash,
//    colon, semicolon …): the punctuation projection.
//  • 'soft' — a single INFERRED medial caesura for a punctuation-free line
//    (Kiparsky 1975, via McAleese: "phonological phrasing determines the
//    location of caesurae in verse").
//
// Extracted from display.ts (2026-06-13) so the rhyme layer can find the words
// that immediately precede caesurae (for pre-caesural internal-rhyme detection)
// without importing the display module.  Pure analysis — no colour/chalk here.

import { ClsWord, IntonationalUnit } from '../types.js';
import { isPunctuation } from './parser.js';

export type CaesuraKind = 'hard' | 'soft';

/** Foot-boundary syllable indices from a scansion string (cumulative syllable
 *  count after each foot; silent beats '-' are not syllables). */
function footBoundarySet(scansion: string): Set<number> {
  const set = new Set<number>();
  let c = 0;
  for (const foot of scansion.split('|')) {
    for (const ch of foot) if ('xwnms'.includes(ch)) c++;
    set.add(c);
  }
  return set;
}

// A new phonological/syntactic phrase opens at these POS tags: prepositions &
// subordinators (IN), infinitival "to" (TO), coordinators (CC), wh/relativizers,
// verb-particles (RP), and the predicate's verb/modal.  The major medial caesura
// of a line falls immediately BEFORE such a word — far more reliably read off the
// (robust) POS tags than off FinNLP's (noisy) phonological-phrase grouping, which
// mis-bracketed e.g. "The epic | feast…".  Determiners/articles are excluded (they
// continue a phrase a preposition already opened: "as | one empty bag").
const PHRASE_ONSET_POS = new Set([
  'IN', 'TO', 'CC', 'WDT', 'WP', 'WP$', 'WRB', 'RP',
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ', 'MD',
]);

// Directional/spatial adverbs that open a phrase ("snowed-in OUT of many routes",
// "drifting DOWN to sleep").  FinNLP often tags these RB rather than RP/IN, so the
// POS set alone misses them; a small curated lemma list recovers them with low
// over-fire risk (a generic RB like "very"/"quickly" is NOT a phrase onset).
const DIRECTIONAL_ONSET = new Set([
  'out', 'in', 'up', 'down', 'off', 'away', 'back', 'forth', 'over',
  'around', 'along', 'through', 'apart', 'aside', 'onward', 'onwards',
]);

/** True if a word opens a new phonological/syntactic phrase (a caesura candidate). */
function isPhraseOnset(w: ClsWord): boolean {
  if (PHRASE_ONSET_POS.has(w.lexicalClass)) return true;
  return w.lexicalClass === 'RB' && DIRECTIONAL_ONSET.has(w.word.toLowerCase());
}

/**
 * Caesura positions for a line, keyed by the syllable index AFTER which the pause
 * falls (= number of syllables to its left).
 *  • 'hard' — an overt break at an Intonational-Unit boundary.
 *  • 'soft' — a single INFERRED medial caesura for a punctuation-free line.
 *    Candidates are the boundaries just before a phrase/clause onset
 *    (PHRASE_ONSET_POS); the one nearest the line's midpoint that lies in the
 *    central third AND coincides with a foot boundary wins — so it is medial,
 *    never mid-foot, and consistent across structurally-parallel lines.  Read in
 *    LINEAR order (robust to clitic-group reordering); needs a line of ≥ 8
 *    syllables.
 */
export function computeCaesurae(words: ClsWord[], ius: IntonationalUnit[], scansion?: string): Map<number, CaesuraKind> {
  const caes = new Map<number, CaesuraKind>();
  // Caesurae must sit on FOOT BOUNDARIES (when the scansion is known).  The line's
  // metrical feet ARE the scansion's own segmentation, so a break that falls mid-
  // foot has no metrical reality — it merely fragments a foot (often into a lone
  // monosyllable: "But ‖ Oh ‖ ye…") and it made the reading view disagree with the
  // detailed "Feet:" view, which already marks foot-edge breaks only.  Punctuation
  // is a caesura CANDIDATE, never an override: an IU boundary that does not land on
  // a foot edge is dropped (the soft-caesura fallback below then offers one medial,
  // foot-aligned break if the line is long enough).
  const footEdges = scansion ? footBoundarySet(scansion) : null;
  const iuOf = new Map<ClsWord, number>();
  for (let i = 0; i < ius.length; i++) {
    for (const pp of ius[i].phonologicalPhrases) {
      for (const cg of pp.cliticGroups) for (const tok of cg.tokens) iuOf.set(tok, i);
    }
  }
  let cum = 0;
  let prevIu: number | undefined;
  let prevWasContentful = false;
  const onsetPositions: number[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass) || w.syllables.length === 0) continue;
    const iu = iuOf.get(w);
    if (prevIu !== undefined && iu !== undefined && iu !== prevIu
        && (!footEdges || footEdges.has(cum))) {
      caes.set(cum, 'hard');             // IU boundary landing on a foot edge → hard caesura
    }
    // A phrase-onset word that is NOT the line's first word opens a candidate
    // caesura immediately before it.
    if (prevWasContentful && isPhraseOnset(w)) onsetPositions.push(cum);
    cum += w.syllables.length;
    prevIu = iu;
    prevWasContentful = true;
  }
  const total = cum;

  // Infer ONE medial caesura only when the line carries no overt (hard) break.
  if (caes.size === 0 && total >= 8 && onsetPositions.length > 0) {
    const mid = total / 2;
    const lo = Math.max(2, Math.ceil(total / 3));
    const hi = Math.floor((2 * total) / 3);
    let best = -1, bestDist = Infinity;
    for (const c of onsetPositions) {
      if (c < lo || c > hi) continue;                   // medial third only
      if (footEdges && !footEdges.has(c)) continue;     // align to a foot boundary
      const d = Math.abs(c - mid);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (best > 0) caes.set(best, 'soft');
  }
  return caes;
}

/**
 * The words that immediately PRECEDE a caesura in a line — i.e. each word whose
 * cumulative syllable count lands exactly on a caesura position.  Used by the
 * rhyme layer for pre-caesural internal-rhyme detection.  Returned in linear
 * (reading) order; the caesura kind is paired so callers can weight hard vs
 * inferred breaks if they wish.
 */
export function preCaesuralWords(
  words: ClsWord[], ius: IntonationalUnit[], scansion?: string,
): { word: ClsWord; kind: CaesuraKind }[] {
  const caes = computeCaesurae(words, ius, scansion);
  if (caes.size === 0) return [];
  const out: { word: ClsWord; kind: CaesuraKind }[] = [];
  let cum = 0;
  for (const w of words) {
    if (isPunctuation(w.lexicalClass) || w.syllables.length === 0) continue;
    cum += w.syllables.length;
    const kind = caes.get(cum);
    if (kind) out.push({ word: w, kind });
  }
  return out;
}
