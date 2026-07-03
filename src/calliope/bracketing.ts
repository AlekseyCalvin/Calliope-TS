// calliope/bracketing.ts — cyclic Compound + Nuclear Stress Rules, extended with
// Wagner (2005) Ch. 6 functor/argument geometry (2026-06-29 Wagner/Krifka rebuild).
//
// This is the REAL phrase-stress stage McAleese (after Chomsky & Halle's SPE and
// Hayes 1984b) prescribes — NOT a left-to-right ramp.  It PROJECTS a constituent
// bracketing from the (UD-normalised) dependency tree, then runs the cyclic stress
// rules over it, innermost cycle out.  The classic SPE convention is:
//
//   • a COMPOUND combination (N+N / NOMD) → Compound Stress Rule: primary on the LEFT
//     element (SLATE roof, ICE cream);
//   • every other (phrasal) combination → Nuclear Stress Rule: primary on the RIGHT
//     element (the rightmost constituent of a phrase is its nuclear).
//
// Wagner refines WHICH sister wins at each cycle (the plan's Gaps 2–8):
//   • Complement Prominence (§6.2.2): the ARGUMENT outranks the FUNCTOR;
//   • the Prosodic Asymmetry (§6.1.3): a functor that FOLLOWS its argument is
//     obligatorily subordinated; one that PRECEDES may be on a par;
//   • the specifier restriction (§6.3.2): a BRANCHING functor (a transitive VP) does
//     not subordinate its subject — the two MATCH (co-nuclei);
//   • the modifier asymmetry (§6.5.1): a modifier that PRECEDES its modifiee gets its
//     OWN accentual domain (both project) — unlike an argument, which integrates;
//   • associative domains (§2.2.2): same-coordinator conjuncts MATCH (flat), not NSR.
//
// To express MATCH (two co-equal sisters, neither subordinated) the relational grid is
// generalised: each constituent carries a SET of designated terminal elements (dtes),
// and
//
//   level(w) = 1 + #{ enclosing constituents c : w ∈ c.words ∧ w ∉ c.dtes }
//
// A normal NSR/CSR cycle has a singleton dte (the winner's), so the formula still
// reproduces the canonical derivation
//   [Mary [ate [sweet [ice cream]]]]  →  Mary 2, ate 3, sweet 4, ice 1, cream 5
// (Krifka 2001 Table 17); a MATCH cycle co-designates BOTH sisters' dtes, so neither is
// demoted at that cycle (a branching subject + VP give two co-nuclei).
//
// Output is per-word `phraseStress` (1 = strongest, punctuation = 0): the structural
// prominence the relativiser then reads PER PHONOLOGICAL PHRASE to place beats.

import { ClsSentence, ClsWord } from '../types.js';
import {
  isPunct, isVerb, verbHasArgChild,
  isUnaccusativeOrPassive, isLowLocative, isFrameSetting, isLightNominalHead,
} from './syntax.js';

const NOUN = /^(NN|NNS|NNP|NNPS)$/;

/** A head-dependent combination is a COMPOUND (Compound Stress Rule → primary LEFT)
 *  when the parse labels it NOMD, or when a common-/proper-noun modifier sits
 *  immediately to the left of a noun head — the N+N compound the tagger routinely
 *  mislabels AMOD ("ICE cream", "SLATE roof", "BIRD nest"). */
function isCompound(dep: ClsWord, head: ClsWord): boolean {
  if ((dep.canonicalRel ?? '') === 'NOMD') return true;
  if ((dep.canonicalRel ?? '') === 'EXT') return false;
  return NOUN.test(dep.lexicalClass) && NOUN.test(head.lexicalClass)
    && Math.abs(dep.absoluteIndex - head.absoluteIndex) === 1;
}

interface Cons { words: ClsWord[]; dtes: ClsWord[]; }

function bare(w: ClsWord): string { return w.word.toLowerCase().replace(/['’]/g, ''); }

/** The coordinator lemma of a conjunct (its `cc` dependent), or null. */
function coordinatorLemma(conjunct: ClsWord, words: ClsWord[]): string | null {
  for (const w of words) {
    if (w.dependency?.governor === conjunct &&
        (w.canonicalRel === 'CC' || w.lexicalClass === 'CC')) {
      return bare(w);
    }
  }
  return null;
}

/** Is the coordination headed by `head` ASSOCIATIVE (all conjuncts share one
 *  coordinator: "old and gray and full") rather than ARTICULATED (mixed and/or)?
 *  Associative → MATCH (flat, Wagner §2.2.2 / Newman); articulated → NSR. */
function conjIsAssociative(
  head: ClsWord, children: Map<number, ClsWord[]>, words: ClsWord[],
): boolean {
  const conjuncts = (children.get(head.absoluteIndex) ?? [])
    .filter(c => (c.canonicalRel ?? '') === 'CONJ');
  if (conjuncts.length < 1) return true;
  const coords = conjuncts.map(c => coordinatorLemma(c, words)).filter(Boolean);
  if (coords.length === 0) return true;                        // no overt coordinator → flat
  return coords.every(c => c === coords[0]);
}

/** A child relation that makes a verb BRANCH — carry an internal argument.
 *  Used for the specifier-restriction trigger and for distinguishing a bare
 *  participle ("little boy lost" — no args, adjective-like) from a participial
 *  PHRASE ("gone in the teeth" — has an OBL, a real clause). */
const ARG_CHILD_LOCAL = new Set(['DOBJ', 'IOBJ', 'OBJ', 'OBL', 'CCOMP', 'XCOMP', 'ADVCL']);
function hasArgChildren(w: ClsWord, children: Map<number, ClsWord[]>): boolean {
  return (children.get(w.absoluteIndex) ?? []).some(c =>
    ARG_CHILD_LOCAL.has(c.canonicalRel ?? ''));
}

/** Decide which sister of a (dep, head) edge is the constituent's DTE — 'dep',
 *  'head', or 'match' (both co-designated).  Encodes Wagner's combination rules. */
function combineDecision(
  dep: ClsWord, head: ClsWord,
  children: Map<number, ClsWord[]>, words: ClsWord[],
): 'dep' | 'head' | 'match' {
  const rel = dep.canonicalRel ?? '';
  const depBefore = dep.absoluteIndex < head.absoluteIndex;
  const rightWins: 'dep' | 'head' = depBefore ? 'head' : 'dep';   // NSR rightmost
  const leftWins: 'dep' | 'head' = depBefore ? 'dep' : 'head';    // CSR leftmost

  // Compound Stress Rule first (handles the backwards-parsed N+N the tagger mislabels).
  if (isCompound(dep, head)) return leftWins;
  if (rel === 'EXT') return rightWins;                            // proper-name head (New YORK)

  switch (rel) {
    case 'NOMD':
      return leftWins;                                            // CSR: complement (N1) prominent
    case 'DOBJ': case 'IOBJ': case 'OBJ':
    case 'CCOMP': case 'XCOMP':
      return 'dep';                                               // argument is the DTE
    case 'OBL':
      // A post-nominal / post-adjectival oblique ("a friend OF him", "full OF
      // sleep") is a complement of its NON-verbal head and is subordinated to it
      // (the head stays the local nuclear).  Only a VERBAL oblique is an argument
      // / locative of the predicate.
      if (!isVerb(head)) return 'head';
      if (isLowLocative(dep, head, words)) return 'match';        // low locative → own accent
      if (isFrameSetting(dep, words)) return 'match';            // frame-setting → own domain
      return 'dep';                                               // oblique argument → DTE
    case 'NMOD':
      return 'head';                                              // post-nominal modifier subordinated
    case 'NSUBJ': case 'NSUBJPASS':
      if (verbHasArgChild(head, children)) return 'match';        // branching VP → specifier restriction
      if (isUnaccusativeOrPassive(dep, head)) return 'dep';       // underlying object → subject DTE
      return rightWins;                                           // unergative → verb (NSR) DTE
    case 'AMOD':
      return depBefore ? 'match' : 'head';                        // pre-modifier → own domain; post → subordinate
    case 'ADVMOD':
      if (/^JJ/.test(head.lexicalClass)) return 'head';           // degree adv ("very TALL") integrates
      return depBefore ? 'match' : 'head';                        // pre-adv → own domain; post → subordinate
    case 'ACL': case 'ADVCL':
      // A BARE participial acl (no argument children — "little boy lost",
      // "mission accomplished") is adjective-like: the NSR gives right-stress
      // (the participle is the nuclear: "little boy LOST").  A participial PHRASE
      // ("gone in the teeth") has arguments, so the HEAD NOUN stays the nuclear
      // and the participial phrase is subordinated to it ("old BITCH gone in the
      // teeth").
      if (!hasArgChildren(dep, children)) return 'dep';           // bare participle → NSR right-stress
      return 'head';                                              // participial phrase → head noun wins
    case 'CASE':
      return 'head';                                              // preposition subordinated to its noun
      // (the "OF him" differentiation — prep beat over a given pronoun — is set in
      //  relstress.ts, not here, so a function word never becomes the phrase nuclear)
    case 'AUX': case 'AUXPASS': case 'DET': case 'NUMMOD':
    case 'EXPL': case 'COMPMARK': case 'ADVMARK': case 'CC':
      return 'head';                                              // function-word functor subordinated
    case 'VPRT': case 'DISCOURSE': case 'INTJ':
      return 'match';                                             // particle / interjection keep accent
    case 'CONJ':
      return conjIsAssociative(head, children, words) ? 'match' : rightWins;
    default:
      return rightWins;                                           // NSR: rightmost wins
  }
}

/**
 * Run the cyclic Compound + Nuclear Stress Rules (Wagner-extended) over the
 * sentence's dependency tree and write each word's `phraseStress` (1 = strongest).
 */
export function computePhraseStress(sent: ClsSentence): void {
  for (const w of sent.words) if (isPunct(w)) w.phraseStress = 0;
  const words = sent.words.filter(w => !isPunct(w));
  if (words.length === 0) return;

  const childrenOf = new Map<number, ClsWord[]>();
  const roots: ClsWord[] = [];
  for (const w of words) {
    const gov = w.dependency?.governor;
    if (gov && !isPunct(gov) && gov !== w) {
      const arr = childrenOf.get(gov.absoluteIndex);
      if (arr) arr.push(w); else childrenOf.set(gov.absoluteIndex, [w]);
    } else {
      roots.push(w);
    }
  }

  const cons: Cons[] = [];
  const visited = new Set<ClsWord>();

  function combine(left: Cons, right: Cons, dep: ClsWord, head: ClsWord): Cons {
    const depBefore = dep.absoluteIndex < head.absoluteIndex;
    const depCons = depBefore ? left : right;
    const headCons = depBefore ? right : left;
    const decision = combineDecision(dep, head, childrenOf, words);
    let dtes: ClsWord[];
    if (decision === 'match') {
      dtes = [...left.dtes, ...right.dtes];
      // For an ASSOCIATIVE coordination, the conjunct HEAD words are all co-equal
      // accents (old / gray / full), even when a conjunct's own internal nuclear
      // differs ("full of sleep" → sleep) — so co-designate the conjunct heads too,
      // keeping the coordinate accents level instead of letting one sink.
      if ((dep.canonicalRel ?? '') === 'CONJ') {
        if (!dtes.includes(dep)) dtes.push(dep);
        if (!dtes.includes(head)) dtes.push(head);
      }
    } else if (decision === 'dep') {
      dtes = depCons.dtes;
    } else {
      dtes = headCons.dtes;
    }
    const c: Cons = { words: [...left.words, ...right.words], dtes };
    cons.push(c);
    return c;
  }

  function project(head: ClsWord): Cons {
    visited.add(head);
    let cur: Cons = { words: [head], dtes: [head] };
    const kids = (childrenOf.get(head.absoluteIndex) ?? []).filter(k => !visited.has(k));
    const left = kids.filter(k => k.absoluteIndex < head.absoluteIndex)
                     .sort((a, b) => b.absoluteIndex - a.absoluteIndex);   // closest-first
    const right = kids.filter(k => k.absoluteIndex > head.absoluteIndex)
                      .sort((a, b) => a.absoluteIndex - b.absoluteIndex);  // closest-first
    for (const d of right) cur = combine(cur, project(d), d, head);   // head LEFT,  dep RIGHT
    for (const d of left)  cur = combine(project(d), cur, d, head);   // dep  LEFT,  head RIGHT
    return cur;
  }

  roots.sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  let top: Cons | null = null;
  for (const r of roots) {
    if (visited.has(r)) continue;
    const pc = project(r);
    if (!top) {
      top = pc;
    } else {
      const c: Cons = { words: [...top.words, ...pc.words], dtes: pc.dtes };  // NSR: right root wins
      cons.push(c);
      top = c;
    }
  }

  // level(w) = 1 + #{ constituents c : w ∈ c.words ∧ w ∉ c.dtes }
  for (const w of words) {
    let demotions = 0;
    for (const c of cons) if (!c.dtes.includes(w) && c.words.includes(w)) demotions++;
    w.phraseStress = 1 + demotions;
  }

  // Accent-level clash reduction (Wagner §6.4.1): runs BEFORE the syllable-level
  // resolveStressClashes (relstress.ts) and is additional to it.  See below.
  reduceAccentClashes(words);
}

/** Accent-level clash reduction (Wagner §6.4.1).  Operates on which CONTENT words
 *  bear a phrasal accent (a local prominence), NOT on syllable stress.  A run of
 *  three-or-more SURFACE-ADJACENT content words (no intervening function word) that
 *  share the SAME phraseStress is a clash plateau: the last is the nuclear (never
 *  dropped), the first keeps its accent, and medial accents are thinned by the
 *  alternation rule (keep every other one).  Dropped accents are demoted one rung
 *  (phraseStress += 1), increasing contour differentiation without flattening.
 *
 *  This is deliberately narrow — it fires only on a true equal-prominence plateau —
 *  so ordinary verse, where the cyclic rules already differentiate, is untouched.
 *  The syllable-level resolveStressClashes still runs afterward for cross-φ
 *  abutments and the compound-pair special case. */
function reduceAccentClashes(words: ClsWord[]): void {
  const ordered = [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  let i = 0;
  while (i < ordered.length) {
    if (!ordered[i].isContent) { i++; continue; }
    // Maximal run of surface-adjacent content words (adjacent absolute indices).
    let j = i;
    while (j + 1 < ordered.length && ordered[j + 1].isContent &&
           ordered[j + 1].absoluteIndex === ordered[j].absoluteIndex + 1) {
      j++;
    }
    const run = ordered.slice(i, j + 1);
    if (run.length >= 3) {
      const minPs = Math.min(...run.map(w => w.phraseStress));
      const plateau = run.filter(w => w.phraseStress === minPs);
      // Only thin when MOST of the run sits on the same prominence (a real plateau).
      if (plateau.length >= 3) {
        // keep first and last; drop alternate medial members.
        for (let k = 1; k < plateau.length - 1; k++) {
          if (k % 2 === 1) plateau[k].phraseStress = minPs + 1;   // drop every other medial accent
        }
      }
    }
    i = j + 1;
  }
}

// ─── ϕ-domain derivation (the phonological-phrase grounding) ──────────────
//
// The phonological-phrase (ϕ) layer is derived from the SAME dependency
// constituent structure the cyclic stress rules use above — not from a parallel
// POS heuristic.  Two adjacent words share a ϕ iff the dependency edge between
// them is ϕ-INTERNAL; a new ϕ opens at every ϕ-PROJECTING edge.

const NOMINAL = /^(NN|NNS|NNP|NNPS)$/;
const COPULA = new Set(['am', 'is', 'are', 'was', 'were']);

function isCopula(w: ClsWord): boolean {
  return COPULA.has(w.word.toLowerCase().replace(/['’]/g, '')) && /^VB/.test(w.lexicalClass);
}

/** Does a nominal `dep` BRANCH — carry its own NOMINAL modifier?  An ADVERB child
 *  does NOT count. */
function branchesNominally(dep: ClsWord, children: Map<number, ClsWord[]>): boolean {
  return (children.get(dep.absoluteIndex) ?? []).some(c => {
    if (!c.isContent) return false;
    if (/^RB/.test(c.lexicalClass) || (c.canonicalRel ?? '') === 'ADVMOD') return false;
    return true;
  });
}

/** Does `dep`'s subtree open its OWN ϕ relative to its governor `head`? */
function phiProjects(
  dep: ClsWord, head: ClsWord, children: Map<number, ClsWord[]>, words: ClsWord[],
): boolean {
  switch (dep.canonicalRel ?? '') {
    case 'CCOMP': case 'XCOMP': case 'ADVCL': case 'CONJ':
      return true;
    case 'ACL':
      // A BARE participial acl ("little boy lost", "mission accomplished" — no
      // argument children) is adjective-like: it stays WITH its head noun in one
      // ϕ, and the NSR gives right-stress (LOST is the nuclear).  A participial
      // PHRASE ("gone in the teeth") has arguments and is a clause: it projects
      // its own ϕ, separate from the head noun.
      return hasArgChildren(dep, children);
    case 'OBL':
      // A verbal oblique is its own ϕ — EXCEPT an oblique whose governor is an
      // ACL (a participle): it is a complement of the participial phrase, not an
      // independent locative, so it stays INSIDE the ACL's ϕ ("gone in the teeth"
      // is one ϕ, not two).  This prevents the oblique from being stranded alone
      // while the participle projects separately.
      if ((head.canonicalRel ?? '') === 'ACL') return false;
      if (!isVerb(head)) return isLightNominalHead(head);       // post-nominal PP of a LIGHT
      //   head ("Something | for the modern stage") projects; of a FULL noun ("a mould
      //   in plaster") it does not — see the NMOD case for the same modifier asymmetry.
      if (isLowLocative(dep, head, words) || isFrameSetting(dep, words)) return true;
      return true;                                              // verbal oblique → own ϕ
    case 'NSUBJ': case 'NSUBJPASS':
      return NOMINAL.test(dep.lexicalClass);
    case 'DOBJ': case 'IOBJ': case 'OBJ':
      if (isCopula(head)) return false;
      return branchesNominally(dep, children);
    case 'NMOD':
      // A post-nominal PP modifier of a LIGHT head (a pronoun / inherently-given
      // indefinite — "Something | for the modern stage") opens its OWN ϕ: the head
      // is too light to host the modifier, so a real phrasing break falls after it
      // (Wagner §6.5.1).  A FULL lexical-noun head keeps its post-nominal PP as an
      // internal κ ("a mould in plaster" stays one ϕ), so this does not over-segment.
      return isLightNominalHead(head);
    default:
      return false;
  }
}

/**
 * Partition the sentence's words into ϕ-domains over the dependency tree.
 */
export function computePhiDomains(sent: ClsSentence): Map<ClsWord, number> {
  const words = sent.words.filter(w => !isPunct(w));

  const children = new Map<number, ClsWord[]>();
  for (const w of words) {
    const g = w.dependency?.governor;
    if (g && !isPunct(g) && g !== w) {
      const a = children.get(g.absoluteIndex);
      if (a) a.push(w); else children.set(g.absoluteIndex, [w]);
    }
  }

  const parent = new Map<number, number>();
  for (const w of words) parent.set(w.absoluteIndex, w.absoluteIndex);
  const find = (x: number): number => {
    while (parent.get(x)! !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; }
    return x;
  };
  const union = (a: number, b: number) => { parent.set(find(a), find(b)); };

  for (const w of words) {
    const g = w.dependency?.governor;
    if (!g || isPunct(g) || g === w) continue;
    if (!phiProjects(w, g, children, words)) union(w.absoluteIndex, g.absoluteIndex);
  }

  const dom = new Map<ClsWord, number>();
  for (const w of words) dom.set(w, find(w.absoluteIndex));
  return dom;
}
