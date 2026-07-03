// semantics.ts — Prominence signals mined from the dependency parse + POS.
//
// Dependency roles ARE the semantic layer: NSUBJ=agent, DOBJ/IOBJ=patient/
// recipient, OBL/ADVMOD/ADVCL=peripheral, PRP$=possessor, INTJ/DISCOURSE=
// address.  A flat POS floor crushes function words that these configurations
// reveal to be prominent — a STRANDED preposition ("what are you waiting FOR"),
// a CONTRASTIVE possessive ("thy choice, not mine"), a VOCATIVE.  These
// detectors recover that prominence from observable structure only (no semantic
// guessing, no cross-poem givenness).  They are consumed by the relativiser
// (stress.ts) as targeted floor RAISES, and by the nuclear pass (Phase 4).

import { ClsWord } from './types.js';
import { isPunctuation } from './parser.js';

/** True if some other token has `word` as its dependency governor (i.e. word
 *  has a complement/dependent of its own). */
function hasDependent(word: ClsWord, words: ClsWord[]): boolean {
  for (const w of words) {
    if (w !== word && w.dependency && w.dependency.governor === word) return true;
  }
  return false;
}

/** Last non-punctuation token index in the sentence at/after `from`? */
function isClauseFinal(word: ClsWord, words: ClsWord[]): boolean {
  const idx = words.indexOf(word);
  if (idx < 0) return false;
  for (let k = idx + 1; k < words.length; k++) {
    if (!isPunctuation(words[k].lexicalClass)) return false;
  }
  return true;
}

/**
 * A STRANDED preposition: an IN preposition whose complement has been extracted
 * (wh-movement / relativisation / topicalisation), so it governs no object and
 * sits clause-finally — "what are you waiting FOR", "…what you stare AT".  Such
 * a preposition bears stress (it is not the reducible proclitic of "in the
 * house").  Conservative: IN only (infinitival TO is excluded — "I want to go"
 * is not stranding), no dependent, and clause-final (the canonical strand site).
 */
export function isStrandedPreposition(word: ClsWord, words: ClsWord[]): boolean {
  if (word.lexicalClass !== 'IN') return false;
  if (hasDependent(word, words)) return false;       // has a complement → ordinary preposition
  return isClauseFinal(word, words);
}

/** Absolute / elliptical possessive pronouns used as the contrasted element. */
const ABSOLUTE_POSSESSIVES = new Set([
  'mine', 'thine', 'yours', 'hers', 'ours', 'theirs', 'his',
]);
const CONTRAST_MARKERS = new Set(['not', 'but', 'nor']);

/**
 * A CONTRASTIVE possessive: a possessive determiner (PRP$: thy/my/your/her…)
 * in the elliptical contrast frame "X's … not/but MINE" — the contrast lifts
 * the possessor out of reduction ("it was THY choice, not mine").  Tight by
 * construction: requires a contrast marker (not/but/nor) adjacent to an
 * absolute possessive somewhere in the clause, so an ordinary unfocused
 * possessive ("I lost my way") is left alone.
 */
export function isContrastivePossessive(word: ClsWord, words: ClsWord[]): boolean {
  if (word.lexicalClass !== 'PRP$') return false;
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i].word.toLowerCase();
    const b = words[i + 1].word.toLowerCase().replace(/['’]/g, '');
    if (CONTRAST_MARKERS.has(a) && ABSOLUTE_POSSESSIVES.has(b)) return true;
  }
  return false;
}

/** Finite auxiliaries / modals whose appearance before a subject pronoun marks
 *  subject-aux inversion. */
const INVERSION_AUX = new Set(['MD', 'VBP', 'VBZ', 'VBD']);

/**
 * A fronted DEICTIC LOCATIVE "there"/"here" in locative inversion — "THERE
 * could I marvel", "HERE could I rest".  FinNLP mis-tags the fronted locative
 * as existential (EX / expl) or reduces it as a discourse adverb, flattening it
 * to 'w'; but a fronted locative that triggers subject-aux inversion (an
 * aux/modal immediately followed by a subject pronoun) is a stressed deictic
 * focus, NOT the reduced existential of "there IS a house" (no inversion) or
 * the presentational "there LIVED a king" (verb + NP, no inversion).
 */
export function isDeicticLocative(word: ClsWord, words: ClsWord[]): boolean {
  const lemma = word.word.toLowerCase().replace(/['’]/g, '');
  if (lemma !== 'there' && lemma !== 'here') return false;
  const idx = words.indexOf(word);
  // must be the first non-punctuation token (fronted)
  let first = -1;
  for (let i = 0; i < words.length; i++) {
    if (!isPunctuation(words[i].lexicalClass)) { first = i; break; }
  }
  if (idx !== first) return false;
  // subject-aux inversion: <there/here> <aux|modal> <subject pronoun>
  const aux = words[idx + 1];
  const subj = words[idx + 2];
  return !!(aux && subj && INVERSION_AUX.has(aux.lexicalClass) && subj.lexicalClass === 'PRP');
}

/**
 * Imperative clause: the ROOT is a base-form verb (VB) with no overt subject
 * (no NSUBJ dependent) — "Tell me…", "Do not go…".  Used by the nuclear pass:
 * the accent falls on the verb / its object, not on a (dropped) subject, and an
 * imperative-clause vocative is a direct address.
 */
export function isImperativeClause(words: ClsWord[]): boolean {
  const root = words.find(w => w.dependency && w.dependency.dependentType === 'root');
  if (!root) return false;
  if (root.lexicalClass !== 'VB' && root.lexicalClass !== 'VBP') return false;
  for (const w of words) {
    if (w.dependency && w.dependency.governor === root
        && /nsubj/i.test(w.dependency.dependentType)) return false;
  }
  return true;
}

/**
 * A VOCATIVE (direct address): a noun tagged DISCOURSE/INTJ/DEP and set off by
 * adjacent punctuation (a comma or "!"), in a clause that is imperative or
 * subject-less — "Sing, O GODDESS…", "blow, BUGLE, blow".  Conservative: the
 * noun must be comma/!-adjacent so an ordinary argument noun is not swept in.
 */
export function isVocative(word: ClsWord, words: ClsWord[]): boolean {
  if (!/^(NN|NNS|NNP|NNPS)$/.test(word.lexicalClass)) return false;
  const role = word.dependency?.dependentType ?? '';
  if (!/discourse|intj|dep|vocative/i.test(role)) return false;
  const idx = words.indexOf(word);
  const prev = idx > 0 ? words[idx - 1] : null;
  const next = idx + 1 < words.length ? words[idx + 1] : null;
  const commaAdjacent =
    (prev && /^[,!]$/.test(prev.word)) || (next && /^[,!]$/.test(next.word));
  return !!commaAdjacent && isImperativeClause(words);
}
