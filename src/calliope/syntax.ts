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

/** Focus-sensitive particles (Krifka §4.4.6, Association with Focus): a
 *  premodifying "just / only / even / merely" marks its sister as the FOCUS —
 *  the ASSOCIATE bears the accent, the particle is a functor and reduces
 *  ("the carriage held but just OURSELVES": "just" = "only", so the accent
 *  belongs to the pronoun it exclusivises).  Returns the associate, or null
 *  when the word is not a premodifying focus particle.  A postmodifying or
 *  clause-final "just/only" ("he only just made it") is temporal/degree use
 *  and returns null. */
const FOCUS_PARTICLES = new Set(['just', 'only', 'even', 'merely']);
export function focusAssociateOf(w: ClsWord, words: ClsWord[]): ClsWord | null {
  if (!FOCUS_PARTICLES.has(bare(w))) return null;
  if (!/^RB/.test(w.lexicalClass)) return null;
  const gov = w.dependency?.governor;
  // canonical case: the particle is an ADVMOD premodifier of its associate
  if (gov && gov !== w && !isPunct(gov) && gov.absoluteIndex > w.absoluteIndex) return gov;
  // parse-robust fallback: the particle immediately precedes a pronoun the
  // parser attached elsewhere ("but just Ourselves" with "just" hung on the verb)
  const next = words.find(x => x.absoluteIndex === w.absoluteIndex + 1 && x.syllables.length > 0);
  if (next && (PRON.test(next.lexicalClass) || feat(next, 'PronType') === 'Prs')) return next;
  return null;
}

/** Marginal-modal use of dare/need (Quirk et al.): the BARE-infinitive
 *  complement construction — "dare he aspire", "What the hand dare seize" —
 *  is the AUXILIARY usage (the one that licenses subject inversion), so the
 *  verb reduces like a modal and the beat belongs to its infinitive.  The
 *  LEXICAL usage takes a to-infinitive ("dared to aspire") or a nominal
 *  object ("dared the leap") and keeps full content stress — the gate is the
 *  complement's shape, not the lemma alone. */
const MARGINAL_MODALS = new Set(['dare', 'dares', 'dared', 'durst', 'need']);
export function isMarginalModalUse(w: ClsWord, words: ClsWord[]): boolean {
  if (!MARGINAL_MODALS.has(bare(w)) || !/^VB/.test(w.lexicalClass)) return false;
  // A clausal-complement child that is a bare verb (no "to" mark below it).
  const comp = words.find(d => d !== w && d.dependency?.governor === w &&
    /^(XCOMP|CCOMP)$/.test(d.canonicalRel ?? '') && /^VB/.test(d.lexicalClass));
  if (comp) {
    const hasTo = words.some(m => m !== comp && m.dependency?.governor === comp &&
      (m.lexicalClass === 'TO' || bare(m) === 'to'));
    return !hasTo;
  }
  // Surface fallback for mis-parses: an immediately-following bare infinitive
  // ("dare seize"), or inverted pronoun subject + bare verb ("dare he aspire").
  const at = (k: number) => words.find(x => x.absoluteIndex === w.absoluteIndex + k);
  const n1 = at(1);
  if (n1 && n1.lexicalClass === 'VB') return true;
  const n2 = at(2);
  if (n1 && n1.lexicalClass === 'PRP' && n2 && /^VBP?$/.test(n2.lexicalClass)) return true;
  return false;
}

/** A CAPITALIZED personal/possessive pronoun in mid-sentence ("but just
 *  Ourselves", "For His Civility" — Dickinson's reverential capitals).
 *  English capitalizes pronouns only sentence-initially and in "I", so a
 *  capital here is the poet's deliberate typographic FOCUS mark: the pronoun
 *  is referential/contrastive — Wagner's "functor role" ceded to a full
 *  referring use, Krifka (78): an accented pronoun signals narrow focus. */
export function isCapitalizedFocalPronoun(w: ClsWord, words: ClsWord[]): boolean {
  if (!PRON.test(w.lexicalClass) && feat(w, 'PronType') !== 'Prs') return false;
  if (!/^[A-Z]/.test(w.word)) return false;
  const lower = bare(w);
  if (lower === 'i' || lower.startsWith('i')) {
    // "I" and its contractions are conventionally capital — no signal there.
    if (lower === 'i' || /^i(ll|m|d|ve)$/.test(lower)) return false;
  }
  // Conventional capitalization is NOT a focus mark: a pronoun opening a
  // QUOTED sentence ("Who said, "It is just as I feared!"") or following
  // sentence-internal terminal punctuation or a colon is capitalized by
  // orthographic rule, not by the poet's emphasis.  Scan back over the
  // punctuation tokens abutting the pronoun; a quote mark or sentence
  // punctuation among them disqualifies.  (Dashes and commas do NOT
  // disqualify — Dickinson's mid-clause capitals stand.)
  for (const x of [...words]
    .filter(p => p.absoluteIndex < w.absoluteIndex)
    .sort((a, b) => b.absoluteIndex - a.absoluteIndex)) {
    if (/[A-Za-z]/.test(x.word)) break;                  // reached a real word
    if (/["“”'‘’.!?:]/.test(x.word)) return false;       // conventional capital
  }
  // Mid-sentence only: some earlier alphabetic word must exist.
  return words.some(x => x.absoluteIndex < w.absoluteIndex && /[A-Za-z]/.test(x.word));
}

/** A POSTPOSED preposition: orphaned from its complement, which stands
 *  immediately to its LEFT as a wh-word — the inverted pied-piping of "what
 *  FOR is this form" (= "for what"), and the bare "Who WITH?", "Where FROM?".
 *  Such a preposition cannot procliticize (no rightward complement to lean on)
 *  and takes its STRONG form (Selkirk 1996: function words are weak only where
 *  they can cliticize onto a following host) — the same phonology as clause-
 *  final stranding, caught here in the wh-adjacent inversion the transitivity
 *  test misses.  Subordinators never match ("what if…" is a mark, not case),
 *  and neither does a preposition with a genuine rightward complement
 *  ("who for the WORLD would…", "when in ROME…" stay reduced). */
export function isPostposedPreposition(w: ClsWord, words: ClsWord[]): boolean {
  const pos = w.lexicalClass;
  const rel = w.canonicalRel ?? '';
  if (pos !== 'IN' && pos !== 'TO' && rel !== 'CASE') return false;
  if (rel === 'COMPMARK' || rel === 'ADVMARK') return false;
  const prev = words
    .filter(x => x.syllables.length > 0 && x.absoluteIndex < w.absoluteIndex)
    .sort((a, b) => b.absoluteIndex - a.absoluteIndex)[0];
  if (!prev || prev.absoluteIndex !== w.absoluteIndex - 1) return false;
  if (!/^(WDT|WP|WP\$|WRB)$/.test(prev.lexicalClass)) return false;
  // No genuine rightward complement: neither a following nominal governor (UD
  // attaches the prep as CASE dependent of the noun it precedes) nor a
  // following nominal/pronominal child.
  const gov = w.dependency?.governor;
  if (gov && !isPunct(gov) && (NOUN.test(gov.lexicalClass) || PRON.test(gov.lexicalClass)) &&
      gov.absoluteIndex > w.absoluteIndex) return false;
  if (words.some(d => d.dependency?.governor === w &&
      (NOUN.test(d.lexicalClass) || PRON.test(d.lexicalClass)) &&
      d.absoluteIndex > w.absoluteIndex)) return false;
  return true;
}

/** Subject–auxiliary INVERSION without interrogative force: the aux/modal
 *  precedes its clause's subject in a sentence that is NOT a question —
 *  optative "So, may then each moment drip off…" / "May she rest", negative
 *  inversion "Never did I see", conditional inversion "Had I known".  The
 *  inverted auxiliary is the overt exponent of the operator that triggered the
 *  inversion (wish / negation / condition — Krifka: illocutionary and polarity
 *  operators are accentable focus exponents), so it is NOT the reduced given-
 *  auxiliary of a plain declarative: it anchors a light beat ("HAD I but
 *  known", "never DID I see").  In a QUESTION the inversion is discharged by
 *  the interrogative operator instead (wh-word or final "?") and the aux stays
 *  reduced ("won't you GUIDE me…?", "do I have to BLESS?"). */
export function isInvertedOperatorAux(w: ClsWord, words: ClsWord[]): boolean {
  const rel = w.canonicalRel ?? '';
  if (rel !== 'AUX' && rel !== 'AUXPASS' && w.lexicalClass !== 'MD') return false;
  if (!/^(MD|VB)/.test(w.lexicalClass)) return false;
  const head = w.dependency?.governor;
  if (!head || head === w || isPunct(head)) return false;
  const subj = words.find(d => d.dependency?.governor === head &&
    /^(NSUBJ|NSUBJPASS)$/.test(d.canonicalRel ?? ''));
  if (!subj || subj.absoluteIndex < w.absoluteIndex) return false;  // normal order / imperative
  if (words.some(x => x.word.includes('?'))) return false;          // overt question
  const firstAlpha = words
    .filter(x => /[A-Za-z]/.test(x.word))
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex)[0];
  // A wh-fronted clause is interrogative even when verse carries the "?" on a
  // later line.
  if (firstAlpha && /^(WDT|WP|WP\$|WRB)$/.test(firstAlpha.lexicalClass)) return false;
  return true;
}

/** Semi-modal "have to" (necessity): have/has/had governing a TO-infinitive
 *  open complement with no intervening object — "do I have to bless", "we had
 *  to laugh".  This is the reduced ("hafta") functor use: under broad focus
 *  the whole chain subordinates and the beat belongs to the infinitive (or
 *  falls to the subject by alternation).  The LEXICAL uses keep full content
 *  stress and never match: possession with a purpose infinitive ("I have
 *  BOOKS to read" — the object intervenes, the infinitive is ACL on the
 *  noun), causative ("have him CALL me" — bare infinitive), existential /
 *  plain possession ("what do I HAVE here" — no infinitive at all).  A
 *  narrow/verum focus on the necessity itself ("Who do I HAVE to bless?") is
 *  a marked reading that needs a cue the text must supply — an all-caps HAVE
 *  is honored as that typographic cue. */
const HAVE_FORMS = new Set(['have', 'has', 'had', 'hath', 'having']);
export function isSemiModalHaveTo(w: ClsWord, words: ClsWord[]): boolean {
  if (!HAVE_FORMS.has(bare(w)) || !/^VB/.test(w.lexicalClass)) return false;
  if (/^[A-Z]{2,}$/.test(w.word)) return false;        // typographic narrow focus
  const kids = words.filter(d => d !== w && d.dependency?.governor === w);
  if (kids.some(d => /^(DOBJ|OBJ|IOBJ)$/.test(d.canonicalRel ?? ''))) return false;
  const comp = kids.find(d => /^(XCOMP|CCOMP)$/.test(d.canonicalRel ?? '') &&
    /^VB/.test(d.lexicalClass));
  if (comp) {
    const hasTo = words.some(m => m !== comp && m.dependency?.governor === comp &&
      (m.lexicalClass === 'TO' || bare(m) === 'to'));
    if (hasTo) return true;
  }
  // Parse-robust surface fallback: have + "to" + verb, immediately adjacent.
  const n1 = words.find(x => x.absoluteIndex === w.absoluteIndex + 1);
  const n2 = words.find(x => x.absoluteIndex === w.absoluteIndex + 2);
  if (n1 && (n1.lexicalClass === 'TO' || bare(n1) === 'to') &&
      n2 && /^VB/.test(n2.lexicalClass)) return true;
  return false;
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
