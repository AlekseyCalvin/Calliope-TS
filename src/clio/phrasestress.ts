// phrasestress.ts — McAleese's Phrase-Stress phase (previously SKIPPED).
//
// The pipeline used to map lexical stress straight to relative stress (plus a
// single "+1 on the rightmost content word"), leaving `ClsWord.phraseStress`
// a vestigial field stuck at 0.  This module restores the genuine phase that
// sits BETWEEN lexical and relative stress in McAleese's procedure (thesis
// Appendix A; Chomsky & Halle's Nuclear + Compound Stress Rules):
//
//   1. every word starts at 1;
//   2. the Compound Stress Rule pins a compound's subordinate element at the
//      floor while its principal stays in the ramp;
//   3. the recursive Nuclear Stress Rule ramps the principal stress of each
//      successive *stressed* word left-to-right, so prominence rises to the
//      phrase's nuclear (rightmost) peak.
//
// For the right-branching structure of English declaratives the recursive NSR
// reduces to a monotone ramp over the stressed words — function words and
// compound-subordinates pinned at 1.  NOTE the convention: here 1 is the FLOOR
// and the ramp climbs RIGHTWARD to the nuclear peak (the "If hairs…" example
// below).  McAleese's "Mary ate sweet ice cream" worked example uses the
// OPPOSITE (SPE) numbering — 1 = PRIMARY/strongest, weakened outward — so his
// ICE cream (primary on "ice") is reproduced here as ice=PEAK, cream=floor
// (the compound's HEAD "cream" is the subordinate, pinned at 1):
//
//   "Mary ate sweet ice cream"  -> Mary2 ate3 sweet4 ice5 cream1  (ICE cream: head subordinate)
//   "If hairs be wires, black wires grow on her head" -> 1 2 3 4 5 6 7 1 1 8
//
// (Marked / left-branching structures are approximated by the same ramp; a
// constituent-tree-driven refinement over `sentence.nodes` is a flagged
// follow-up.  This module reads only POS / content flags and surface order,
// and writes only the previously-unused phraseStress field — purely additive.)

import { ClsWord } from '../types.js';
import { isPunctuation } from './parser.js';
import { compoundStressSide } from './stress.js';

/** Sentence-final punctuation resets the nuclear ramp (the NSR is
 *  sentence-bounded).  A comma / colon / dash does NOT — the ramp runs across
 *  an internal intonational break (cf. "If hairs…, black wires…" → 1234…5,678). */
const SENTENCE_FINAL = new Set(['.', '!', '?', '…']);

/** Common-/proper-noun POS tags, gating which compounds floor an element. */
const NOUN_TAGS = new Set(['NN', 'NNS', 'NNP', 'NNPS']);

/**
 * Proclitic POS tags pinned at the phrase-stress floor: the NSR ramp applies to
 * *stressed words* (nouns, adjectives, adverbs, and VERBS — including the
 * copula/auxiliary "be" and modals, which bear lexical stress even though they
 * reduce in the contour), while pure clitics carry none.  Verbs are NOT here,
 * so McAleese's "if hairs BE wires…" keeps `be` in the ramp (=3).  A word the
 * earlier pipeline promoted to content (a phrasal-verb particle, a focus
 * demonstrative — `isContent === true`) is un-pinned and ramps.
 */
const PINNED_POS = new Set([
  'IN', 'TO', 'DT', 'CC', 'PRP', 'PRP$', 'WP', 'WP$', 'WDT', 'EX', 'POS',
]);

/**
 * Populate `word.phraseStress` for every word of a parsed sentence.
 */
export function computePhraseStress(words: ClsWord[]): void {
  const subordinate = compoundSubordinates(words);
  let ramp = 1; // running nuclear ramp; the floor for pinned words is 1
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) {
      w.phraseStress = 0;
      if (SENTENCE_FINAL.has(w.word)) ramp = 1;
      continue;
    }
    // Pinned at the floor: a proclitic function word bears no nuclear ramp, and
    // a compound's subordinate element is demoted by the Compound Stress Rule.
    const isClitic = PINNED_POS.has(w.lexicalClass) && !w.isContent;
    if (isClitic || subordinate.has(w)) {
      w.phraseStress = 1;
      continue;
    }
    w.phraseStress = ++ramp;
  }
}

/**
 * Identify the subordinate (pinned) element of each surface-adjacent compound,
 * delegating the direction to `compoundStressSide` (the shared rule, so phrase
 * stress and the lexical compound pass cannot disagree).
 *   - fore-stress ('left') → the HEAD (right) element is subordinate: SEA·shore,
 *     ICE cream, KITCHen table — the Compound Stress Rule default for N+N;
 *   - right-stress ('right') → the MODIFIER (left) is subordinate: apple PIE,
 *     and proper-name pairs (New YORK);
 *   - Adjective+noun ("sweet cream") is phrasal, not a compound (`side` is
 *     'right' there too, so the modifier "sweet" is pinned and "cream" ramps —
 *     i.e. end-stress, as desired).
 */
function compoundSubordinates(words: ClsWord[]): Set<ClsWord> {
  const subs = new Set<ClsWord>();
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i], b = words[i + 1];
    if (isPunctuation(a.lexicalClass) || isPunctuation(b.lexicalClass)) continue;
    if (!a.isContent || !b.isContent) continue;
    const side = compoundStressSide(a.word, a.lexicalClass, b.word, b.lexicalClass);
    // Floor an element only for a genuine N+N compound; an Adj+N ("sweet ice",
    // "red car") is phrasal — its end-stress emerges from the ramp itself, so we
    // pin nothing and let the adjective ramp (McAleese: sweet=4, above cream).
    const bothNouns = NOUN_TAGS.has(a.lexicalClass) && NOUN_TAGS.has(b.lexicalClass);
    if (side === 'left') subs.add(b);              // fore-stress compound: head subordinate (ICE cream)
    else if (side === 'right' && bothNouns) subs.add(a); // right-stress N+N: modifier subordinate (apple PIE)
  }
  return subs;
}
