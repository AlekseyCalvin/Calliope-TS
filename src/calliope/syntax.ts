// calliope/syntax.ts — Wagner/Krifka structural predicates shared by the cyclic
// stress (bracketing.ts) and the relativiser (relstress.ts).
//
// These encode the functor/argument geometry of Wagner (2005) Ch. 6 and the
// argument/adjunct/locative typology of Krifka (2001) §4.5 / Wagner §6.5.1, read
// off the canonical UD relations + Penn POS + morphological FEATS.  No semantic
// role labeller is available, so the obl subtyping and transitivity tests are
// heuristic (preposition lemma + surface position + complement presence); every
// classification is approximate and, where uncertain, defaults to the reading
// that preserves prior behaviour (integration / transitive).

import { ClsWord } from '../types.js';
import { feat } from './feats.js';

const NOUN = /^(NN|NNS|NNP|NNPS)$/;
const PROPER = /^(NNP|NNPS)$/;
const VERB = /^VB/;
const PRON = /^(PRP|PRP\$)$/;

export function isPunct(w: ClsWord): boolean {
  return /^[^A-Za-z0-9]+$/.test(w.lexicalClass) || w.syllables.length === 0;
}
export function isNoun(w: ClsWord): boolean { return NOUN.test(w.lexicalClass); }
export function isVerb(w: ClsWord): boolean { return VERB.test(w.lexicalClass); }
function bare(w: ClsWord): string { return w.word.toLowerCase().replace(/['’]/g, ''); }

/** A PRONOUN — inherently given (Wagner §7.2.3): a personal/possessive pronoun by
 *  POS, or any word the parse marks PronType=Prs.  Demonstratives (this/that),
 *  wh-words (Rel/Int), negative (nobody/nothing) and indefinite-as-focus pronouns
 *  are NOT treated as inherently given here. */
export function isPronoun(w: ClsWord): boolean {
  if (PRON.test(w.lexicalClass)) return true;
  return feat(w, 'PronType') === 'Prs';
}

/** A POSITIVE indefinite pronoun — inherently given (Wagner §7.2.3): its
 *  existential presupposition is trivially satisfied in any context, so it is
 *  subordinated by default and yields the utterance nuclear to a heavier sister
 *  ("Something for the modern STAGE").  Only the SOME-/ANY- existential series:
 *  NEGATIVE (nothing/nobody) and temporal/emphatic words are deliberately excluded
 *  — those are FOCAL, not given (Eliot's "Nothing", McCartney's "Yesterday"), and
 *  per the maintainer's directive must keep their prominence.  UDPipe routinely
 *  mis-tags these as NN, so detection is by lemma (+ PronType guard). */
const INDEFINITE_GIVEN = new Set([
  'something', 'someone', 'somebody', 'somewhat', 'somewhere', 'someplace',
]);
export function isInherentlyGiven(w: ClsWord): boolean {
  if (!INDEFINITE_GIVEN.has(bare(w))) return false;
  const pt = feat(w, 'PronType');
  return pt !== 'Neg';                                       // never a negative pronoun
}

/** A LIGHT nominal head — a personal pronoun or an inherently-given indefinite —
 *  whose post-nominal PP modifier cannot be hosted inside the head's own group and
 *  so needs its OWN ϕ (the phrasing break the ear hears after "Something …"). */
export function isLightNominalHead(w: ClsWord): boolean {
  return isPronoun(w) || isInherentlyGiven(w);
}

/** A child relation that makes a verb BRANCH (carry an internal argument) — the
 *  specifier-restriction trigger (Wagner §6.3.2): a transitive/clausal VP whose
 *  branchingness blocks subordination of its subject. */
const ARG_CHILD = new Set(['DOBJ', 'IOBJ', 'OBJ', 'OBL', 'CCOMP', 'XCOMP']);
export function verbHasArgChild(
  verb: ClsWord, children: Map<number, ClsWord[]>,
): boolean {
  return (children.get(verb.absoluteIndex) ?? []).some(c => {
    const rel = c.canonicalRel ?? '';
    if (!ARG_CHILD.has(rel)) return false;
    // A low locative oblique is an adjunct, not a branching argument.
    if (rel === 'OBL' && isLowLocative(c, verb)) return false;
    return true;
  });
}

/** An unaccusative / passive subject is an UNDERLYING OBJECT, so it can bear the
 *  nuclear accent (Krifka §4.5.2): NSUBJPASS, or Voice=Pass on the verb, or a
 *  small set of unaccusative intransitives. */
const UNACCUSATIVE = new Set([
  'arrive', 'come', 'go', 'fall', 'rise', 'appear', 'die', 'happen', 'remain',
  'emerge', 'occur', 'vanish', 'grow', 'sink', 'flow', 'melt', 'wake',
]);
export function isUnaccusativeOrPassive(subj: ClsWord, verb: ClsWord): boolean {
  if ((subj.canonicalRel ?? '') === 'NSUBJPASS') return true;
  if (feat(verb, 'Voice') === 'Pass') return true;
  return UNACCUSATIVE.has(bare(verb).replace(/(ed|s|ing)$/, ''));
}

// ─── oblique typology (Wagner §6.5.1 / Larson 2005 / Krifka §4.5.1) ──────────
const GOAL_PREPS = new Set(['to', 'into', 'onto', 'toward', 'towards', 'unto']);
const SOURCE_PREPS = new Set(['from', 'out']);
const ADJUNCT_PREPS = new Set([
  'in', 'on', 'at', 'by', 'for', 'during', 'throughout', 'within', 'amid',
  'amidst', 'among', 'amongst', 'beneath', 'beside', 'over', 'under', 'above',
]);
const FRAME_PREPS = new Set([
  'in', 'on', 'at', 'by', 'during', 'after', 'before', 'since', 'until', 'upon',
]);
const TIME_NOUNS = new Set([
  'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year',
  'years', 'minute', 'minutes', 'moment', 'moments', 'century', 'centuries',
  'morning', 'evening', 'night', 'nights', 'spring', 'summer', 'autumn', 'winter',
  'dawn', 'dusk', 'noon', 'midnight', 'season', 'seasons',
]);

/** The preposition lemma governing an oblique noun: its `case`/`CASE` dependent. */
export function prepLemmaOf(obl: ClsWord, words: ClsWord[]): string | null {
  for (const w of words) {
    if (w.dependency?.governor === obl && (w.canonicalRel === 'CASE' ||
        w.lexicalClass === 'IN' || w.lexicalClass === 'TO')) {
      return bare(w);
    }
  }
  return null;
}

/** An oblique ARGUMENT (goal/source/recipient) — can integrate with the verb so
 *  the verb is subordinated and the oblique NP bears the single accent. */
export function isObliqueArgument(obl: ClsWord, words: ClsWord[]): boolean {
  const p = prepLemmaOf(obl, words);
  if (!p) return false;
  if (GOAL_PREPS.has(p) || SOURCE_PREPS.has(p)) return true;
  return false;
}

/** A LOW LOCATIVE / temporal adjunct (Larson 2005): a VP-final place/time oblique
 *  that gets its OWN accent regardless of position — NOT a functor of the VP. */
export function isLowLocative(obl: ClsWord, head: ClsWord, words?: ClsWord[]): boolean {
  // Detect by preposition + noun semantics; if we have no word list, fall back to
  // the noun being a time word.
  if (words) {
    const p = prepLemmaOf(obl, words);
    if (p && ADJUNCT_PREPS.has(p)) {
      // VP-final: the oblique follows its verbal head.
      if (obl.absoluteIndex > head.absoluteIndex) return true;
    }
  }
  if (TIME_NOUNS.has(bare(obl))) return true;
  return false;
}

/** A FRAME-SETTING locative (Wagner §6.5.1): a sentence-initial temporal/spatial
 *  oblique that frames the proposition — IS a functor, gets its own domain. */
export function isFrameSetting(obl: ClsWord, words: ClsWord[]): boolean {
  const p = prepLemmaOf(obl, words);
  if (!p || !FRAME_PREPS.has(p)) return false;
  // sentence-initial: the preposition is (near) the first content token.
  let firstContent = -1;
  for (let i = 0; i < words.length; i++) {
    if (!isPunct(words[i])) { firstContent = words[i].absoluteIndex; break; }
  }
  return obl.absoluteIndex <= firstContent + 2;
}

// ─── function-word transitivity (Wagner §6.5.5) ──────────────────────────────
const PARTICLE_LEMMAS = new Set([
  'in', 'out', 'up', 'down', 'off', 'away', 'back', 'forth', 'over', 'around',
  'along', 'through', 'apart', 'aside', 'onward', 'about',
]);

/** Last non-punct token of the clause at/after `w`? (the canonical strand site). */
function isClauseFinal(w: ClsWord, words: ClsWord[]): boolean {
  const idx = words.findIndex(x => x === w);
  if (idx < 0) return false;
  for (let k = idx + 1; k < words.length; k++) {
    if (!isPunct(words[k])) return false;
  }
  return true;
}

/** A TRANSITIVE function word governs a nominal complement (Wagner §6.5.5: only
 *  complement-taking functors have weak/stressless allomorphs).  An INTRANSITIVE
 *  or STRANDED preposition/particle keeps stress — returns false. */
export function isTransitiveFunctionWord(w: ClsWord, words: ClsWord[]): boolean {
  const pos = w.lexicalClass;
  const rel = w.canonicalRel ?? '';
  if (pos === 'RP' || rel === 'VPRT') return false;          // particles are intransitive
  if (pos === 'IN' || pos === 'TO' || rel === 'CASE') {
    // Does it govern a noun (have a nominal complement)?  In UD the preposition is
    // a CASE dependent of its noun, so check both directions.
    const gov = w.dependency?.governor;
    if (gov && !isPunct(gov) && NOUN.test(gov.lexicalClass) &&
        gov.absoluteIndex > w.absoluteIndex) {
      return true;                                            // prep → noun complement to its right
    }
    const hasNominalDep = words.some(d => d.dependency?.governor === w &&
      (NOUN.test(d.lexicalClass) || d.canonicalRel === 'OBL' || d.canonicalRel === 'DOBJ'));
    if (hasNominalDep) return true;
    // Clause-final adverbial particle/preposition with no complement → stranded.
    if (PARTICLE_LEMMAS.has(bare(w)) && isClauseFinal(w, words)) return false;
    if (isClauseFinal(w, words)) return false;                // stranded
    return true;                                              // default: transitive
  }
  return true;                                                // det/aux/cc/etc.: transitive
}

// ─── functor of a head-dependent pair (Wagner §6.2.2 mapping) ────────────────
export type FunctorSide = 'dep' | 'head' | 'match';

/** Which sister of a (dep, head) UD edge is the FUNCTOR — or 'match' for an
 *  associative pairing (Wagner §2.2.2).  This is the relation-keyed mapping in
 *  the plan's Gap-2 table: for some relations the GOVERNOR is the functor
 *  (DOBJ/OBL/CCOMP), for others the DEPENDENT is (AMOD/CASE/AUX/DET/ADVMOD). */
export function functorOf(dep: ClsWord): FunctorSide {
  switch (dep.canonicalRel ?? '') {
    case 'DOBJ': case 'IOBJ': case 'OBJ': case 'OBL':
    case 'CCOMP': case 'XCOMP': case 'NSUBJ': case 'NSUBJPASS':
      return 'head';                                          // governor (verb/VP) is functor
    case 'AMOD': case 'ADVMOD': case 'ACL': case 'ADVCL':
    case 'CASE': case 'AUX': case 'AUXPASS': case 'DET': case 'NUMMOD':
    case 'CC': case 'COMPMARK': case 'ADVMARK': case 'EXPL': case 'VPRT':
      return 'dep';                                           // dependent is functor
    case 'CONJ': case 'DISCOURSE': case 'INTJ':
      return 'match';                                         // associative / own accent
    default:
      return 'head';
  }
}
