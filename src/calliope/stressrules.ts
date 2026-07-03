// calliope/stressrules.ts — Scenario A–O relation-keyed stress (the maintainer's
// authoritative spec, each rule cross-checked against external linguistics).
// Operates over POS + word.canonicalRel + the person/place name flags.
//
// THIS FILE so far implements the nominal-modifier scenarios — the most directly
// testable, and where the canonical substrate first pays off:
//   A  N+N noun-adjunct (NOMD)        → LEFT  (SLATE roof, BIRD nest, MSNBC news,
//                                              REAGAN era) — the ~⅔ baseline;
//                                              food/temporal heads stay RIGHT.
//   B  Adj+N (AMOD)                   → RIGHT (a green ROOF); a LEXICALISED Adj+N
//                                              compound fore-stresses (HOT dog).
//   C  Proper NAME (NNP+NNP)          → RIGHT/head (New YORK, Bay BRIDGE) EXCEPT a
//                                              de-accenting classifier head ("Street"
//                                              → WALL Street).
//   M  is subsumed here (proper-name extension → rightmost head).
// Verbal/clausal/override scenarios (D–L, N, O) are added next.
//
// External-theory notes (binding): N+N left is only a ~⅔ baseline (Kunter & Plag),
// so the curated right-stress heads are first-class; lexicalised Adj+N fore-stress
// is a documented lexicalisation marker, not merely contrast; "Street" de-accents.

import { ClsWord } from '../types.js';
import { setPrimaryStress, isRightStressedHead } from '../stress.js';

const NOUN = /^(NN|NNS|NNP|NNPS)$/;
const PROPER = /^(NNP|NNPS)$/;
const ADJ = /^JJ/;

function bare(w: ClsWord): string {
  return w.word.toLowerCase().replace(/[^a-z]/g, '');
}
function isNoun(w: ClsWord): boolean { return NOUN.test(w.lexicalClass); }
function isProper(w: ClsWord): boolean { return PROPER.test(w.lexicalClass); }
function isAdjMod(w: ClsWord): boolean { return ADJ.test(w.lexicalClass) || w.canonicalRel === 'AMOD'; }

// Scenario C exception: proper-name heads that de-accent the name LEFT.  "Street"
// is the well-documented case (WALL Street, STATE Street) vs right-stressing
// Avenue/Road/Square/Bridge (Fifth AVENUE) — see the plan's external cross-check.
const PROPER_NAME_LEFT_HEADS = new Set(['street']);

// Scenario B exception: lexicalised Adj+N compounds that fore-stress despite the
// AMOD right-stress baseline (the stress shift is the lexicalisation marker:
// "HOT dog" the food vs "hot DOG" a dog that is hot).  Small, curated, defensible.
const LEXICALIZED_FORESTRESS = new Set([
  'hot dog', 'hot dogs', 'high school', 'high schools', 'white house',
  'black board', 'blackboard', 'green house', 'blue blood', 'hot rod',
]);
function isLexicalizedForestress(a: ClsWord, b: ClsWord): boolean {
  return LEXICALIZED_FORESTRESS.has(`${bare(a)} ${bare(b)}`);
}

type Side = 'left' | 'right';

/** Which element of an adjacent (modifier w1, head-noun w2) structure carries
 *  primary stress, per Scenarios A/B/C. */
export function scenarioModifierSide(w1: ClsWord, w2: ClsWord): Side {
  // Participial/gerundial HYPHENATED compound modifier (book-carrying, law-abiding,
  // well-known) is adjectival/phrasal, NOT a noun adjunct — so it end-stresses, the
  // head keeping prominence: "a book-carrying MAN", "a law-abiding CITIZEN".  (The
  // table's VBN/VBG-participle → end-stress; only a single-word -ing GERUND like
  // WAITING room fore-stresses, and those are not hyphenated.)
  if (/-/.test(w1.word) && /(ing|ed)$/i.test(bare(w1))) return 'right';
  // C — proper NAME (both proper nouns): head/right, classifier "Street" → left.
  if (isProper(w1) && isProper(w2)) {
    return PROPER_NAME_LEFT_HEADS.has(bare(w2)) ? 'left' : 'right';
  }
  // B — Adj+N: right (compositional); lexicalised Adj+N compound → left.
  if (isAdjMod(w1)) {
    return isLexicalizedForestress(w1, w2) ? 'left' : 'right';
  }
  // A — N+N noun-adjunct (incl. proper-modifier + common head, REAGAN era / MSNBC
  // news): left by default; food/temporal right-stress heads (apple PIE) → right.
  if (isNoun(w1) && isNoun(w2)) {
    return isRightStressedHead(w2.word) ? 'right' : 'left';
  }
  return 'right';
}

/**
 * Apply the nominal-modifier stress scenarios over a sentence's words.  Mirrors
 * the legacy `applyCompoundStress` iteration (adjacent content words, noun head)
 * but decides via the canonical relations / name flags rather than POS alone, so
 * the proper-modifier and lexicalised cases come out right.  Replaces
 * `applyCompoundStress` in the Calliope engine.
 */
export function applyScenarioStress(words: ClsWord[]): void {
  const content = words.filter(w => w.isContent);
  for (let i = 0; i + 1 < content.length; i++) {
    const w1 = content[i];
    const w2 = content[i + 1];
    if (w1.absoluteIndex + 1 !== w2.absoluteIndex) continue;  // surface-adjacent only
    if (!isNoun(w2)) continue;                                 // head of the structure is a noun
    if (!isNoun(w1) && !isAdjMod(w1)) continue;                // modifier is a noun or adjective
    if (scenarioModifierSide(w1, w2) === 'left') {
      setPrimaryStress(w1, 2);
      setPrimaryStress(w2, 1);
    } else {
      setPrimaryStress(w1, 1);
      setPrimaryStress(w2, 2);
    }
  }
}

const RANK: Record<string, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const LEVELS = ['x', 'w', 'n', 'm', 's'] as const;

function peakSyll(w: ClsWord) {
  let best = null as ClsWord['syllables'][number] | null;
  let bestR = -1;
  for (const s of w.syllables) {
    const r = RANK[s.relativeStress ?? 'w'];
    if (r >= bestR) { bestR = r; best = s; }
  }
  return best;
}

/**
 * Make the LEFT-stress scenario decision DURABLE in the relative-stress contour.
 *
 * The lexical compound pass (`applyScenarioStress`) sets the modifier primary, but
 * the nuclear pass + relativiser re-promote the rightmost word, so a *non-curated*
 * fore-stressed compound (SLATE roof, REAGAN era, WALL Street, HOT dog) would still
 * surface as end-stressed.  The legacy `resolveCompoundForestress` repairs this only
 * for the curated `isLeftStressedPair` set; this Calliope post-pass — run AFTER
 * `assignRelativeStresses` — re-asserts the same demote-only fore-stress for EVERY
 * scenario-left pair: the modifier rises to the pair's max prominence, the head is
 * demoted one rung below (never raised), which also keeps the no-equal-clash rule.
 */
export function enforceScenarioStress(words: ClsWord[]): void {
  const content = words.filter(w => w.isContent);
  for (let i = 0; i + 1 < content.length; i++) {
    const w1 = content[i];
    const w2 = content[i + 1];
    if (w1.absoluteIndex + 1 !== w2.absoluteIndex) continue;
    if (!isNoun(w2)) continue;
    if (!isNoun(w1) && !isAdjMod(w1)) continue;
    if (scenarioModifierSide(w1, w2) !== 'left') continue;
    const s1 = peakSyll(w1);
    const s2 = peakSyll(w2);
    if (!s1 || !s2) continue;
    const r1 = RANK[s1.relativeStress ?? 'w'];
    const r2 = RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = LEVELS[hi];                                  // modifier ≥ both
    s2.relativeStress = LEVELS[Math.min(r2, Math.max(0, hi - 1))];   // demote head only
  }
}
