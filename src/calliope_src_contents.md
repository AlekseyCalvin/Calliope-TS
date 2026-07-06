# LLM Context for

Generated on: 2026-07-02 20:25:55
Repository: `.`
Total files: 41

---

## Table of Contents

1. [caesura.ts](#caesurats)
2. [calliope/boundaries.ts](#calliopeboundariests)
3. [calliope/bracketing.ts](#calliopebracketingts)
4. [calliope/deps.ts](#calliopedepsts)
5. [calliope/engine.ts](#calliopeenginets)
6. [calliope/feats.ts](#calliopefeatsts)
7. [calliope/names.ts](#calliopenamests)
8. [calliope/postag.ts](#calliopepostagts)
9. [calliope/prosodic.ts](#calliopeprosodicts)
10. [calliope/relstress.ts](#callioperelstressts)
11. [calliope/stressrules.ts](#calliopestressrulests)
12. [calliope/syntax.ts](#calliopesyntaxts)
13. [calliope/udpos.ts](#calliopeudposts)
14. [clio/caesura.ts](#cliocaesurats)
15. [clio/depfix.ts](#cliodepfixts)
16. [clio/display.ts](#cliodisplayts)
17. [clio/engine.ts](#clioenginets)
18. [clio/parser.ts](#clioparserts)
19. [clio/phonological.ts](#cliophonologicalts)
20. [clio/phrasestress.ts](#cliophrasestressts)
21. [clio/pipeline.ts](#cliopipelinets)
22. [clio/rhyme.ts](#cliorhymets)
23. [clio/scandroid.ts](#clioscandroidts)
24. [clio/scansion.ts](#clioscansionts)
25. [clio/semantics.ts](#cliosemanticsts)
26. [clio/stress.ts](#cliostressts)
27. [clio/tagfix.ts](#cliotagfixts)
28. [depfix.ts](#depfixts)
29. [display.ts](#displayts)
30. [engine.ts](#enginets)
31. [index.ts](#indexts)
32. [parser.ts](#parserts)
33. [phonological.ts](#phonologicalts)
34. [phrasestress.ts](#phrasestressts)
35. [rhyme.ts](#rhymets)
36. [scandroid.ts](#scandroidts)
37. [scansion.ts](#scansionts)
38. [semantics.ts](#semanticsts)
39. [stress.ts](#stressts)
40. [tagfix.ts](#tagfixts)
41. [types.ts](#typests)

## caesura.ts

```typescript
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

import { ClsWord, IntonationalUnit } from './types.js';
import { isPunctuation } from './parser.js';
import { computeBoundaries } from './calliope/boundaries.js';

export type CaesuraKind = 'hard' | 'soft';

/** A caesura with its graded boundary strength (0..1, NSBR-scaled), so the display
 *  can colour the mark by how strong the underlying prosodic break is. */
export interface CaesuraInfo { kind: CaesuraKind; strength: number; }

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
export function computeCaesurae(words: ClsWord[], ius: IntonationalUnit[], scansion?: string): Map<number, CaesuraInfo> {
  const caes = new Map<number, CaesuraInfo>();
  // Graded boundary strength (Wagner Ch.4–5) keyed by syllable index, so each
  // caesura carries the strength of its underlying ϕ/ι break — used both to COLOUR
  // the mark and to gate strong-ϕ hard caesurae on a line-relative threshold.
  const bounds = computeBoundaries(words, ius);
  const strengthAt = new Map<number, number>();
  for (const b of bounds.phi) {
    const prev = strengthAt.get(b.syllableIndex) ?? 0;
    if (b.strength > prev) strengthAt.set(b.syllableIndex, b.strength);
  }
  const strOf = (syl: number): number => strengthAt.get(syl) ?? 0;
  const setHard = (syl: number) => caes.set(syl, { kind: 'hard', strength: Math.max(0.6, strOf(syl)) });
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
    if (isPunctuation(w.lexicalClass) || w.syllables.length === 0) {
      // A COMMA is an overt medial pause — the canonical caesura marker — but in
      // the Match-Theory hierarchy it is only a ϕ (minor) break, NOT an ι boundary
      // (dash/colon/semicolon DO project an ι, so those are caught by the IU test
      // below).  So detect a comma here directly: a comma after a contentful word,
      // landing on a foot edge, is a hard caesura.  (Without this, the comma→ϕ
      // reclassification silently dropped every comma caesura, taking pre-caesural
      // and caesural internal-rhyme detection with it.)
      if (prevWasContentful && (w.lexicalClass === ',' || w.word === ',')
          && (!footEdges || footEdges.has(cum))) {
        setHard(cum);
      }
      continue;
    }
    const iu = iuOf.get(w);
    if (prevIu !== undefined && iu !== undefined && iu !== prevIu
        && (!footEdges || footEdges.has(cum))) {
      setHard(cum);                      // IU boundary landing on a foot edge → hard caesura
    }
    // A phrase-onset word that is NOT the line's first word opens a candidate
    // caesura immediately before it.
    if (prevWasContentful && isPhraseOnset(w)) onsetPositions.push(cum);
    cum += w.syllables.length;
    prevIu = iu;
    prevWasContentful = true;
  }
  const total = cum;

  // STRONG-ϕ hard caesura (Wagner Ch.5): a ϕ boundary whose NSBR-scaled strength
  // clears a line-relative threshold — a major medial break after a long branching
  // phrase — is a hard caesura even without punctuation, provided it lands on a foot
  // edge and is medial.  Threshold is relative (strength is already line-normalised),
  // so a comma after a short phrase does NOT trigger one.
  if (total >= 8) {
    const lo = Math.max(2, Math.ceil(total / 3));
    const hi = Math.floor((2 * total) / 3);
    for (const b of bounds.phi) {
      const c = b.syllableIndex;
      if (c < lo || c > hi) continue;
      if (footEdges && !footEdges.has(c)) continue;
      if (caes.has(c)) continue;
      if (b.strength >= 0.75) caes.set(c, { kind: 'hard', strength: b.strength });
    }
  }

  // Infer ONE medial caesura only when the line carries no overt (hard) break.
  // Prefer the STRONGEST candidate boundary, tie-broken by nearness to the midpoint.
  if (caes.size === 0 && total >= 8 && onsetPositions.length > 0) {
    const mid = total / 2;
    const lo = Math.max(2, Math.ceil(total / 3));
    const hi = Math.floor((2 * total) / 3);
    let best = -1, bestStr = -1, bestDist = Infinity;
    for (const c of onsetPositions) {
      if (c < lo || c > hi) continue;                   // medial third only
      if (footEdges && !footEdges.has(c)) continue;     // align to a foot boundary
      const str = strOf(c);
      const d = Math.abs(c - mid);
      if (str > bestStr + 1e-6 || (Math.abs(str - bestStr) <= 1e-6 && d < bestDist)) {
        bestStr = str; bestDist = d; best = c;
      }
    }
    if (best > 0) caes.set(best, { kind: 'soft', strength: Math.max(0.25, bestStr) });
  }
  // A caesura is a MEDIAL pause: a line-terminal comma/IU close lands at the last
  // syllable (cum == total) and is the line break's own boundary, not a caesura.
  // Dropping it here keeps every consumer consistent — the detailed view used to
  // print a spurious trailing '‖' the reading view (correctly) never showed, and
  // the rhyme layer would have double-counted the end word as "pre-caesural".
  caes.delete(total);
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
    const info = caes.get(cum);
    if (info) out.push({ word: w, kind: info.kind });
  }
  return out;
}

```

## calliope/boundaries.ts

```typescript
// calliope/boundaries.ts — graded prosodic boundary strength (Wagner 2005 Ch. 4–5).
//
// The labelled κ/ϕ/ι hierarchy is the SKELETON; this module adds the relational
// FLESH Wagner argues the grid actually encodes — a graded boundary strength rather
// than a categorical label.  Each ϕ/ι boundary gets a strength scaled RELATIVE to the
// line's other boundaries (the NSBR, Normalized Scopally-determined Boundary Rank,
// Ch. 5 §5.3): the strongest boundary in the line is 1.0, the rest fall below it.
//
// The raw strength of a boundary between left unit A and right unit B combines:
//   • the categorical level (ι ≫ ϕ ≫ κ) — the SBR base rank;
//   • punctuation coincidence — a comma/dash/colon at the boundary makes it stronger;
//   • the LENGTH of the preceding constituent (a boundary after a long, branching
//     phrase is stronger — Wagner Ch. 5 look-back);
//   • clause separation — a boundary between subject|predicate or main|subordinate
//     clause (their dependency LCA is at/near the root) is stronger;
//   • associative coordination — a boundary internal to a same-coordinator series is
//     WEAKER (equal-rank, flat).
//
// Strength feeds (a) the colored bracket rendering (display.ts) and (b) caesura
// placement (caesura.ts): a hard caesura needs a boundary whose strength clears a
// line-relative threshold, not an absolute one.

import { ClsWord, IntonationalUnit } from '../types.js';

export interface BoundaryInfo {
  level: 'kappa' | 'phi' | 'iota';
  strength: number;   // 0..1, relative to the strongest boundary in the line (NSBR)
  raw: number;        // pre-normalisation raw score
  syllableIndex: number;  // cumulative content syllables to the boundary's left
}

export interface LineBoundaries {
  /** ϕ boundaries in document order: phi[k] is the boundary OPENING the k-th ϕ.
   *  phi[0] is the line's left edge (strength 0 — not a real internal break). */
  phi: BoundaryInfo[];
  /** ι boundaries in document order, same convention. */
  iota: BoundaryInfo[];
}

function isPunct(w: ClsWord): boolean {
  return /^[^A-Za-z0-9]+$/.test(w.lexicalClass) || w.syllables.length === 0;
}

/** Dependency depth of a word (number of governors up to the root). */
function depthOf(w: ClsWord, memo: Map<ClsWord, number>): number {
  const seen = new Set<ClsWord>();
  let d = 0;
  let cur: ClsWord | undefined = w;
  while (cur) {
    if (memo.has(cur)) { d += memo.get(cur)!; break; }
    if (seen.has(cur)) break;                       // cycle guard
    seen.add(cur);
    const g: ClsWord | undefined = cur.dependency?.governor;
    if (!g || g === cur || isPunct(g)) break;
    d++;
    cur = g;
  }
  memo.set(w, d);
  return d;
}

/** The syntactic head of a ϕ — the lowest-depth (closest to root) content token. */
function phraseHead(tokens: ClsWord[], memo: Map<ClsWord, number>): ClsWord | null {
  let best: ClsWord | null = null;
  let bestD = Infinity;
  for (const t of tokens) {
    if (isPunct(t)) continue;
    const d = depthOf(t, memo);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** Lowest-common-ancestor depth of two words in the dependency tree. */
function lcaDepth(a: ClsWord, b: ClsWord, memo: Map<ClsWord, number>): number {
  const anc = new Map<ClsWord, number>();
  let cur: ClsWord | undefined = a;
  let d = 0;
  const seen = new Set<ClsWord>();
  while (cur && !seen.has(cur)) {
    anc.set(cur, d++);
    seen.add(cur);
    const g: ClsWord | undefined = cur.dependency?.governor;
    if (!g || g === cur || isPunct(g)) break;
    cur = g;
  }
  cur = b;
  const seen2 = new Set<ClsWord>();
  while (cur && !seen2.has(cur)) {
    if (anc.has(cur)) return depthOf(cur, memo);
    seen2.add(cur);
    const g: ClsWord | undefined = cur.dependency?.governor;
    if (!g || g === cur || isPunct(g)) break;
    cur = g;
  }
  return 0;   // disjoint subtrees / different roots → treat as top-level (depth 0)
}

/** Is there a comma / dash / terminal punctuation token between A and B in surface
 *  order, and is it a strong (ι-class) one? */
function punctBetween(words: ClsWord[], a: ClsWord, b: ClsWord): { comma: boolean; strong: boolean } {
  let comma = false, strong = false;
  for (const w of words) {
    if (w.absoluteIndex <= a.absoluteIndex || w.absoluteIndex >= b.absoluteIndex) continue;
    if (!isPunct(w)) continue;
    if (w.word === ',' || w.lexicalClass === ',') comma = true;
    if (/^[.!?:;…]$/.test(w.word) || /^[.!?:;-]$/.test(w.lexicalClass) ||
        w.lexicalClass === '-LRB-' || w.lexicalClass === '-RRB-') strong = true;
  }
  return { comma, strong };
}

function sylCount(tokens: ClsWord[]): number {
  let n = 0;
  for (const t of tokens) n += t.syllables.length;
  return n;
}

/** Flatten the ϕ of an ι into token lists. */
function phiTokenLists(iu: IntonationalUnit): ClsWord[][] {
  return iu.phonologicalPhrases.map(pp =>
    pp.cliticGroups.flatMap(cg => cg.tokens).filter(t => !isPunct(t)));
}

/**
 * Compute graded boundary strength for every ϕ and ι boundary in a line.
 */
export function computeBoundaries(words: ClsWord[], ius: IntonationalUnit[]): LineBoundaries {
  const memo = new Map<ClsWord, number>();
  const maxDepth = Math.max(1, ...words.filter(w => !isPunct(w)).map(w => depthOf(w, memo)));

  // Flatten ϕ across all ι in document order, remembering each ϕ's ι index.
  const flatPhi: { tokens: ClsWord[]; iuIdx: number; ppIdx: number }[] = [];
  ius.forEach((iu, iuIdx) => {
    phiTokenLists(iu).forEach((tokens, ppIdx) => {
      if (tokens.length) flatPhi.push({ tokens, iuIdx, ppIdx });
    });
  });

  let cumSyl = 0;
  const phi: BoundaryInfo[] = [];
  const iota: BoundaryInfo[] = [];
  for (let k = 0; k < flatPhi.length; k++) {
    const cur = flatPhi[k];
    const prev = k > 0 ? flatPhi[k - 1] : null;
    const isIotaBoundary = !!prev && cur.iuIdx !== prev.iuIdx;

    let raw = 0;
    if (prev) {
      const aHead = phraseHead(prev.tokens, memo);   // left phrase head
      const bHead = phraseHead(cur.tokens, memo);    // right phrase head
      const aLast = prev.tokens[prev.tokens.length - 1];
      const bFirst = cur.tokens[0];
      // base rank by level
      raw += isIotaBoundary ? 3.0 : 1.0;
      // punctuation coincidence
      const p = punctBetween(words, aLast, bFirst);
      if (p.strong) raw += 2.0; else if (p.comma) raw += 1.2;
      // length of the preceding constituent (look-back): longer → stronger
      raw += Math.min(1.5, sylCount(prev.tokens) / 6);
      // clause separation: a shallow dependency LCA (near the root) → strong
      if (aHead && bHead) {
        const lca = lcaDepth(aHead, bHead, memo);
        raw += 1.2 * (1 - Math.min(1, lca / maxDepth));   // shallow LCA → +clause bonus
      }
      // associative coordination weakening: same coordinator across the boundary
      if (startsCoordinator(cur.tokens) && !p.comma && !p.strong) raw -= 0.4;
    }
    const info: BoundaryInfo = {
      level: isIotaBoundary ? 'iota' : 'phi',
      strength: 0,                                   // filled after normalisation
      raw: Math.max(0, raw),
      syllableIndex: cumSyl,
    };
    phi.push(info);
    if (isIotaBoundary) iota.push(info);
    cumSyl += sylCount(cur.tokens);
  }

  // NSBR normalisation: scale to the strongest boundary in the line (0..1).
  const maxRaw = Math.max(0, ...phi.map(b => b.raw));
  for (const b of phi) b.strength = maxRaw > 0 ? b.raw / maxRaw : 0;

  return { phi, iota };
}

function startsCoordinator(tokens: ClsWord[]): boolean {
  const t = tokens[0];
  return !!t && (t.lexicalClass === 'CC' || t.canonicalRel === 'CC');
}

```

## calliope/bracketing.ts

```typescript
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

```

## calliope/deps.ts

```typescript
// calliope/deps.ts — canonical dependency normalisation for the Calliope engine.
//
// en-parse emits a hybrid Stanford/UD label set, partly unreliable.  This pass
// writes a normalised Scenario relation onto `word.canonicalRel`, the label space
// the Match-Theory prosodic builder (Stage 2) and the Scenario A–O stress rules
// (Stage 3) read.  It is ADDITIVE — it never mutates the raw `dependency`, so the
// legacy/Clio passes see exactly the same parse as before.
//
// Where en-parse is reliable the mapping is a straight relabel; where it is not —
// the ditransitive DOBJ/IOBJ swap (probed: "gave John a book" → John=dobj,
// book=iobj, reversed), or N+N compounds it labels generic `dep` — POS and surface
// adjacency decide.  (Head-changing repairs — coordinate re-heading, fronted
// adverbial re-root, invocations — are handled where the prosodic builder needs
// them, Stage 2.)

import { ClsSentence, ClsWord } from '../types.js';

const NOUN = /^(NN|NNS|NNP|NNPS)$/;
const PROPER = /^(NNP|NNPS)$/;
const VERB = /^VB/;
const ADJ = /^JJ/;

function rawRel(w: ClsWord): string {
  return (w.dependency?.dependentType ?? '').toLowerCase();
}
function gov(w: ClsWord): ClsWord | undefined {
  return w.dependency?.governor;
}
/** w immediately precedes its head (a pre-head modifier — the N+N / Adj+N frame). */
function preHead(w: ClsWord, head: ClsWord): boolean {
  return w.absoluteIndex + 1 === head.absoluteIndex;
}

/** Populate `canonicalRel` for every word, then apply label-only repairs. */
export function normalizeDeps(sent: ClsSentence): void {
  for (const w of sent.words) w.canonicalRel = canonical(w);
  fixDitransitive(sent.words);
  inferPrenominalModifiers(sent.words);
}

/** Reliable structural relations whose label adjacency must NOT override. */
const STRUCTURAL = new Set([
  'ROOT', 'NSUBJ', 'NSUBJPASS', 'DOBJ', 'IOBJ', 'OBL', 'AUX', 'AUXPASS',
  'CCOMP', 'XCOMP', 'ADVCL', 'ADVMOD', 'AMOD', 'ACL', 'CC', 'CONJ', 'EXPL',
  'INTJ', 'DISCOURSE', 'VPRT', 'COMPMARK', 'ADVMARK', 'EXT',
]);

/**
 * Pre-head modifier inference by SURFACE ADJACENCY — independent of en-parse's
 * (often unreliable) head links.  An attributive adjective immediately before a
 * noun is AMOD; a noun immediately before a noun is a NOMD noun adjunct (or EXT
 * for a proper+proper name span).  This is what lets a POS-corrected adjective
 * (Pale/High/Green, demoted from a spurious NNP by `correctPosWithLexicon`) read
 * as the AMOD it is, rather than collapsing to a bare `dep`.  Only fills a word
 * whose current label is non-structural, so deliberate relations are preserved.
 */
function inferPrenominalModifiers(words: ClsWord[]): void {
  for (let i = 0; i + 1 < words.length; i++) {
    const w = words[i];
    const h = words[i + 1];
    if (w.absoluteIndex + 1 !== h.absoluteIndex) continue;   // surface-adjacent
    if (!NOUN.test(h.lexicalClass)) continue;                 // head is a noun
    if (STRUCTURAL.has(w.canonicalRel ?? '')) continue;       // keep real relations
    if (ADJ.test(w.lexicalClass)) {
      w.canonicalRel = 'AMOD';
    } else if (NOUN.test(w.lexicalClass)) {
      w.canonicalRel = PROPER.test(w.lexicalClass) && PROPER.test(h.lexicalClass) ? 'EXT' : 'NOMD';
    }
  }
}

function canonical(w: ClsWord): string {
  const rel = rawRel(w);
  const pos = w.lexicalClass;
  const g = gov(w);
  const gpos = g?.lexicalClass ?? '';

  switch (rel) {
    case 'root': return 'ROOT';
    case 'nsubj': return 'NSUBJ';
    case 'nsubjpass': case 'nsubj:pass': return 'NSUBJPASS';
    case 'csubj': return 'NSUBJ';
    case 'csubjpass': case 'csubj:pass': return 'NSUBJPASS';
    case 'dobj': case 'obj': return 'DOBJ';
    case 'iobj': return 'IOBJ';
    case 'aux': return 'AUX';
    case 'auxpass': case 'aux:pass': return 'AUXPASS';
    // UD oblique nominal (UDPipe emits `obl`; the old path used Stanford `pobj`).
    case 'obl': case 'obl:npmod': case 'obl:tmod': case 'obl:arg': return 'OBL';
    case 'cop': return 'AUX';                 // copula behaves prosodically like an auxiliary
    case 'ccomp': return 'CCOMP';
    case 'xcomp': return 'XCOMP';
    case 'advcl': return 'ADVCL';
    case 'advmod': return 'ADVMOD';
    case 'amod': return 'AMOD';
    case 'acl': case 'relcl': case 'acl:relcl': return 'ACL';
    case 'det': case 'predet': return 'DET';
    case 'nummod': return 'NUMMOD';
    case 'cc': return 'CC';
    case 'conj': return 'CONJ';
    case 'expl': return 'EXPL';
    case 'intj': return 'INTJ';
    case 'discourse': return 'DISCOURSE';
    case 'prt': case 'compound:prt': return 'VPRT';
    case 'case': return 'CASE';
    case 'poss': case 'possessive': case 'nmod:poss': return 'CASE';
    case 'prep': return 'CASE';               // the preposition itself cliticises
    case 'pobj': return 'OBL';                // object of a preposition → oblique
    case 'mark': return markType(w);          // complementiser vs adverbial subordinator
    case 'nmod':
      if (NOUN.test(pos) && g && NOUN.test(gpos) && preHead(w, g)) return 'NOMD';
      return 'OBL';
    case 'compound':
      return 'NOMD';
    case 'flat': case 'flat:name': case 'name':
      return 'EXT';
  }

  // Generic `dep` / unknown: infer from POS + adjacency.
  if (NOUN.test(pos) && g && NOUN.test(gpos) && preHead(w, g)) {
    // A proper-name span (both proper, adjacent) reads as an EXT extension; a
    // common-noun pre-modifier is a NOMD noun adjunct.
    return PROPER.test(pos) && PROPER.test(gpos) ? 'EXT' : 'NOMD';
  }
  if (ADJ.test(pos) && g && NOUN.test(gpos)) return 'AMOD';
  if (pos === 'RP') return 'VPRT';
  if (pos === 'CC') return 'CC';
  if (pos === 'DT' || pos === 'PDT') return 'DET';
  if (pos === 'CD') return 'NUMMOD';
  if (pos === 'IN' || pos === 'TO') return 'CASE';
  return rel ? rel.toUpperCase() : 'DEP';
}

/** A `mark` heads a complement clause (COMPMARK: to/that) or an adverbial clause
 *  (ADVMARK: as/when/because).  Decide by the governed clause's own relation. */
function markType(w: ClsWord): string {
  const clauseVerb = gov(w);
  const crel = clauseVerb ? rawRel(clauseVerb) : '';
  return crel === 'advcl' ? 'ADVMARK' : 'COMPMARK';
}

/** Ditransitive correction: a verb governing two bare objects N1 (precedes) N2 is
 *  often labelled N1=DOBJ N2=IOBJ — reversed.  The first post-verbal object is the
 *  recipient (IOBJ), the second the theme (DOBJ). */
function fixDitransitive(words: ClsWord[]): void {
  const byGov = new Map<ClsWord, ClsWord[]>();
  for (const w of words) {
    if (w.canonicalRel !== 'DOBJ' && w.canonicalRel !== 'IOBJ') continue;
    const g = gov(w);
    if (!g || !VERB.test(g.lexicalClass)) continue;
    const list = byGov.get(g);
    if (list) list.push(w); else byGov.set(g, [w]);
  }
  for (const objs of byGov.values()) {
    if (objs.length !== 2) continue;
    objs.sort((a, b) => a.absoluteIndex - b.absoluteIndex);
    objs[0].canonicalRel = 'IOBJ';
    objs[1].canonicalRel = 'DOBJ';
  }
}

```

## calliope/engine.ts

```typescript
// calliope/engine.ts — the "Calliope" engine: the faithful, default,
// syntax-driven prosody pipeline.  It derives the κ/ϕ/ι prosodic hierarchy and
// word prominence from a canonical, DepEdit-normalised dependency parse via the
// Scenario A–O relation-keyed stress rules and the corrected Match-Theory
// boundary map.
//
// Build status: STAGE 0 — the engine seam is in place but the per-sentence
// sequence is, for now, identical to the legacy ("Clio") one, so the default
// output is unchanged and the existing tests stay green.  Stages 1–4 progressively
// replace the body with: canonical deps (Stage 1) → Match-Theory hierarchy
// (Stage 2) → Scenario A–O stress (Stage 3) → phrase-stress ramp + relativise
// (Stage 4).  The legacy path remains untouched in `src/clio/engine.ts`.

import { ClsSentence, IntonationalUnit } from '../types.js';
import { assignLexicalStress, applySurfacePostProcessing, detectDisplayPrefixes, applyStressShift } from '../stress.js';
import { ProsodyEngine } from '../engine.js';
import { correctPosWithLexicon } from './postag.js';
import { tagNames } from './names.js';
import { parseFeats } from './feats.js';
import { normalizeDeps } from './deps.js';
import { buildProsodicHierarchy } from './prosodic.js';
import { computePhraseStress } from './bracketing.js';
import { computeRelativeStress } from './relstress.js';

function analyzeSentenceCalliope(sent: ClsSentence): IntonationalUnit[] {
  // ── Stage F1: reliable parse over the whole utterance (Calliope-only). ──
  // Correct spurious proper-noun tags via en-lexicon (Pale/High → JJ); type real
  // proper nouns as person/place names; normalise en-parse's hybrid relations into
  // the Scenario label space on word.canonicalRel (with surface-adjacency fallback
  // for pre-head modifiers).  Mutates the Calliope-only view of the parse; Clio,
  // invoked via --clio, never runs these and keeps its frozen reading.
  correctPosWithLexicon(sent);
  tagNames(sent);
  // Parse UD morphological FEATS (Number/VerbForm/Voice/PronType/Definite/Degree/…)
  // from lexicalDetails onto word.featsMap so the Wagner/Krifka stress + bracketing
  // refinements can read morphology.  Must precede normalizeDeps (which may consult it).
  parseFeats(sent);
  normalizeDeps(sent);

  // ── Stress path: lexical → genuine phrase stress → relative, per McAleese E4. ──
  // 1. Lexical stress (syllabification + word contour 0-3).
  // 2. κ/ϕ/ι hierarchy fixed over the whole utterance from the dependency relations.
  // 3. PHRASE STRESS: the genuine cyclic Compound + Nuclear Stress Rules over the
  //    dependency tree's constituent bracketing (bracketing.ts) — an integer
  //    prominence ranking (1 = strongest utterance nuclear), NOT a ramp.
  // 4. RELATIVE STRESS: the x/w/n/m/s contour DERIVED per φ from that phrase stress
  //    (the φ's lowest-phraseStress word is its beat), then clash-resolved.  The two
  //    layers are separate signals — global integer vs local contour — free to
  //    diverge.  (Replaces the legacy compound→nuclear→phrase→relativise chain, which
  //    Clio still runs.)
  assignLexicalStress(sent.words);
  // Display-only prefix detection: set `morphPrefix` on words whose productive
  // prefix + dictionary stem split would guide the display syllabifier to
  // respect the morpheme boundary (dis·il·lu·sions, un·ed·u·ca·ted).  Runs for
  // ALL words (in-vocab AND OOV), never affects stress or meter.
  detectDisplayPrefixes(sent.words);
  const ius = buildProsodicHierarchy(sent);
  // Stress Shift: swap primary↔secondary for words where Nounsing-Pro confirms
  // shiftLikely=true AND the context motivates it (imperative at phrase start or
  // Rhythm Rule clash).  Runs after hierarchy (needs PP-initial info) but before
  // phrase stress (so the shifted peak flows into the NSR ramp).
  applyStressShift(sent.words, ius);
  computePhraseStress(sent);
  computeRelativeStress(sent.words, ius);
  // Surface-order post-processing passes shared with the Clio engine: compound
  // forestress, lexicalised collocation forestress, hyphen-seam clash resolution,
  // residual linear clash resolution, and exclaimed-interjection raise.  These
  // re-assert forestress on surface-adjacent pairs the hierarchy-order passes may
  // miss (mis-grouped parses) and catch any residual equal-stress clashes.
  applySurfacePostProcessing(sent.words);
  return ius;
}

export const calliopeEngine: ProsodyEngine = {
  name: 'calliope',
  analyzeSentence: analyzeSentenceCalliope,
};

```

## calliope/feats.ts

```typescript
// calliope/feats.ts — parse UD morphological FEATS onto ClsWord (Phase 1 enabler).
//
// The parser stores the raw FEATS string ("Number=Sing|Person=3|Tense=Pres|
// VerbForm=Fin") on `word.lexicalDetails`, but no downstream module could read it:
// `udpos.ts:feat()` only sees the UDPipe-level `UDWord.featsMap` at parse time.  This
// pass parses `lexicalDetails` into `word.featsMap` ONCE, early in the Calliope
// pipeline, so the stress / bracketing / relativiser modules can key on morphology
// (VerbForm=Part → participle, Voice=Pass → underlying object subject, PronType=Prs →
// inherently given, Degree=Cmp → JJR, …).  Pure plumbing — it mutates only the
// additive `featsMap`, never the parse.

import { ClsSentence, ClsWord } from '../types.js';

/** Parse a UD FEATS string ("A=b|C=d") into a key→value record. */
function parseFeatsString(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split('|')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/** Populate `word.featsMap` for every word in the sentence from `lexicalDetails`. */
export function parseFeats(sent: ClsSentence): void {
  for (const w of sent.words) {
    if (w.featsMap) continue;                // already parsed (idempotent)
    w.featsMap = parseFeatsString(w.lexicalDetails);
  }
}

/** Read one morphological feature, undefined if absent.  Lazily parses on demand
 *  so callers reached before `parseFeats` still work. */
export function feat(w: ClsWord, key: string): string | undefined {
  if (!w.featsMap) w.featsMap = parseFeatsString(w.lexicalDetails);
  return w.featsMap[key];
}

/** True when a feature has the given value. */
export function featIs(w: ClsWord, key: string, value: string): boolean {
  return feat(w, key) === value;
}

```

## calliope/names.ts

```typescript
// calliope/names.ts — proper-NOUN (person) vs proper-NAME (place) typing via the
// `humannames` and `cities-list` membership lists.  These packages are JUST lists
// ({ "John": 1, … }), so this is a boolean enrichment, not a pipeline: it flags a
// token as a known person and/or place name to drive Scenario C (proper-name
// head-stress) and EXT.
//
// Lookups are GATED to proper-noun-tagged tokens (NNP/NNPS).  Both lists are huge
// (197k names, 79k cities) and overlap heavily with common words — "Will", "May",
// "Rose", "Sun", "York", "Reading" are all in them — so flagging an untyped token
// would be noise.  Restricting to NNP(S) keeps the signal honest.

import { createRequire } from 'module';
import { ClsSentence } from '../types.js';

const req = createRequire(import.meta.url);

function loadList(pkg: string): Record<string, number> {
  try {
    const m = req(pkg);
    return (m && typeof m === 'object' ? m : {}) as Record<string, number>;
  } catch {
    return {};
  }
}

export const PERSON = loadList('humannames');
export const PLACE = loadList('cities-list');
const PROPER = /^(NNP|NNPS)$/;

export function inList(list: Record<string, number>, surface: string): boolean {
  const key = surface.replace(/['’].*$/, '').replace(/[^A-Za-z-]/g, '');
  if (!key) return false;
  const cap = key[0].toUpperCase() + key.slice(1);
  return !!(list[key] || list[cap]);
}

/** Flag proper-noun tokens as person and/or place names (membership only). */
export function tagNames(sent: ClsSentence): void {
  for (const w of sent.words) {
    if (!PROPER.test(w.lexicalClass)) continue;
    if (inList(PERSON, w.word)) w.isPersonName = true;
    if (inList(PLACE, w.word)) w.isPlaceName = true;
  }
}

```

## calliope/postag.ts

```typescript
// calliope/postag.ts — Calliope-only POS correction via en-lexicon.
//
// THE BUG THIS FIXES: en-pos tags a capitalised line-initial common word as a
// proper noun ("Pale rain" → Pale/NNP, "High tide" → High/NNP), purely from the
// capital.  That mis-tag flips content class, derails the dependency parse, and —
// once relation-keyed stress is reintroduced — fore-stresses an adjective.
//
// en-lexicon (a CORE FinNLP module, the POS dictionary that en-pos/en-parse are
// built on) carries the true multi-role reading keyed on the LOWERCASE form:
//   lexicon['pale'] = "JJ|VBP|NN|VB"      (adjective first)
//   lexicon['Pale'] = "NNP|RB"            (the capitalised key is the trap)
//   lexicon['high'] = "JJ|NN|RB|RP"
// so consulting the lowercase entry recovers the real word class.
//
// This runs as the FIRST Calliope step — NOT in the shared `tagfix.ts`, because
// that seam feeds BOTH engines and would un-freeze Clio.  It corrects the ClsWord
// POS in place (Calliope's own pre-pass); Clio, invoked via `--clio`, never calls
// it and so keeps its frozen reading.  (It does not re-run en-parse; the κ/ϕ/ι
// builder downstream is built to be robust to residual head-attachment errors,
// and `normalizeDeps` re-derives `canonicalRel` from the corrected POS.)
//
// Discipline (anti-gaming): the demotion is gated so it can ONLY fire where the
// capital is uninformative (sentence/line-initial) and the word is demonstrably a
// common word, never a known or sequenced proper name.

import { createRequire } from 'module';
import { ClsSentence, ClsWord } from '../types.js';

const req = createRequire(import.meta.url);

function loadLexicon(): Record<string, string> {
  try {
    const m = req('en-lexicon');
    return (m && (m.lexicon ?? m)) as Record<string, string>;
  } catch {
    return {};
  }
}
const LEXICON = loadLexicon();

const PRONOUN_SUBJECT_CONTRACTIONS_LOCAL = new Set([
  "i'm", "i'll", "i've", "i'd",
  "you're", "you'll", "you've", "you'd",
  "he'll", "he'd", "he's", "she'll", "she'd", "she's", "it'll",
  "we're", "we'll", "we've", "we'd",
  "they're", "they'll", "they've", "they'd",
]);

const PROPER = /^(NNP|NNPS)$/;
const PUNCT = /^[^A-Za-z0-9]+$/;
// Content POS, matching parser.ts CONTENT_POS (kept local to avoid a cycle).
const CONTENT = new Set([
  'NN', 'NNS', 'NNP', 'NNPS', 'JJ', 'JJR', 'JJS',
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ', 'RB', 'RBR', 'RBS', 'CD',
]);
// Demotion is restricted to the ATTRIBUTIVE/NOMINAL common classes — the exact
// mis-as-proper class (pale→JJ, slate→NN).  A lowercase-primary that is a finite
// VERB (rose→VBD) is genuinely ambiguous sentence-initially, so we leave NNP
// rather than risk a wrong verb tag wrecking the parse.
const DEMOTE_TARGET = /^(JJ|JJR|JJS|NN|NNS)$/;

function bareLower(w: ClsWord): string {
  return w.word.toLowerCase().replace(/[^a-z]/g, '');
}
function isPunctTag(tag: string): boolean {
  return PUNCT.test(tag) || tag === '-LRB-' || tag === '-RRB-';
}

/**
 * Demote spurious proper-noun tags to their true common reading via en-lexicon.
 * Mutates `word.lexicalClass` / `word.isContent` in place for the Calliope engine.
 */
export function correctPosWithLexicon(sent: ClsSentence): void {
  const words = sent.words;

  // Index of the first non-punctuation word — the one whose capital is forced by
  // sentence/line position and therefore carries no proper-noun evidence.
  let firstContentIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (!isPunctTag(words[i].lexicalClass)) { firstContentIdx = i; break; }
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!PROPER.test(w.lexicalClass)) continue;

    // (a) The lowercase lexicon PRIMARY reading must be an attributive/nominal
    //     common word.  This — not name-list membership — is the real signal: the
    //     huge humannames/cities-list flag almost every capitalised common word
    //     ("Pale", "Slate", "Green" are all in them), so membership cannot gate
    //     here.  Genuinely proper words are protected instead: their lowercase
    //     entry is either absent (london, york) or proper-primary (reagan → NNP).
    const entry = LEXICON[bareLower(w)];
    if (!entry) continue;
    const primary = entry.split('|')[0];
    if (!DEMOTE_TARGET.test(primary)) continue;

    // (b) Caps must be uninformative: the token is the sentence/line-initial word,
    //     and it is NOT part of a proper-name sequence (a neighbour tagged NNP).
    if (i !== firstContentIdx) continue;
    const prev = i > 0 ? words[i - 1] : undefined;
    const next = i + 1 < words.length ? words[i + 1] : undefined;
    const adjacentProper =
      (prev && PROPER.test(prev.lexicalClass)) || (next && PROPER.test(next.lexicalClass));
    if (adjacentProper) continue;

    w.lexicalClass = primary;
    w.isContent = CONTENT.has(primary);
  }
}

// ─── UDPipe XPOS correction (the role en-pos + tagfix.ts played pre-UD) ──────
//
// UDPipe is trained on running prose and systematically MIS-TAGS terse,
// decontextualised verse fragments — it has no sentence context to lean on.
// Observed on the test corpus: "hat"→WP, "Woolen"→NNS, "gray"→VBP, "constantly"
// →NN, "slate"/"clay"→JJ, "bicycle"→NN.  The faithful downstream then scans the
// garbage.  en-pos avoided this because it is lexicon-backed; we restore that by
// cross-checking UDPipe's XPOS against en-lexicon's multi-role reading (AGENTS.md:
// "nounsing-pro / lexicon POS to aid FinNLP… cross-check").  HIGH PRECISION — it
// only overrides a tag the lexicon positively contradicts; an unknown word keeps
// UDPipe's tag.

/** Coarse word-class of a Penn tag (N/V/J/R), else the exact tag. */
function coarseClass(tag: string): string {
  if (/^(NN|NNS|NNP|NNPS)$/.test(tag)) return 'N';
  if (/^VB/.test(tag)) return 'V';
  if (/^JJ/.test(tag)) return 'J';
  if (/^RB/.test(tag)) return 'R';
  return tag;
}
const NOUN_TAG = /^(NN|NNS|NNP|NNPS)$/;

function retag(w: ClsWord, tag: string): void {
  w.lexicalClass = tag;
  w.isContent = CONTENT.has(tag);
  w.lexicalPlural = tag === 'NNS' || tag === 'NNPS';
}

/** Is the immediately-preceding non-punctuation word a subject pronoun? */
function prevIsSubjectPronoun(words: ClsWord[], i: number): boolean {
  for (let k = i - 1; k >= 0; k--) {
    if (isPunctTag(words[k].lexicalClass)) continue;
    const rel = (words[k].dependency?.dependentType ?? '').toLowerCase();
    return words[k].lexicalClass === 'PRP' && /nsubj/.test(rel);
  }
  return false;
}

/** Next non-punctuation word, or undefined. */
function nextContentful(words: ClsWord[], i: number): ClsWord | undefined {
  for (let k = i + 1; k < words.length; k++) {
    if (!isPunctTag(words[k].lexicalClass)) return words[k];
  }
  return undefined;
}

export function correctUDPipePos(sent: ClsSentence): void {
  const words = sent.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (isPunctTag(w.lexicalClass)) continue;

    // (0) CONTRACTED SUBJECT PRONOUNS: UDPipe/FinNLP often mis-tags
    //     "I'll", "I've", "I'd", "I'm" as JJ, NNP, or other content classes,
    //     giving them a spurious content beat. Correct them to PRP (personal
    //     pronoun) so they floor to 'w' or 'n' like other pronouns.
    const lowerWord = w.word.toLowerCase().replace(/[’]/g, "'");
    if (PRONOUN_SUBJECT_CONTRACTIONS_LOCAL.has(lowerWord)) {
      retag(w, 'PRP');
      continue;
    }

    // (0) POSSESSIVE clitic mis-tagged as a verb: UDPipe tags the genitive "'s"
    //     in "laugher's licence" as VBZ (confusing it with the copula "he's" = he
    //     is), giving the clitic a spurious content beat.  The genitive 's carries
    //     a `case` relation onto its possessor noun; the copula does not — so that
    //     relation distinguishes them.  Retag POS (0 syllables downstream).
    // (0) POSSESSIVE clitic mis-tagged as a verb: UDPipe sometimes tags the
    //     genitive "'s" (in "laugher's licence") as VBZ — confusing it with the
    //     copula "he's" = he is — giving the clitic a spurious content beat.  The
    //     genitive 's carries a `case` relation onto its possessor noun; the copula
    //     does not — so that relation distinguishes them.  Retag POS.
    if ((w.word === "'s" || w.word === "’s") && /^VB/.test(w.lexicalClass)
        && (w.dependency?.dependentType ?? '').toLowerCase() === 'case') {
      retag(w, 'POS');
      continue;
    }
    // The possessive ending itself is never corrected by the lexicon pass below
    // (en-lexicon has a spurious verb entry for the bare letter "s").
    if (w.lexicalClass === 'POS') continue;

    const lemma = bareLower(w);
    if (lemma.length <= 1) continue;                        // "s"/"a"/"o" → too ambiguous
    const entry = LEXICON[lemma];
    if (!entry) continue;                                   // unknown → trust UDPipe
    const classes = entry.split('|');
    const primary = classes[0];
    const lexCoarse = new Set(classes.map(coarseClass));
    const udCoarse = coarseClass(w.lexicalClass);
    const CONTENT_COARSE = new Set(['N', 'V', 'J', 'R']);

    // (1) PLAUSIBILITY: UDPipe's coarse class is absent from the lexicon entirely
    //     (hat→WP, Woolen→NNS, constantly→NN, clay→JJ) → fall back to the lexicon's
    //     primary reading.  Only fires on a positive contradiction AND only when the
    //     correction is TOWARD a content class (never invents a function tag).
    if (!lexCoarse.has(udCoarse) && CONTENT_COARSE.has(coarseClass(primary))
        && coarseClass(primary) !== udCoarse) {
      retag(w, primary);
      continue;
    }

    // (2) ATTRIBUTIVE NOUN mis-tagged JJ: a lexicon-primary noun UDPipe tagged JJ,
    //     sitting immediately before a noun, is the modifier of an N+N compound
    //     ("SLATE roof", "CLAY jar"), not an adjective.  Retag NN so the compound
    //     fore-stresses (deps.ts NOMD).
    if (/^JJ/.test(w.lexicalClass) && coarseClass(primary) === 'N') {
      const nxt = nextContentful(words, i);
      if (nxt && NOUN_TAG.test(nxt.lexicalClass) && nxt.absoluteIndex === w.absoluteIndex + 1) {
        retag(w, 'NN');
        continue;
      }
    }

    // (3) NOUN that should be a finite VERB: a lexicon-verb-capable common noun
    //     UDPipe tagged NN, immediately preceded by a SUBJECT PRONOUN ("they
    //     BICYCLE through", "we PAPER walls"), is the clause's predicate → VBP.
    if (NOUN_TAG.test(w.lexicalClass) && lexCoarse.has('V') && prevIsSubjectPronoun(words, i)) {
      retag(w, 'VBP');
      continue;
    }

    // (4) TEMPORAL ADVERB mis-tagged IN: "before"/"after"/"since"/"once" tagged IN
    //     but with no nominal complement before the next clause boundary is an
    //     adverb (RB), not a preposition.  Penn treebank: IN takes an NP
    //     complement ("before the storm"); RB does not ("never before", "long
    //     after").  A following verb/pronoun signals a subordinate clause ("before
    //     I go") → leave as IN (subordinating conjunction sense).
    const TEMPORAL_ADVS = new Set(['before', 'after', 'since', 'once']);
    if (w.lexicalClass === 'IN' && TEMPORAL_ADVS.has(lemma)) {
      let hasNoun = false, hasClauseStart = false;
      for (let k = i + 1; k < words.length; k++) {
        if (isPunctTag(words[k].lexicalClass)) break;
        if (NOUN_TAG.test(words[k].lexicalClass)) { hasNoun = true; break; }
        if (/^(VB|VBP|VBD|VBG|VBN|VBZ|PRP)$/.test(words[k].lexicalClass)) hasClauseStart = true;
      }
      if (!hasNoun && !hasClauseStart) {
        retag(w, 'RB');
        continue;
      }
    }
  }
}

```

## calliope/prosodic.ts

```typescript
// calliope/prosodic.ts — the Match-Theory prosodic hierarchy for Calliope.
//
// Builds the κ (clitic group) / ϕ (phonological phrase) / ι (intonational unit)
// structure from the canonical dependency relations and the REAL utterance
// boundaries — replacing the legacy builder (phonological.ts), which split an IU
// at every comma and grouped phrases off the constituent tree.  The corrections,
// per McAleese A1/A2 and the maintainer's critique:
//
//   ι  only at genuine intonational breaks: terminal punctuation (. ? !), colon,
//      semicolon, and parentheticals.  A plain COMMA is NOT an ι — it is a minor
//      ϕ break.  (This is the "utterance boundaries, not line breaks / not every
//      comma" fix.)
//   ϕ  at: a comma; the head of an oblique PP (a preposition opens a new phrase —
//      "…compare thee | to a summer's day"); each coordinate conjunct; a clause
//      complement (CCOMP/XCOMP/ADVCL); and the junction between a full nominal
//      SUBJECT and its predicate verb.
//   κ  a content head plus its function words by DIRECTION: determiners, case
//      markers/prepositions, auxiliaries, coordinators, complementisers, numerals,
//      possessives and (sub/obj) pronouns procliticise rightward onto the following
//      head; the possessive 's and verb particles encliticise leftward.  A trailing
//      proclitic with no head to its right attaches to the preceding group (so
//      "…compare thee" keeps the object pronoun in the verb's group).
//
// Output is the shared IntonationalUnit[] shape, so display/scansion are unchanged.
// It reads only POS + canonicalRel + surface order; it never mutates the parse.

import {
  ClsSentence, ClsWord, CliticGroup, PhonologicalPhrase, IntonationalUnit,
} from '../types.js';
import { computePhiDomains } from './bracketing.js';

// ─── punctuation → break kind ──────────────────────────────────────
const IU_PUNCT_TAGS = new Set(['.', '!', '?', ':', ';', '-LRB-', '-RRB-', '(', ')']);
const IU_PUNCT_WORDS = new Set(['.', '!', '?', '…', ':', ';', '(', ')']);

type BreakKind = 'iu' | 'phi' | null;
function breakKind(w: ClsWord): BreakKind {
  if (IU_PUNCT_TAGS.has(w.lexicalClass) || IU_PUNCT_WORDS.has(w.word)) return 'iu';
  if (w.lexicalClass === ',' || w.word === ',') return 'phi';
  return null; // other punctuation (quotes, etc.) — transparent to phrasing
}
function isAnyPunct(w: ClsWord): boolean {
  return /^[^A-Za-z0-9]+$/.test(w.lexicalClass) ||
    w.lexicalClass === '-LRB-' || w.lexicalClass === '-RRB-';
}

// ─── κ: directional cliticisation ──────────────────────────────────
const PROCLITIC_REL = new Set([
  'DET', 'CASE', 'AUX', 'AUXPASS', 'CC', 'COMPMARK', 'ADVMARK', 'NUMMOD', 'EXPL',
]);
const PROCLITIC_POS = /^(DT|PDT|IN|TO|CC|MD|WDT|WP|WP\$|EX|PRP\$|PRP)$/;

const OBJECT_REL = new Set(['DOBJ', 'IOBJ', 'OBL', 'OBJ']);

/** A clitic that leans LEFTWARD onto the preceding head (possessive 's, particle,
 *  OBJECT pronoun).  An object pronoun encliticises to its verb ("compare thee",
 *  "give me") — so it must NOT be pulled rightward into the next phrase, which is
 *  what buried the preposition in "…compare thee | to a summer's day". */
function isEnclitic(w: ClsWord): boolean {
  if (w.lexicalClass === 'POS' || w.lexicalClass === 'RP' || w.canonicalRel === 'VPRT') return true;
  if (w.lexicalClass === 'PRP' && OBJECT_REL.has(w.canonicalRel ?? '')) return true;
  return false;
}
/** A function word that leans RIGHTWARD onto the following content head. */
function isProclitic(w: ClsWord): boolean {
  if (w.isContent) return false;             // a promoted particle/demonstrative is a head
  if (isEnclitic(w)) return false;
  if (PROCLITIC_REL.has(w.canonicalRel ?? '')) return true;
  return PROCLITIC_POS.test(w.lexicalClass);
}

/** Build clitic groups over one IU segment's content/function words (no punct). */
function buildCliticGroups(words: ClsWord[]): CliticGroup[] {
  const groups: CliticGroup[] = [];
  let pending: ClsWord[] = [];               // proclitics awaiting their head
  for (const w of words) {
    if (isEnclitic(w) && groups.length > 0 && pending.length === 0) {
      groups[groups.length - 1].tokens.push(w);
      continue;
    }
    if (isProclitic(w)) { pending.push(w); continue; }
    // content head (or any non-clitic): open a CP with its pending proclitics.
    groups.push({ tokens: [...pending, w] });
    pending = [];
  }
  if (pending.length) {
    if (groups.length) groups[groups.length - 1].tokens.push(...pending);
    else groups.push({ tokens: pending });
  }
  return groups;
}

// ─── ϕ: phrase grouping (by dependency ϕ-domain) ───────────────────
// A ϕ boundary opens between two clitic groups when they fall in DIFFERENT
// ϕ-domains of the dependency tree (computePhiDomains, bracketing.ts) — the
// SAME constituent structure the cyclic stress rules use — replacing the old
// POS-keyed opensPhrase heuristic.  So a stranded particle no longer opens a
// spurious oblique ϕ ("thought of" stays together), a branching object NP gets
// its own ϕ (reading | the latest biography), and a clause does not flatten
// when its head is mis-tagged (the relations, not the POS, decide).

function rightmostContent(cg: CliticGroup): ClsWord | undefined {
  for (let i = cg.tokens.length - 1; i >= 0; i--) if (cg.tokens[i].isContent) return cg.tokens[i];
  return cg.tokens[cg.tokens.length - 1];
}

/** The ϕ-domain id a clitic group sits in: the domain of its head (rightmost
 *  content word, else last token); a function-only group falls back to any of
 *  its tokens' domains (its proclitics share the domain of the head they lean
 *  onto).  A new ϕ opens whenever this id changes between adjacent groups. */
function domainOf(cg: CliticGroup, dom: Map<ClsWord, number>): number {
  const head = rightmostContent(cg) ?? cg.tokens[cg.tokens.length - 1];
  const d = dom.get(head);
  if (d !== undefined) return d;
  for (const t of cg.tokens) { const dd = dom.get(t); if (dd !== undefined) return dd; }
  return -1;
}

/** Two PARSE-ROBUST ϕ-boundary markers from McAleese's Table-1 that the
 *  dependency-domain core cannot see when en-parse mis-attaches:
 *
 *   • a COORDINATOR (CC "and / or / but") — each coordinate conjunct is its own
 *     ϕ; en-parse often flattens "old and gray and full" into a list of AMODs,
 *     so the conj relation is gone, but the CC token survives reliably.
 *   • a RELATIVE PRONOUN (WDT/WP "that / which / who") — it opens the relative
 *     clause's ϕ; en-parse routinely fails to build the ACL ("…the cat that
 *     caught the rat" flattened into one clause), but the relativiser is tagged.
 *
 *  These are the two Table-1 triggers that survive attachment errors, so they
 *  supplement the dependency domains rather than re-introducing POS guesswork. */
function startsCoordOrRelative(cg: CliticGroup): boolean {
  const t = cg.tokens[0];
  if (!t) return false;
  if (t.lexicalClass === 'CC' || t.canonicalRel === 'CC') return true;
  return /^(WDT|WP|WP\$)$/.test(t.lexicalClass);
}

// A φ needs a stress-bearing ANCHOR to stand on its own.  A content word is the
// usual one, but the 'n'-tier function words — demonstratives, quantifiers, and
// wh-words (relstress.functionLevel → 'n') — also carry a real beat, so a phrase
// built around one ("for THAT", "to EACH", "by WHICH") is a genuine φ with a
// nuclear and must NOT be dissolved into a neighbour the way a pure article /
// preposition / pronoun run ("around it") is.  (Lemma/POS list mirrors relstress'
// 'n' category; kept local so the hierarchy layer does not depend on the stress one.)
const ANCHOR_LEMMAS = new Set([
  'this', 'that', 'these', 'those',
  'all', 'both', 'each', 'every', 'some', 'any', 'many', 'much', 'few', 'most',
  'half', 'several', 'either', 'neither', 'enough', 'none',
]);
const ANCHOR_POS = /^(PDT|WDT|WP|WP\$|WRB)$/;
function canAnchorBeat(pp: PhonologicalPhrase): boolean {
  return pp.cliticGroups.some(cg => cg.tokens.some(t =>
    t.isContent ||
    /^VB/.test(t.lexicalClass) ||        // a verb group ("has been") is a real ϕ even
                                          // when its tokens are non-content auxiliaries —
                                          // it must not fold back into the subject NP
    ANCHOR_LEMMAS.has(t.word.toLowerCase().replace(/['’]/g, '')) ||
    ANCHOR_POS.test(t.lexicalClass)));
}

function groupIntoPhrases(
  cgs: CliticGroup[], commaBeforeCG: Set<CliticGroup>, dom: Map<ClsWord, number>
): PhonologicalPhrase[] {
  const phrases: { cgs: CliticGroup[]; commaPreceded: boolean }[] = [];
  let current: CliticGroup[] = [];
  let prev: CliticGroup | null = null;
  let currentCommaPreceded = false;
  for (const cg of cgs) {
    const brk = current.length > 0 && prev !== null &&
      (commaBeforeCG.has(cg) || startsCoordOrRelative(cg) ||
       domainOf(cg, dom) !== domainOf(prev, dom));
    if (brk) {
      phrases.push({ cgs: current, commaPreceded: currentCommaPreceded });
      current = [];
      currentCommaPreceded = commaBeforeCG.has(cg);
    }
    current.push(cg);
    prev = cg;
  }
  if (current.length) phrases.push({ cgs: current, commaPreceded: currentCommaPreceded });

  // A ϕ must have a beat-anchor: a phrase of only un-anchored function words (a
  // stranded preposition + pronoun like "around it", an orphan determiner) has no
  // nuclear to carry a beat, so it MERGES into its neighbour — into the previous
  // phrase when there is one (it leans back onto the head it modifies), else the
  // next.  A phrase anchored by a demonstrative/quantifier/wh ("for THAT") is NOT
  // merged — it is a genuine φ.
  //
  // BUT: a phrase preceded by a COMMA is NEVER merged, even if it lacks a
  // beat-anchor.  A comma is an OVERT prosodic boundary the poet placed; merging
  // across it destroys the boundary and flattens the post-comma material into the
  // pre-comma phrase ("among them" after "And of the best," → xww instead of xnw).
  // A function-word-only post-comma phrase keeps its separate ϕ so the
  // relativiser can apply the phrase-initial beat and the givenness escape.
  const merged: PhonologicalPhrase[] = [];
  for (const p of phrases) {
    const pp: PhonologicalPhrase = { cliticGroups: p.cgs };
    if (!canAnchorBeat(pp) && merged.length > 0 && !p.commaPreceded) {
      merged[merged.length - 1].cliticGroups.push(...p.cgs);
    } else {
      merged.push(pp);
    }
  }
  // A leading un-anchored phrase folds forward into the next — but NOT if it was
  // comma-preceded (a comma before the first phrase would be line-initial, which
  // doesn't happen; this guard is for safety).
  if (merged.length >= 2 && !canAnchorBeat(merged[0]) && !phrases[0].commaPreceded) {
    merged[1].cliticGroups.unshift(...merged[0].cliticGroups);
    merged.shift();
  }
  return merged;
}

// ─── top level ─────────────────────────────────────────────────────
export function buildProsodicHierarchy(sent: ClsSentence): IntonationalUnit[] {
  // ϕ-domains over the dependency tree (the same constituent structure the
  // cyclic stress rules use) — the grouping signal for phonological phrases.
  const dom = computePhiDomains(sent);

  const ius: IntonationalUnit[] = [];
  let segWords: ClsWord[] = [];
  let commaAfterPos = new Set<number>();      // positions in segWords with a comma after

  const flush = () => {
    if (segWords.length === 0) { commaAfterPos = new Set(); return; }
    // A φ-break (comma) is a HARD boundary for clitic-group formation: a proclitic
    // must not lean across a comma onto a head in the next phrase.  (Letting it do
    // so silently glued "for that ," onto the following "a specialized branch" — both
    // "for" and "that" procliticise rightward onto "specialized" — so the comma fell
    // INSIDE one clitic group and the φ-break was lost.)  So we split the IU segment
    // into RUNS at the comma positions, build clitic groups WITHIN each run, and mark
    // the first CG of every run after the first as φ-preceded.
    const runs: ClsWord[][] = [];
    let run: ClsWord[] = [];
    segWords.forEach((w, i) => {
      run.push(w);
      if (commaAfterPos.has(i)) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);

    const cgs: CliticGroup[] = [];
    const commaBeforeCG = new Set<CliticGroup>();
    runs.forEach((r, ri) => {
      const rcgs = buildCliticGroups(r);
      if (ri > 0 && rcgs.length > 0) commaBeforeCG.add(rcgs[0]);
      cgs.push(...rcgs);
    });
    ius.push({ phonologicalPhrases: groupIntoPhrases(cgs, commaBeforeCG, dom) });
    segWords = [];
    commaAfterPos = new Set();
  };

  for (const w of sent.words) {
    const kind = breakKind(w);
    if (kind === 'iu') { flush(); continue; }
    if (kind === 'phi') { if (segWords.length) commaAfterPos.add(segWords.length - 1); continue; }
    if (isAnyPunct(w)) continue;              // transparent punctuation
    segWords.push(w);
  }
  flush();
  return ius;
}

```

## calliope/relstress.ts

```typescript
// calliope/relstress.ts — per-phonological-phrase relative stress for Calliope.
//
// This is the corrected relativisation McAleese A2 step 1b prescribes —
// "determine the relative stresses in EACH PP (w / n / m / s)" — and the direct
// answer to the maintainer's critique of the old pipeline (everything defaulting
// high, per-word boosts stacking linearly into adjacent reds, function words
// flattened into long w-runs).
//
// Principles:
//   • Default is LOW.  Each word's prominence is RAISED only with motivation.
//   • Within a PP there is ONE nuclear peak (s) — the φ's MOST PROMINENT word per the
//     genuine phrase stress (lowest `phraseStress`, the Compound + Nuclear Stress
//     Rules computed in bracketing.ts).  Other content words are subordinate (m); the
//     rest ramp DOWN — nothing is boosted past the peak.
//   • FUNCTION words take a category gradient, never a flat run:
//        preposition / article / coordinator / complementiser  → x  (zero-provision)
//        possessive / personal pronoun / auxiliary / modal      → w  (overt weak)
//        quantifier / demonstrative / wh-word / negator          → n  (some stress)
//     so "of all my days" reads x · n · w · s  (of < my < all < days).
//   • Compound fore-stress (SLATE roof, ICE cream) needs NO special case here: the
//     Compound Stress Rule already gave the compound's LEFT element the lower
//     phraseStress, so it wins the φ nuclear automatically.
//   • The clash invariant is preserved: no two adjacent syllables share n / m / s
//     (w and x may repeat); the less-prominent of a clashing pair is demoted.
//
// This stage DERIVES the symbolic contour FROM the integer phrase stress, per φ — but
// the two remain SEPARATE material signals: the integer ranking is global (one
// utterance nuclear), the symbolic contour is local (one beat per φ) and then
// modified (clash resolution), so they legitimately diverge — never forced equal.

import { ClsWord, IntonationalUnit, StressLevel, Syllable } from '../types.js';
import { collectPPTokens } from '../phonological.js';
import { isTransitiveFunctionWord, isPronoun, isInherentlyGiven } from './syntax.js';

const RANK: Record<StressLevel, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const LEVELS: StressLevel[] = ['x', 'w', 'n', 'm', 's'];

const CONTENT = /^(NN|NNS|NNP|NNPS|JJ|JJR|JJS|VB|VBD|VBG|VBN|VBP|VBZ|RB|RBR|RBS|CD|UH)$/;

const ARTICLES = new Set(['a', 'an', 'the']);
const QUANTIFIERS = new Set([
  'all', 'both', 'each', 'every', 'some', 'any', 'many', 'much', 'few', 'no',
  'most', 'half', 'several', 'either', 'neither', 'enough',
]);
const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those']);
// "no" is a NEGATOR, not a reducible determiner: "made with NO loss of time" keeps
// a beat on "no".  Listed here (ahead of the rel==='DET' → x floor in functionLevel)
// so the negative determiner is never flattened to the clitic tier.
const NEGATORS = new Set(['not', 'never', "n't", 'nor', 'no']);
// "be" reduces in the contour even as a copula ("the sky is BLUE").  "have"/"do"
// reduce only as AUXILIARIES — as main verbs ("the woods HAVE it", "DO your
// work") they are full content, so they are gated on the AUX relation below.
const BE_FORMS = new Set(['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being']);
// Aphaeresis clitics: "'tis"/"'twas" = it+is / it+was, weak pronoun+copula clipped
// to a single proclitic syllable — never a stressed content peak (en-pos mis-tags
// the capitalised "'Tis" as NNP).  Apostrophes already stripped by bare().
const APHAERESIS = new Set(['tis', 'twas', 'twere', 'twill', 'twould', 'tisnt']);

function bare(w: ClsWord): string {
  return w.word.toLowerCase().replace(/['’]/g, '');
}
function isAphaeresis(w: ClsWord): boolean { return APHAERESIS.has(bare(w)); }
function isContent(w: ClsWord): boolean {
  return CONTENT.test(w.lexicalClass) && !isAphaeresis(w);
}
function isReducedVerb(w: ClsWord, words?: ClsWord[]): boolean {
  if (isAphaeresis(w)) return true;
  const rel = w.canonicalRel ?? '';
  // "to be" (infinitive main verb) and ROOT be-forms ("Where WAS I?",
  // "I have BEEN") carry a beat — NOT reduced.  Must check BEFORE the AUX
  // gate because UD maps cop→AUX, so "to be" has canonicalRel='AUX'.
  if (BE_FORMS.has(bare(w)) && /^(VB|VBD|VBG|VBN|VBP|VBZ)$/.test(w.lexicalClass)) {
    if (words) {
      const prev = words
        .filter(x => x.syllables.length > 0 && x.absoluteIndex < w.absoluteIndex)
        .sort((a, b) => b.absoluteIndex - a.absoluteIndex)[0];
      if (prev && (prev.canonicalRel === 'COMPMARK' || prev.lexicalClass === 'TO'))
        return false;
    }
    if (rel === 'ROOT') return false;
  }
  if (rel === 'AUX' || rel === 'AUXPASS') return true;   // true auxiliary reduces
  // copular "be" after a function word with a predicate reduces; "have"/"do" as
  // MAIN verbs do not
  return BE_FORMS.has(bare(w)) && /^(VB|VBD|VBG|VBN|VBP|VBZ)$/.test(w.lexicalClass);
}

/** Intrinsic prominence of a FUNCTION word — the category gradient.  `words` (the
 *  whole line) lets the transitivity test (Wagner §6.5.5) see a preposition's
 *  complement: only a COMPLEMENT-TAKING (transitive) preposition has the reduced
 *  'x' allomorph; a STRANDED or adverbial-particle preposition keeps a beat. */
function functionLevel(w: ClsWord, words: ClsWord[]): StressLevel {
  const lemma = bare(w);
  const pos = w.lexicalClass;
  const rel = w.canonicalRel ?? '';
  // A quantifier / demonstrative in an ATTRIBUTIVE determiner slot ("each street",
  // "this cat", "that day") is a reduced determiner (x), NOT a standalone n-tier
  // quantifier.  Only the determiner USE reduces — a predeterminer ("ALL the",
  // PDT/det:predet) and a standalone quantifier/demonstrative ("EACH of them",
  // "THIS is…", rel ≠ det) keep their 'n'.  This is what lets a ϕ-initial
  // preposition's beat ("through", "in") outrank an interior "each".
  if (rel === 'DET' && pos !== 'PDT' && !NEGATORS.has(lemma)) return 'x';
  // n — quantifiers, demonstratives, wh-words, negators (carry real stress)
  if (pos === 'PDT' || QUANTIFIERS.has(lemma) || DEMONSTRATIVES.has(lemma) ||
      NEGATORS.has(lemma) || /^(WDT|WP|WP\$|WRB)$/.test(pos)) return 'n';
  // "out of" is a compound preposition with fixed stress on "out" (OUT of, not
  // out OF).  "out" carries the directional content; "of" is the grammatical
  // linker that floors to 'x'.  Raise "out" to 'n' so it outranks a preceding
  // unstressed syllable (the "-ter" of "laughter") and differentiates the contour
  // ("laughter OUT of" → s w n x, not flat s w w x).  Only fires when "of"
  // immediately follows — a stranded/particle "out" ("coming OUT") is handled by
  // the transitivity check below and keeps its own beat.
  if (lemma === 'out') {
    const next = words.find(x => x.absoluteIndex === w.absoluteIndex + 1);
    if (next && bare(next) === 'of') return 'n';
  }
  // A STRANDED / intransitive preposition ("what are you waiting FOR", "she walked
  // IN") is NOT the reducible proclitic of "in the house" — Wagner §6.5.5: only
  // transitive functors have the weak allomorph.  It keeps an overt beat ('w'), so
  // the metrical fitter can promote it; a TRANSITIVE preposition floors at 'x'.
  if (pos === 'IN' || pos === 'TO' || rel === 'CASE') {
    return isTransitiveFunctionWord(w, words) ? 'x' : 'w';
  }
  // x — pure clitics: articles, coordinators, complementisers
  if (ARTICLES.has(lemma) || pos === 'CC' || rel === 'CC' || rel === 'COMPMARK') return 'x';
  // w — possessives, pronouns, auxiliaries, modals, leftover determiners
  return 'w';
}

/** The peak (highest lexical-stress) syllable of a word. */
function peakSyllable(w: ClsWord): Syllable | null {
  let best: Syllable | null = null;
  let bestV = -1;
  for (const s of w.syllables) {
    const v = s.lexicalStress ?? s.stress;
    if (v > bestV) { bestV = v; best = s; }
  }
  return best;
}

/** Paint every syllable of a word given the level assigned to its peak.
 *
 *  The within-word contour preserves the LEXICAL gradient primary > secondary >
 *  unstressed (Nounsing's CMU stress → lexicalStress 2 = primary, 1 = secondary,
 *  0 = unstressed).  Crucially a SECONDARY stress is a REAL stress and must land
 *  STRICTLY ABOVE this word's own unstressed floor — never collapsed flat onto it.
 *  Hayes' stress-maximum theory: a polysyllable's internal contour (which syllables
 *  bear primary, secondary, or no stress) is a fixed lexical fact, not a position to
 *  be overwritten — "ac·CEL·er·AT·ed" must keep its EY2 secondary distinct from the
 *  truly toneless syllables around it, in a non-nuclear word (peak = m) exactly as
 *  much as in a nuclear one.
 *  peak → level; a co-primary (another lexicalStress-2 syllable) sits just below the
 *  peak; a secondary (lexicalStress 1) sits ONE TIER ABOVE this word's floor — 'n' if
 *  the floor is 'w' (a content word: ti in for·TI·tude is 'w', so tude's secondary
 *  clears it at 'n'), or 'w' if the floor is 'x' (a reduced function word: der in
 *  UNDER·neath is 'x', so un's secondary clears it at 'w', not flattened to 'x') —
 *  capped below the peak and at 'n' (the canonical non-peak ceiling); unstressed
 *  syllables sit AT the floor. */
function paintWord(w: ClsWord, level: StressLevel): void {
  const peak = peakSyllable(w);
  const peakRank = RANK[level];
  const floorRank = w.isContent ? RANK.w : RANK.x;   // unstressed floor for this word
  for (const s of w.syllables) {
    if (s === peak) { s.relativeStress = level; continue; }
    const lv = s.lexicalStress ?? s.stress;
    let r: number;
    if (lv >= 2) {
      r = peakRank - 1;                              // co-primary: just below the peak
    } else if (lv === 1) {
      // SECONDARY stress → one tier ABOVE this word's floor (never flattened onto
      // it), never reaching the peak, never exceeding 'n'.
      r = Math.min(floorRank + 1, peakRank - 1, RANK.n);
    } else {
      r = Math.min(floorRank, peakRank);             // unstressed (≤ peak for reduced words)
    }
    s.relativeStress = LEVELS[Math.max(0, Math.min(r, peakRank))];
  }
}

/** Relativise one phonological phrase by READING the genuine phrase stress.
 *
 *  The cyclic Compound + Nuclear Stress Rules (bracketing.ts) already ranked every
 *  word with an integer (1 = strongest).  Within a φ:
 *    • the lowest-ranked content word is the NUCLEAR (s) — and because the Compound
 *      Stress Rule fore-stressed a compound's LEFT element (lower integer), the
 *      compound peak falls out here for free (SLATE roof, ICE cream);
 *    • every other content word is a SECONDARY BEAT (m) — kept flat, NOT ramped to a
 *      trough, so the alternating beats that metrical verse needs stay visible (a
 *      ramp here flattened Hiawatha's "shores"/"Gitche" into non-beats → mis-meter);
 *    • the FINE gradient the maintainer asked for (ICE > cream, not a flat tie) is
 *      produced where content ABUTS, by clash resolution that breaks the tie with the
 *      phrase-stress integer — the less-prominent (higher-integer) member of two
 *      adjacent beats is the one demoted (so ICE ps2 keeps the beat, cream ps3 drops).
 *
 *  Two anchored beats per φ, per Kiparsky's "beginnings free, endings strict"
 *  (McAleese pp.34–35, Hayes & Kaun 1996 — the procedure reads the stresses at the
 *  END of each unit, but the LEFT edge carries a lighter beat too):
 *    • ENDING (strict): the rightmost lowest-ranked content word → the nuclear s.
 *    • BEGINNING (free, light): a φ-initial PREPOSITION rises x→w — the subtle
 *      left-edge beat the maintainer hears on "…working | IN the house" and that lets
 *      "…through | each…" read through(w) > each(x).  Articles, pronouns, auxiliaries
 *      and coordinators do not rise. */
function relativisePP(toks: ClsWord[], words: ClsWord[]): void {
  if (toks.length === 0) return;
  // A DISCOURSE-GIVEN content word (repeated from an earlier line of the stanza) is
  // subordinated relative to its sister (Wagner Ch.7) — but only as an ANCHOR
  // demotion, and never when it would empty the φ of content.  A word given a higher
  // (worse) effective phrase-stress is less likely to win the φ nuclear.
  const ps = (w: ClsWord) => {
    const base = w.phraseStress || Infinity;
    // A given content word — discourse-given (repeated from an earlier line), an
    // inherently-given indefinite pronoun ("something", Wagner §7.2.3), or
    // anaphorically given via a shared-head coordinate structure ("young blood
    // and high blood" → the second "blood") — is less likely to win the φ
    // nuclear, so a heavier sister in the SAME φ takes the beat.
    const given = isContent(w) && (w.discourseGiven || isInherentlyGiven(w) || w.coordinateGiven);
    return given ? base + 2 : base;
  };

  // Pronoun promotion (Nuclear Stress Rule + trochaic inversion): a simple personal
  // pronoun (PRP with no apostrophe) at the start of the φ gets promoted to an
  // anchor if it is syntactically prominent (phraseStress === 1) and its following
  // verb in the φ is a function/light verb (have, has, had, do, etc.) with weaker
  // phraseStress (phraseStress > 1).  This captures the trochaic inversion in
  // "I have no right" (I=1, have=3 → I wins the beat, have reduces) while
  // sparing contractions ("I'll", "I'm") and pronouns preceding lexical content
  // verbs ("I would give" → give is lexical, so I does NOT promote).
  const promotePronoun = (w: ClsWord) => {
    if (w.lexicalClass !== 'PRP' || w.word.includes("'") || w.word.includes("’")) return false;
    if (w.phraseStress !== 1) return false;
    const idx = toks.indexOf(w);
    if (idx !== 0) return false;
    const nextVerb = toks.slice(1).find(x => /^VB/.test(x.lexicalClass));
    if (!nextVerb) return false;
    const FUNCTION_VERBS_SHORT = new Set(['have', 'has', 'had', 'do', 'does', 'did', 'get', 'got']);
    if (!FUNCTION_VERBS_SHORT.has(nextVerb.word.toLowerCase())) return false;
    // Only the MAIN-verb use of have/do ("I HAVE no right" — possession) licenses
    // the inversion.  As an AUXILIARY ("i have SENE them") the beat belongs to the
    // lexical verb further right; promoting the pronoun here handed it the φ
    // nuclear over the participle ("I"(s) have sene(m) — the Wyatt L3 bug).
    if ((nextVerb.canonicalRel ?? '') === 'AUX' || (nextVerb.canonicalRel ?? '') === 'AUXPASS') return false;
    if ((nextVerb.phraseStress || 0) > 1) return true;
    return false;
  };

  // The set the gradient is measured against: content words (non-reduced) first;
  // for a content-less φ fall back to its prominent function words ("for THAT",
  // "to YOU"), then to any content, then to anything — so every φ has an anchor.
  let anchors = toks.filter(w => promotePronoun(w) || (isContent(w) && !isReducedVerb(w, words)));
  if (anchors.length === 0) anchors = toks.filter(w => !isReducedVerb(w, words) && functionLevel(w, words) !== 'x');
  if (anchors.length === 0) anchors = toks.filter(isContent);
  if (anchors.length === 0) anchors = toks.slice();
  const anchorSet = new Set(anchors);

  // Nuclear strength = the lowest phrase-stress integer among the anchors; the
  // nuclear WORD is the RIGHTMOST anchor at that value (English resolves rightward
  // toward the nuclear).  Because the Compound Stress Rule already fore-stressed a
  // compound's LEFT element (lower integer), the compound peak falls out here for
  // free — SLATE roof, ICE cream — with no special case.
  const localMin = Math.min(...anchors.map(ps));
  let nuclear: ClsWord | null = null;
  for (const w of anchors) if (ps(w) === localMin) nuclear = w;   // last = rightmost

  // Base level per token.
  const levels: StressLevel[] = toks.map((w) => {
    if (w === nuclear) return 's';                              // φ nuclear (right edge)
    if (anchorSet.has(w)) return 'm';                           // secondary beat (flat — the
    //                                  gradient among abutting beats is set by clash resolution)
    // BE-FORM flooring — only fires for true AUX copulas now (isReducedVerb
    // already excludes "to be" and ROOT be-forms, which are anchors with beats).
    // 'x' reserved for the clearest copula+predicate case: be-form after a
    // function word directly followed by an adjective/noun predicate.
    // Everything else → 'w' (promotable).
    if (isReducedVerb(w, words)) {
      if (BE_FORMS.has(bare(w))) {
        const i = toks.indexOf(w);
        const prev = i > 0 ? toks[i - 1] : null;
        const followingContent = toks.slice(i + 1).find(x => isContent(x));
        if (prev && !isContent(prev) && followingContent &&
            /^(JJ|NN)/.test(followingContent.lexicalClass))
          return 'x';
      }
      return 'w';
    }
    // Function word → its category gradient; a POLYSYLLABIC one floors its peak at
    // 'w' so its stressed syllable outranks the reduced one (be·CAUSE, u·PON).
    let tier = functionLevel(w, words);
    if (w.syllables.length > 1 && tier === 'x') tier = 'w';
    // A polysyllabic function word whose lexicon entry records a genuine PRIMARY
    // stress ("O·ver", "AF·ter", "UN·der", "u·PON") is not a reduced clitic — its
    // stressed syllable is a real (if light) beat that metrical verse freely uses
    // ("O·ver many a quaint and curious volume…" opens The Raven's trochee chain).
    // Raise the peak one tier to 'n' — still below every content beat, still
    // promotable/demotable by the fitter — leaving true reduced polysyllables
    // ("be·cause" 00, "where·fore" secondary-only) at 'w'.
    if (w.syllables.length > 1 && tier === 'w' &&
        w.syllables.some(s => (s.lexicalStress ?? s.stress) === 2)) {
      tier = 'n';
    }
    return tier;
  });

  // Phrase-initial beat ("beginnings free" — a light left-edge beat): a φ-initial
  // PREPOSITION rises x→w (the subtle beat on "IN the house"; lets "through" outrank
  // an interior "each"), unless it is itself the nuclear.  Also fires for the first
  // IN/TO AFTER a coordinator at the φ's start ("And of the best" — "And" is toks[0]
  // at 'x', "of" is toks[1]; "of" gets the raise so it reads 'w', not flat 'x').
  const raiseFirstPrep = (idx: number) => {
    if (idx < 0 || idx >= toks.length) return;
    const w = toks[idx];
    if (w === nuclear) return;
    if ((w.lexicalClass === 'IN' || w.lexicalClass === 'TO') && levels[idx] === 'x') {
      levels[idx] = 'w';
    }
  };
  raiseFirstPrep(0);
  // If toks[0] is a coordinator (CC), the first IN/TO after it also gets the raise
  // — it is κ-initial (the start of the prepositional phrase after "and"), even if
  // not ϕ-initial.  "And of the best" → "of" rises to 'w'.
  if (toks.length > 1 && (toks[0].lexicalClass === 'CC' || (toks[0].canonicalRel ?? '') === 'CC')) {
    for (let i = 1; i < toks.length; i++) {
      if (toks[i].lexicalClass === 'IN' || toks[i].lexicalClass === 'TO') {
        raiseFirstPrep(i);
        break;
      }
      // Skip over articles/determiners to find the first IN/TO
      if (toks[i].isContent) break;               // hit content before any prep
    }
  }

  // Givenness escape (Wagner §6.1.3, maintainer's no-flat-run-on directive): when a
  // φ's nuclear is an inherently-given PRONOUN immediately preceded by a transitive
  // PREPOSITION ("of HIM", "to THEE"), do NOT leave them on a par or stress the
  // pronoun — subordinate the given pronoun and give the preposition the beat
  // ("OF him"), the differentiated reading.  The metrical fitter may re-promote the
  // pronoun if the line demands it.
  if (nuclear && isPronoun(nuclear)) {
    const ni = toks.indexOf(nuclear);
    const prep = ni > 0 ? toks[ni - 1] : null;
    if (prep && (prep.lexicalClass === 'IN' || prep.lexicalClass === 'TO' ||
                 (prep.canonicalRel ?? '') === 'CASE')) {
      const pi = toks.indexOf(prep);
      levels[ni] = 'w';          // given pronoun subordinated
      levels[pi] = 'n';          // preposition takes the differentiating beat
    }
  }

  toks.forEach((w, i) => paintWord(w, levels[i]));
  // NOTE: the clash invariant (no adjacent equal n/m/s) is enforced once, globally,
  // by resolveStressClashes over TRUE adjacent syllables in computeRelativeStress —
  // not here.  A per-word peak comparison would wrongly treat two polysyllables'
  // stressed syllables as adjacent ("TY·ger TY·ger", peaks two syllables apart) and
  // spuriously flatten every falling trochaic/dactylic foot.
}

const CLASH_NOUN = /^(NN|NNS|NNP|NNPS)$/;
/** Two clashing words form a COMPOUND whose LEFT element fore-stresses (Compound
 *  Stress Rule): a NOMD modifier + its head, or two adjacent nouns (the N+N compound
 *  the tagger routinely mislabels).  Only for such a pair does the clash keep the
 *  lower-phraseStress (fore-stressed) member; every OTHER clash uses the default
 *  rightward resolution.  This is the narrow place the Compound Stress Rule needs to
 *  reach the contour when neither element is the φ nuclear (e.g. "ice cream" buried
 *  under a wrong root) — without disturbing ordinary verse, where forcing the
 *  lower-phraseStress member to win moved beats onto odd positions and mis-metered. */
function isCompoundPair(a: ClsWord, b: ClsWord): boolean {
  if (a === b) return false;
  if ((a.canonicalRel ?? '') === 'NOMD' && a.dependency?.governor === b) return true;
  if ((b.canonicalRel ?? '') === 'NOMD' && b.dependency?.governor === a) return true;
  return CLASH_NOUN.test(a.lexicalClass) && CLASH_NOUN.test(b.lexicalClass) &&
    Math.abs(a.absoluteIndex - b.absoluteIndex) === 1;
}

/**
 * Stress-clash resolution over the TRUE surface syllable sequence (McAleese A2
 * step 3d.ii: "stress clashes (ss, ms) > s-s").  A BEAT is one per foot (at most
 * one per phonological phrase) — so two ADJACENT strong syllables (both ≥ m, in
 * any order: ss, ms, sm, mm) are a clash, NOT two beats.  One member drops to 'n'
 * (below the beat threshold), leaving a single beat with a demoted neighbour;
 * adjacent equal 'n' likewise demotes one member to 'w'.
 *
 * WHICH member drops:
 *   • a COMPOUND pair (isCompoundPair) keeps the fore-stressed (lower-phraseStress)
 *     element and demotes the other — the Compound Stress Rule, "ICE cream";
 *   • an n-n tie is broken by LEXICAL stress (Hayes' stress-maximum principle):
 *     the syllable with the higher lexicalStress value (2=primary > 1=secondary
 *     > 0=unstressed) is protected; the lower yields to 'w'.  This preserves a
 *     polysyllable's internal contour — a PRIMARY (lexicalStress 2) that was
 *     demoted to 'n' by a prior m/s clash still outranks a SECONDARY
 *     (lexicalStress 1), which in turn outranks an artifact 'n' (lexicalStress
 *     0, reached via the function-word gradient or a prior demotion).  Without
 *     this, a cascade can crush real lexical data — e.g. "before" (be=1, fore=2):
 *     "fore" loses an m/s clash (demoted to 'n'), then ties "be"(n) and was
 *     wrongly sacrificed (the old code only protected ===1 secondaries, treating
 *     the primary 2 as "not grounded"), corrupting "wn" into "nw".  Equal-
 *     lexical-stress ties (both primary, both secondary, both unstressed) default
 *     left (Rhythm Rule);
 *   • every other clash demotes the lower symbolic level, ties to the LEFT (the
 *     Rhythm Rule / Iambic Reversal — an earlier stress backs off ahead of one that
 *     follows closely, not a general "endings are strict" license).
 *
 * Because it compares adjacent SYLLABLES (not word peaks), a falling foot whose
 * stresses are separated by a weak syllable ("TY·ger TY·ger", "HARB·our") is left
 * intact — only genuinely abutting beats collapse.
 */
function resolveStressClashes(words: ClsWord[], sylWord: Map<Syllable, ClsWord>): void {
  const syls: Syllable[] = [];
  for (const w of [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex)) {
    for (const s of w.syllables) syls.push(s);
  }
  // Lexical stress value of a syllable (2=primary, 1=secondary, 0=unstressed).
  // Used to break n-n ties: a syllable with HIGHER lexical stress has greater
  // phonological integrity (Hayes' stress-maximum principle) and is protected
  // against demotion by a syllable with lower lexical stress.  The prior code
  // checked only ===1 (secondary), which inverted the hierarchy — a primary
  // (lexicalStress===2) was treated as "not grounded" and sacrificed to a
  // secondary, corrupting words like "before" (be=1/secondary, fore=2/primary)
  // into "nw" instead of "wn".
  const lexVal = (s: Syllable) => s.lexicalStress ?? s.stress ?? 0;
  let changed = true;
  for (let guard = 0; changed && guard < 8; guard++) {
    changed = false;
    for (let i = 0; i + 1 < syls.length; i++) {
      const a = syls[i], b = syls[i + 1];
      const ra = RANK[a.relativeStress ?? 'w'];
      const rb = RANK[b.relativeStress ?? 'w'];
      if (ra >= RANK.m && rb >= RANK.m) {
        const wa = sylWord.get(a), wb = sylWord.get(b);
        let demoteA: boolean;
        if (wa && wb && wa !== wb && isCompoundPair(wa, wb)) {
          // compound fore-stress: demote the LESS prominent (higher phrase stress)
          demoteA = (wa.phraseStress || Infinity) >= (wb.phraseStress || Infinity);
        } else {
          demoteA = ra <= rb;                          // default: lower level, tie → left
        }
        if (demoteA) a.relativeStress = 'n'; else b.relativeStress = 'n';
        changed = true;
      } else if (ra === RANK.n && rb === RANK.n) {
        // Break the tie by LEXICAL stress: the syllable with higher lexical
        // stress (primary > secondary > unstressed) is protected; the lower
        // yields.  This preserves a polysyllable's internal contour (the
        // primary survives even if a prior clash demoted it to n) while still
        // letting genuine secondaries (lexicalStress 1) beat artifact n's
        // (lexicalStress 0, reached via function-word gradient or prior
        // demotion).  Equal-lexical-stress ties default left (Rhythm Rule).
        const la = lexVal(a), lb = lexVal(b);
        if (la > lb) b.relativeStress = 'w';
        else if (lb > la) a.relativeStress = 'w';
        else a.relativeStress = 'w';                  // tie → default left
        changed = true;
      }
    }
  }
}

/** Inherent-givenness nuclear demotion (Wagner §7.2.3).  After each φ has been
 *  relativised, an inherently-given indefinite pronoun that won its OWN φ's nuclear
 *  (e.g. a lone "Something" set off as its own ϕ) should still YIELD the utterance
 *  peak to a heavier element later in the same intonational unit — so when a LATER
 *  word in the IU also reaches 's', the given pronoun's peak is demoted s→m.  It
 *  keeps a beat (its lexical contour is untouched below the peak) but no longer
 *  claims the main prominence: "Something(m) for the modern STAGE(s)".
 *
 *  Guards keep it from crushing a FOCAL pronoun: it never fires when the given word
 *  is the IU's only nuclear (a lone "Something."), and skips a lemma repeated in the
 *  IU (focal anaphora). */
function demoteGivenNuclei(iuWords: ClsWord[]): void {
  const ordered = iuWords.filter(w => w.syllables.length > 0)
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  const peak = (w: ClsWord) => Math.max(0, ...w.syllables.map(s => RANK[s.relativeStress ?? 'w']));
  for (let i = 0; i < ordered.length; i++) {
    const w = ordered[i];
    if (!isInherentlyGiven(w) || peak(w) !== RANK.s) continue;
    const lemma = bare(w);
    if (ordered.filter(x => bare(x) === lemma).length > 1) continue;   // focal repetition
    if (!ordered.slice(i + 1).some(x => peak(x) === RANK.s)) continue;  // no heavier later nuclear
    for (const s of w.syllables) if ((s.relativeStress ?? 'w') === 's') s.relativeStress = 'm';
  }
}

/** Alternation promotion (Attridge 1982), gated by Hayes' stress-maximum
 *  monosyllable/polysyllable asymmetry (McAleese pp.49-57; Halle-Keyser, Kiparsky
 *  1975): English does not sustain a trough of three-or-more weak syllables — its
 *  medial syllable is promoted to a light beat, McAleese's 'n' ("some stress"). This
 *  is the SAME promotion the meter-fitter applies internally (`scansion.ts`: a 'w'
 *  flanked by weakness realises a beat); writing it into the displayed contour
 *  breaks the long w-troughs the maintainer flagged.
 *
 *  NOTE on grounding: "beginnings free, endings strict" (Kiparsky 1968) is a loose
 *  statistical tendency about WHERE stress clashes resolve in the line, not a
 *  license to promote by position alone — it says nothing about whether a given
 *  syllable is phonologically eligible to carry stress at all.  The actual gate
 *  here is Hayes' stress-maximum asymmetry: a STRESSED MONOSYLLABLE is positionally
 *  free (it has no internal contour to violate, so context can promote it — "error
 *  AND upon", "not TO advance"), but an UNSTRESSED syllable inside a POLYSYLLABLE
 *  is not free — the lexicon's verdict that it carries no stress (lexicalStress
 *  === 0) is a fixed phonological fact, and promoting it fabricates a secondary
 *  stress Nounsing-Pro never recorded (e.g. promoting "mariner"'s toneless "-ner"
 *  just because it sits between two other weak syllables, one of which belongs to
 *  the unrelated following word).  So:
 *   • only an overt-weak 'w' promotes; a reduced clitic 'x' (the/a/of) stays the
 *     genuine trough — a clitic is never a beat;
 *   • a candidate that is the toneless (lexicalStress === 0) syllable of a word with
 *     MORE THAN ONE syllable is excluded — its own word's lexical contour already
 *     settled the question, and position cannot overrule it; a true monosyllable, or
 *     a syllable that itself carries some lexical stress (primary or secondary) but
 *     is sitting low because its WHOLE WORD only earned a low φ-level, remains
 *     eligible;
 *   • it must sit between two weak (w/x) syllables — the interior of a real trough;
 *   • the LINE EDGES do not count as weak, so a line-initial/final weak is never
 *     promoted (the off-beat before the first beat, and the final cadence, are left);
 *   • promotions never abut (a promoted 'n' breaks the run), so the result alternates
 *     w·n·w and the clash invariant (no adjacent equal n) is preserved. */
function promoteWeakTroughs(words: ClsWord[]): void {
  const syls: Syllable[] = [];
  const sylWord = new Map<Syllable, ClsWord>();
  for (const w of [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex)) {
    for (const s of w.syllables) { syls.push(s); sylWord.set(s, w); }
  }
  const isW = (i: number) =>
    i >= 0 && i < syls.length && syls[i].relativeStress === 'w';
  const isLexicallyToneless = (i: number) => {
    const s = syls[i];
    if ((s.lexicalStress ?? s.stress) !== 0) return false;   // carries some real stress
    const w = sylWord.get(s);
    return !!w && w.syllables.length > 1;                    // interior of a polysyllable
  };
  let lastProm = -2;
  for (let i = 1; i < syls.length - 1; i++) {
    if (!isW(i) || !isW(i - 1) || !isW(i + 1)) continue;   // medial of a ≥3 literal-w run
    if (isLexicallyToneless(i)) continue;                   // no fabricated secondaries
    if (i - 1 === lastProm) continue;                       // keep promotions non-adjacent
    syls[i].relativeStress = 'n';
    lastProm = i;
  }
}

/** Lower a polysyllabic word's final 'w' syllable to 'x' when another 'w'
 *  immediately follows it in surface order.  The unstressed ending of a longer
 *  word (even a stress-bearing word) carries fainter emphasis than even a weakly-
 *  stressed syllable or word immediately following it — so a w-w seam at a word
 *  boundary is differentiated by dropping the word-internal one to the clitic tier.
 *
 *  Narrowly scoped: only fires on the FINAL syllable of a polysyllabic word (2+
 *  syllables) that is 'w' (not 'n', 'm', 's', or 'x'), AND only when the very next
 *  syllable in surface order is also 'w'.  Does NOT affect any other syllable of
 *  the word, does NOT fire when the next syllable is 'x', 'n', 'm', or 's'. */
function demotePolysyllabicFinalTrough(words: ClsWord[]): void {
  const syls: Syllable[] = [];
  const sylWord = new Map<Syllable, ClsWord>();
  for (const w of [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex)) {
    for (const s of w.syllables) { syls.push(s); sylWord.set(s, w); }
  }
  for (let i = 0; i < syls.length - 1; i++) {
    const s = syls[i];
    const next = syls[i + 1];
    if (s.relativeStress !== 'w') continue;
    if (next.relativeStress !== 'w') continue;
    const w = sylWord.get(s);
    if (!w || w.syllables.length < 2) continue;          // polysyllabic only
    if (s !== w.syllables[w.syllables.length - 1]) continue;  // final syllable only
    s.relativeStress = 'x';
  }
}

/** Anaphoric givenness in coordinate structures (Krifka §4, Wagner §7.2).
 *  In a coordinate structure "X blood and Y blood" the HEAD lemma ("blood") is
 *  repeated across conjuncts.  Both occurrences are the shared contrastive
 *  background — the CATEGORY "blood" is what stays constant, and the modifiers
 *  ("Young", "high") carry the contrastive focus.  So BOTH heads are demoted
 *  (`coordinateGiven`), letting the modifier win the φ nuclear in EACH conjunct
 *  ("YOUNG blood and HIGH blood").  This is distinct from a refrain (identical
 *  phrase repeated for emphasis = focal) and from cross-line discourse
 *  givenness (repetition across lines of a stanza).
 *
 *  Detection: a content word whose `canonicalRel` is CONJ and whose governor
 *  shares the same lemma.  BOTH the conjunct (second occurrence) AND its
 *  governor (first occurrence) are marked `coordinateGiven`.  The relativiser's
 *  `ps()` then demotes both, so the modifier in each φ wins the beat.
 *
 *  Guard: only fires when the conjuncts' modifiers DIFFER — if the entire phrase
 *  is identical ("nevermore and nevermore") it's a refrain, not a shared-head
 *  coordinate, and both occurrences stay focal. */
function markCoordinateGivenness(words: ClsWord[]): void {
  for (const w of words) {
    if (!isContent(w) || (w.canonicalRel ?? '') !== 'CONJ') continue;
    const gov = w.dependency?.governor;
    if (!gov || gov === w) continue;
    // Same lemma (head repeated across conjuncts)?
    if (bare(w) !== bare(gov)) continue;
    // Guard against a refrain: check that the conjuncts have DIFFERENT
    // pre-head modifiers.  Compare the AMOD/ADVMOD lemmas immediately before
    // each head.  If both heads have the same modifier (or neither has one),
    // leave both focal — it's either a refrain or a plain coordination.
    const modBefore = (head: ClsWord): string => {
      const idx = words.indexOf(head);
      if (idx <= 0) return '';
      const prev = words[idx - 1];
      if ((prev.canonicalRel ?? '') === 'AMOD' || (prev.canonicalRel ?? '') === 'ADVMOD')
        return bare(prev);
      return '';
    };
    if (modBefore(w) === modBefore(gov)) continue;
    // Mark BOTH heads as coordinate-given: the shared head is the contrastive
    // background in both conjuncts, so contrastive focus falls on BOTH modifiers.
    w.coordinateGiven = true;
    gov.coordinateGiven = true;
  }
}

/** Assign relative stress for the whole sentence, one PP at a time. */
export function computeRelativeStress(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Mark anaphorically-given heads in coordinate structures before relativisation,
  // so the relativiser's `ps()` can demote them and let the modifier win the beat.
  markCoordinateGivenness(words);

  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const toks = collectPPTokens(pp)
        .filter(w => w.syllables.length > 0)
        .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
      relativisePP(toks, words);
    }
  }
  // Enforce the clash rule over the whole line's surface syllables (catches the
  // cross-PP abutments the per-PP painting cannot see).  Carry each syllable's word
  // so the clash can recognise a compound pair and apply the Compound Stress Rule.
  const sylWord = new Map<Syllable, ClsWord>();
  for (const w of words) for (const s of w.syllables) sylWord.set(s, w);
  resolveStressClashes(words, sylWord);

  // Per-IU: an inherently-given indefinite pronoun yields its φ-nuclear to a heavier
  // later element in the same IU (after clash resolution, so the demotion is final).
  for (const iu of ius) {
    const iuWords = iu.phonologicalPhrases.flatMap(pp => collectPPTokens(pp));
    demoteGivenNuclei(iuWords);
  }

  // Final readability pass: promote the medial weak of a ≥3-weak trough to 'n'
  // (Attridge alternation), breaking long w-runs and filling promotable beats.
  promoteWeakTroughs(words);

  // Differentiate w-w seams at polysyllabic word boundaries: lower a
  // polysyllabic word's final 'w' to 'x' when another 'w' immediately follows.
  demotePolysyllabicFinalTrough(words);
}

```

## calliope/stressrules.ts

```typescript
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

```

## calliope/syntax.ts

```typescript
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

```

## calliope/udpos.ts

```typescript
// calliope/udpos.ts — UNIVERSAL POS → Penn Treebank conversion.
//
// WHY: the phonological pipeline keys on Penn XPOS (NN/VBZ/JJ/DT/IN…), but
// UDPipe's XPOS column is treebank-specific and INCONSISTENT across models —
// EWT/GUM emit Penn tags, but LinES emits its own morphological tagset
// (DEF/SG-NOM/PL-NOM/ING/REL…) and ParTUT an Italian-derived one (RD/S/V/E/A/PD…),
// neither of which the downstream understands.  UPOS and FEATS, by contrast, are
// the Universal Dependencies standard and are consistent (and more accurate:
// ~94% UPOS vs ~93% XPOS) across ALL four models.  So we DERIVE the Penn tag the
// pipeline needs from UPOS + morphological FEATS, making the parser model-agnostic
// AND giving us morphology en-parse never had (Number, Tense, Degree, PronType,
// VerbForm) to make finer, more reliable distinctions.

import type { UDWord } from 'udpipe-node';

// The Penn Treebank tag set the downstream understands.  EWT/GUM emit these
// directly (and reliably — a lexicalised PDT like "all" stays PDT even when the
// parse mislabels its relation); LinES/ParTUT do NOT, so for those we derive the
// Penn tag from UPOS+FEATS instead.
const PENN_TAGS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS', 'JJ', 'JJR', 'JJS',
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ', 'MD',
  'RB', 'RBR', 'RBS', 'PRP', 'PRP$', 'WP', 'WP$', 'WDT', 'WRB',
  'DT', 'PDT', 'CD', 'IN', 'TO', 'CC', 'RP', 'EX', 'POS', 'UH', 'FW', 'SYM', 'LS',
]);

/** True if `xpos` is a Penn tag the pipeline consumes directly (EWT/GUM). */
export function isPennTag(xpos: string | undefined): boolean {
  return !!xpos && PENN_TAGS.has(xpos);
}

/** The Penn tag for a token: the raw XPOS when it is already Penn (EWT/GUM),
 *  otherwise derived from UPOS+FEATS (LinES/ParTUT, or a missing XPOS). */
export function pennTagOf(w: UDWord): string {
  if (isPennTag(w.xpos)) return w.xpos;
  return udToPenn(w);
}

const MODAL_LEMMAS = new Set([
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'ought', "'ll", "'d", 'wilt', 'shalt', 'canst', 'wouldst', 'shouldst', 'couldst',
]);
// Pre-determiners ("ALL the books", "BOTH his hands", "such a day", "HALF the night").
const PREDET_LEMMAS = new Set(['all', 'both', 'half', 'such', 'quite', 'many']);

function feat(w: UDWord, k: string): string | undefined {
  return w.featsMap ? w.featsMap[k] : undefined;
}

/**
 * Convert one UDPipe token to a Penn Treebank tag from UPOS + FEATS (+ lemma /
 * deprel for the cases morphology alone can't settle).  Falls back to the raw XPOS
 * only when UPOS is absent.
 */
export function udToPenn(w: UDWord): string {
  const upos = w.upos || '';
  const lemma = (w.lemma || w.form || '').toLowerCase();
  const deprel = (w.deprel || '').toLowerCase();
  const num = feat(w, 'Number');
  const degree = feat(w, 'Degree');
  const pron = feat(w, 'PronType');
  const poss = feat(w, 'Poss');
  const vform = feat(w, 'VerbForm');
  const tense = feat(w, 'Tense');
  const person = feat(w, 'Person');

  // Pre-determiner ("ALL the time", "BOTH his hands"): a stress-bearing quantifier
  // (Penn PDT, content), regardless of whether the model calls it DET or PRON.  UD
  // marks it with the det:predet relation; the non-Penn models lose that, so back
  // it up with the lemma list.
  if (deprel === 'det:predet') return 'PDT';

  switch (upos) {
    case 'NOUN':
      return num === 'Plur' ? 'NNS' : 'NN';
    case 'PROPN':
      return num === 'Plur' ? 'NNPS' : 'NNP';

    case 'ADJ':
      if (degree === 'Cmp') return 'JJR';
      if (degree === 'Sup') return 'JJS';
      // Ordinal numerals tag JJ in UD but CD-like in Penn; keep JJ (attributive).
      return 'JJ';

    case 'ADV':
      if (pron === 'Int' || pron === 'Rel') return 'WRB';   // when/where/why/how
      if (degree === 'Cmp') return 'RBR';
      if (degree === 'Sup') return 'RBS';
      return 'RB';

    case 'VERB':
    case 'AUX': {
      if (upos === 'AUX' && (feat(w, 'VerbType') === 'Mod' || MODAL_LEMMAS.has(lemma))) return 'MD';
      if (vform === 'Ger') return 'VBG';
      if (vform === 'Part') return tense === 'Past' ? 'VBN' : 'VBG';
      if (vform === 'Inf') return 'VB';
      if (vform === 'Fin') {
        if (tense === 'Past') return 'VBD';
        if (person === '3' && num === 'Sing') return 'VBZ';
        return 'VBP';
      }
      // No VerbForm feature: best-effort by tense/person.
      if (tense === 'Past') return 'VBD';
      if (person === '3' && num === 'Sing') return 'VBZ';
      return upos === 'AUX' ? 'VBP' : 'VB';
    }

    case 'PRON':
      if (poss === 'Yes') return (pron === 'Rel' || pron === 'Int') ? 'WP$' : 'PRP$';
      if (pron === 'Rel' || pron === 'Int') return 'WP';
      if (pron === 'Dem') return 'DT';                       // "this/that" pronominal
      return 'PRP';

    case 'DET':
      if (pron === 'Rel' || pron === 'Int') return 'WDT';    // which/that(rel)/what
      if (poss === 'Yes') return 'PRP$';                     // my/your/their (UD DET)
      if (PREDET_LEMMAS.has(lemma) && deprel === 'det:predet') return 'PDT';
      return 'DT';                                           // articles + demonstratives

    case 'ADP':
      // A particle of a phrasal verb ("came DOWN", "give UP") is stress-bearing RP;
      // an ordinary preposition is the reducible IN.  UD marks the particle by the
      // compound:prt relation.
      return deprel === 'compound:prt' ? 'RP' : 'IN';
    case 'SCONJ':
      return 'IN';
    case 'CCONJ':
      return 'CC';

    case 'PART':
      if (lemma === 'to') return 'TO';
      if (lemma === "'s" || lemma === '’s' || deprel === 'case') return 'POS';
      if (lemma === 'not' || lemma === "n't" || lemma === "n’t") return 'RB';
      return 'RB';

    case 'NUM':
      return 'CD';
    case 'INTJ':
      return 'UH';
    case 'SYM':
      return 'SYM';
    case 'X':
      return 'FW';

    case 'PUNCT':
      // EWT/GUM give the punctuation char as XPOS already; otherwise use the form.
      return (w.xpos && /[^A-Za-z0-9]/.test(w.xpos)) ? w.xpos : (w.form || w.xpos || ':');

    default:
      return w.xpos || w.upos || 'NN';
  }
}

```

## clio/caesura.ts

```typescript
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

```

## clio/depfix.ts

```typescript
// depfix.ts — Post-parse dependency repair via DepEdit rules (the `depedits`
// npm package, the maintainer's TypeScript port of DepEdit).
//
// Runs AFTER en-parse, complementing the pre-parse tag corrections in
// tagfix.ts: tagfix repairs what the tagger got wrong before the tree is
// built; this pass repairs systematic attachment errors en-parse makes even
// with correct tags.  Rules are written in DepEdit's declarative format
// (definitions ⟶ relations ⟶ actions, tab-separated) over en-parse's own
// label space (DOBJ/NSUBJ/DEP/…), so the round-trip is lossless and every
// rule is independently testable.
//
// The rule set is deliberately small and evidence-based — each rule cites the
// observed failure it corrects.  `depedits` is ESM-only; it is loaded lazily
// and failures degrade gracefully (the unrepaired parse is still a parse).

import { createRequire } from 'module';

interface FinDepNode {
  label: string;      // dependency label, e.g. "NSUBJ", "ROOT"
  type: string;       // phrase type, e.g. "NP", "VP"
  parent: number;     // 0-based index of governor token; -1 for root
}

// Observed failure (probe: "I had quit the programming paradigm"): en-parse
// attaches BOTH nouns of a noun compound to the verb as parallel objects
// ("programming ←DOBJ← quit", "paradigm ←DOBJ← quit"), and leaves the
// determiner dangling on the first noun as generic DEP.  The repairs:
//   1. Two adjacent common nouns sharing a governor with the same object
//      relation → the first is a compound modifier (AMOD) of the second.
//   2. A determiner left as DEP on a noun that has become a modifier →
//      re-attach it as DET to that noun's head (the true NP head).
const CALLIOPE_DEP_FIXES = [
  'xpos=/NNS?/&func=/DOBJ|IOBJ/;xpos=/NNS?/&func=/DOBJ|IOBJ/;xpos=/VB.*/\t#3>#1;#3>#2;#1.#2\t#2>#1;#1:func=AMOD',
  'xpos=/DT/&func=/DEP|EXT/;xpos=/NNS?/&func=/AMOD/;xpos=/NNS?.*/\t#2>#1;#3>#2\t#3>#1;#1:func=DET',
].join('\n');

let engine: { process(conllu: string): string } | null | undefined;

function loadEngine(): typeof engine {
  if (engine !== undefined) return engine;
  try {
    // This package compiles to ESM, where bare `require` does not exist, and
    // the parse path is synchronous, so dynamic import() is not an option:
    // createRequire gives a sync loader, and since `depedits` is itself
    // ESM-only this resolves via Node's require(esm) (≥20.17 / ≥22.12).  On
    // older runtimes it throws and the repair pass degrades to a no-op (the
    // unrepaired parse is still a parse).
    const req = createRequire(import.meta.url);
    const { DepEditEngine } = req('depedits');
    const e = new DepEditEngine();
    e.loadIniString(CALLIOPE_DEP_FIXES);
    engine = e;
  } catch {
    engine = null;
  }
  return engine;
}

/**
 * Repair systematic en-parse attachment errors.  Returns a new deps array
 * (same shape as en-parse's `toArray` output); on any failure returns the
 * input unchanged.
 */
export function applyDepFixes(tokens: string[], tags: string[], deps: FinDepNode[]): FinDepNode[] {
  const e = loadEngine();
  if (!e || tokens.length === 0 || deps.length !== tokens.length) return deps;
  try {
    const conllu = tokens.map((tok, i) => {
      const head = deps[i].parent >= 0 ? deps[i].parent + 1 : 0;
      const safe = tok.replace(/\s/g, '_') || '_';
      return `${i + 1}\t${safe}\t${safe}\t_\t${tags[i] || '_'}\t_\t${head}\t${deps[i].label || 'DEP'}\t_\t_`;
    }).join('\n') + '\n\n';
    const out = e.process(conllu);
    const fixed: FinDepNode[] = deps.map(d => ({ ...d }));
    for (const row of out.split('\n')) {
      const cols = row.split('\t');
      if (cols.length < 10) continue;
      const idx = parseInt(cols[0], 10) - 1;
      if (!(idx >= 0 && idx < fixed.length)) continue;
      const head = parseInt(cols[6], 10);
      fixed[idx].parent = Number.isFinite(head) ? head - 1 : fixed[idx].parent;
      if (cols[7] && cols[7] !== '_') fixed[idx].label = cols[7];
    }
    return fixed;
  } catch {
    return deps;
  }
}

```

## clio/display.ts

```typescript
// display.ts — Unified, integrated CLI display for Calliope TS
// Shows ALL information layers in a single comprehensive view

import chalk from 'chalk';
import {
  ClsWord,
  ClsSentence,
  IntonationalUnit,
  PhonologicalPhrase,
  CliticGroup,
  StressLevel,
  LineResult,
  SyllableDisplayEntry,
  MeterScore,
} from '../types.js';
import { isPunctuation } from './parser.js';
import { syllabifyWord, syllableVowelLengths } from './phonological.js';
import { computeCaesurae, CaesuraKind } from './caesura.js';
import { summarizePoem, analyzePhonopoetics, type Phonopoetics, type RhymeRel } from './rhyme.js';

// ═══════════════════════════════════════════════════════════════════════
// COLOUR SYSTEM — Conceptually motivated palettes
// ═══════════════════════════════════════════════════════════════════════

// Lexical stress (numeric 0–3): blue→magenta→red→bold red
// Represents phonetic prominence from dictionary
const LEX0 = (s: string) => chalk.blue(s);
const LEX1 = (s: string) => chalk.magenta(s);
const LEX2 = (s: string) => chalk.red(s);
const LEX3 = (s: string) => chalk.red.bold(s);

function lexColour(val: number): (s: string) => string {
  if (val === 0) return LEX0;
  if (val === 1) return LEX1;
  if (val === 2) return LEX2;
  return LEX3;
}

// Relative / phonological stress (x w n m s): light-grey→cyan→green→yellow→bright red
// Represents phonological prominence after phrasal rules.  `x` = zero-provision
// (maximally-reduced clitic), one rung below the stressless-overt floor `w`.
// Light grey (not dark blue) so it stays legible on a black terminal.
const REL_X = (s: string) => chalk.hex('#b0b0b0')(s);
const REL_W = (s: string) => chalk.cyan(s);
const REL_N = (s: string) => chalk.green(s);
const REL_M = (s: string) => chalk.yellow(s);
const REL_S = (s: string) => chalk.redBright(s);

function relColour(rel: StressLevel): (s: string) => string {
  if (rel === 'x') return REL_X;
  if (rel === 'w') return REL_W;
  if (rel === 'n') return REL_N;
  if (rel === 'm') return REL_M;
  if (rel === 's') return REL_S;
  return chalk.gray.dim;
}

// Phrasal boundaries — distinct palette (purple/blue/green)
const B_CP = chalk.magentaBright;
const B_PP = chalk.blueBright;
const B_IU = chalk.greenBright;
const B_CAESURA = chalk.whiteBright.bold;       // hard caesura (overt: punctuation / IU edge)
const B_CAESURA_SOFT = chalk.cyan.dim;          // inferred caesura (phonological-phrase pause)
const B_FOOT = chalk.gray;
const B_SILENT = chalk.gray.dim;

// Word roles
const W_CONTENT = chalk.white;
const W_FUNCTION = chalk.gray;
const W_DEP = chalk.italic.dim;

// Section headers
const H1 = chalk.bold.underline;
const H2 = chalk.bold;

const HR = '─'.repeat(70);
const HR_THIN = '─'.repeat(50);

// ═══════════════════════════════════════════════════════════════════════
// PER-SYLLABLE DATA STRUCTURE
// ═══════════════════════════════════════════════════════════════════════

interface ColSyl {
  chunk: string;
  word: string;
  pos: string;
  isContent: boolean;
  lexStress: number;
  relStress: StressLevel;
  cpId: number;
  ppId: number;
  iuId: number;
  isFirstInWord: boolean;
  isFirstInCP: boolean;
  isFirstInPP: boolean;
  isFirstInIU: boolean;
  isLastInCP: boolean;
  isLastInPP: boolean;
  isLastInIU: boolean;
  depLabel: string;
  govWord: string;
  globalIdx: number;
  wordRef: ClsWord;
}

function buildColSyls(words: ClsWord[], ius: IntonationalUnit[]): ColSyl[] {
  const result: ColSyl[] = [];
  let globalIdx = 0;

  for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
    const iu = ius[iuIdx];
    for (let ppIdx = 0; ppIdx < iu.phonologicalPhrases.length; ppIdx++) {
      const pp = iu.phonologicalPhrases[ppIdx];
      for (let cpIdx = 0; cpIdx < pp.cliticGroups.length; cpIdx++) {
        const cg = pp.cliticGroups[cpIdx];
        for (let tIdx = 0; tIdx < cg.tokens.length; tIdx++) {
          const w = cg.tokens[tIdx];
          if (isPunctuation(w.lexicalClass)) continue;
          const dep = w.dependency;
          const sylCount = w.syllables.length;
          const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix);

          for (let si = 0; si < sylCount; si++) {
            const syl = w.syllables[si];
            const lex = syl.lexicalStress ?? syl.stress;
            const rel = syl.relativeStress ?? 'w';

            result.push({
              chunk: chunks[si] || w.word,
              word: w.word,
              pos: w.lexicalClass,
              isContent: w.isContent,
              lexStress: lex,
              relStress: rel,
              cpId: cpIdx,
              ppId: ppIdx,
              iuId: iuIdx,
              isFirstInWord: si === 0,
              isFirstInCP: tIdx === 0 && si === 0,
              isFirstInPP: cpIdx === 0 && tIdx === 0 && si === 0,
              isFirstInIU: ppIdx === 0 && cpIdx === 0 && tIdx === 0 && si === 0,
              isLastInCP: tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              isLastInPP: cpIdx === pp.cliticGroups.length - 1 &&
                tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              isLastInIU: ppIdx === iu.phonologicalPhrases.length - 1 &&
                cpIdx === pp.cliticGroups.length - 1 &&
                tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              depLabel: dep?.dependentType ?? '',
              govWord: dep?.governor?.word ?? '',
              globalIdx: globalIdx++,
              wordRef: w,
            });
          }
        }
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// UNIFIED DISPLAY — All layers integrated
// ═══════════════════════════════════════════════════════════════════════

export function renderUnifiedDisplay(result: LineResult, rawLine?: string): string {
  const words = result.sentence.words;
  const ius = result.phonologicalHierarchy;
  const detail = result.phonologicalScansion;
  const colSyls = buildColSyls(words, ius);

  const lines: string[] = [];
  lines.push('');
  lines.push(HR);

  // ── Layer 1: Original text with word-role coloring ──────────────
  lines.push(H1('Original Text'));
  lines.push('');
  const textParts: string[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const wc = w.isContent ? W_CONTENT : W_FUNCTION;
    const posTag = W_DEP('(' + w.lexicalClass + ')');
    textParts.push(wc(w.word) + posTag);
  }
  lines.push('  ' + textParts.join(' '));
  lines.push('');

  // ── Layer 2: Phrasal structure tree ─────────────────────────────
  lines.push(H1('Phrasal Structure') + '  ' + B_IU('IU') + ' → ' + B_PP('PP') + ' → ' + B_CP('CP'));
  // Mini-legend: only the POS tags & dependencies that occur in THIS line.
  lines.push(...renderLineGlossary(words));
  lines.push('');

  const wordSet = new Set<ClsWord>();
  const dedupedEntries: { col: ColSyl; word: ClsWord }[] = [];
  for (const cs of colSyls) {
    if (!wordSet.has(cs.wordRef)) {
      wordSet.add(cs.wordRef);
      dedupedEntries.push({ col: cs, word: cs.wordRef });
    }
  }

  let lastIU = -1, lastPP = -1;
  for (const we of dedupedEntries) {
    const cs = we.col;
    if (cs.iuId !== lastIU) {
      lines.push(B_IU('  IU' + (cs.iuId + 1)));
      lastIU = cs.iuId;
      lastPP = -1;
    }
    if (cs.ppId !== lastPP) {
      lines.push(B_PP('    PP' + (cs.ppId + 1) + ': {'));
      lastPP = cs.ppId;
    }
    const dep = we.word.dependency;
    const depInfo = dep && dep.governorIndex > 0
      ? W_DEP(' ←' + dep.dependentType)
      : '';
    const wordLabel = W_CONTENT(we.word.word) + W_DEP('(' + we.word.lexicalClass + ')');
    lines.push('      ' + B_CP('[') + wordLabel + depInfo + B_CP(']'));
  }
  lines.push('    ' + B_PP('}'));
  lines.push('');

  // ── Layer 3: Lexical stress (numeric) ───────────────────────────
  lines.push(H1('Lexical Stress') + '  ' + LEX0('0') + LEX1('1') + LEX2('2') + LEX3('3') + '  (0=none 1=secondary 2=primary 3+=boosted)');
  lines.push('');

  const lexParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) lexParts.push(' ');
    lexParts.push(lexColour(cs.lexStress)(String(cs.lexStress)));
  }
  lines.push('  ' + lexParts.join(''));
  lines.push('');

  // ── Layer 3b: Phrase stress (McAleese's integer nuclear ramp) ───
  // The phase that used to be skipped: every word starts at 1; the Compound
  // Stress Rule pins a compound's subordinate; the Nuclear Stress Rule ramps
  // the principal stress of each stressed word L→R to the phrase's peak.
  lines.push(H1('Phrase Stress') + '  ' + chalk.dim('1 = floor (function / compound-subordinate) → N = nuclear peak'));
  lines.push('');

  const phrParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) phrParts.push(' ');
    if (cs.isFirstInWord) {
      const ps = cs.wordRef.phraseStress || 0;
      phrParts.push((ps <= 1 ? chalk.dim : chalk.cyanBright)(String(ps)));
    } else {
      phrParts.push(' '); // continuation syllable — keep word-start alignment
    }
  }
  lines.push('  ' + phrParts.join(''));
  lines.push('');

  // ── Layer 4: Relative stress (w/n/m/s) ──────────────────────────
  lines.push(H1('Relative Stress') + '  ' + REL_X('x') + REL_W('w') + REL_N('n') + REL_M('m') + REL_S('s') + '  (zero‑provision→weak→low→moderate→strong)');
  lines.push('');

  const relParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) relParts.push(' ');
    relParts.push(relColour(cs.relStress)(cs.relStress));
  }
  lines.push('  ' + relParts.join(''));
  lines.push('');

  // ── Layer 5: Phonological bracketing ────────────────────────────
  lines.push(H1('Phonological Bracketing') + '  ' + B_CP('[]') + ' CP  ' + B_PP('{}') + ' PP  ' + B_IU('<>') + ' IU');
  lines.push('');

  const sylParts: string[] = [];
  let iuOpen = false, ppOpen = false, cpOpen = false;
  for (const cs of colSyls) {
    if (cs.isFirstInIU && !iuOpen) { sylParts.push(B_IU('<')); iuOpen = true; }
    if (cs.isFirstInPP && !ppOpen) { sylParts.push(B_PP('{')); ppOpen = true; }
    if (cs.isFirstInCP && !cpOpen) { sylParts.push(B_CP('[')); cpOpen = true; }

    if (cs.isFirstInWord && cs.globalIdx > 0) sylParts.push(' ');
    sylParts.push(relColour(cs.relStress)(cs.chunk));

    if (cs.isLastInCP && cpOpen) { sylParts.push(B_CP(']')); cpOpen = false; }
    if (cs.isLastInPP && ppOpen) { sylParts.push(B_PP('}')); ppOpen = false; }
    if (cs.isLastInIU && iuOpen) { sylParts.push(B_IU('>')); iuOpen = false; }
  }
  lines.push('  ' + sylParts.join(''));
  lines.push('');

  // ── Layer 6: Metrical scansion with caesura ─────────────────────
  lines.push(H1('Metrical Scansion'));
  lines.push('');

  const scansion = detail.scansion;
  const feetRaw = scansion.split('|');

  interface LinearSyl {
    chunk: string;
    relStress: StressLevel;
    wordRef: ClsWord;
  }
  const linearSyls: LinearSyl[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const sylCount = w.syllables.length;
    const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix);
    for (let si = 0; si < sylCount; si++) {
      linearSyls.push({
        chunk: chunks[si] || w.word,
        relStress: w.syllables[si].relativeStress ?? 'w',
        wordRef: w,
      });
    }
  }

  // Caesurae: hard at IU/punctuation breaks, plus one inferred (soft) medial
  // caesura at a phonological-phrase boundary for a punctuation-free line.
  const caesurae = computeCaesurae(words, ius, scansion);

  function isSyllableChar(ch: string): boolean {
    return 'xXwWnNmMsS'.includes(ch);
  }

  let sylIdx = 0;
  const footDisplays: string[] = [];
  let prevWordRef: ClsWord | null = null;
  for (const rawFoot of feetRaw) {
    let footOut = '';
    for (const ch of rawFoot) {
      if (ch === '-') {
        footOut += B_SILENT('·');
        continue;
      }
      if (!isSyllableChar(ch)) continue;
      if (sylIdx < linearSyls.length) {
        const ls = linearSyls[sylIdx];
        if (prevWordRef !== null && ls.wordRef !== prevWordRef) footOut += ' ';
        footOut += relColour(ls.relStress)(ls.chunk);
        prevWordRef = ls.wordRef;
        sylIdx++;
      }
    }
    const ck = caesurae.get(sylIdx); if (ck) footOut += ' ' + caesuraGlyph(ck);
    footDisplays.push(footOut);
  }
  lines.push('  ' + H2('Feet:   ') + footDisplays.join(B_FOOT(' | ')));

  const stressDisplays: string[] = [];
  let rIdx = 0;
  for (const rawFoot of feetRaw) {
    let s = '';
    for (const ch of rawFoot) {
      if (ch === '-') { s += B_SILENT('_'); continue; }
      if (!isSyllableChar(ch)) continue;
      if (rIdx < linearSyls.length) {
        s += relColour(linearSyls[rIdx].relStress)(linearSyls[rIdx].relStress);
        rIdx++;
      }
    }
    const ck2 = caesurae.get(rIdx); if (ck2) s += ' ' + caesuraGlyph(ck2);
    stressDisplays.push(s);
  }
  lines.push('  ' + H2('Stress: ') + stressDisplays.join(B_FOOT(' | ')));
  lines.push('');

  // ── Layer 7: Dependencies ───────────────────────────────────────
  lines.push(H1('Dependencies'));
  lines.push('');
  for (const we of dedupedEntries) {
    const w = we.word;
    if (isPunctuation(w.lexicalClass)) continue;
    const dep = w.dependency;
    if (!dep) continue;
    if (dep.governorIndex === 0 || dep.dependentType === 'root') {
      lines.push('  ' + B_IU('ROOT →') + ' ' + W_CONTENT(w.word));
    } else {
      lines.push('  ' +
        W_FUNCTION(w.word.padEnd(12)) +
        W_DEP('←' + dep.dependentType + '← ') +
        W_CONTENT(dep.governorName)
      );
    }
  }
  lines.push('');

  // ── Layer 8: Summary ────────────────────────────────────────────
  lines.push(H1('Summary'));
  lines.push('');
  lines.push('  ' + H2('Meter:    ') + detail.meter + chalk.dim('  (' + detail.footCount + ' feet)') + consensusNote(detail) + rhythmNoteStr(detail));
  const rank = formatRanking(detail.ranking);
  lines.push('  ' + H2('Fit:      ') + chalk.yellow(detail.certainty + '%') + (rank ? '   ' + rank : ''));
  lines.push('  ' + H2('Scansion: ') + detail.scansion);
  lines.push('  ' + H2('Summary:  ') + detail.summary);
  lines.push('');

  // ── Layer 9: Scandroid comparison (if available) ────────────────
  if (result.scandroidCorral || result.scandroidMaximise) {
    lines.push(H1('Scandroid Comparison'));
    lines.push('');
    if (result.scandroidCorral) {
      lines.push('  ' + H2('CW: ') + result.scandroidCorral.scansion);
    }
    if (result.scandroidMaximise) {
      lines.push('  ' + H2('MN: ') + result.scandroidMaximise.scansion);
    }
    lines.push('');
  }

  // ── Layer 10: Reading projection (stress gradient over the input) ──
  // A reading-view-style colourisation of the verbatim input, so the finalised
  // analysis always shows "something that looks like the input".  Falls back to
  // the parsed surface forms when the raw line wasn't supplied.
  lines.push(H1('Reading Projection') + chalk.dim('  — stress gradient over the input'));
  lines.push('');
  const projection = rawLine && rawLine.trim()
    ? projectStressOntoLine(rawLine, words)
    : words.filter(w => !isPunctuation(w.lexicalClass)).map(w => colourToken(w.word, w)).join(' ');
  lines.push('  ' + projection);
  lines.push('');

  // ── Layer 11: Legend ────────────────────────────────────────────
  lines.push(HR_THIN);
  lines.push(renderLegend());
  lines.push(HR);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// LEGEND
// ═══════════════════════════════════════════════════════════════════════

export function renderLegend(): string {
  return [
    H2('Legend'),
    '  ' + B_CP('[]') + ' Clitic Phrase  ' + B_PP('{}') + ' Phonological Phrase  ' + B_IU('<>') + ' Intonational Unit',
    '  ' + LEX0('0') + LEX1('1') + LEX2('2') + LEX3('3') + '  Lexical stress (0=none 1=secondary 2=primary 3+=boosted)',
    '  ' + REL_X('x') + REL_W('w') + REL_N('n') + REL_M('m') + REL_S('s') + '  Relative stress (zero‑provision→weak→low→moderate→strong)',
    '  ' + W_CONTENT('content') + '  ' + W_FUNCTION('function') + '  Word class',
    '  ' + B_CAESURA('‖') + ' Caesura (phrasal break)  ' + B_CAESURA_SOFT('¦') + ' Inferred caesura  ' +
      B_FOOT('|') + ' Foot boundary  ' + B_SILENT('·') + ' Silent beat',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// GLOSSARIES — Penn POS tags & grammatical dependencies
// (For the long-form Display Legend [menu] and the per-line mini-legend in the
//  detailed views.  NOT shown in the compact in-output legend above.)
// ═══════════════════════════════════════════════════════════════════════

interface Gloss { name: string; eg: string; }

// Penn Treebank POS tags that FinNLP's en-pos tagger assigns to words (the tags
// shown as "(TAG)" in the Original Text / Phrasal Structure layers).  Pure
// punctuation/symbol/list tags (, : . ( ) # $ SYM LS) are intentionally omitted —
// they label no lexical word in the prosodic analysis.  Grouped by word class so
// the distinctions read clearly.
const POS_GROUPS: { label: string; tags: [string, Gloss][] }[] = [
  { label: 'Nouns', tags: [
    ['NN',   { name: 'noun, singular or mass',  eg: 'table, water, dust' }],
    ['NNS',  { name: 'noun, plural',            eg: 'tables, waters' }],
    ['NNP',  { name: 'proper noun, singular',   eg: 'London, Pound' }],
    ['NNPS', { name: 'proper noun, plural',     eg: 'Americans, Smiths' }],
  ]},
  { label: 'Verbs & modals', tags: [
    ['VB',   { name: 'verb, base form',                 eg: 'throw, eat, run' }],
    ['VBD',  { name: 'verb, past tense',                eg: 'threw, ate, ran' }],
    ['VBG',  { name: 'verb, gerund / present part.',    eg: 'throwing, eating' }],
    ['VBN',  { name: 'verb, past participle',           eg: 'thrown, eaten' }],
    ['VBP',  { name: 'verb, non-3rd-sg present',        eg: '(I) throw, run' }],
    ['VBZ',  { name: 'verb, 3rd-sg present',            eg: 'throws, runs' }],
    ['MD',   { name: 'modal',                           eg: 'can, will, must' }],
  ]},
  { label: 'Adjectives & adverbs', tags: [
    ['JJ',   { name: 'adjective',               eg: 'green, large' }],
    ['JJR',  { name: 'adjective, comparative',  eg: 'greener, larger' }],
    ['JJS',  { name: 'adjective, superlative',  eg: 'greenest, largest' }],
    ['RB',   { name: 'adverb',                  eg: 'quickly, very' }],
    ['RBR',  { name: 'adverb, comparative',     eg: 'faster, better' }],
    ['RBS',  { name: 'adverb, superlative',     eg: 'fastest, best' }],
  ]},
  { label: 'Determiners & numbers', tags: [
    ['DT',   { name: 'determiner',              eg: 'the, a, an' }],
    ['PDT',  { name: 'predeterminer',           eg: 'all (the books), both' }],
    ['CD',   { name: 'cardinal number',         eg: 'one, two, three' }],
  ]},
  { label: 'Pronouns', tags: [
    ['PRP',  { name: 'personal pronoun',        eg: 'I, you, he, they' }],
    ['PRP$', { name: 'possessive pronoun',      eg: 'my, your, their' }],
  ]},
  { label: 'Wh-words', tags: [
    ['WDT',  { name: 'wh-determiner',           eg: 'which, that' }],
    ['WP',   { name: 'wh-pronoun',              eg: 'who, what' }],
    ['WP$',  { name: 'possessive wh-pronoun',   eg: 'whose' }],
    ['WRB',  { name: 'wh-adverb',               eg: 'when, where, why' }],
  ]},
  { label: 'Function & other', tags: [
    ['IN',   { name: 'preposition / subord. conj.', eg: 'in, of, although' }],
    ['TO',   { name: 'infinitival "to"',            eg: 'to (go)' }],
    ['CC',   { name: 'coordinating conjunction',    eg: 'and, but, or' }],
    ['RP',   { name: 'particle',                    eg: 'up (give up), off' }],
    ['EX',   { name: 'existential "there"',         eg: 'there (is)' }],
    ['POS',  { name: 'possessive ending',           eg: "'s, '" }],
    ['UH',   { name: 'interjection',                eg: 'oh, wow, ah' }],
    ['FW',   { name: 'foreign word',                eg: 'je ne sais quoi' }],
  ]},
];

// Grammatical dependency relations AS THE TOOLKIT DISPLAYS THEM (the lowercase
// labels shown as "←label", after FinNLP's relations are mapped to the
// Antelope/Universal-Dependencies scheme in parser.ts).  Grouped by role.
const DEP_GROUPS: { label: string; deps: [string, Gloss][] }[] = [
  { label: 'Core arguments', deps: [
    ['nsubj',     { name: 'nominal subject',            eg: 'I like you' }],
    ['nsubjpass', { name: 'nominal subject (passive)',  eg: 'I was given a chance' }],
    ['dobj',      { name: 'direct object',              eg: 'I like you' }],
    ['iobj',      { name: 'indirect object',            eg: 'she gave me a book' }],
    ['pobj',      { name: 'object of preposition (oblique)', eg: 'to the children' }],
  ]},
  { label: 'Clausal relations', deps: [
    ['ccomp',     { name: 'clausal complement',         eg: 'ordered to dig' }],
    ['xcomp',     { name: 'open clausal complement',    eg: 'told us to dig' }],
    ['advcl',     { name: 'adverbial clause modifier',  eg: 'walking as rain fell' }],
    ['acl',       { name: 'clausal modifier of a noun', eg: 'the man you love' }],
  ]},
  { label: 'Modifiers', deps: [
    ['amod',      { name: 'adjectival modifier',        eg: 'good to him' }],
    ['advmod',    { name: 'adverbial modifier',         eg: 'genetically modified' }],
    ['nummod',    { name: 'numeric modifier',           eg: '2 eggs' }],
    ['nmod',      { name: 'nominal modifier',           eg: 'news of the market' }],
    ['poss',      { name: 'possessive / nominal mod.',  eg: "Senka's match" }],
    ['det',       { name: 'determiner',                 eg: 'the book' }],
  ]},
  { label: 'Function & markers', deps: [
    ['prep',      { name: 'case / preposition marker',  eg: 'went to Rome' }],
    ['aux',       { name: 'auxiliary',                  eg: 'am going' }],
    ['auxpass',   { name: 'auxiliary (passive)',        eg: 'have been marked' }],
    ['cc',        { name: 'coordinating conjunction',   eg: 'Matt and Alex' }],
    ['mark',      { name: 'clause / complement marker', eg: 'if I like it' }],
    ['prt',       { name: 'verb particle',              eg: 'switched it off' }],
    ['expl',      { name: 'expletive',                  eg: 'there is' }],
    ['discourse', { name: 'discourse element',          eg: 'I like that :)' }],
    ['intj',      { name: 'interjection',               eg: 'pass it, please' }],
  ]},
  { label: 'Other', deps: [
    ['root',      { name: 'root (head of the sentence)', eg: 'the main predicate' }],
    ['dep',       { name: 'unspecified dependency',      eg: '(unresolved)' }],
    ['punct',     { name: 'punctuation',                 eg: 'Guys, calm!' }],
  ]},
];

// Flat lookups (used by the per-line mini-legend).
const POS_GLOSS: Record<string, Gloss> = Object.fromEntries(POS_GROUPS.flatMap(g => g.tags));
const DEP_GLOSS: Record<string, Gloss> = Object.fromEntries(DEP_GROUPS.flatMap(g => g.deps));

/** A glossary row, padded on the RAW strings (so chalk colour codes don't skew
 *  alignment).  `tagWidth` is sized to the widest tag in the table. */
function glossRow(tag: string, g: Gloss, tagWidth: number): string {
  return '  ' + chalk.cyan(tag.padEnd(tagWidth)) + W_CONTENT(g.name.padEnd(32)) + chalk.dim('e.g. ' + g.eg);
}

/**
 * The long-form legend triggered from the main menu's "Display Legend" option:
 * the compact legend PLUS full Penn POS-tag and grammatical-dependency glossaries.
 * (These glossaries are deliberately NOT part of the compact in-output legend.)
 */
export function renderFullLegend(): string {
  const out: string[] = [];
  out.push(renderLegend());
  out.push('');
  out.push(HR_THIN);
  out.push(H1('Part-of-Speech Tags') + chalk.dim('  — Penn Treebank, as tagged by en-pos'));
  const posWidth = Math.max(...POS_GROUPS.flatMap(g => g.tags.map(([t]) => t.length))) + 2;
  for (const grp of POS_GROUPS) {
    out.push('');
    out.push('  ' + H2(grp.label));
    for (const [tag, g] of grp.tags) out.push(glossRow(tag, g, posWidth));
  }
  out.push('');
  out.push(HR_THIN);
  out.push(H1('Grammatical Dependencies') + chalk.dim('  — relation of each word to its governor (←label)'));
  const depWidth = Math.max(...DEP_GROUPS.flatMap(g => g.deps.map(([d]) => d.length))) + 2;
  for (const grp of DEP_GROUPS) {
    out.push('');
    out.push('  ' + H2(grp.label));
    for (const [dep, g] of grp.deps) out.push(glossRow(dep, g, depWidth));
  }
  return out.join('\n');
}

/**
 * A compact per-line mini-legend: only the POS tags and dependency relations that
 * actually occur in THIS line's parse, defined briefly (no examples), for the head
 * of the detailed view's Phrasal Structure section.  Fits in one or two lines.
 */
function renderLineGlossary(words: ClsWord[]): string[] {
  const posSeen: string[] = [];
  const depSeen: string[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    if (!posSeen.includes(w.lexicalClass)) posSeen.push(w.lexicalClass);
    const dep = w.dependency;
    if (dep && dep.governorIndex > 0 && dep.dependentType && !depSeen.includes(dep.dependentType)) {
      depSeen.push(dep.dependentType);
    }
  }
  // Concise gloss for the mini-legend: drop the comma/parenthesis qualifier that
  // the full legend carries ("noun, singular or mass" → "noun").
  const brief = (name: string): string => name.split(/,| \(/)[0].trim();
  const out: string[] = [];
  if (posSeen.length) {
    const items = posSeen.map(t => chalk.cyan(t) + chalk.dim('=') + W_FUNCTION(brief(POS_GLOSS[t]?.name ?? t)));
    out.push('  ' + chalk.dim('PoS  ') + items.join(chalk.dim(' · ')));
  }
  if (depSeen.length) {
    const items = depSeen.map(d => chalk.cyan(d) + chalk.dim('=') + W_FUNCTION(brief(DEP_GLOSS[d]?.name ?? d)));
    out.push('  ' + chalk.dim('Dep  ') + items.join(chalk.dim(' · ')));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// READING VIEW — original formatting, stress-gradient coloured per syllable
// ═══════════════════════════════════════════════════════════════════════

/** One input line with its (1+) parsed sentence results. */
export interface ReadingLine {
  raw: string;            // the original line text, verbatim
  results: LineResult[];  // a line may parse into more than one sentence
}

/** A stanza: a run of consecutive non-blank input lines. */
export interface ReadingStanza {
  lines: ReadingLine[];
}

/** Surface form reduced to bare lowercase letters (drops apostrophes/hyphens). */
function normWordForm(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

/** Colour each orthographic syllable of an original token by its relative stress. */
function colourToken(tokenText: string, word: ClsWord): string {
  const sylCount = Math.max(1, word.syllables.length);
  const chunks = syllabifyWord(tokenText, sylCount, syllableVowelLengths(word.syllables), word.morphSuffix); // partitions the WHOLE token
  const stresses = chunks.map((_, i) => word.syllables[i]?.relativeStress ?? 'w');

  // Fast path: chunks reconstruct the token exactly (the common case).
  if (chunks.join('') === tokenText) {
    return chunks.map((c, i) => relColour(stresses[i])(c)).join('');
  }

  // Fallback: the syllabifier dropped a delimiter (it strips hyphens), so walk
  // the ORIGINAL token char-by-char, assigning each kept char to its syllable
  // by the chunk lengths and emitting dropped hyphens verbatim.  Every original
  // character is emitted exactly once, so nothing is ever lost.
  const lens = chunks.map(c => c.length);
  let out = '';
  let ci = 0;
  let consumed = 0;
  for (const ch of tokenText) {
    if (ch === '-') { out += ch; continue; }      // dropped delimiter, verbatim
    while (ci < lens.length - 1 && consumed >= lens[ci]) { ci++; consumed = 0; }
    out += relColour(stresses[ci])(ch);
    consumed++;
  }
  return out;
}

/**
 * Project per-syllable stress colours back onto the original line, preserving
 * capitalisation, punctuation, spacing and any extrametrical fragments the
 * pipeline dropped (e.g. possessive "'s").  Word-like tokens are coloured;
 * everything between them (spaces, punctuation, dashes) is emitted verbatim.
 *
 * Alignment is tolerant: it matches each token to the next parsed word by
 * normalised form (equal, or token starts with the word — handling "cat's"),
 * with a small look-ahead resync so a stray/unsyllabified token never derails
 * the rest of the line.  No original character is ever dropped.
 */
export function projectStressOntoLine(rawLine: string, words: ClsWord[]): string {
  const tokenRe = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  let out = '';
  let cursor = 0;
  let wi = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rawLine)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out += rawLine.slice(cursor, start);          // gap text, verbatim
    cursor = end;
    const token = m[0];
    const tokNorm = normWordForm(token);

    const matches = (w: ClsWord | undefined): boolean => {
      if (!w) return false;
      const wn = normWordForm(w.word);
      return wn.length > 0 && (tokNorm === wn || tokNorm.startsWith(wn));
    };

    if (matches(words[wi])) {
      out += colourToken(token, words[wi]);
      wi++;
    } else {
      // Resync: a parsed word may have been skipped (e.g. unsyllabified "'s").
      let found = -1;
      for (let k = wi; k < Math.min(words.length, wi + 4); k++) {
        if (matches(words[k])) { found = k; break; }
      }
      if (found >= 0) {
        out += colourToken(token, words[found]);
        wi = found + 1;
      } else {
        out += token; // leave verbatim; do not advance the word cursor
      }
    }
  }
  out += rawLine.slice(cursor);                    // trailing text, verbatim
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// CAESURA RENDERING  (placement logic now lives in caesura.ts)
// ═══════════════════════════════════════════════════════════════════════

/** Render the glyph for a caesura kind. */
function caesuraGlyph(kind: CaesuraKind): string {
  return kind === 'hard' ? B_CAESURA('‖') : B_CAESURA_SOFT('¦');
}

/** Colour a scansion string ("nws|nns|-wns") letter-by-letter, inserting caesura
 *  marks (at foot boundaries) when a caesura map is supplied. */
function colourScansionMap(scansion: string, caesurae?: Map<number, CaesuraKind>): string {
  let out = '';
  let sc = 0;                       // syllables emitted so far
  const emitted = new Set<number>();
  const caesAt = (): string => {
    if (caesurae && caesurae.has(sc) && !emitted.has(sc)) {
      emitted.add(sc);
      return ' ' + caesuraGlyph(caesurae.get(sc)!) + ' ';
    }
    return '';
  };
  for (const ch of scansion) {
    if (ch === '|') {
      const c = caesAt();
      out += c || B_FOOT('|');
    } else if (ch === '-') {
      out += B_SILENT('-');
    } else if ('xwnms'.includes(ch)) {
      out += caesAt();              // a (rare) mid-foot caesura, inserted inline
      out += relColour(ch as StressLevel)(ch);
      sc++;
    } else {
      out += ch;
    }
  }
  return out;
}

const METER_ABBR: Record<string, string> = {
  iambic: 'iamb', trochaic: 'troch', anapestic: 'anap', dactylic: 'dact',
  amphibrachic: 'amph', bacchic: 'bacch', spondaic: 'spon', pyrrhic: 'pyrr',
  'free verse': 'free',
};

// ── Meter-family colours ───────────────────────────────────────────
// One consistent, legible LIGHT tone per metre family, reused EVERYWHERE a
// metre is named (the reading per-line meter, the top-3 ranking, and the
// synopsis).  The foot-count label (pentameter / octameter…) stays white — we
// tint only the family word, so the output is informative without being gaudy.
const METER_HUE: Record<string, (s: string) => string> = {
  iambic:       chalk.hex('#7fb8ff'),  // light blue
  trochaic:     chalk.hex('#ffc24d'),  // yellow / orange
  dactylic:     chalk.hex('#88e0a0'),  // mid / light green
  amphibrachic: chalk.hex('#ff9ec4'),  // pinkish
  anapestic:    chalk.hex('#ff7a6b'),  // reddish
  bacchic:      chalk.hex('#c08be6'),  // purple / wine
  spondaic:     chalk.hex('#b8b8b8'),
  pyrrhic:      chalk.hex('#b8b8b8'),
};
const METER_FALLBACK = chalk.hex('#cfd8e3'); // free verse / unknown

/** Tint a metre-family WORD (the first token of a metre name) by its hue. */
function meterFamilyColour(family: string): (s: string) => string {
  return METER_HUE[family.toLowerCase()] ?? METER_FALLBACK;
}

/** Colour a full metre label ("iambic pentameter"): family tinted, foot-count
 *  label left white.  Bare "free verse" / multi-word non-families: fallback. */
function colourMeterLabel(meter: string): string {
  const sp = meter.indexOf(' ');
  if (sp < 0) return meterFamilyColour(meter)(meter);
  const family = meter.slice(0, sp);
  const hue = METER_HUE[family.toLowerCase()];
  if (!hue) return METER_FALLBACK(meter);
  return hue(family) + chalk.whiteBright(meter.slice(sp));
}

/** Tint every metre-family word/abbreviation occurring inside a free-form
 *  string (used to colour the synopsis values without restructuring them).
 *  Longest-first so "iamb" inside "iambic" is not matched before the full word. */
const _METER_WORD_RE = /\b(iambic|trochaic|dactylic|amphibrachic|anapestic|bacchic|spondaic|pyrrhic|iamb|troch|dact|amph|anap|bacch|spon|pyrr)\b/gi;
function tintMeterNames(s: string): string {
  return s.replace(_METER_WORD_RE, (w) => {
    const key = w.toLowerCase();
    const fam = key.startsWith('iamb') ? 'iambic' : key.startsWith('troch') ? 'trochaic'
      : key.startsWith('dact') ? 'dactylic' : key.startsWith('amph') ? 'amphibrachic'
      : key.startsWith('anap') ? 'anapestic' : key.startsWith('bacch') ? 'bacchic'
      : key.startsWith('spon') ? 'spondaic' : 'pyrrhic';
    return meterFamilyColour(fam)(w);
  });
}

/** Compact top-3 meter fit scores, e.g. "anap 0.81 · iamb 0.77 · amph 0.74" —
 *  each family abbreviation tinted its hue, the score dimmed, no enclosing
 *  parentheses (set off from the meter name by a dim "|" at the call site). */
function formatRanking(ranking?: MeterScore[]): string {
  if (!ranking || ranking.length === 0) return '';
  const top = ranking.slice(0, 3).map(r =>
    meterFamilyColour(r.meter)(METER_ABBR[r.meter] ?? r.meter) + chalk.dim(' ' + r.score.toFixed(2)));
  return top.join(chalk.dim(' · '));
}

/** Divergence notes.  After the continuity rename, a near-tie line's BASE
 *  meter is already the stanza/poem-dominant one and `standaloneMeter` records
 *  the numerically-best standalone reading ("≈ continuity; standalone:
 *  dactylic tetrameter").  `consensusMeter` survives only when the forced
 *  re-fit failed — then the old "aligns w/" annotation still applies. */
function consensusNote(detail: { consensusMeter?: string; standaloneMeter?: string }): string {
  if (detail.standaloneMeter) {
    return chalk.dim.italic(`  ≈ continuity; standalone: ${detail.standaloneMeter}`);
  }
  if (!detail.consensusMeter) return '';
  return chalk.dim.italic(`  ↔ aligns w/ stanza ${detail.consensusMeter}`);
}

/** Non-classical rhythm annotation (dolnik / taktovik / accentual), set by the
 *  rhythm layer.  Shown as a separate chip AFTER the meter — it supplements the
 *  classical reading (in beats), it never replaces it. */
function rhythmNoteStr(detail: { rhythmNote?: string }): string {
  if (!detail.rhythmNote) return '';
  const note = detail.rhythmNote;
  // Some notes (the 4/3 accentual) already carry a ♪; don't double it.
  return chalk.magenta.dim('  ' + (note.includes('♪') ? note : '♪ ' + note));
}

/** Rhyme chip for a line: the end-rhyme scheme letter with its rhyme TYPE
 *  (e.g. "A(perfect)"; '·' = unrhymed), PLUS any pre-caesural INTERNAL rhymes,
 *  each parenthesised and cyan with its own type, shown before the end letter:
 *  e.g. "(C)(perfect) A(perfect)". */
function rhymeStr(detail: {
  rhyme?: { letter: string; type?: string; internal?: { letter: string; type?: string }[] };
}): string {
  const r = detail.rhyme;
  if (!r) return '';
  const parts: string[] = [];
  for (const iw of r.internal ?? []) {
    parts.push(chalk.cyan(`(${iw.letter})`) + (iw.type ? chalk.dim(`(${iw.type})`) : ''));
  }
  if (r.letter && r.letter !== '·') {
    parts.push(chalk.yellowBright(r.letter) + (r.type ? chalk.dim(`(${r.type})`) : ''));
  } else if (parts.length === 0) {
    parts.push(chalk.dim('·'));
  }
  return '  ' + parts.join(' ');
}

/** Non-punctuation, syllable-bearing words across all of a line's sentences. */
function collectLineWords(ln: ReadingLine): ClsWord[] {
  const ws: ClsWord[] = [];
  for (const res of ln.results) {
    for (const w of res.sentence.words) {
      if (!isPunctuation(w.lexicalClass) && w.syllables.length > 0) ws.push(w);
    }
  }
  return ws;
}

/**
 * The Phonopoetics block of the synopsis: end / caesural / head rhymes (each
 * letter coloured by the strongest relative-stress tier it spans), alliteration,
 * and acrostics.  Only subsections actually present in the poem are shown.
 */
function renderPhonopoetics(p: Phonopoetics): string[] {
  // a rhyme pair "word [A|L1(|kind)] -> word [A|L4]", letter tinted by top stress
  const rel = (r: RhymeRel): string => {
    const L = relColour(r.topStress)(r.letter);
    const D = chalk.dim;
    const kindTag = r.kind === 'end' ? '' : D('|' + r.kind);
    const typ = r.type ? D(` ${r.type}`) : '';
    return chalk.white(r.fromWord) + ' ' + D('[') + L + D('|') + D(r.fromLabel) + kindTag + D(']')
      + D(' → ') + chalk.white(r.toWord) + ' ' + D('[') + L + D('|') + D(r.toLabel) + D(']') + typ;
  };
  const SEP = chalk.dim('  ·  ');
  const sub: { label: string; body: string }[] = [];
  if (p.end.length)       sub.push({ label: 'End-Rhymes',      body: p.end.map(rel).join(SEP) });
  if (p.caesural.length)  sub.push({ label: 'Caesural Rhymes', body: p.caesural.map(rel).join(SEP) });
  if (p.head.length)      sub.push({ label: 'Head Rhymes',     body: p.head.map(rel).join(SEP) });
  if (p.alliteration.length) sub.push({
    label: 'Alliteration',
    body: p.alliteration.map(a => chalk.white(a.words.join(' ')) + chalk.dim(` (${a.label})`)).join(SEP),
  });
  if (p.acrostics.length) sub.push({
    label: 'Acrostic',
    body: p.acrostics.map(a =>
      a.firsts.map((f, i) => chalk.dim('[' + a.labels[i] + ':') + chalk.whiteBright(f) + chalk.dim(']')).join('')
      + chalk.dim(' → ') + chalk.yellowBright(a.word)).join(SEP),
  });
  if (sub.length === 0) return [];

  const out: string[] = ['', chalk.bold.cyan('Phonopoetics:')];
  const w = Math.max(...sub.map(s => s.label.length)) + 2;
  for (const s of sub) out.push('  ' + chalk.bold((s.label + ':').padEnd(w)) + s.body);
  return out;
}

/**
 * Reading view: the poem itself in its original formatting, each syllable
 * coloured by 4-tier relative stress, followed by a same-structure block of
 * per-line stress maps + meter (with top-3 fit scores).  This is the whole
 * output for this mode — not the full per-line analytic dump.
 */
/** A verse line CLOSED by terminal or clause punctuation is END-STOPPED (a
 *  prosodic pause at the line break); one ending on a word with no boundary
 *  punctuation RUNS ON — enjambment — its intonational unit spilling into the
 *  next line.  (Trailing quotes/brackets are ignored when judging the close.) */
function lineRunsOn(raw: string): boolean {
  const t = raw.replace(/["'’”»)\]]+$/, '').trimEnd();
  if (!t) return false;
  return !/[.!?;:,—–…]$/.test(t);
}

/** Poem-wide enjambment summary (end-stopped vs run-on line-ends), or null for
 *  a single line.  The final line is terminal by position, so only the
 *  line-INTERNAL breaks (lines 1..n-1) are judged. */
function summariseEnjambment(stanzas: ReadingStanza[]): string | null {
  const raws = stanzas.flatMap(st => st.lines.map(l => l.raw));
  if (raws.length < 2) return null;
  const interior = raws.slice(0, -1);
  const enjambed: number[] = [];
  interior.forEach((r, i) => { if (lineRunsOn(r)) enjambed.push(i + 1); });
  const n = interior.length, k = enjambed.length;
  if (k === 0) return 'end-stopped throughout';
  const where = k <= 6 ? ' (lines ' + enjambed.join(', ') + ')' : '';
  return k >= Math.ceil(n / 2)
    ? `predominantly enjambed — ${k} of ${n} line-ends run on${where}`
    : `mostly end-stopped — ${k} of ${n} line-ends enjambed${where}`;
}

export function renderReadingView(stanzas: ReadingStanza[]): string {
  const out: string[] = [];
  const multiStanza = stanzas.length > 1;

  out.push('');
  out.push(HR);
  out.push(H1('Reading View') + chalk.dim('  — stress gradient over input text'));
  out.push('');

  // ── Block 1: the poem, original formatting, syllables coloured ──
  // Multi-stanza poems get a right-aligned "Stanza N" counter in the blank line
  // before each stanza after the first (the gaps between stanzas).
  for (let s = 0; s < stanzas.length; s++) {
    if (multiStanza && s > 0) {
      out.push('');
      out.push(chalk.dim.italic(('Stanza ' + (s + 1)).padStart(HR.length)));
    }
    for (const ln of stanzas[s].lines) {
      out.push(projectStressOntoLine(ln.raw, collectLineWords(ln)));
    }
  }

  out.push('');
  out.push(HR_THIN);
  out.push(H1('Stress Maps, Meter, & Rhymes') + chalk.dim('  — top-3 fit scores per line'));
  out.push('');

  // ── Block 2: stress maps + meter, same stanza/line structure ──
  for (let s = 0; s < stanzas.length; s++) {
    const firstDetail = stanzas[s].lines.flatMap(l => l.results)[0]?.phonologicalScansion;
    const formNote = firstDetail?.formNote ? chalk.green.dim('  ❡ ' + firstDetail.formNote) : '';
    if (multiStanza) out.push(H2('Stanza ' + (s + 1)) + formNote);
    else if (formNote) out.push(formNote.trim());
    for (let l = 0; l < stanzas[s].lines.length; l++) {
      const ln = stanzas[s].lines[l];
      const baseLabel = multiStanza ? `S${s + 1}L${l + 1}` : `L${l + 1}`;
      if (ln.results.length === 0) {
        out.push('  ' + chalk.dim(baseLabel.padEnd(8) + '(no parse)'));
        continue;
      }
      for (let r = 0; r < ln.results.length; r++) {
        const res = ln.results[r];
        const d = res.phonologicalScansion;
        const label = ln.results.length > 1 ? `${baseLabel}.${r + 1}` : baseLabel;
        const caesurae = computeCaesurae(res.sentence.words, res.phonologicalHierarchy, d.scansion);
        const map = colourScansionMap(d.scansion, caesurae);
        const rank = formatRanking(d.ranking);
        out.push('  ' + chalk.bold(label.padEnd(8)) + map + '  ' +
          colourMeterLabel(d.meter) + (rank ? chalk.dim(' | ') + rank : '') + consensusNote(d) + rhythmNoteStr(d) + rhymeStr(d));
      }
    }
    if (multiStanza && s < stanzas.length - 1) out.push('');
  }

  // ── Block 3: Legend ──
  // Kept ABOVE the synopsis: the legend serves the Stress Maps & Meter, and the
  // Phonopoetics subsection of the synopsis below can run long — left at the
  // bottom it gets pushed out of the field of view.
  out.push('');
  out.push(HR_THIN);
  out.push(renderLegend());

  // ── Block 4: cumulative poem synopsis (non-interfering meta-measure) ──
  // Several top conclusions about the poem as a whole, drawn only from the
  // per-line determinations above — never overriding any of them.
  const synopsis = summarizePoem(stanzas.map(st => st.lines.flatMap(l => l.results)));
  if (synopsis.length > 0) {
    out.push('');
    out.push(HR_THIN);
    out.push(H1('Poem Synopsis') + chalk.dim(' In short, we have:'));
    out.push('');
    const w = Math.max(...synopsis.map(r => r.label.length)) + 2;
    for (const row of synopsis) {
      const label = chalk.bold.cyan((row.label + ':').padEnd(w));
      // Colour the value so the block is not a wall of white: tint any metre
      // names their family hue, and highlight the mean-fit %.
      let val = tintMeterNames(row.value);
      if (row.label === 'Meter') val = val.replace(/~\d+%/, (m) => chalk.yellow(m));
      out.push('  ' + label + val);
    }
    // Enjambment / end-stop — a poem-wide reading of the line-ends.
    const enj = summariseEnjambment(stanzas);
    if (enj) out.push('  ' + chalk.bold.cyan('Enjambment:'.padEnd(w)) + chalk.dim(enj));
    // Phonopoetics — end / caesural / head rhymes, alliteration, acrostic.
    out.push(...renderPhonopoetics(analyzePhonopoetics(stanzas.map(st => st.lines.flatMap(l => l.results)))));
  }

  out.push('');
  out.push(HR);
  return out.join('\n');
}

```

## clio/engine.ts

```typescript
// clio/engine.ts — the "Clio" engine: a FROZEN snapshot of the original
// per-sentence prosodic analysis as it stood before the Calliope rebuild
// (commit 3c016ad).  Clio is Calliope's historian sister — the legacy /
// alternative parse, kept verbatim and reachable from the CLI menu
// ("Ask Clio instead (alternative parse)") and the `--clio` flag.
//
// DO NOT evolve this file with the Calliope rebuild.  It deliberately pins the
// prior behaviour so the maintainer can A/B the new faithful engine against it.
// It composes the existing, unchanged linguistic modules in the original order.

import { ClsSentence, IntonationalUnit } from '../types.js';
import {
  assignLexicalStress,
  applyCompoundStress,
  applyNuclearStress,
  assignRelativeStresses,
} from './stress.js';
import { computePhraseStress } from './phrasestress.js';
import { buildPhonologicalHierarchy } from './phonological.js';
import { ProsodyEngine } from '../engine.js';

/** The original per-sentence sequence lifted verbatim from `processLine`. */
function analyzeSentenceClio(sent: ClsSentence): IntonationalUnit[] {
  assignLexicalStress(sent.words);
  const ius = buildPhonologicalHierarchy(sent);
  applyCompoundStress(ius);
  applyNuclearStress(ius);
  // McAleese's Phrase-Stress phase (integer nuclear ramp); populates
  // word.phraseStress, consumed by the relativiser.
  computePhraseStress(sent.words);
  assignRelativeStresses(sent.words, ius);
  return ius;
}

export const clioEngine: ProsodyEngine = {
  name: 'clio',
  analyzeSentence: analyzeSentenceClio,
};

```

## clio/parser.ts

```typescript
// parser.ts — Syntactic dependency parser powered by FinNLP, producing
// ClsDocument with full dependency graph and phrase‑structure node tree
// that matches the Universal Dependencies format as used in McAleese’s Calliope.

import * as Lexed from 'lexed';
import * as EnPos from 'en-pos';
import * as EnParse from 'en-parse';
import * as EnNorm from 'en-norm';
import { correctTags } from './tagfix.js';
import { applyDepFixes } from './depfix.js';
import {
  ClsDocument,
  ClsSentence,
  ClsWord,
  ClsDependency,
  ClsNode
} from '../types.js';

// ─── Local type declarations for the FinNLP API ────────────────────
// These mirror the actual interfaces exported by finnlp / en-parse.
// (The library ships with .d.ts files, but declaring them here ensures
// type‑safety even if the consumer’s tsconfig resolution differs.)

interface FinDepNode {
  label: string;      // dependency label, e.g. "NSUBJ", "ROOT"
  type: string;       // phrase type, e.g. "NP", "VP"
  parent: number;     // 0‑based index of governor token; -1 for root
}

interface FinNodeInterface {
  left: FinNodeInterface[];
  right: FinNodeInterface[];
  tokens: string[];
  tags: string[];
  index: number[];     // [from, to] inclusive token indices (0‑based)
  type: string;
  label: string;
}

interface FinSentenceResult {
  sentence: string;
  tokens: string[];
  lemmas: string[];
  tags: string[];
  deps: FinDepNode[];
  depsTree: FinNodeInterface;
  confidence: number;
}

interface FinRunInstance {
  raw: string;
  intercepted: string;
  sentences: FinSentenceResult[];
}

// ─── Contraction re‑merging ───────────────────────────────────────
// FinNLP's en‑norm module resolves contractions (e.g. "we'll" → "we" + "will"),
// producing 2 tokens from 1. For scansion, the contracted form must be
// 1 phonetic unit. This step re‑merges dehiscised contraction pairs
// after parsing, using the raw text to distinguish genuine contractions
// from accidental "host + clitic" word sequences.

interface ContractionEntry {
  host: string;
  clitic: string;
}

const CONTRACTION_MAP: Record<string, ContractionEntry> = {
  "we'll":     { host: 'we',     clitic: 'will' },
  "we've":     { host: 'we',     clitic: 'have' },
  "we're":     { host: 'we',     clitic: 'are' },
  "we'd":      { host: 'we',     clitic: 'would' },
  "i'll":      { host: 'i',      clitic: 'will' },
  "i've":      { host: 'i',      clitic: 'have' },
  "i'm":       { host: 'i',      clitic: 'am' },
  "i'd":       { host: 'i',      clitic: 'would' },
  "you'll":    { host: 'you',    clitic: 'will' },
  "you've":    { host: 'you',    clitic: 'have' },
  "you're":    { host: 'you',    clitic: 'are' },
  "you'd":     { host: 'you',    clitic: 'would' },
  "he'll":     { host: 'he',     clitic: 'will' },
  "he's":      { host: 'he',     clitic: 'is' },
  "he'd":      { host: 'he',     clitic: 'would' },
  "she'll":    { host: 'she',    clitic: 'will' },
  "she's":     { host: 'she',    clitic: 'is' },
  "she'd":     { host: 'she',    clitic: 'would' },
  "it'll":     { host: 'it',     clitic: 'will' },
  "it'd":      { host: 'it',     clitic: 'would' },
  "they'll":   { host: 'they',   clitic: 'will' },
  "they've":   { host: 'they',   clitic: 'have' },
  "they're":   { host: 'they',   clitic: 'are' },
  "they'd":    { host: 'they',   clitic: 'would' },
  "that's":    { host: 'that',   clitic: 'is' },
  "that'll":   { host: 'that',   clitic: 'will' },
  "this'll":   { host: 'this',   clitic: 'will' },
  "it's":      { host: 'it',     clitic: 'is' },
  "who'll":    { host: 'who',    clitic: 'will' },
  "who's":     { host: 'who',    clitic: 'is' },
  "who'd":     { host: 'who',    clitic: 'would' },
  "who've":    { host: 'who',    clitic: 'have' },
  "what's":    { host: 'what',   clitic: 'is' },
  "there's":   { host: 'there',  clitic: 'is' },
  "here's":    { host: 'here',   clitic: 'is' },
  "where's":   { host: 'where',  clitic: 'is' },
  "when's":    { host: 'when',   clitic: 'is' },
  "how's":     { host: 'how',    clitic: 'is' },
  "why's":     { host: 'why',    clitic: 'is' },
  "one's":     { host: 'one',    clitic: 'is' },
  "let's":     { host: 'let',    clitic: 'us' },
  "y'all":     { host: 'you',    clitic: 'all' },
  "don't":     { host: 'do',     clitic: 'not' },
  "can't":     { host: 'can',    clitic: 'not' },
  "won't":     { host: 'will',   clitic: 'not' },
  "shouldn't": { host: 'should', clitic: 'not' },
  "couldn't":  { host: 'could',  clitic: 'not' },
  "wouldn't":  { host: 'would',  clitic: 'not' },
  "isn't":     { host: 'is',     clitic: 'not' },
  "aren't":    { host: 'are',    clitic: 'not' },
  "wasn't":    { host: 'was',    clitic: 'not' },
  "weren't":   { host: 'were',   clitic: 'not' },
  "haven't":   { host: 'have',   clitic: 'not' },
  "hasn't":    { host: 'has',    clitic: 'not' },
  "hadn't":    { host: 'had',    clitic: 'not' },
  "didn't":    { host: 'did',    clitic: 'not' },
  "doesn't":   { host: 'does',   clitic: 'not' },
  "ain't":     { host: 'am',     clitic: 'not' },
  "might've":  { host: 'might',  clitic: 'have' },
  "would've":  { host: 'would',  clitic: 'have' },
  "should've": { host: 'should', clitic: 'have' },
  "could've":  { host: 'could',  clitic: 'have' },
  "must've":   { host: 'must',   clitic: 'have' },
};

interface RawSegment {
  text: string;
  isContraction: boolean;
  isArchaicD: boolean;   // poetic preterite "-'d" (fix'd, lov'd, charm'd) — NOT a real
                         // contraction, but en-norm dehiscises it as host + "would",
                         // misaligning the whole rest of the line.  Re-merged
                         // conditionally (only when the would/had token is present).
}

/** Archaic poetic "-'d" preterite: any -'d form that is not a genuine pronoun/wh
 *  contraction (those live in CONTRACTION_MAP and are checked first).  Hyphenated
 *  compounds count too (hen-peck'd, half-hid'd) — en-norm keeps the compound as one
 *  token but dehiscises the -'d into "would", which the merge re-attaches. */
const ARCHAIC_D_RE = /^[a-z]+(?:-[a-z]+)*'d$/;

/**
 * Tokenise the raw (un‑normalised) text into word‑like segments,
 * marking which are contracted forms.
 */
function tokenizeRawText(text: string): RawSegment[] {
  // A hyphenated word that carries an apostrophe-suffix (hen-peck'd, ne'er-do-well's)
  // is ONE segment — en-norm keeps the hyphen compound as a single token, so splitting
  // it here (→ "hen" + "peck'd") desynced the segment↔token walk and broke the -'d
  // re-merge.  Plain hyphen compounds WITHOUT an apostrophe (torch-flames) still split,
  // exactly as before (the first alternative requires a trailing 'x), so mergeHyphenated-
  // Words keeps handling those.
  const re = /\b[a-zA-Z]+(?:-[a-zA-Z]+)*'[a-zA-Z]+\b|\b[a-zA-Z]+(?:'[a-zA-Z]+)?\b/g;
  const segments: RawSegment[] = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    const lower = match[0].toLowerCase();
    const isContraction = lower in CONTRACTION_MAP;
    segments.push({
      text: lower,
      isContraction,
      isArchaicD: !isContraction && ARCHAIC_D_RE.test(lower),
    });
  }
  return segments;
}

/**
 * Re‑merge contraction pairs in a sentence's ClsWord array.
 *
 * Segments from the raw text are walked in parallel with the sentence's
 * tokens. Non‑contraction segments consume 1 token; contraction segments
 * consume 2 tokens (host + clitic), which are merged into a single ClsWord
 * that preserves the host's properties and the original contracted form.
 *
 * Returns the updated word array.
 */
function mergeContractionsInSentence(
  words: ClsWord[],
  segments: RawSegment[],
  startSegmentIdx: number
): { words: ClsWord[]; consumedSegments: number } {
  const merged: ClsWord[] = [];
  let tokenIdx = 0;
  let segIdx = startSegmentIdx;

  while (tokenIdx < words.length && segIdx < segments.length) {
    // Punctuation tokens have NO raw-text segment (tokenizeRawText matches only
    // letter sequences), so they must not consume a segment.  Otherwise a
    // sentence ending in "!"/"." over-advances segIdx and misaligns every later
    // sentence — dropping a pronoun that precedes a contraction ("No more! He
    // won't…" lost "He" and mis-tagged the contraction PRP).
    if (isPunctuation(words[tokenIdx].lexicalClass)) {
      merged.push(words[tokenIdx]);
      tokenIdx++;
      continue;
    }

    const seg = segments[segIdx];

    // Archaic poetic preterite ("fix'd", "lov'd"): en-norm expands the -'d into a
    // separate "would"/"had" token, splitting one syllable into two words AND
    // shifting every later token off its raw segment.  Re-merge host + modal back
    // into the apostrophized form — but ONLY when the spurious modal is actually
    // there (conditional, so a hand-typed "fix'd" that survived intact is safe).
    if (seg.isArchaicD) {
      const next = tokenIdx + 1 < words.length ? words[tokenIdx + 1].word.toLowerCase() : '';
      if (next === 'would' || next === 'had') {
        merged.push({ ...words[tokenIdx], word: seg.text });
        tokenIdx += 2;
        segIdx++;
        continue;
      }
      merged.push(words[tokenIdx]);
      tokenIdx++;
      segIdx++;
      continue;
    }

    if (seg.isContraction) {
      if (tokenIdx + 1 >= words.length) {
        merged.push(words[tokenIdx]);
        tokenIdx++;
        segIdx++;
        continue;
      }

      const hostWord = words[tokenIdx];
      const cliticWord = words[tokenIdx + 1];

      // Keep the host as the merged word, update its text to the contracted form.
      const mergedWord: ClsWord = {
        ...hostWord,
        word: seg.text,
      };

      merged.push(mergedWord);
      tokenIdx += 2;
      segIdx++;
    } else {
      merged.push(words[tokenIdx]);
      tokenIdx++;
      segIdx++;
    }
  }

  // Append any remaining words that exceeded segment count.
  while (tokenIdx < words.length) {
    merged.push(words[tokenIdx]);
    tokenIdx++;
  }

  return { words: merged, consumedSegments: segIdx - startSegmentIdx };
}

function mergeHyphenatedWords(words: ClsWord[]): ClsWord[] {
  const merged: ClsWord[] = [];
  let i = 0;
  while (i < words.length) {
    if (i + 2 < words.length &&
        words[i + 1].word === '-' &&
        !isPunctuation(words[i].lexicalClass) &&
        !isPunctuation(words[i + 2].lexicalClass)) {
      const combined = words[i].word + '-' + words[i + 2].word;
      const mergedWord: ClsWord = {
        ...words[i],
        word: combined,
        lexicalClass: words[i + 2].lexicalClass.startsWith('N') ? words[i + 2].lexicalClass : words[i].lexicalClass,
        isContent: words[i].isContent || words[i + 2].isContent,
      };
      merged.push(mergedWord);
      i += 3;
    } else {
      merged.push(words[i]);
      i++;
    }
  }
  return merged;
}

// ─── Mappings: FinNLP → Antelope‑compatible labels ──────────────────
// FinNLP (aka Stanford Dependency Types) versus Antelope NLP dependency (aka Universal Dependencies) type equivalencies.

const FIN_TO_ANTELOPE_LABEL: Record<string, string> = {
  AUX:       'aux',
  AUXPASS:   'auxpass',
  NSUBJ:     'nsubj',
  NSUBJPASS: 'nsubjpass',
  DOBJ:      'dobj',
  IOBJ:      'iobj',
  OBL:       'pobj',        // OBL (oblique) ≈ pobj in Antelope
  DET:       'det',
  CASE:      'prep',        // CASE marks the preposition; matched to UD prep
  CC:        'cc',
  COMPMARK:  'mark',
  ADVMARK:   'mark',
  NOMD:      'poss',        // nominal modifier ≈ possessive relation
  AMOD:      'amod',
  ADVMOD:    'advmod',
  ADVCL:     'advcl',
  XCOMP:     'xcomp',
  CCOMP:     'ccomp',
  ACL:       'acl',
  VPRT:      'prt',
  NUMDMOD:   'nummod',
  EXPL:      'expl',
  DISCOURSE: 'discourse',
  PUNCT:     'punct',
  INTERJ:    'intj',
  EXT:       'dep',         // extension – best mapped to generic 'dep'
  DEP:       'dep',
  ROOT:      'root',
};

function toAntelopeLabel(finLabel: string): string {
  return FIN_TO_ANTELOPE_LABEL[finLabel] ?? finLabel.toLowerCase();
}

const CONTENT_POS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS',
  'JJ', 'JJR', 'JJS',
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ',
  'RB', 'RBR', 'RBS',
  'CD',                         // cardinal numbers (content‑like)
]);

/** Punctuation POS tags that should not be syllabified. */
const PUNCT_TAGS = new Set([
  ',', '.', ':', ';', '!', '?',
  '-LRB-', '-RRB-', '``', "''",
  '--', '...', '"', "'",
  '(', ')', '[', ']', '{', '}',  // FinNLP emits literal bracket tags, not -LRB-/-RRB-
]);

export function isPunctuation(tag: string): boolean {
  return PUNCT_TAGS.has(tag);
}

/**
 * Quotation-mark tags.  Quotes are tokens (never syllabified) but NOT prosodic
 * breaks: a quoted word inside a clause ('call them "wisdom" teeth') is read in
 * one breath — no intonational boundary, no caesura.  Treating quotes as IU
 * boundaries fragmented such lines into 3-4 IUs and flipped their meter.
 */
const QUOTE_TAGS = new Set(['``', "''", '"', "'"]);

export function isQuoteTag(tag: string): boolean {
  return QUOTE_TAGS.has(tag);
}

/**
 * Typographic dashes that FinNLP mis-tags as content words.  A standalone en-dash
 * "–", em-dash "—", horizontal bar "―", minus sign "−" or a run of 2+ hyphens is a
 * prosodic break (a dash caesura), NOT a stress-bearing token — but FinNLP's POS
 * model labels the bare glyph `NNP` (proper noun), so it flowed through the
 * pipeline, received a syllable, and even attracted a strong metrical beat
 * ("crunch – a guilt" scanned the dash as 's').  We re-tag any such glyph to the
 * Penn dash/colon class ':' (already an IU/caesura boundary) at parse time, so the
 * dash drops out of syllabification & scansion and instead marks a pause.
 * A *single* hyphen-minus is deliberately excluded — it joins hyphenated compounds
 * ("torch-flames") handled by mergeHyphenatedWords.
 */
const DASH_GLYPH_RE = /^(?:[‒–—―−]+|-{2,})$/;
function isDashGlyph(word: string): boolean {
  return DASH_GLYPH_RE.test(word);
}

const DASH_CLASS = '‒–—―−';   // figure / en / em / bar / minus
const DASH_GLYPHS_RE = new RegExp(`[${DASH_CLASS}]`, 'g');
const DASH_PAREN_RE = new RegExp(`([${DASH_CLASS}])([^${DASH_CLASS}]*?[.!?][^${DASH_CLASS}]*?)([${DASH_CLASS}])`, 'g');

/**
 * Normalize dash *usages* to comma clause-breaks BEFORE parsing.  In verse a dash
 * is a comma-like prosodic break — not a word, not a sentence end — but FinNLP
 * mis-handles it two ways: it glues a SPACE-flanked hyphen-minus into the
 * neighbouring word ("I still carry - Oh" → token "carry-Oh", then OOV), and it
 * tags a bare en/em-dash as a proper noun (NNP) that pollutes the dependency tree.
 * Worse, a parenthetical aside set off by dashes often contains sentence-final
 * punctuation ("– Oh, Petersburg! –") that splits the line into separate
 * sentences and severs the main clause's dependencies (here, carry↔address).
 *
 * So we (1) fold every dash usage — em/en/figure/bar/minus, a 2+ hyphen run, or a
 * space-flanked single hyphen — into a canonical dash glyph (leaving unspaced
 * hyphen compounds like "torch-flames" intact for `mergeHyphenatedWords`);
 * (2) neutralize sentence-final punctuation INSIDE a dash-delimited parenthetical
 * so the line stays one sentence; (3) rewrite the dashes to commas, which FinNLP
 * parses cleanly and which are the same prosodic break (a comma is an IU boundary
 * → caesura).  The verbatim original (dashes and all) is preserved by the caller
 * for the reading-view projection; only the parser's working copy is normalized.
 */
function normalizeDashesToClauseBreaks(text: string): string {
  // (1) space-flanked single/multi hyphen-minus, and any 2+ hyphen run → en-dash
  text = text.replace(/(^|\s)-+(?=\s|$)/g, '$1–');
  text = text.replace(/-{2,}/g, '–');
  // (2) neutralize sentence-final punctuation between paired dashes (keeps it one sentence)
  text = text.replace(DASH_PAREN_RE, (_m, a, inner, b) => a + inner.replace(/[.!?]+/g, ',') + b);
  // (3) dash glyphs → comma clause-break
  text = text.replace(DASH_GLYPHS_RE, ',');
  // tidy: collapse comma runs, no space before a comma, one space after, no leading comma
  text = text.replace(/(?:\s*,\s*){2,}/g, ', ')
             .replace(/\s+,/g, ',')
             .replace(/,(\S)/g, ', $1')
             .replace(/^\s*,\s*/, '');
  return text;
}

function isContentWord(tag: string): boolean {
  return CONTENT_POS.has(tag);
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Parse a multi‑sentence text string and return a ClsDocument whose
 * internal structure mirrors the Antelope NLP (aka Universal Dependency type)
 * output from McAleese’s original Calliope implementation.
 */
export function parseDocument(text: string): ClsDocument {
  // Collapse runs of sentence-final punctuation (ellipsis "...", "!!", "??")
  // to a single mark BEFORE tokenisation.  FinNLP otherwise glues the surplus
  // marks onto the preceding word ("springtime..." → token "springtime.." → OOV,
  // mis-tagged JJ, mis-syllabified, and re-phrased), which made two lines that
  // differ only in trailing punctuation scan differently.  This is metrically
  // harmless (punctuation bears no syllable); the verbatim original is preserved
  // by the caller and used for the reading projection.
  text = text.replace(/([.!?])\1+/g, '$1');

  // Dashes → comma clause-breaks (fixes "carry-Oh" gluing AND the parenthetical
  // sentence-split that severs main-clause dependencies).  See the helper above.
  text = normalizeDashesToClauseBreaks(text);

  // Pre‑scan the raw text for contraction positions before FinNLP
  // normalises them away.
  const rawSegments = tokenizeRawText(text);

  // Run the FinNLP pipeline STAGED rather than via `Fin.Run`, so the tag-
  // correction layer (tagfix.ts) sits between en-pos and en-parse: corrected
  // tags repair the tagging AND the dependency tree built from it.  The
  // stages below mirror finnlp's own Run() exactly (en-norm → lexed →
  // en-pos → en-parse); lemmas are skipped (unused downstream).
  const intercepted = EnNorm.resolveContractions(EnNorm.replaceConfusables(text));
  const lexer = new Lexed.Lexed(intercepted).lexer();
  const runner: FinRunInstance = { raw: text, intercepted, sentences: [] };
  for (let li = 0; li < lexer.sentences.length; li++) {
    const tokens = EnNorm.normalizeCaps(lexer.tokens[li]);
    const tagging = new EnPos.Tag(tokens).initial().smooth();
    const tags = correctTags(tokens, tagging.tags);
    const depsTree = EnParse.tree(tags, tokens)[0];
    runner.sentences.push({
      sentence: lexer.sentences[li],
      tokens, tags, lemmas: [],
      depsTree,
      // Post-parse dependency repair (depfix.ts): systematic en-parse
      // attachment errors (noun-compound double-objects, dangling DT).
      deps: applyDepFixes(tokens, tags, EnParse.toArray(depsTree)),
      confidence: 0,
    });
  }

  const sentences: ClsSentence[] = [];
  let absoluteOffset = 0;
  let segmentIdx = 0;

  for (let si = 0; si < runner.sentences.length; si++) {
    const s = runner.sentences[si];
    const rawTokens: string[] = s.tokens;
    const rawTags: string[] = s.tags;
    const rawDeps: FinDepNode[] = s.deps;

    // ---- 1. Build ClsWord array ----
    const wordsPre: ClsWord[] = rawTokens.map((word, i) => {
      // Re-tag a mis-tagged dash glyph (FinNLP labels "–"/"—" as NNP) to the Penn
      // dash class ':' so it acts as a caesura/IU boundary, not a stressable word.
      const tag = isDashGlyph(word) ? ':' : rawTags[i];
      return ({
      index: i + 1,                             // 1‑based, matching Antelope
      lexicalClass: tag,
      lexicalDetails: '',
      lexicalPlural: tag === 'NNS' || tag === 'NNPS',
      position: '',
      word,
      absoluteIndex: absoluteOffset + i,
      isContent: isContentWord(tag),
      syllables: [],                            // filled later by stress module
      phraseStress: 0,
      dependency: undefined,                    // patched below
      node: undefined,                          // patched below
    });
    });

    // ---- 1a. Re‑merge contraction pairs ----
    const { words: contractedWords, consumedSegments } = mergeContractionsInSentence(
      wordsPre, rawSegments, segmentIdx
    );
    segmentIdx += consumedSegments;

    // ---- 1b. Re‑merge hyphenated words ----
    const words = mergeHyphenatedWords(contractedWords);

    // Re‑index words after merging (1‑based).
    words.forEach((w, i) => {
      w.index = i + 1;
    });

    // ---- 2. Build ClsDependency array ----
    const dependencies: ClsDependency[] = [];

    // Build contraction merge map: wordsPre idx → contractedWords idx.
    // MUST replay mergeContractionsInSentence exactly: punctuation tokens have no
    // raw segment (consume none), and an archaic -'d merges only when the
    // spurious would/had token follows.
    const contractionMap = new Map<number, number>();
    let pi = 0;
    let qi = 0;
    let segOff = segmentIdx - consumedSegments;
    while (pi < wordsPre.length && segOff < segmentIdx) {
      if (isPunctuation(wordsPre[pi].lexicalClass)) {
        contractionMap.set(pi, qi);
        pi++;
        qi++;
        continue;
      }
      const seg = rawSegments[segOff];
      const archaicMerge = seg.isArchaicD
        && pi + 1 < wordsPre.length
        && ['would', 'had'].includes(wordsPre[pi + 1].word.toLowerCase());
      if ((seg.isContraction && pi + 1 < wordsPre.length) || archaicMerge) {
        contractionMap.set(pi, qi);
        contractionMap.set(pi + 1, qi);
        pi += 2;
        qi += 1;
        segOff++;
      } else {
        contractionMap.set(pi, qi);
        pi++;
        qi++;
        segOff++;
      }
    }
    while (pi < wordsPre.length) {
      contractionMap.set(pi, qi);
      pi++;
      qi++;
    }

    // Build hyphen merge map: contractedWords idx → words idx
    const hyphenMap = new Map<number, number>();
    let ci = 0;
    let wi = 0;
    while (ci < contractedWords.length) {
      if (ci + 2 < contractedWords.length &&
          contractedWords[ci + 1].word === '-' &&
          !isPunctuation(contractedWords[ci].lexicalClass) &&
          !isPunctuation(contractedWords[ci + 2].lexicalClass)) {
        hyphenMap.set(ci, wi);
        hyphenMap.set(ci + 1, wi);
        hyphenMap.set(ci + 2, wi);
        ci += 3;
        wi++;
      } else {
        hyphenMap.set(ci, wi);
        ci++;
        wi++;
      }
    }

    // Compose: wordsPre idx → words idx
    const mergeMap2 = new Map<number, number>();
    for (const [preIdx, cIdx] of contractionMap) {
      const wIdx = hyphenMap.get(cIdx);
      if (wIdx !== undefined) mergeMap2.set(preIdx, wIdx);
    }

    // Build dependencies from rawDeps, remapping governor and dependent indices.
    for (let i = 0; i < rawDeps.length; i++) {
      const dep = rawDeps[i];
      const govPreIdx = dep.parent;               // 0‑based, -1 for root
      const depPreIdx = i;

      const govPostIdx = govPreIdx >= 0 ? mergeMap2.get(govPreIdx) : undefined;
      const depPostIdx = mergeMap2.get(depPreIdx);

      if (depPostIdx === undefined) continue;
      if (govPreIdx >= 0 && govPostIdx === depPostIdx) continue; // self-loop from merged pair

      // If this dependent is the clitic half of a contraction, skip
      // (its dependency info is already captured through the host mapping).
      // Check if this is the second token of a contraction:
      const isCliticHalf = i > 0 &&
        mergeMap2.get(i) === mergeMap2.get(i - 1);

      if (isCliticHalf) continue;

      const govWord: ClsWord | undefined =
        govPostIdx !== undefined && govPostIdx >= 0 ? words[govPostIdx] : undefined;
      const depWord: ClsWord = words[depPostIdx];

      // If governor was a clitic half that got merged into host, re-point to host
      const actualGovWord = govWord || (govPreIdx >= 0 && govPreIdx < wordsPre.length
        ? words[mergeMap2.get(govPreIdx)!]
        : undefined);

      dependencies.push({
        index: depPostIdx + 1,
        governorIndex: govPostIdx !== undefined ? govPostIdx + 1 : 0,
        dependentIndex: depPostIdx + 1,
        dependentType: toAntelopeLabel(dep.label),
        governorName: (govPostIdx !== undefined && govPostIdx >= 0 && words[govPostIdx])
          ? words[govPostIdx].word : 'ROOT',
        dependentName: depWord.word,
        governor: (govPostIdx !== undefined && govPostIdx >= 0 && words[govPostIdx])
          ? words[govPostIdx] : null as unknown as ClsWord,
        dependent: depWord,
      });
    }

    // Ensure ROOT dependency exists.
    const hasRoot = dependencies.some(d => d.governorIndex === 0);
    if (!hasRoot && words.length > 0) {
      dependencies.push({
        index: 0,
        governorIndex: 0,
        dependentIndex: 1,
        dependentType: 'root',
        governorName: 'ROOT',
        dependentName: words[0].word,
        governor: null as unknown as ClsWord,
        dependent: words[0],
      });
    }

    // Back‑reference: each word stores the dependency edge where it is the dependent.
    words.forEach(w => {
      w.dependency = dependencies.find(d => d.dependent === w);
    });

    // ---- 3. Build phrase‑structure node tree from FinNLP's depsTree ----
    const rootNode = buildNodeTree(s.depsTree, words);

    // Attach each word’s corresponding leaf node (if any).
    const wordNodeMap = new Map<number, ClsNode>();
    collectWordNodes(rootNode, wordNodeMap);
    words.forEach(w => {
      w.node = wordNodeMap.get(w.index);
    });

    sentences.push({
      index: si + 1,
      nodes: rootNode,
      dependencies,
      words,
      xml: '',
    });

    absoluteOffset += words.length;
  }

  return { sentences, xml: '' };
}

// ─── Node‑tree construction ──────────────────────────────────────

/** Sentinel used for empty / unparsable trees. */
const EMPTY_NODE: ClsNode = {
  index: '0',
  nodeName: 'EMPTY',
  parent: null,
  contains: [],
};

/**
 * Recursively convert a FinNLP NodeInterface tree into a ClsNode tree
 * that mirrors Antelope’s phrase‑structure output.
 *
 * The root of the FinNLP tree is always wrapped in an SQ node.
 */
function buildNodeTree(
  finRoot: FinNodeInterface | null | undefined,
  words: ClsWord[]
): ClsNode {
  // Guard: missing or empty tree
  if (!finRoot || !finRoot.tokens || finRoot.tokens.length === 0) {
    // Create a minimal SQ node containing all words as direct leaves.
    const sq: ClsNode = {
      index: '1',
      nodeName: 'SQ',
      parent: null,
      contains: words.map(w => createWordLeaf(w)),
    };
    return sq;
  }

  // The top‑level SQ node (Antelope style)
  const sqNode: ClsNode = {
    index: '1',
    nodeName: 'SQ',
    parent: null,
    contains: [],
  };

  // Convert the root FinNLP node and attach it under SQ.
  const convertedRoot = convertFinNode(finRoot, words, sqNode);
  if (convertedRoot) {
    convertedRoot.parent = sqNode;
    sqNode.contains.push(convertedRoot);
  }

  // Ensure every word is represented somewhere in the tree.
  // Words not yet attached (e.g., punctuation at the edges) are added
  // directly under SQ.
  const attachedIndices = new Set<number>();
  collectAttachedWordIndices(sqNode, attachedIndices);
  for (const w of words) {
    if (!attachedIndices.has(w.index)) {
      const leaf = createWordLeaf(w);
      leaf.parent = sqNode;
      sqNode.contains.push(leaf);
    }
  }

  return sqNode;
}

/**
 * Convert a single FinNodeInterface (sub‑tree) into a ClsNode.
 */
function convertFinNode(
  finNode: FinNodeInterface,
  words: ClsWord[],
  parentNode: ClsNode
): ClsNode {
  // Determine whether this is a leaf (single‑word) node.
  const isLeaf =
    (!finNode.left || finNode.left.length === 0) &&
    (!finNode.right || finNode.right.length === 0);

  if (isLeaf && finNode.tokens.length === 1) {
    // Single‑word leaf → reference the ClsWord
    const wordIdx = finNode.index[0];  // 0‑based
    const word = words[wordIdx];
    if (!word) {
      // Fallback: create a text leaf
      return {
        index: `leaf_${wordIdx}`,
        nodeName: finNode.tokens[0],
        parent: parentNode,
        contains: [],
      };
    }
    return createWordLeaf(word);
  }

  // Phrase node – use the FinNLP type as label (NP, VP, PP, etc.)
  const phraseType = finNode.type && finNode.type !== 'ROOT'
    ? finNode.type
    : 'XP';
  const phraseNode: ClsNode = {
    index: `ph_${finNode.index[0]}_${finNode.index[1]}`,
    nodeName: phraseType,
    parent: parentNode,
    contains: [],
  };

  // Process left children (pre‑head dependents)
  if (finNode.left && finNode.left.length > 0) {
    for (const leftChild of finNode.left) {
      const childNode = convertFinNode(leftChild, words, phraseNode);
      if (childNode) {
        childNode.parent = phraseNode;
        phraseNode.contains.push(childNode);
      }
    }
  }

  // The head token(s) of this node
  for (let i = finNode.index[0]; i <= finNode.index[1]; i++) {
    const word = words[i];
    if (word) {
      const leaf = createWordLeaf(word);
      leaf.parent = phraseNode;
      phraseNode.contains.push(leaf);
    }
  }

  // Process right children (post‑head dependents)
  if (finNode.right && finNode.right.length > 0) {
    for (const rightChild of finNode.right) {
      const childNode = convertFinNode(rightChild, words, phraseNode);
      if (childNode) {
        childNode.parent = phraseNode;
        phraseNode.contains.push(childNode);
      }
    }
  }

  return phraseNode;
}

// ─── Leaf‑node helpers ────────────────────────────────────────────

function createWordLeaf(word: ClsWord): ClsNode {
  return {
    index: `w${word.index}`,
    nodeName: word.index.toString(),   // Antelope style: the word’s 1‑based index as string
    parent: null,
    contains: [word],
  };
}

// ─── Tree traversal helpers ───────────────────────────────────────

function collectWordNodes(node: ClsNode, map: Map<number, ClsNode>): void {
  for (const child of node.contains) {
    if (child instanceof Object && 'word' in (child as any)) {
      // child is a ClsWord
      const w = child as ClsWord;
      // The leaf is the current node (since word leaves contain the word directly)
      map.set(w.index, node);
    } else if (child instanceof Object && 'index' in (child as any)) {
      // child is a ClsNode
      collectWordNodes(child as ClsNode, map);
    }
  }
}

function collectAttachedWordIndices(
  node: ClsNode,
  set: Set<number>
): void {
  for (const child of node.contains) {
    if (child instanceof Object && 'word' in (child as any)) {
      const w = child as ClsWord;
      set.add(w.index);
    } else if (child instanceof Object && 'index' in (child as any)) {
      collectAttachedWordIndices(child as ClsNode, set);
    }
  }
}
```

## clio/phonological.ts

```typescript
// phonological.ts — Constructs the prosodic hierarchy (CP, PP, IU)
// from the parsed sentence, replicating McAleese’s method.

import {
  ClsSentence,
  ClsWord,
  ClsNode,
  CliticGroup,
  PhonologicalPhrase,
  IntonationalUnit,
  KeyStress,
  StressLevel,
  SyllableDisplayEntry,
} from '../types.js';
import { isPunctuation } from './parser.js';


/**
 * Build the full phonological hierarchy for a sentence.
 *
 * 1. Split into Intonational Units at punctuation tokens.
 * 2. Within each IU, build Clitic Groups by attaching function words
 *    to their governing content word (contiguous grouping).
 * 3. Group Clitic Groups into Phonological Phrases using the phrase
 *    structure tree (PPs correspond to VP and PP nodes).
 */
export function buildPhonologicalHierarchy(
  sentence: ClsSentence
): IntonationalUnit[] {
  const words = sentence.words;
  if (words.length === 0) return [];

  // ---- Step 1: split into IU segments by punctuation ----
  const iuSegments = splitByPunctuation(words);

  const ius: IntonationalUnit[] = [];

  for (const seg of iuSegments) {
    // ---- Step 2: build Clitic Groups for this segment ----
    const cgs = buildCliticGroups(seg);

    // ---- Step 3: group CPs into PPs using the phrase tree ----
    const pps = groupIntoPhonologicalPhrases(cgs, seg, sentence.nodes);

    ius.push({ phonologicalPhrases: pps });
  }

  return ius;
}

// ─── Intonational Unit splitting ───────────────────────────────

/** Punctuation POS tags that trigger an IU boundary.  Quotation marks are
 *  deliberately EXCLUDED: quotes are not prosodic breaks (a quoted word inside
 *  a clause is read in one breath), and treating them as IU boundaries
 *  fragmented the line's phonological hierarchy — flipping meters.  Parentheses
 *  stay: a parenthetical aside IS an intonational break. */
const PUNCT_TAGS = new Set([
  '.', ',', ':', ';', '!', '?',
  '-LRB-', '-RRB-', '(', ')',    // parentheses (true parentheticals);
  '[', ']', '{', '}',            // FinNLP emits literal bracket tags
]);

function splitByPunctuation(words: ClsWord[]): ClsWord[][] {
  const segments: ClsWord[][] = [];
  let current: ClsWord[] = [];

  for (const w of words) {
    if (PUNCT_TAGS.has(w.lexicalClass)) {
      // The punctuation token itself is not part of the prosodic
      // hierarchy; it acts as a boundary.
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(w);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

// ─── Clitic Group construction ────────────────────────────────

/**
 * Content‑word POS tags (expand as needed).
 * Content words serve as the head of a Clitic Group.
 */
const CONTENT_TAGS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS',  // nouns
  'JJ', 'JJR', 'JJS',          // adjectives
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ',  // verbs (excl. modals)
  'RB', 'RBR', 'RBS',          // adverbs
  'CD',                         // cardinal numbers (content‑like)
]);

function isContent(w: ClsWord): boolean {
  return CONTENT_TAGS.has(w.lexicalClass);
}

/**
 * Build contiguous Clitic Groups for a segment of words.
 *
 * A CP consists of exactly one content word plus any contiguous
 * function words that are dependents of that content word.
 * Function words attach to the nearest content word to their right
 * if they depend on it, or to the left content word otherwise.
 */
function buildCliticGroups(words: ClsWord[]): CliticGroup[] {
  const groups: CliticGroup[] = [];
  const assigned = new Set<ClsWord>();

  // First pass: create CPs for all content words and attach their dependents
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (assigned.has(w)) continue;

    if (isContent(w)) {
      // Start a new CP with this content word.
      const cpWords: ClsWord[] = [];

      // Attach preceding unassigned function words that depend on w.
      // Skip over already-assigned content words to reach function words.
      let j = i - 1;
      while (j >= 0) {
        const prev = words[j];
        if (assigned.has(prev)) {
          j--;
          continue; // skip assigned words (content or otherwise)
        }
        if (isContent(prev)) break; // unassigned content → stop
        // prev is an unassigned function word
        if (dependsOn(prev, w)) {
          cpWords.unshift(prev);
          assigned.add(prev);
        } else {
          break;
        }
        j--;
      }

      // Add the content word itself.
      cpWords.push(w);
      assigned.add(w);

      // Attach following unassigned function words that depend on w.
      // Skip over already-assigned content words.
      let k = i + 1;
      while (k < words.length) {
        const next = words[k];
        if (assigned.has(next)) {
          k++;
          continue; // skip assigned words
        }
        if (isContent(next)) break; // unassigned content → stop
        // next is an unassigned function word
        if (dependsOn(next, w)) {
          cpWords.push(next);
          assigned.add(next);
        } else {
          break;
        }
        k++;
      }

      groups.push({ tokens: cpWords });
    }
  }

  // Second pass: any remaining unassigned function words become degenerate CPs
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!assigned.has(w)) {
      groups.push({ tokens: [w] });
      assigned.add(w);
    }
  }

  // Sort groups by the index of their first token to maintain sentence order
  groups.sort((a, b) => a.tokens[0].index - b.tokens[0].index);

  return groups;
}

/** True if `dependent` has `head` as its direct governor. */
function dependsOn(dependent: ClsWord, head: ClsWord): boolean {
  const dep = dependent.dependency;
  return !!(dep && dep.governor === head);
}

// ─── Phonological Phrase grouping via phrase tree ──────────────

/**
 * Assigns each CP (identified by its head word) to a Phonological
 * Phrase.  The mapping uses the phrase‑structure tree: a PP node
 * (or VP node) becomes a Phonological Phrase containing all CPs
 * whose head words fall inside that node’s subtree.
 */
function groupIntoPhonologicalPhrases(
  cgs: CliticGroup[],
  segmentWords: ClsWord[],
  rootNode: ClsNode | null
): PhonologicalPhrase[] {
  if (!rootNode) {
    // Fallback: every CP is its own PP.
    return cgs.map(cg => ({ cliticGroups: [cg] }));
  }

  // Collect all phrase nodes that are candidates for PPs:
  // VP and PP nodes (as in Antelope’s output, VP and PP are the
  // maximal projections that McAleese uses as PPs).
  const phraseNodes = collectPhraseNodes(rootNode);

  // For each CP, determine which phrase node contains its head word,
  // preferring the smallest (most specific) node.
  const cpToPP = new Map<CliticGroup, ClsNode | null>();

  for (const cg of cgs) {
    const headWord = cg.tokens.find(w => isContent(w))!;
    if (!headWord) {
      cpToPP.set(cg, null);
      continue;
    }
    const containingNode = findMinimalContainingNode(headWord, phraseNodes);
    cpToPP.set(cg, containingNode);
  }

  // Build PP objects: each unique phrase node becomes a PP,
  // containing all CPs assigned to it.  CPs with no containing node
  // are grouped into a single “orphan” PP.
  const ppMap = new Map<ClsNode | null, CliticGroup[]>();
  for (const cg of cgs) {
    const node = cpToPP.get(cg) ?? null;
    if (!ppMap.has(node)) ppMap.set(node, []);
    ppMap.get(node)!.push(cg);
  }

  // Merge orphan CPs (node=null) into the PP of the nearest adjacent
  // non-orphan CP within the same IU segment. This ensures function-word
  // CPs (like determiners) that have no parse-tree node stay with the
  // CPs they modify.
  // Strategy: iterate CPs in order; if an orphan sits next to a non-orphan
  // in the ordered list, merge it into that non-orphan's PP.
  const orphanPPKey: ClsNode = { index: '__orphan_group__', nodeName: '__orphan_group__', parent: null, contains: [] } as any;
  if (ppMap.has(null)) {
    const orphans = ppMap.get(null)!;
    ppMap.delete(null);
    // Create a synthetic key for all orphans so they merge with nearest adjacent PP.
    // We'll merge them in the final ordering step below.
    ppMap.set(orphanPPKey, []);
  }

  // Build PPs respecting order and merging adjacent orphans into
  // the nearest non-orphan PP.
  const cgOrder = [...cgs].sort((a, b) => a.tokens[0].index - b.tokens[0].index);

  // Collect unique non-orphan node keys in order
  const nodeKeysInOrder: (ClsNode | null)[] = [];
  for (const cg of cgOrder) {
    const node = cpToPP.get(cg) ?? null;
    if (node === null) continue; // orphans handled below
    if (!nodeKeysInOrder.includes(node)) {
      nodeKeysInOrder.push(node);
    }
  }

  // Assign each orphan CG to the PP of the nearest adjacent non-orphan CG.
  const orphanToNode = new Map<CliticGroup, ClsNode | null>();
  for (const cg of cgOrder) {
    const node = cpToPP.get(cg) ?? null;
    if (node !== null) continue; // not an orphan
    // Look backward for nearest non-orphan CG
    let foundNode: ClsNode | null = null;
    for (let idx = cgOrder.indexOf(cg) - 1; idx >= 0; idx--) {
      const n = cpToPP.get(cgOrder[idx]) ?? null;
      if (n !== null) { foundNode = n; break; }
    }
    // If none found backward, look forward
    if (!foundNode) {
      for (let idx = cgOrder.indexOf(cg) + 1; idx < cgOrder.length; idx++) {
        const n = cpToPP.get(cgOrder[idx]) ?? null;
        if (n !== null) { foundNode = n; break; }
      }
    }
    orphanToNode.set(cg, foundNode);
  }

  // Build PP objects: each unique phrase node becomes a PP,
  // containing all CPs assigned to it (including merged orphans).
  const finalPPMap = new Map<ClsNode, CliticGroup[]>();
  for (const cg of cgOrder) {
    const node = cpToPP.get(cg) ?? null;
    const effectiveNode = node !== null ? node : (orphanToNode.get(cg) ?? orphanPPKey);
    if (!finalPPMap.has(effectiveNode)) finalPPMap.set(effectiveNode, []);
    finalPPMap.get(effectiveNode)!.push(cg);
  }

  const pps: PhonologicalPhrase[] = [];
  for (const [, cpList] of finalPPMap) {
    cpList.sort((a, b) => a.tokens[0].index - b.tokens[0].index);
    pps.push({ cliticGroups: cpList });
  }
  pps.sort((a, b) => a.cliticGroups[0].tokens[0].index - b.cliticGroups[0].tokens[0].index);
  return pps;
}


/** Recursively collect all major syntactic constituent nodes (VP, PP, NP, ADJP, ADVP). */
function collectPhraseNodes(node: ClsNode): ClsNode[] {
  const result: ClsNode[] = [];
  const phraseTypes = new Set(['VP', 'PP', 'NP', 'ADJP', 'ADVP']);
  if (phraseTypes.has(node.nodeName)) {
    result.push(node);
  }
  for (const child of node.contains) {
    // Skip ClsWord leaves (they have a `word` property)
    if ((child as ClsWord).word !== undefined) continue;
    // Now child must be a ClsNode
    const childNode = child as ClsNode;
    if (childNode.nodeName !== undefined) {
      result.push(...collectPhraseNodes(childNode));
    }
  }
  return result;
}

/**
 * Find the smallest phrase node (from the candidate list) that
 * contains the given word, or null if none does.
 */
function findMinimalContainingNode(
  word: ClsWord,
  phraseNodes: ClsNode[]
): ClsNode | null {
  let best: ClsNode | null = null;
  let bestSize = Infinity;

  for (const node of phraseNodes) {
    if (nodeContainsWord(node, word)) {
      const size = nodeSize(node);
      if (size < bestSize) {
        bestSize = size;
        best = node;
      }
    }
  }
  return best;
}

/** Check whether a node’s subtree includes the given word. */
function nodeContainsWord(node: ClsNode, word: ClsWord): boolean {
  for (const child of node.contains) {
    if ((child as ClsWord).word !== undefined && (child as ClsWord).index !== undefined) {
      if ((child as ClsWord).index === word.index) return true;
    } else if ((child as ClsNode).nodeName !== undefined) {
      if (nodeContainsWord(child as ClsNode, word)) return true;
    }
  }
  return false;
}

/** Approximate size of a node’s subtree (number of word leaves). */
function nodeSize(node: ClsNode): number {
  let count = 0;
  for (const child of node.contains) {
    if ((child as ClsWord).word !== undefined) {
      // leaf word
      count++;
    } else if ((child as ClsNode).nodeName !== undefined) {
      count += nodeSize(child as ClsNode);
    }
  }
  return count;
}

// ─── Utility exports for scansion.ts and index.ts ─────────────

export function collectIUTokens(iu: IntonationalUnit): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const pp of iu.phonologicalPhrases) {
    tokens.push(...collectPPTokens(pp));
  }
  return tokens;
}

export function collectPPTokens(pp: PhonologicalPhrase): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const cg of pp.cliticGroups) {
    tokens.push(...cg.tokens);
  }
  return tokens;
}

// ─── RENDERING FUNCTIONS (REPLACED) ────────────────────────────

/**
 * Build a flat list of all syllables with their stress and global index,
 * and a flag indicating whether it is the final syllable of its word.
 */
interface FlatMeta {
  stress: StressLevel;
  globalIndex: number;
  isFinalSylOfWord: boolean;
}

function flattenWithMeta(words: ClsWord[]): FlatMeta[] {
  const result: FlatMeta[] = [];
  let idx = 0;
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const syls = w.syllables;
    for (let i = 0; i < syls.length; i++) {
      result.push({
        stress: syls[i].relativeStress ?? 'w',
        globalIndex: idx,
        isFinalSylOfWord: i === syls.length - 1,
      });
      idx++;
    }
  }
  return result;
}

/**
 * Core renderer that walks the hierarchy and produces the bracket string.
 * If `keySet` is given, only positions whose global index is in the set are
 * shown with their actual stress; all other positions become 'x'.
 */
function renderStressString(
  ius: IntonationalUnit[],
  flat: FlatMeta[],
  keySet?: Set<number>
): string {
  let result = '';
  let sylIdx = 0;   // pointer into flat array

  for (const iu of ius) {
    result += '<';
    for (const pp of iu.phonologicalPhrases) {
      result += '{';
      for (const cg of pp.cliticGroups) {
        result += '[';
        let firstWord = true;
        for (const word of cg.tokens) {
          if (!firstWord) result += '/';   // word break marker
          firstWord = false;
          const syls = word.syllables;
          // polysyllabic word: insert '\' before first syllable
          if (syls.length > 1) result += '\\';

          for (let s = 0; s < syls.length; s++) {
            const meta = flat[sylIdx];
            sylIdx++;
            const stress = meta.stress;
            if (keySet) {
              result += keySet.has(meta.globalIndex) ? stress : 'x';
            } else {
              result += stress;
            }
          }
        }
        result += ']';
      }
      result += '}';
    }
    result += '>';
  }
  return result;
}

/**
 * Render the full phonological hierarchy into the bracket notation
 * used by McAleese, e.g. "<{[nm/ws\n]}mn/sw\]m]}>".
 */
export function renderHierarchy(ius: IntonationalUnit[], words: ClsWord[]): string {
  const flat = flattenWithMeta(words);
  return renderStressString(ius, flat);
}

/**
 * Render the key‑stress string: only syllables that participate in
 * key‑stress patterns are shown with their stress symbol; all others become 'x'.
 */
export function renderKeyStresses(
  ius: IntonationalUnit[],
  words: ClsWord[],
  keyStresses: KeyStress[]
): string {
  const flat = flattenWithMeta(words);
  const keySet = new Set<number>();
  for (const ks of keyStresses) {
    for (const pos of ks.positions) {
      keySet.add(pos);
    }
  }
  return renderStressString(ius, flat, keySet);
}

// ─── DISPLAY HELPERS ─────────────────────────────────────────────

/**
 * Split a word into orthographic syllable chunks using the Maximum Onset Principle.
 * Respects English phonotactics: digraphs stay together, consonants go to
 * the onset of the following syllable when they form a legal cluster.
 */
const VOWEL_CHARS = new Set('aeiouyAEIOUY');
const CONSONANT_DIGRAPHS = new Set(['th','sh','ch','wh','ph','gh','ck','ng','nk','tch','dge','sc','sk','sp','st']);

// ARPABET vowels, split into "free/long" (can end a syllable → favours an OPEN
// split: e·ven, ta·ble, o·pen) and "checked/short" (needs a coda → favours a
// CLOSED split: sev·en, prob·lem, rob·in).  This is the vowel-length cue that
// orthography alone cannot supply; it comes from nounsing-pro's per-syllable
// phones.  Display-only: it never affects meter scoring.
const ARPABET_VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);
const FREE_VOWELS = new Set(['IY', 'EY', 'AY', 'OW', 'UW', 'AW', 'OY', 'ER', 'AO']);

export type VowelLength = 'long' | 'short' | 'unknown';

/** Classify a syllable's vowel (from its ARPABET phones) as free/long vs checked/short. */
export function vowelLengthOf(phones: string): VowelLength {
  if (!phones) return 'unknown';
  // Per-syllable phones may be parenthesised and stress-digited, e.g. "(s EH)".
  for (const tok of phones.trim().split(/\s+/)) {
    const v = tok.replace(/[^A-Za-z]/g, '').toUpperCase();  // strip parens/digits
    if (ARPABET_VOWELS.has(v)) return FREE_VOWELS.has(v) ? 'long' : 'short';
  }
  return 'unknown';
}

/** Per-syllable vowel lengths for a word, to guide open/closed syllabification. */
export function syllableVowelLengths(
  syllables: { phones: string; stress?: number; lexicalStress?: number }[],
): VowelLength[] {
  return syllables.map(s => {
    const len = vowelLengthOf(s.phones);
    const stressed = (s.lexicalStress ?? s.stress ?? 0) >= 1;
    // Only a *stressed* checked vowel closes its syllable; a reduced/unstressed
    // syllable stays open (beau·ti·ful, not beau·tif·ul; mem·o·ry, not mem·or·y).
    if (len === 'short' && !stressed) return 'unknown';
    return len;
  });
}

/**
 * Opaque lexicalised compounds whose orthographic syllable boundary the
 * maximal-onset syllabifier cuts in the wrong place (some·one → so·meone, because
 * the lone medial 'm' is greedily taken as the onset of syllable 2).  We supply
 * the morpheme boundary explicitly: the constituents are real words, so each is
 * syllabified on its own and re-joined.  Applied ONLY when the parts' own
 * syllable counts sum to the requested count, so a mismatched parse falls through
 * to the general algorithm rather than mis-splitting.  Display-only (never affects
 * stress or meter, which derive from the CMU syllable count, not this chunking).
 */
const LEXICAL_COMPOUND_PARTS: Record<string, string[]> = {
  someone: ['some', 'one'], anyone: ['any', 'one'], everyone: ['every', 'one'], noone: ['no', 'one'],
  something: ['some', 'thing'], anything: ['any', 'thing'], everything: ['every', 'thing'], nothing: ['no', 'thing'],
  somebody: ['some', 'body'], anybody: ['any', 'body'], everybody: ['every', 'body'], nobody: ['no', 'body'],
  somewhere: ['some', 'where'], anywhere: ['any', 'where'], everywhere: ['every', 'where'], nowhere: ['no', 'where'],
  somehow: ['some', 'how'], somewhat: ['some', 'what'], someday: ['some', 'day'],
  sometime: ['some', 'time'], sometimes: ['some', 'times'], someplace: ['some', 'place'],
  itself: ['it', 'self'], himself: ['him', 'self'], herself: ['her', 'self'], myself: ['my', 'self'],
  yourself: ['your', 'self'], oneself: ['one', 'self'],
  themselves: ['them', 'selves'], ourselves: ['our', 'selves'], yourselves: ['your', 'selves'],
  into: ['in', 'to'], onto: ['on', 'to'], unto: ['un', 'to'], upon: ['up', 'on'],
  within: ['with', 'in'], without: ['with', 'out'], throughout: ['through', 'out'],
  cannot: ['can', 'not'], become: ['be', 'come'], became: ['be', 'came'],
  // Archaic/locative pronominal compounds (frequent in verse).  The medial
  // silent 'e' of the first element ("where·fore") otherwise inflates the
  // orthographic vowel-group count and mis-places the boundary.
  wherefore: ['where', 'fore'], therefore: ['there', 'fore'],
  wherein: ['where', 'in'], therein: ['there', 'in'], herein: ['here', 'in'],
  whereby: ['where', 'by'], thereby: ['there', 'by'], hereby: ['here', 'by'],
  whereof: ['where', 'of'], thereof: ['there', 'of'], hereof: ['here', 'of'],
  whereto: ['where', 'to'], thereto: ['there', 'to'], hereto: ['here', 'to'],
  whereon: ['where', 'on'], thereon: ['there', 'on'],
  whereat: ['where', 'at'], thereat: ['there', 'at'],
  whereupon: ['where', 'upon'], thereupon: ['there', 'upon'], hereupon: ['here', 'upon'],
  hereafter: ['here', 'after'], thereafter: ['there', 'after'], whereafter: ['where', 'after'],
  heretofore: ['here', 'to', 'fore'], hitherto: ['hither', 'to'],
};

/** Orthographic syllable estimate for a single sub-word (silent-final-e aware). */
function quickSyllableCount(s: string): number {
  const lower = s.toLowerCase();
  const pos: number[] = [];
  let inV = false;
  for (let i = 0; i < lower.length; i++) {
    if (VOWEL_CHARS.has(lower[i])) { if (!inV) { pos.push(i); inV = true; } }
    else inV = false;
  }
  let groups = pos.length;
  if (groups >= 2 && lower.endsWith('e') && pos[pos.length - 1] === lower.length - 1) groups--;
  return Math.max(1, groups);
}

export function syllabifyWord(word: string, syllableCount: number, vowelLengths?: VowelLength[], morphSuffix?: string): string[] {
  if (syllableCount <= 1) return [word];

  // Lexical compound boundary (someone → some·one, not so·meone).  Only when the
  // constituents' own syllable counts add up to the requested total.
  {
    const key = word.toLowerCase().replace(/[^a-z]/g, '');
    const parts = LEXICAL_COMPOUND_PARTS[key];
    if (parts && key === word.toLowerCase()) {
      const counts = parts.map(quickSyllableCount);
      if (counts.reduce((a, b) => a + b, 0) === syllableCount) {
        const out: string[] = [];
        let off = 0;
        for (let p = 0; p < parts.length; p++) {
          const seg = word.slice(off, off + parts[p].length);
          off += parts[p].length;
          out.push(...syllabifyWord(seg, counts[p]));
        }
        if (out.length === syllableCount) return out;
      }
    }
  }

  // Morpheme-aware peel: when OOV stress assignment validated a productive
  // archaic suffix (-est/-eth/-ith), split it off as the final syllable so the
  // stem keeps its spelling (know·est, not kno·west; know·eth, not kno·weth).
  if (morphSuffix && syllableCount >= 2
      && word.toLowerCase().endsWith(morphSuffix)
      && word.length > morphSuffix.length + 1) {
    const stem = word.slice(0, word.length - morphSuffix.length);
    const suffixChunk = word.slice(word.length - morphSuffix.length);
    const stemChunks = syllabifyWord(stem, syllableCount - 1, vowelLengths?.slice(0, syllableCount - 1));
    return [...stemChunks, suffixChunk];
  }

  // For hyphenated words, use hyphen as syllable boundary if counts match
  if (word.includes('-')) {
    const parts = word.split('-');
    if (parts.length === syllableCount) {
      return parts;
    }
  }

  const cleanWord = word.replace(/-/g, '');
  if (cleanWord.length <= syllableCount) {
    if (cleanWord.length === syllableCount) return cleanWord.split('');
    return [word];
  }

  const hyphenMap: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== '-') hyphenMap.push(i);
  }

  const lower = cleanWord.toLowerCase();
  const n = lower.length;

  // Common English consonant digraphs
  const DIGRAPHS = new Set(['ch', 'sh', 'th', 'wh', 'ph', 'gh', 'ck', 'ng', 'wr', 'kn', 'gn']);
  // Digraphs that commonly end syllables (codas)
  const CODA_DIGRAPHS = new Set(['ch', 'sh', 'ck', 'ng', 'th']);
  // "Muta cum liquida": an obstruent + liquid/glide that, between vowels, stays
  // together as the onset of the following syllable (maximal-onset principle):
  // se·cret, be·tween, chil·dren, pro·gram, re·gret.  Deliberately EXCLUDES the
  // s+stop clusters (st/sp/sc/sk), which in medial position split after a short
  // vowel (mis·ter, dis·turb, whis·per) rather than maximising the onset.
  const MEDIAL_ONSET = new Set([
    'bl', 'br', 'cl', 'cr', 'dr', 'dw', 'fl', 'fr', 'gl', 'gr',
    'pl', 'pr', 'tr', 'tw',
  ]);
  // Legal English 3-consonant onsets (s + voiceless stop + liquid/glide) plus
  // the orthographic clusters thr/shr/chr/phr/sch (single onset phonemically).
  const TRIPLE_ONSET = new Set([
    'str', 'spr', 'scr', 'spl', 'squ', 'thr', 'shr', 'chr', 'phr', 'sch',
  ]);
  // Final "consonant + le" forms its own syllable (ta·ble, lit·tle, ap·ple,
  // tem·ple, bot·tle): the single consonant immediately before "le" joins it.
  const endsConsonantLe = n >= 3 && lower.endsWith('le') && !VOWEL_CHARS.has(lower[n - 3]);
  // Non-syllabic past-tense "-ed": the 'e' in a final "…Xed" (X a consonant other
  // than t/d) is silent (re·turned, not re·tur·ned).  After t/d it IS syllabic
  // (want·ed, embed·ded), so those are excluded.
  const endsSilentEd = n >= 3 && lower.endsWith('ed')
    && !VOWEL_CHARS.has(lower[n - 3]) && lower[n - 3] !== 't' && lower[n - 3] !== 'd';

  interface Nucleus { start: number; end: number }
  const nuclei: Nucleus[] = [];
  let i = 0;
  while (i < n) {
    if (VOWEL_CHARS.has(lower[i])) {
      const vs = i;
      while (i < n && VOWEL_CHARS.has(lower[i])) i++;
      const isLoneFinalE = (i === n && (i - vs) === 1 && lower[vs] === 'e');
      if (isLoneFinalE && nuclei.length >= 2) {
        // silent-e: a lone 'e' at word end after 2+ nuclei is typically silent
      } else {
        nuclei.push({ start: vs, end: i });
      }
    } else {
      i++;
    }
  }

  if (nuclei.length === 0) return [word];

  // If we have a surplus nucleus and the word ends in a non-syllabic "-ed",
  // drop that silent 'e' first (preferred over a generic consonant-count merge,
  // which would otherwise mis-segment e.g. "returned" → "re·tur·ned").
  if (nuclei.length > syllableCount && endsSilentEd) {
    const last = nuclei[nuclei.length - 1];
    if (last.start === n - 2 && last.end === n - 1) nuclei.pop();
  }

  while (nuclei.length > syllableCount && nuclei.length > 1) {
    let minConsonants = Infinity;
    let mergeIdx = 0;
    for (let j = 0; j < nuclei.length - 1; j++) {
      const consonantsBetween = nuclei[j + 1].start - nuclei[j].end;
      if (consonantsBetween < minConsonants) { minConsonants = consonantsBetween; mergeIdx = j; }
    }
    nuclei[mergeIdx] = { start: nuclei[mergeIdx].start, end: nuclei[mergeIdx + 1].end };
    nuclei.splice(mergeIdx + 1, 1);
  }

  const useWord = word;
  const useN = n;

  if (nuclei.length === syllableCount) {
    const boundaries: number[] = [0];
    for (let j = 0; j < nuclei.length - 1; j++) {
      const gapStart = nuclei[j].end;
      const gapEnd = nuclei[j + 1].start;
      const consonants = gapEnd - gapStart;
      let boundary: number;
      if (consonants <= 0) {
        boundary = gapEnd;
      } else if (consonants === 1) {
        // Single intervocalic consonant: Maximal Onset (open, V·CV) by default,
        // but a checked/short stressed vowel CLOSES the syllable (VC·V):
        // sev·en / rob·in / lem·on, vs. open e·ven / o·pen / ro·bot after a free
        // (long) vowel.  Falls back to MOP when vowel length is unknown (OOV).
        boundary = (vowelLengths && vowelLengths[j] === 'short') ? gapEnd : gapStart;
      } else if (consonants === 2) {
        const pair = lower.substring(gapStart, gapEnd);
        if (MEDIAL_ONSET.has(pair)) {
          // Onset cluster (muta cum liquida) normally begins the next syllable
          // (ta·ble, se·cret, pro·gram) — UNLESS a checked/short vowel closes the
          // syllable, in which case one consonant stays behind (prob·lem, frac·ture).
          boundary = (vowelLengths && vowelLengths[j] === 'short') ? gapStart + 1 : gapStart;
        } else if (DIGRAPHS.has(pair)) {
          if (CODA_DIGRAPHS.has(pair)) {
            // Common coda: digraph goes with preceding syllable
            boundary = gapEnd;
          } else {
            // Common onset: digraph goes with following syllable
            boundary = gapStart;
          }
        } else {
          // Not a cluster/digraph: split (first consonant with prev, second with next)
          boundary = gapStart + 1;
        }
      } else {
        // 3+ consonants: maximise the onset — a legal THREE-consonant onset
        // (s + stop + liquid/glide) carries whole to the next syllable ONLY
        // when the preceding vowel is known to be long/free (a stressed short
        // vowel takes the s as its coda: mis·tress, but a free vowel opens:
        // de·stroy with reduced e).  Else a final 2-consonant onset cluster or
        // digraph carries; otherwise only the last consonant (chil·dren).
        const lastThree = lower.substring(gapEnd - 3, gapEnd);
        const lastTwo = lower.substring(gapEnd - 2, gapEnd);
        if (TRIPLE_ONSET.has(lastThree) && vowelLengths && vowelLengths[j] === 'long') {
          boundary = gapEnd - 3;
        } else if (MEDIAL_ONSET.has(lastTwo) || DIGRAPHS.has(lastTwo)) {
          boundary = gapEnd - 2;
        } else {
          boundary = gapEnd - 1;
        }
      }
      // Final "consonant + le" overrides: the consonant before "le" joins it.
      if (endsConsonantLe && j === nuclei.length - 2) {
        boundary = n - 3;
      }
      if (boundary >= n) boundary = n - 1;
      if (boundary <= boundaries[boundaries.length - 1]) {
        boundary = boundaries[boundaries.length - 1] + 1;
      }
      boundaries.push(boundary);
    }
    boundaries.push(n);

    const result: string[] = [];
    for (let j = 0; j < boundaries.length - 1; j++) {
      const origStart = hyphenMap.length > 0 ? hyphenMap[boundaries[j]] : boundaries[j];
      const origEnd = hyphenMap.length > 0 ? (boundaries[j + 1] < hyphenMap.length ? hyphenMap[boundaries[j + 1]] : word.length) : boundaries[j + 1];
      result.push(word.slice(origStart, origEnd));
    }
    while (result.length < syllableCount) result.push('');
    return result.slice(0, syllableCount);
  }

  const result: string[] = [];
  let start = 0;
  for (let s = 0; s < syllableCount - 1; s++) {
    const remaining = syllableCount - s;
    const remainingChars = n - start;
    const idealLen = Math.round(remainingChars / remaining);
    let end = start + Math.max(2, idealLen);
    if (end > n - (remaining - 1) * 2) end = n - (remaining - 1) * 2;
    if (end <= start + 1) end = start + 2;
    if (end > n) end = n;
    const origStart = hyphenMap.length > 0 ? hyphenMap[start] : start;
    const origEnd = hyphenMap.length > 0 ? (end < hyphenMap.length ? hyphenMap[end] : word.length) : end;
    result.push(word.slice(origStart, origEnd));
    start = end;
  }
  const origStart = hyphenMap.length > 0 ? hyphenMap[start] : start;
  result.push(word.slice(origStart));
  while (result.length < syllableCount) result.push('');
  return result.slice(0, syllableCount);
}

/**
 * Flatten all syllables into display entries with word context.
 * Each entry carries the original word text, the syllable text
 * (orthographic chunk), the syllable's position within the word,
 * and its relative stress level.
 */
export function flattenDisplayEntries(words: ClsWord[]): SyllableDisplayEntry[] {
  const result: SyllableDisplayEntry[] = [];
  let globalIdx = 0;
  let wordIdx = 0;

  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const sylCount = w.syllables.length;
    const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix);
    for (let si = 0; si < sylCount; si++) {
      result.push({
        wordText: w.word,
        sylText: chunks[si],
        sylIndex: si,
        sylCount,
        relativeStress: w.syllables[si].relativeStress ?? 'w',
        globalIndex: globalIdx++,
        wordIndex: wordIdx,
      });
    }
    wordIdx++;
  }

  return result;
}
```

## clio/phrasestress.ts

```typescript
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

```

## clio/pipeline.ts

```typescript
// clio/pipeline.ts — the FROZEN Clio analysis pipeline (the "control group").
//
// This is a verbatim snapshot of index.ts's orchestration (processLine +
// applyContinuityRename + analyzeStanzas/analyzeText/analyzeReadingDocument) as it
// stood at the structure-first rebuild, wired EXCLUSIVELY to clio-local frozen
// modules (clio/parser, clio/scansion, clio/rhyme, clio/scandroid, clio/phonological,
// clio/display) and hard-wired to clioEngine.  Nothing here imports the live
// top-level pipeline, so changes to the regular (Calliope) pipeline — including the
// shared scorer — CANNOT affect Clio's output.  Clio is grounded in this tree alone.
//
// DO NOT evolve this file or any clio/* module with the Calliope rebuild.

import { parseDocument } from './parser.js';
import { renderHierarchy, renderKeyStresses } from './phonological.js';
import {
  extractKeyStresses, scoreMeters, applyStanzaConsensus, applyRhythmLayer, applyMetricalityLayer,
} from './scansion.js';
import { applyRhymeAndForm } from './rhyme.js';
import { scandroidCorralWeird, scandroidMaximizeNormal, stressToMarks } from './scandroid.js';
import { type ReadingStanza } from './display.js';
import { clioEngine } from './engine.js';
import type {
  ClsSentence, MetreName, IntonationalUnit, StressLevel, ScansionResult, LineResult,
} from '../types.js';

export type { ReadingStanza } from './display.js';
// Frozen Clio renderers + parse entry, so the CLI can render Clio output entirely
// from the clio/ tree (live display.ts changes cannot reach Clio).
export { renderUnifiedDisplay, renderReadingView, renderFullLegend } from './display.js';
export { parseDocument, isPunctuation } from './parser.js';
export { renderHierarchy, renderKeyStresses } from './phonological.js';
export { clioEngine } from './engine.js';

/** Scan one verse line (which may parse into several grammatical sentences). */
function processLine(sents: ClsSentence[]): LineResult | null {
  if (sents.length === 0) return null;

  const iusPerSent: IntonationalUnit[][] = [];
  for (const sent of sents) {
    iusPerSent.push(clioEngine.analyzeSentence(sent));
  }

  const words = sents.flatMap(s => s.words);
  const ius = iusPerSent.flat();
  let merged: ClsSentence;
  if (sents.length === 1) {
    merged = sents[0];
  } else {
    words.forEach((w, i) => { w.index = i + 1; });
    merged = {
      index: sents[0].index, nodes: null,
      dependencies: sents.flatMap(s => s.dependencies), words, xml: '',
    };
  }

  const keyStresses = extractKeyStresses(ius, words);
  const phonoDetail = scoreMeters(keyStresses, words, ius);
  phonoDetail.all = renderHierarchy(ius, words);
  phonoDetail.keyStresses = renderKeyStresses(ius, words, keyStresses);

  const stressPattern: StressLevel[] = words.flatMap(w => w.syllables.map(s => s.relativeStress ?? 'w'));
  const marks = stressToMarks(stressPattern);
  const actualFeet = phonoDetail.footCount > 0 ? phonoDetail.footCount : 5;
  const corral = scandroidCorralWeird(marks, actualFeet);
  const max = scandroidMaximizeNormal(marks, actualFeet);

  const corralResult: ScansionResult | undefined = corral.footlist.length
    ? { meter: 'iambic', scansion: corral.footlist.map(f => f.replace(/[()]/g, '')).join(' | '),
        certainty: 0, weightScore: 0, maxPossibleWeight: 0, algorithm: 'Scandroid Corral the Weird' }
    : undefined;
  const maxResult: ScansionResult | undefined = max.footlist.length
    ? { meter: 'iambic', scansion: max.footlist.map(f => f.replace(/[()]/g, '')).join(' | '),
        certainty: 0, weightScore: 0, maxPossibleWeight: 0, algorithm: 'Scandroid Maximise the Normal' }
    : undefined;

  return {
    sentence: merged, phonologicalHierarchy: ius, keyStresses,
    phonologicalScansion: phonoDetail, scandroidCorral: corralResult, scandroidMaximise: maxResult,
  };
}

function applyContinuityRename(results: LineResult[]): void {
  const noted = results.filter(r => r.phonologicalScansion.rhythmNote).length;
  if (results.length > 0 && noted >= results.length / 2) return;
  for (const res of results) {
    const d = res.phonologicalScansion;
    if (!d.consensusMeter) continue;
    const family = d.consensusMeter.split(' ')[0] as MetreName;
    const forced = scoreMeters(res.keyStresses, res.sentence.words, res.phonologicalHierarchy, family);
    if (!forced || forced.meterName === 'free verse' || forced.footCount <= 0) continue;
    d.standaloneMeter = d.meter;
    d.meter = forced.meter; d.meterName = forced.meterName; d.footCount = forced.footCount;
    d.scansion = forced.scansion; d.certainty = forced.certainty; d.summary = forced.summary;
    d.consensusMeter = undefined;
  }
}

export function analyzeStanzasClio(text: string): LineResult[][] {
  const stanzas = text.split(/\n\s*\n/);
  const results: LineResult[][] = [];
  for (const stanza of stanzas) {
    const lines = stanza.split('\n').filter(l => l.trim() !== '');
    const stanzaResults: LineResult[] = [];
    for (const line of lines) {
      const doc = parseDocument(line);
      const res = processLine(doc.sentences);
      if (res) stanzaResults.push(res);
    }
    applyStanzaConsensus(stanzaResults.map(r => r.phonologicalScansion));
    applyRhythmLayer(stanzaResults.map(r => r.phonologicalScansion));
    applyContinuityRename(stanzaResults);
    results.push(stanzaResults);
  }
  if (results.length > 1) {
    const all = results.flat();
    applyStanzaConsensus(all.map(r => r.phonologicalScansion));
    applyContinuityRename(all);
    for (const st of results) applyRhythmLayer(st.map(r => r.phonologicalScansion));
  }
  applyMetricalityLayer(results.flatMap(st => st.map(r => r.phonologicalScansion)));
  applyRhymeAndForm(results);
  return results;
}

export function analyzeTextClio(text: string): LineResult[] {
  return analyzeStanzasClio(text).flat();
}

export function analyzeReadingDocumentClio(text: string): ReadingStanza[] {
  const stanzas = text.split(/\n\s*\n/);
  const out: ReadingStanza[] = [];
  for (const stanza of stanzas) {
    const rawLines = stanza.split('\n').filter(l => l.trim() !== '');
    if (rawLines.length === 0) continue;
    const lines = rawLines.map(raw => {
      const doc = parseDocument(raw);
      const res = processLine(doc.sentences);
      return { raw, results: res ? [res] : [] };
    });
    applyStanzaConsensus(lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
    applyRhythmLayer(lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
    applyContinuityRename(lines.flatMap(l => l.results));
    out.push({ lines });
  }
  if (out.length > 1) {
    const all = out.flatMap(st => st.lines.flatMap(l => l.results));
    applyStanzaConsensus(all.map(r => r.phonologicalScansion));
    applyContinuityRename(all);
    for (const st of out) applyRhythmLayer(st.lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
  }
  applyMetricalityLayer(out.flatMap(st => st.lines.flatMap(l => l.results.map(r => r.phonologicalScansion))));
  applyRhymeAndForm(out.map(st => st.lines.flatMap(l => l.results)));
  return out;
}

```

## clio/rhyme.ts

```typescript
// rhyme.ts — Rhyme-pair classification, stanza rhyme-scheme detection, and
// poetic FORM identification.
//
// Rhyme typology follows the maintainer's LYRICAL app (meter_exemplars.ts
// RHYME_TYPES) so the two toolkits stay cross-compatible: perfect / rich /
// family / assonant / consonant / augmented / diminished / wrenched / eye /
// identical, with the structural qualifiers masculine / feminine / dactylic.
// Phonology comes from the augmented CMU dictionary (nounsing-pro); the
// orthographic (eye/wrenched) tier is a deliberately guarded fallback.
//
// FORM is a stanza/poem-level verdict (this is where "ballad" lives — a
// quatrain with ballad rhyme AND alternating 4·3 beats — NOT in the rhythm
// pass).  Form names align with LYRICAL's FORM_REGISTRY where they overlap
// (Couplet, Triplet, Quatrain, Limerick, Petrarchan/Shakespearean Sonnet…).

import * as nounsing from 'nounsing-pro';
import { ClsWord, LineResult, PhonologicalScansionDetail, StressLevel } from '../types.js';
import { isPunctuation } from './parser.js';
import { ictusProfile } from './scansion.js';
import { preCaesuralWords } from './caesura.js';

export type RhymeTypeName =
  | 'identical' | 'rich' | 'perfect' | 'family'
  | 'assonant' | 'consonant' | 'augmented' | 'diminished'
  | 'wrenched' | 'eye';

export interface RhymePair {
  type: RhymeTypeName;
  /** masculine (stress on final syllable) / feminine (penult) / dactylic (antepenult) */
  structure?: 'masculine' | 'feminine' | 'dactylic';
}

const VOWEL_RE = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)/;
const PLOSIVES = new Set(['B', 'D', 'G', 'P', 'T', 'K']);
const FRICATIVES = new Set(['V', 'DH', 'Z', 'ZH', 'JH', 'F', 'TH', 'S', 'SH', 'CH', 'HH']);
const NASALS = new Set(['M', 'N', 'NG']);

const isVowelPhone = (p: string) => VOWEL_RE.test(p);
const base = (p: string) => p.replace(/[0-9]/g, '');
const sameFamily = (a: string, b: string) =>
  (PLOSIVES.has(a) && PLOSIVES.has(b)) || (FRICATIVES.has(a) && FRICATIVES.has(b)) || (NASALS.has(a) && NASALS.has(b));

function phonesOf(word: string): string[] | null {
  const clean = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return null;
  try {
    const ph = nounsing.firstPhonesForWord(clean);
    if (typeof ph === 'string' && ph.length > 0) return ph.split(' ');
  } catch { /* OOV */ }
  return null;
}

/** Index of the LAST stressed (1/2) vowel; falls back to the last vowel. */
function lastStressedIdx(ph: string[]): number {
  let lastVowel = -1;
  for (let i = ph.length - 1; i >= 0; i--) {
    if (!isVowelPhone(ph[i])) continue;
    if (lastVowel < 0) lastVowel = i;
    if (/[12]$/.test(ph[i])) return i;
  }
  return lastVowel;
}

/** masculine/feminine/dactylic from how many vowels FOLLOW the rhyming vowel. */
function structureOf(ph: string[], idx: number): RhymePair['structure'] {
  let after = 0;
  for (let i = idx + 1; i < ph.length; i++) if (isVowelPhone(ph[i])) after++;
  return after === 0 ? 'masculine' : after === 1 ? 'feminine' : 'dactylic';
}

/** Guarded orthographic tier: shared ending ≥3 chars, matching final phone if
 *  known, and never on a shared bare "-ing" (mass false positives). */
function orthographicTier(a: string, b: string, pa: string[] | null, pb: string[] | null): RhymeTypeName | null {
  const wa = a.toLowerCase().replace(/[^a-z]/g, '');
  const wb = b.toLowerCase().replace(/[^a-z]/g, '');
  if (wa.length < 3 || wb.length < 3) return null;
  let common = 0;
  while (common < Math.min(wa.length, wb.length) && wa[wa.length - 1 - common] === wb[wb.length - 1 - common]) common++;
  if (common < 3) return null;
  if (wa.slice(-3) === 'ing' && wb.slice(-3) === 'ing' && common <= 4) return null;
  if (pa && pb && base(pa[pa.length - 1]) !== base(pb[pb.length - 1])) return null;
  // Wrenched when the shared ending is an UNSTRESSED suffix of a polysyllable
  // (temperate/date, manifestation/convention); plain eye-rhyme otherwise.
  const polyUnstressed = (ph: string[] | null) => {
    if (!ph) return false;
    const idx = lastStressedIdx(ph);
    return idx >= 0 && structureOf(ph, idx) !== 'masculine';
  };
  return polyUnstressed(pa) !== polyUnstressed(pb) ? 'wrenched' : 'eye';
}

/** Classify the rhyme relation between two line-end words (or null). */
export function classifyRhymePair(a: string, b: string): RhymePair | null {
  const wa = a.toLowerCase().replace(/[^a-z']/g, '');
  const wb = b.toLowerCase().replace(/[^a-z']/g, '');
  if (!wa || !wb) return null;
  const pa = phonesOf(a);
  const pb = phonesOf(b);
  if (wa === wb) return { type: 'identical', structure: pa ? structureOf(pa, lastStressedIdx(pa)) : undefined };
  if (!pa || !pb) {
    const t = orthographicTier(a, b, pa, pb);
    return t ? { type: t } : null;
  }
  const ia = lastStressedIdx(pa);
  const ib = lastStressedIdx(pb);
  if (ia < 0 || ib < 0) return null;
  const ra = pa.slice(ia);
  const rb = pb.slice(ib);
  const structure = structureOf(pa, ia);
  const sameStructure = structure === structureOf(pb, ib);

  const norm = (seg: string[]) => seg.map(base);
  const na = norm(ra);
  const nb = norm(rb);
  const partsEqual = na.length === nb.length && na.every((p, i) => p === nb[i]);

  if (partsEqual && sameStructure) {
    const onsetA = ia > 0 ? base(pa[ia - 1]) : '';
    const onsetB = ib > 0 ? base(pb[ib - 1]) : '';
    return { type: onsetA === onsetB ? 'rich' : 'perfect', structure };
  }

  const vowelSame = na[0] === nb[0];
  const codaA = na.slice(1).filter(p => !isVowelPhone(p));
  const codaB = nb.slice(1).filter(p => !isVowelPhone(p));
  const codaEq = codaA.length === codaB.length && codaA.every((p, i) => p === codaB[i]);

  if (vowelSame) {
    // Same stressed vowel.  Matching-length codas whose consonants pair up
    // within one phonetic family (wet/deck, dame/grain) → family rhyme.
    if (codaA.length === codaB.length && codaA.length > 0
        && codaA.every((p, i) => p === codaB[i] || sameFamily(p, codaB[i]))) {
      return { type: 'family', structure };
    }
    // One extra trailing consonant on the second/first word (bray/brave).
    if (codaA.length + 1 === codaB.length && codaA.every((p, i) => p === codaB[i])) return { type: 'augmented', structure };
    if (codaB.length + 1 === codaA.length && codaB.every((p, i) => p === codaA[i])) return { type: 'diminished', structure };
    return { type: 'assonant', structure };
  }
  if (codaEq && codaA.length > 0) return { type: 'consonant', structure };
  const t = orthographicTier(a, b, pa, pb);
  return t ? { type: t } : null;
}

// Strength tiers for scheme detection.
const STRONG: Set<RhymeTypeName> = new Set(['identical', 'rich', 'perfect', 'family']);
const SLANT: Set<RhymeTypeName> = new Set(['assonant', 'consonant', 'augmented', 'diminished', 'wrenched', 'eye']);
// Full rhyme only — the stricter bar a pre-caesural INTERNAL rhyme must clear.
const STRICT_INTERNAL: Set<RhymeTypeName> = new Set(['identical', 'rich', 'perfect']);

export interface LineRhyme {
  endWord: string;
  letter: string;          // scheme letter ('A', 'B', …; '·' = unrhymed)
  type?: RhymeTypeName;    // relation to the matched earlier line
  matchedLine?: number;    // 0-based index within the stanza
}

/** Detect a stanza's rhyme scheme from its line-end words.  Strong rhymes
 *  bind; slant-tier rhymes bind only when no strong candidate exists. */
export function detectScheme(endWords: string[]): LineRhyme[] {
  const out: LineRhyme[] = [];
  let nextLetter = 0;
  for (let i = 0; i < endWords.length; i++) {
    let best: { j: number; pair: RhymePair } | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const pair = classifyRhymePair(endWords[j], endWords[i]);
      if (!pair) continue;
      if (STRONG.has(pair.type)) { best = { j, pair }; break; }    // nearest strong wins
      if (!best && SLANT.has(pair.type)) best = { j, pair };       // else nearest slant
    }
    if (best) {
      out.push({ endWord: endWords[i], letter: out[best.j].letter, type: best.pair.type, matchedLine: best.j });
    } else {
      out.push({ endWord: endWords[i], letter: String.fromCharCode(65 + (nextLetter++ % 26)) });
    }
  }
  // Rebind pass: a STRONG rhyme claims its partner back from an earlier
  // slant-tier binding.  (Sonnet 130: "rare" first slant-binds to the red/head
  // group, then "compare" arrives as its perfect partner — the couplet wins.)
  for (let k = 0; k < out.length; k++) {
    const r = out[k];
    if (r.matchedLine === undefined || !r.type || !STRONG.has(r.type)) continue;
    const target = out[r.matchedLine];
    if (target.matchedLine !== undefined && target.type && SLANT.has(target.type)) {
      const fresh = String.fromCharCode(65 + (nextLetter++ % 26));
      target.letter = fresh;
      target.type = undefined;
      target.matchedLine = undefined;
      r.letter = fresh;
    }
  }
  // Lines whose letter never recurs are unrhymed: mark '·' for readability.
  const counts = new Map<string, number>();
  for (const r of out) counts.set(r.letter, (counts.get(r.letter) ?? 0) + 1);
  for (const r of out) if ((counts.get(r.letter) ?? 0) < 2) r.letter = '·';
  // Re-letter the survivors in order of first appearance (A, B, C…).
  const remap = new Map<string, string>();
  let k = 0;
  for (const r of out) {
    if (r.letter === '·') continue;
    if (!remap.has(r.letter)) remap.set(r.letter, String.fromCharCode(65 + (k++ % 26)));
    r.letter = remap.get(r.letter)!;
  }
  return out;
}

const schemeStr = (rs: LineRhyme[]) => rs.map(r => r.letter).join('');

/** Canonical scheme for FORM matching: every line gets a letter in sequential
 *  first-appearance order, unrhymed lines (·) each their own — so "·A·A"
 *  compares as "ABCB". */
function canonicalScheme(rs: LineRhyme[]): string {
  const remap = new Map<string, string>();
  let k = 0;
  const next = () => String.fromCharCode(65 + (k++ % 26));
  let out = '';
  for (const r of rs) {
    if (r.letter === '·') { out += next(); continue; }
    if (!remap.has(r.letter)) remap.set(r.letter, next());
    out += remap.get(r.letter)!;
  }
  return out;
}

/** Stanza-level form verdict (LYRICAL-compatible names where they overlap). */
function stanzaForm(rhymes: LineRhyme[], details: PhonologicalScansionDetail[]): string | undefined {
  const s = canonicalScheme(rhymes);
  const n = rhymes.length;
  const meters = details.map(d => (d.consensusMeter ?? d.meter).split(' ')[0]);
  const dominant = (name: string, frac = 0.5) => meters.filter(m => m === name).length / n >= frac;

  if (n === 2 && s === 'AA') return 'couplet';
  if (n === 3) {
    if (s === 'ABA') return 'triplet (tercet, ABA)';
    if (s === 'AAA') return 'mono-rhymed triplet';
  }
  if (n === 4) {
    // Beat counts for the ballad gate: footCount (classical) or ictus count.
    const beats = details.map((d, i) =>
      d.footCount > 0 ? d.footCount : ictusProfile(d.scansion).ictuses);
    const alt43 = beats.length === 4 && beats[0] === beats[2] && beats[1] === beats[3]
      && beats[0] === beats[1] + 1;
    if (s === 'ABAB' || s === 'ABCB') {
      if (alt43) return `ballad stanza (${s}, ${beats[0]}·${beats[1]})`;
      return s === 'ABAB' ? 'quatrain (cross-rhymed, ABAB)' : `ballad-rhyme quatrain (ABCB)`;
    }
    if (s === 'ABBA') return 'quatrain (envelope, ABBA)';
    if (s === 'AABB') return 'quatrain (couplet pair, AABB)';
    if (s === 'AAAA') return 'mono-rhymed quatrain';
  }
  if (n === 5 && s === 'AABBA') {
    const ternary = meters.filter(m => m === 'anapestic' || m === 'amphibrachic' || m === 'dactylic').length >= 3;
    return ternary ? 'limerick (AABBA, ternary)' : 'limerick rhyme (AABBA)';
  }
  if (n === 6 && s === 'ABABCC') return 'sextilla / Venus-and-Adonis stanza (ABABCC)';
  if (n === 7 && s === 'ABABBCC') return 'rhyme royal (ABABBCC)';
  if (n === 8 && (s === 'ABABABCC' || s === 'ABABABAB')) return `octave (${s})`;

  // Unrhymed stanza: blank verse when iambic pentameter dominates.
  const unrhymed = rhymes.every(r => r.letter === '·');
  if (unrhymed && n >= 3) {
    const iambicPenta = details.filter(d =>
      (d.consensusMeter ?? d.meter) === 'iambic pentameter').length / n;
    if (iambicPenta >= 0.6) return 'blank verse';
    if (details.every(d => d.meterName === 'free verse') || details.some(d => d.rhythmNote)) return undefined; // rhythm layer already speaks
  }
  return undefined;
}

/** Poem-level form verdicts that span stanzas (sonnets, terza rima…). */
function poemForm(stanzas: { rhymes: LineRhyme[]; details: PhonologicalScansionDetail[] }[]): string | undefined {
  const all = stanzas.flatMap(st => st.rhymes);
  const n = all.length;
  // Whole-poem scheme with stanza-local letters concatenated is NOT meaningful;
  // re-detect across the full poem for sonnet/terza checks.
  if (n === 14) {
    const rs = detectScheme(all.map(r => r.endWord));
    const s = canonicalScheme(rs);
    if (/^ABABCDCDEFEFGG$/.test(s)) return 'Shakespearean Sonnet';
    if (/^ABBAABBA/.test(s)) return 'Petrarchan Sonnet';
    if (s.endsWith('GG') || /(..)\1*..$/.test(s)) {
      // 14 iambic-pentameter lines with a closing couplet still reads sonnet-like.
      const last2 = rs[12].letter !== '·' && rs[12].letter === rs[13].letter;
      const iambicPenta = stanzas.flatMap(st => st.details)
        .filter(d => (d.consensusMeter ?? d.meter) === 'iambic pentameter').length / 14;
      if (last2 && iambicPenta >= 0.5) return 'sonnet (14 lines, closing couplet)';
    }
  }
  // Terza rima: chained tercets ABA BCB CDC…
  if (stanzas.length >= 3 && stanzas.every(st => st.rhymes.length === 3)) {
    let chained = true;
    for (let i = 0; i + 1 < stanzas.length && chained; i++) {
      const mid = stanzas[i].rhymes[1].endWord;
      const nxt = stanzas[i + 1].rhymes;
      const p1 = classifyRhymePair(mid, nxt[0].endWord);
      const p3 = classifyRhymePair(mid, nxt[2].endWord);
      if (!(p1 && STRONG.has(p1.type)) || !(p3 && STRONG.has(p3.type))) chained = false;
    }
    if (chained) return 'terza rima (ABA BCB CDC…)';
  }
  return undefined;
}

/** Syllable-bearing (non-punctuation) words of a line, in linear order. */
function lineWords(line: LineResult): ClsWord[] {
  return line.sentence.words.filter(w => !isPunctuation(w.lexicalClass) && w.syllables.length > 0);
}

/** Last syllable-bearing word of a line (across its merged sentences). */
function lineEndWord(line: LineResult): string {
  const ws = lineWords(line);
  return ws.length ? ws[ws.length - 1].word : '';
}

// ─── INTERNAL (PRE-CAESURAL) RHYME — additive layer ─────────────────
//
// The per-stanza END-rhyme scheme (detectScheme) is the primary, UNTOUCHED
// system: every line keeps its end letter AND its rhyme type.  Layered ON TOP,
// a word immediately preceding a caesura that FULLY rhymes (identical/rich/
// perfect — never the looser slant tiers, which on a caesura word are mostly
// coincidental noise) with an end word, or with another such internal word, is
// annotated as an INTERNAL rhyme.  It reuses the end-rhyme letter it echoes, or
// — for an internal-only pair — a fresh letter that does not collide with the
// stanza's end letters.  Internal rhymes render parenthesised before the end
// letter ("(A)B"), each carrying its own type.  Purely additive: the end
// scheme's letters and types are never modified.

/** Attach pre-caesural internal rhymes to each line's `detail.rhyme`, on top of
 *  the per-stanza end scheme `rhymes` (from detectScheme).  Mutates in place. */
function attachInternalRhymes(lines: LineResult[], rhymes: LineRhyme[]): void {
  interface Pos { line: number; word: string; kind: 'end' | 'internal'; }
  const positions: Pos[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lw = lineWords(lines[i]);
    const endObj = lw.length ? lw[lw.length - 1] : undefined;
    positions.push({ line: i, word: rhymes[i].endWord, kind: 'end' });
    const pre = preCaesuralWords(
      lines[i].sentence.words, lines[i].phonologicalHierarchy, lines[i].phonologicalScansion.scansion);
    for (const { word } of pre) {
      if (word === endObj || !word.isContent) continue;  // the end word / function words are not internal-rhyme bearers
      positions.push({ line: i, word: word.word, kind: 'internal' });
    }
  }
  // Union-find over positions.  End-end links are NOT made (detectScheme already
  // lettered the ends); only links INVOLVING an internal, at the full-rhyme tier.
  const parent = positions.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let a = 0; a < positions.length; a++) {
    for (let b = a + 1; b < positions.length; b++) {
      if (positions[a].kind === 'end' && positions[b].kind === 'end') continue;
      if (!positions[a].word || !positions[b].word) continue;
      const pair = classifyRhymePair(positions[a].word, positions[b].word);
      if (pair && STRICT_INTERNAL.has(pair.type)) union(a, b);
    }
  }
  // Letter per class: a class containing a lettered end takes that end's letter;
  // an internal-only class of >=2 gets a fresh letter clear of the stanza's ends.
  const endLetterAt = new Map<number, string>();
  positions.forEach((p, i) => { if (p.kind === 'end' && rhymes[p.line].letter !== '\u00b7') endLetterAt.set(i, rhymes[p.line].letter); });
  const used = new Set<string>(rhymes.filter(r => r.letter !== '\u00b7').map(r => r.letter));
  let code = 0;
  const freshLetter = () => { let c: string; do { c = String.fromCharCode(65 + (code++ % 26)); } while (used.has(c)); used.add(c); return c; };
  const classMembers = new Map<number, number[]>();
  for (let i = 0; i < positions.length; i++) { const r = find(i); if (!classMembers.has(r)) classMembers.set(r, []); classMembers.get(r)!.push(i); }
  const classLetter = new Map<number, string>();
  for (const [root, members] of classMembers) {
    if (members.length < 2) continue;
    const endMember = members.find(m => endLetterAt.has(m));
    if (endMember !== undefined) classLetter.set(root, endLetterAt.get(endMember)!);
    else if (members.some(m => positions[m].kind === 'internal')) classLetter.set(root, freshLetter());
  }
  const typeOf = (p: number): RhymeTypeName | undefined => {
    for (const m of classMembers.get(find(p)) ?? []) {
      if (m === p) continue;
      const pair = classifyRhymePair(positions[m].word, positions[p].word);
      if (pair && STRICT_INTERNAL.has(pair.type)) return pair.type;
    }
    return undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const internal: { word: string; letter: string; type?: string }[] = [];
    positions.forEach((p, idx) => {
      if (p.line !== i || p.kind !== 'internal') return;
      const letter = classLetter.get(find(idx));
      if (letter) internal.push({ word: p.word, letter, type: typeOf(idx) });
    });
    const endLetter = rhymes[i].letter;
    const intStr = internal.map(x => `(${x.letter})`).join('');
    const notation = intStr + (endLetter !== '\u00b7' ? endLetter : (internal.length ? '' : '\u00b7'));
    lines[i].phonologicalScansion.rhyme = {
      endWord: rhymes[i].endWord,
      letter: endLetter,
      type: rhymes[i].type,
      matchedLine: rhymes[i].matchedLine,
      internal: internal.length ? internal : undefined,
      notation,
    };
  }
}

/**
 * Annotate rhyme letters/types (`detail.rhyme`) and form verdicts
 * (`detail.formNote`) across a poem.  Stanza forms are per-stanza; a poem-level
 * form (sonnet, terza rima) overrides stanza notes.  Annotation-only — no
 * meter/scansion/certainty is touched.
 */
export function applyRhymeAndForm(stanzas: LineResult[][]): void {
  // FORM detection uses per-stanza end-rhyme schemes (relative, restarting each
  // stanza) — that is what couplet/quatrain/sonnet patterns are defined over.
  const analyzed = stanzas.map(lines => {
    const details = lines.map(l => l.phonologicalScansion);
    const rhymes = detectScheme(lines.map(lineEndWord));
    return { lines, details, rhymes };
  });
  for (const { details, rhymes } of analyzed) {
    const form = stanzaForm(rhymes, details);
    for (const d of details) d.formNote = form;
  }
  const pform = poemForm(analyzed);
  if (pform) for (const { details } of analyzed) for (const d of details) d.formNote = pform;
  // Per-stanza end-rhyme letters + TYPES (detectScheme), then the additive
  // pre-caesural internal-rhyme layer.  Writes `detail.rhyme`; the original
  // end-rhyme display is restored and extended, never replaced.
  for (const { lines, rhymes } of analyzed) attachInternalRhymes(lines, rhymes);
}

// ─── PHONOPOETICS — poem-wide end / caesural / head rhyme, alliteration,
//     acrostic, with the maintainer's three-phase lettering ─────────────
//
// Lettering proceeds in three phases over ONE shared alphabet:
//   1. END words (line 1→N): each rhyme group gets a letter A,B,C…; a later word
//      reuses an earlier group's letter when it rhymes with it (across stanzas).
//   2. CAESURAL words (pre-caesura): continue the alphabet (new letter per new
//      caesural rhyme); a caesural word reuses an END letter ONLY if it rhymes
//      with that exact end group.
//   3. HEAD words (line-initial): continue the alphabet, a new letter per head
//      rhyme (head rhymes do not reuse end/caesural letters).
// Alliteration carries NO letters; an acrostic's letters are inherent.
// Each rhyme letter is to be COLOURED by the strongest relative-stress tier among
// the syllables it spans (`topStress`) — done at the display layer.

const STRESS_ORDER: StressLevel[] = ['x', 'w', 'n', 'm', 's'];
function topStressOf(...ws: (ClsWord | undefined)[]): StressLevel {
  let best: StressLevel = 'x';
  for (const w of ws) {
    if (!w) continue;
    for (const s of w.syllables) {
      const r = s.relativeStress ?? 'w';
      if (STRESS_ORDER.indexOf(r) > STRESS_ORDER.indexOf(best)) best = r;
    }
  }
  return best;
}

/** First consonant phoneme of a word (for alliteration), or '' if vowel-initial/OOV. */
function onsetPhone(word: string): string {
  const ph = phonesOf(word);
  if (!ph || ph.length === 0) return '';
  const p0 = base(ph[0]);
  return isVowelPhone(p0) ? '' : p0;
}

export interface RhymeRel {
  fromWord: string; fromLabel: string;       // the rhyme site being annotated
  toWord: string;   toLabel: string;         // its partner
  letter: string;
  type?: RhymeTypeName;
  kind: 'end' | 'caesural' | 'head';
  topStress: StressLevel;                    // strongest tier spanned (letter colour)
}
export interface Phonopoetics {
  endScheme: string;                         // poem-wide canonical end scheme ("ABAB…")
  end: RhymeRel[];
  caesural: RhymeRel[];
  head: RhymeRel[];
  alliteration: { label: string; words: string[] }[];
  acrostics: { labels: string[]; firsts: string[]; word: string }[];
}

/** Whole-poem phonopoetic analysis: structured data for the Phonopoetics
 *  synopsis section.  Read-only — never mutates the per-line scansion. */
export function analyzePhonopoetics(stanzas: LineResult[][]): Phonopoetics {
  const multi = stanzas.length > 1;
  interface PL { line: LineResult; label: string; }
  const PLs: PL[] = [];
  stanzas.forEach((st, s) => st.forEach((line, l) =>
    PLs.push({ line, label: multi ? `S${s + 1}L${l + 1}` : `L${l + 1}` })));

  const endObj = (pl: PL): ClsWord | undefined => { const ws = lineWords(pl.line); return ws[ws.length - 1]; };
  const headObj = (pl: PL): ClsWord | undefined => lineWords(pl.line).find(w => w.isContent);
  const caesuralObjs = (pl: PL): ClsWord[] => {
    const end = endObj(pl);
    const pre = preCaesuralWords(pl.line.sentence.words, pl.line.phonologicalHierarchy, pl.line.phonologicalScansion.scansion);
    return pre.map(p => p.word).filter(w => w !== end && w.isContent);
  };

  // ── Phase 1: END rhymes (poem-wide) ──
  const endWords = PLs.map(pl => lineEndWord(pl.line));
  const es = detectScheme(endWords);
  const endScheme = canonicalScheme(es);
  const byLetter = new Map<string, number[]>();
  es.forEach((r, i) => { if (r.letter !== '·') { (byLetter.get(r.letter) ?? byLetter.set(r.letter, []).get(r.letter)!).push(i); } });
  let nextCode = byLetter.size;
  const freshLetter = (): string => String.fromCharCode(65 + (nextCode++ % 26));

  const end: RhymeRel[] = [];
  for (const [letter, idxs] of byLetter) {
    for (let k = 1; k < idxs.length; k++) {
      const i = idxs[k], j = idxs[k - 1]; // j earlier, i later → show earlier → later
      end.push({
        fromWord: endWords[j], fromLabel: PLs[j].label,
        toWord: endWords[i], toLabel: PLs[i].label,
        letter, type: es[i].type, kind: 'end',
        topStress: topStressOf(endObj(PLs[i]), endObj(PLs[j])),
      });
    }
  }

  // ── Phase 2: CAESURAL rhymes ──
  interface CW { pl: number; word: ClsWord; letter?: string; pLabel?: string; pWord?: string; type?: RhymeTypeName; }
  const cws: CW[] = [];
  PLs.forEach((pl, i) => caesuralObjs(pl).forEach(w => cws.push({ pl: i, word: w })));
  // (a) bind to an exact END group it rhymes with → reuse that end letter
  for (const cw of cws) {
    for (let i = 0; i < PLs.length; i++) {
      if (es[i].letter === '·') continue;             // unrhymed end → not a "pair"
      const ew = endObj(PLs[i]); if (!ew || ew === cw.word) continue;
      const pair = classifyRhymePair(cw.word.word, ew.word);
      if (pair && STRICT_INTERNAL.has(pair.type)) {
        cw.letter = es[i].letter; cw.pLabel = PLs[i].label; cw.pWord = ew.word; cw.type = pair.type; break;
      }
    }
  }
  // (b) caesural↔caesural among the still-unbound → fresh letters
  const unbound = cws.filter(c => !c.letter);
  for (let i = 0; i < unbound.length; i++) {
    if (unbound[i].letter) continue;
    for (let j = 0; j < i; j++) {
      const pair = classifyRhymePair(unbound[i].word.word, unbound[j].word.word);
      if (pair && STRICT_INTERNAL.has(pair.type)) {
        if (!unbound[j].letter) unbound[j].letter = freshLetter();
        unbound[i].letter = unbound[j].letter;
        // only the later member is annotated (points back) so each pair shows once
        unbound[i].pLabel = PLs[unbound[j].pl].label; unbound[i].pWord = unbound[j].word.word; unbound[i].type = pair.type;
        break;
      }
    }
  }
  const caesural: RhymeRel[] = cws.filter(c => c.letter && c.pLabel).map(c => ({
    fromWord: c.word.word, fromLabel: PLs[c.pl].label,
    toWord: c.pWord!, toLabel: c.pLabel!,
    letter: c.letter!, type: c.type, kind: 'caesural' as const,
    topStress: topStressOf(c.word),
  }));

  // ── Phase 3: HEAD rhymes (line-initial) — fresh letters, no reuse ──
  interface HW { pl: number; word: ClsWord; letter?: string; pLabel?: string; pWord?: string; type?: RhymeTypeName; }
  const hws: HW[] = PLs.map((pl, i) => ({ pl: i, word: headObj(pl)! })).filter(h => h.word);
  for (let i = 0; i < hws.length; i++) {
    if (hws[i].letter) continue;
    for (let j = 0; j < i; j++) {
      const pair = classifyRhymePair(hws[i].word.word, hws[j].word.word);
      if (pair && STRICT_INTERNAL.has(pair.type)) {
        if (!hws[j].letter) hws[j].letter = freshLetter();
        hws[i].letter = hws[j].letter;
        // only the later member is annotated (points back) so each pair shows once
        hws[i].pLabel = PLs[hws[j].pl].label; hws[i].pWord = hws[j].word.word; hws[i].type = pair.type;
        break;
      }
    }
  }
  const head: RhymeRel[] = hws.filter(h => h.letter && h.pLabel).map(h => ({
    fromWord: h.word.word, fromLabel: PLs[h.pl].label,
    toWord: h.pWord!, toLabel: h.pLabel!,
    letter: h.letter!, type: h.type, kind: 'head' as const,
    topStress: topStressOf(h.word),
  }));

  // ── Alliteration: maximal runs (≥2) of content words sharing first letter AND
  //    first consonant phoneme (function words may sit between, but do not count). ──
  const alliteration: { label: string; words: string[] }[] = [];
  for (const pl of PLs) {
    const cw = lineWords(pl.line).filter(w => w.isContent);
    let run: ClsWord[] = [];
    const flush = () => { if (run.length >= 2) alliteration.push({ label: pl.label, words: run.map(w => w.word) }); run = []; };
    for (const w of cw) {
      const letter0 = (w.word.match(/[a-z]/i)?.[0] ?? '').toLowerCase();
      const phone0 = onsetPhone(w.word);
      if (!letter0 || !phone0) { flush(); continue; }
      if (run.length === 0) { run = [w]; continue; }
      const prev = run[run.length - 1];
      const pLetter = (prev.word.match(/[a-z]/i)?.[0] ?? '').toLowerCase();
      if (letter0 === pLetter && phone0 === onsetPhone(prev.word)) run.push(w);
      else { flush(); run = [w]; }
    }
    flush();
  }

  // ── Acrostic: per-stanza (and, if multi-stanza, whole-poem) first letters that
  //    spell a dictionary word (≥3 letters). ──
  const acrostics: { labels: string[]; firsts: string[]; word: string }[] = [];
  const firstLetterOf = (line: LineResult): string => {
    const ws = lineWords(line);
    return ws.length ? (ws[0].word.match(/[a-z]/i)?.[0] ?? '').toUpperCase() : '';
  };
  const checkAcrostic = (lines: LineResult[], labels: string[]) => {
    const firsts = lines.map(firstLetterOf);
    if (firsts.some(f => !f)) return;
    const word = firsts.join('');
    if (word.length >= 3 && phonesOf(word)) acrostics.push({ labels, firsts, word });
  };
  stanzas.forEach((st, s) => checkAcrostic(st, st.map((_, l) => multi ? `S${s + 1}L${l + 1}` : `L${l + 1}`)));
  if (multi) checkAcrostic(stanzas.flat(), PLs.map(p => p.label));

  return { endScheme, end, caesural, head, alliteration, acrostics };
}

// ─── POEM-LEVEL META-MEASURE (synopsis) ─────────────────────────────
//
// A cumulative, NON-INTERFERING reading of the whole poem, shown at the foot of
// the reading views.  It draws solely on determinations already made per line
// (meter, rhythm, rhyme, form) and never overrides them.  Deliberately offers
// SEVERAL top conclusions rather than forcing a single verdict.

// Canonical end-rhyme schemes of the LYRICAL FORM_REGISTRY forms whose pattern is
// expressible in plain letters (refrain forms — villanelle, pantoum, rondeau … —
// need repetition checking and are deferred).  Used to NOTE whole-poem rhyme-
// scheme alignment in the synopsis; the per-stanza/poem form layer remains the
// authority for the FORM verdict itself.
const REGISTRY_FORM_SCHEMES: { lines: number; scheme: string; name: string }[] = [
  { lines: 2,  scheme: 'AA',             name: 'Couplet' },
  { lines: 3,  scheme: 'ABA',            name: 'Triplet' },
  { lines: 4,  scheme: 'ABAB',           name: 'Quatrain' },
  { lines: 5,  scheme: 'AABBA',          name: 'Limerick' },
  { lines: 6,  scheme: 'ABABCC',         name: 'Sextilla' },
  { lines: 7,  scheme: 'ABABBCC',        name: 'Septet (rhyme royal)' },
  { lines: 9,  scheme: 'AAABBBCCC',      name: 'Triad' },
  { lines: 10, scheme: 'ABABCDECDE',     name: 'English Ode' },
  { lines: 14, scheme: 'ABABCDCDEFEFGG', name: 'Shakespearean Sonnet' },
  { lines: 14, scheme: 'ABBAABBACDCDCD', name: 'Petrarchan Sonnet' },
  { lines: 14, scheme: 'ABBAABBACDECDE', name: 'Petrarchan Sonnet' },
];

function matchRegistryForm(totalLines: number, canonicalEndScheme: string): string | undefined {
  return REGISTRY_FORM_SCHEMES.find(f => f.lines === totalLines && f.scheme === canonicalEndScheme)?.name;
}

/** A labelled line of the poem synopsis (display renders each). */
export interface SynopsisRow { label: string; value: string; }

const descriptorOf = (d: PhonologicalScansionDetail): string =>
  d.metricalityNote ? 'plausible prose'
    : d.rhythmNote ? d.rhythmNote                 // accentual/dolnik/taktovik → beats
    : d.meterName === 'free verse' ? 'free verse'
    : d.meter;                                    // e.g. "iambic pentameter"

// Compact metre labels for the synopsis ("iambic pentameter" → "iamb penta").
// Rhythm notes ("4/3 ♪beat accentual"), "free verse", and "plausible prose" are
// left untouched (they are not family+foot labels).
const _FAMILY_ABBR: Record<string, string> = {
  iambic: 'iamb', trochaic: 'troch', dactylic: 'dact', anapestic: 'anap',
  amphibrachic: 'amph', bacchic: 'bacch', spondaic: 'spon', pyrrhic: 'pyrr',
};
const _FOOT_ABBR: Record<string, string> = {
  monometer: 'mono', dimeter: 'di', trimeter: 'tri', tetrameter: 'tetra',
  pentameter: 'penta', hexameter: 'hexa', heptameter: 'hepta', octameter: 'octa',
};
function abbrevMeter(label: string): string {
  const parts = label.split(' ');
  if (parts.length === 2 && _FAMILY_ABBR[parts[0]] && _FOOT_ABBR[parts[1]]) {
    return `${_FAMILY_ABBR[parts[0]]} ${_FOOT_ABBR[parts[1]]}`;
  }
  return label;
}

/**
 * Build the cumulative poem synopsis: top meter(s)/mixed meters (accentual forms
 * reported in beats), the poem-wide rhyme scheme (with internal rhymes), and the
 * poetic-form alignment.  Reads only existing per-line determinations.
 */
export function summarizePoem(stanzas: LineResult[][]): SynopsisRow[] {
  const lines = stanzas.flat();
  const details = lines.map(l => l.phonologicalScansion);
  const N = details.length;
  const rows: SynopsisRow[] = [];
  if (N === 0) return rows;

  // ── Meter — several top conclusions, never forced into one ──
  const tally = new Map<string, number>();
  for (const d of details) tally.set(descriptorOf(d), (tally.get(descriptorOf(d)) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  let meterVal: string;
  if (N === 1) {
    meterVal = abbrevMeter(ranked[0][0]);
  } else if (ranked[0][1] / N >= 0.6) {
    const rest = ranked.slice(1, 3).map(([m, c]) => `${abbrevMeter(m)} (${c})`);
    meterVal = `predominantly ${abbrevMeter(ranked[0][0])} (${ranked[0][1]}/${N})`
      + (rest.length ? `; also ${rest.join(', ')}` : '');
  } else {
    meterVal = 'Mixed | ' + ranked.slice(0, 3).map(([m, c]) => `${abbrevMeter(m)} (${c}/${N})`).join(' · ');
  }
  // "Rhythm" = the metre make-up; "Meter" = the mean fit % (the maintainer's
  // synopsis taxonomy).
  rows.push({ label: 'Rhythm', value: meterVal });

  // ── Meter — mean of the per-line fit certainties ──
  const meanCert = Math.round(details.reduce((s, d) => s + d.certainty, 0) / N);
  rows.push({ label: 'Meter', value: `~${meanCert}% mean line-wise fit` });

  // ── Form — the form layer's verdict(s) + registry-scheme alignment.  (The
  // detailed rhyme listing now lives in the Phonopoetics section; the synopsis
  // carries only the canonical End-Rhyme Scheme, below.) ──
  const endRhymes = N >= 2 ? detectScheme(lines.map(lineEndWord)) : [];
  const endScheme = endRhymes.length ? canonicalScheme(endRhymes) : '';
  const hasEndRhyme = endRhymes.some(r => r.letter !== '·');
  const forms = [...new Set(details.map(d => d.formNote).filter((x): x is string => !!x))];
  let formVal: string | undefined = forms.length ? forms.join(' · ') : undefined;
  if (N >= 2) {
    const reg = matchRegistryForm(N, endScheme);
    if (reg && !(formVal && formVal.includes(reg))) {
      formVal = (formVal ? formVal + ' · ' : '') + `aligns with the ${reg} scheme`;
    }
  }
  if (formVal) rows.push({ label: 'Form', value: formVal });

  // ── End-Rhyme Scheme — poem-wide canonical scheme, its own row (only end
  // rhymes are matched against forms; caesural/head live in Phonopoetics). ──
  if (hasEndRhyme) rows.push({ label: 'End-Rhyme Scheme', value: endScheme });

  // ── Heterometric advisory — the whole-poem observation that per-line beat
  // counts vary widely (kept OUT of the per-line display, as an advisory here). ──
  const beats = details.map(d => (d.footCount > 0 ? d.footCount : ictusProfile(d.scansion).ictuses));
  const lo = Math.min(...beats), hi = Math.max(...beats);
  if (N >= 3 && hi - lo >= 3) {
    rows.push({ label: 'Note', value: `line lengths vary — ${lo}–${hi} beats per line` });
  }

  return rows;
}

```

## clio/scandroid.ts

```typescript
// scandroid.ts — Optional Scandroid integration: provides classic iambic and
// anapestic scansion algorithms from Hartman’s Scandroid, adapted to TypeScript.
// This module is purely functional; it does not modify the main pipeline and
// can be omitted without affecting the phonological scansion.

import { StressLevel, MetreName, ScansionResult } from '../types.js';

// ─── Constants from scanstrings.py ─────────────────────────────────

const STRESS = '/';
const SLACK = 'x';
const PROMOTED = '%';
const FOOTDIV = '|';

/** Foot dictionary for iambic lines (Scandroid’s footDict). */
const IAMBIC_FOOT_DICT: Record<string, string> = {
  'x/': 'iamb',
  'xx': 'pyrrhic',
  '//': 'spondee',
  '/x': 'trochee',
  'x/x': 'amphibrach',
  '//x': 'palimbacchius',
  'xx/': 'anapest',
  '/': 'defective',
  '/xx': 'dactyl',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '%x': '(trochee)',
  'x/xx': '2nd paeon',
  'xx/x': '3rd paeon',
};

/** Foot dictionary for anapestic lines (Scandroid’s AnapSubs). */
const ANAPESTIC_FOOT_DICT: Record<string, string> = {
  'xx/': 'anapest',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x/': 'iamb',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '//': 'spondee',
  'xx/x': '3rd paeon',
  'x/x': 'amphibrach',
  '///': 'molossus',
  '/x%': '(cretic)',
  '//x': 'palimbacchius',
};

// ─── Utility functions (adapted from scanutilities.py) ────────────

/** Generator-like function to walk through a string in chunks, matching a dictionary. */
function footFinder(
  fDict: Record<string, string>,
  str: string,
  chunkSize: number,
  start: number,
  end: number
): Array<{ foot: string; index: number }> {
  const result: Array<{ foot: string; index: number }> = [];
  let pos = start;
  while (pos < end) {
    const chunk = str.slice(pos, pos + chunkSize);
    if (chunk in fDict) {
      pos += chunkSize;
      result.push({ foot: fDict[chunk], index: pos });
    } else {
      // signal failure by returning empty array
      return [];
    }
  }
  return result;
}

/** Find the longest match of a RegExp in a string (last occurrence of longest length). */
function longestMatch(rx: RegExp, s: string): { start: number; length: number } | null {
  let start = -1, length = 0;
  let current = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s.slice(current))) !== null) {
    const mStart = current + m.index;
    const mEnd = mStart + m[0].length;
    if (mEnd - mStart >= length) {
      start = mStart;
      length = mEnd - mStart;
    }
    current = mStart + 1;
  }
  return start >= 0 ? { start, length } : null;
}

/** Compute line length in feet by counting non-adjacent stresses (for anapestic estimation). */
function altLineLenCalc(marks: string): number {
  const arr = marks.split('');
  for (let i = 0; i < arr.length; i++) {
    if (i === 0 || arr[i - 1] === '/') {
      if (arr[i] === '/') arr[i] = 'x';
    }
  }
  return arr.filter(ch => ch === '/').length;
}

// ─── Complexity measurement (from Scandroid’s _measureComplexity) ──

function iambicComplexity(footlist: string[], numFeet: number): number {
  if (footlist.length !== numFeet) return 100;
  let prevIsTrochee = false;
  let points = 0;
  for (let i = 0; i < footlist.length; i++) {
    let f = footlist[i];
    if (f.startsWith('(') && f.endsWith(')')) f = f.slice(1, -1);
    if (['spondee', 'pyrrhic', 'trochee'].includes(f)) points += 2;
    if (['anapest', 'defective', '3rd paeon', 'amphibrach', 'palimbacchius', '2nd paeon'].includes(f)) points += 4;
    if (['dactyl', 'cretic', 'bacchius'].includes(f)) points += 10;
    if (f === 'trochee') {
      if (i === footlist.length - 1) points += 6;
      if (prevIsTrochee) points += 8;
      prevIsTrochee = true;
    } else prevIsTrochee = false;
    if ((f === 'trochee' || f === 'defective') /* bounds test omitted for simplicity */) points += 4;
  }
  return points;
}

function anapesticComplexity(footlist: string[]): number {
  if (footlist.length === 0) return 100;
  let points = 0;
  for (const f of footlist) {
    if (f === 'bacchius') points += 2;
    else if (f === '(anapest)') points += 1;
    else if (f === 'iamb' || f === '(iamb)') points += 2;
    else if (f === 'cretic') points += 4;
    else if (['spondee', 'pyrrhic'].includes(f)) points += 4;
    else if (['amphibrach', '3rd paeon'].includes(f)) points += 4;
    else if (['2nd paeon', 'molossus', 'palimbacchius'].includes(f)) points += 5;
  }
  return points;
}

// ─── Iambic Algorithm 1: Corral the Weird ─────────────────────────

export function scandroidCorralWeird(
  marks: string,
  numFeet: number
): { footlist: string[]; scansionMarks: string } {
  const footlist: string[] = [];
  let remaining = marks;
  let lastFoot = '';

  // Step 1: handle terminal slack (extra syllables at end)
  const normLen = numFeet * 2;
  if (remaining.length > normLen + 1 && ['x/xx', 'xx/x'].includes(remaining.slice(-4))) {
    lastFoot = IAMBIC_FOOT_DICT[remaining.slice(-4)];
    remaining = remaining.slice(0, -4);
  } else if (remaining.length >= normLen && ['x/x', '//x'].includes(remaining.slice(-3))) {
    lastFoot = IAMBIC_FOOT_DICT[remaining.slice(-3)];
    remaining = remaining.slice(0, -3);
  }

  // Step 2: handle acephalous (headless) line
  if (remaining.length <= normLen - 2 && (remaining.startsWith('/x/x') || remaining.startsWith('/xxx'))) {
    footlist.push('defective');
    remaining = remaining.slice(1);
  }

  const currLen = remaining.length;
  const needFeet = numFeet - footlist.length - (lastFoot ? 1 : 0);
  const targetLen = needFeet * 2;

  if (currLen === targetLen) {
    const feet = footFinder(IAMBIC_FOOT_DICT, remaining, 2, 0, currLen);
    if (feet.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...feet.map(f => f.foot));
  } else if (currLen < targetLen) {
    // seek a defective foot (single stress)
    const candidate = remaining.indexOf('x//');
    if (candidate === -1 || candidate % 2 !== 0) return { footlist: [], scansionMarks: '' };
    const defectivePos = candidate + 2;
    const before = footFinder(IAMBIC_FOOT_DICT, remaining, 2, 0, defectivePos);
    if (before.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...before.map(f => f.foot));
    footlist.push('defective');
    const after = footFinder(IAMBIC_FOOT_DICT, remaining, 2, defectivePos + 1, currLen);
    if (after.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...after.map(f => f.foot));
  } else {
    // need anapests to fill extra syllables
    const need = currLen - targetLen;
    // collect candidate positions for anapest insertion
    const candidates: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (remaining.slice(i, i + 4) === '/xx/') candidates.push(i + 1);
    }
    if (candidates.length < need) {
      for (let i = 0; i < remaining.length; i++) {
        if (remaining.slice(i, i + 3) === 'xx/') candidates.push(i);
      }
    }
    let pos = 0;
    let anapestsUsed = 0;
    while (pos < currLen) {
      if (anapestsUsed < need && candidates.includes(pos)) {
        const chunk = remaining.slice(pos, pos + 3);
        if (!(chunk in IAMBIC_FOOT_DICT)) return { footlist: [], scansionMarks: '' };
        footlist.push(IAMBIC_FOOT_DICT[chunk]);
        pos += 3;
        anapestsUsed++;
      } else {
        const chunk = remaining.slice(pos, pos + 2);
        if (!(chunk in IAMBIC_FOOT_DICT)) return { footlist: [], scansionMarks: '' };
        footlist.push(IAMBIC_FOOT_DICT[chunk]);
        pos += 2;
      }
    }
  }

  if (lastFoot) footlist.push(lastFoot);

  // Generate scansion string with foot divisions
  const scansion = footlist.map(f => f.startsWith('(') ? f : f).join('|'); // simplistic
  return { footlist, scansionMarks: scansion };
}

// ─── Iambic Algorithm 2: Maximize the Normal ─────────────────────

export function scandroidMaximizeNormal(
  marks: string,
  numFeet: number
): { footlist: string[]; scansionMarks: string } {
  const possIambRE = /(x[x/])+/;
  const match = longestMatch(possIambRE, marks);
  if (!match) return { footlist: [], scansionMarks: '' };
  const { start, length } = match;
  const runEnd = start + length;
  const headMarks = marks.slice(0, start);
  const tailMarks = marks.slice(runEnd);
  const mainMarks = marks.slice(start, runEnd);
  const footlist: string[] = [];
  const headFeet: string[] = [];
  const tailFeet: string[] = [];

  // Scan the regular middle stretch
  const mainFeet = footFinder(IAMBIC_FOOT_DICT, mainMarks, 2, 0, mainMarks.length);
  if (mainFeet.length === 0) return { footlist: [], scansionMarks: '' };
  footlist.push(...mainFeet.map(f => f.foot));

  // Scan head
  if (headMarks.length > 0) {
    if (headMarks.length % 2 === 0) {
      const hf = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, 0, headMarks.length);
      if (hf.length === 0) return { footlist: [], scansionMarks: '' };
      headFeet.push(...hf.map(f => f.foot));
    } else {
      if (headMarks.startsWith('/x')) {
        headFeet.push('defective');
        const rest = headMarks.slice(1);
        if (rest.length > 0) {
          const hf = footFinder(IAMBIC_FOOT_DICT, rest, 2, 0, rest.length);
          if (hf.length === 0) return { footlist: [], scansionMarks: '' };
          headFeet.push(...hf.map(f => f.foot));
        }
      } else {
        // try to find an anapest in the head
        const anap = headMarks.indexOf('xx/');
        if (anap === -1) return { footlist: [], scansionMarks: '' };
        const before = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, 0, anap);
        if (before.length === 0) return { footlist: [], scansionMarks: '' };
        headFeet.push(...before.map(f => f.foot));
        headFeet.push('anapest');
        const after = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, anap + 3, headMarks.length);
        if (after.length === 0) return { footlist: [], scansionMarks: '' };
        headFeet.push(...after.map(f => f.foot));
      }
    }
  }

  // Scan tail
  if (tailMarks.length > 0) {
    let lastFootStr = '';
    let tailPart = tailMarks;
    if (tailPart.slice(-1) === 'x' && tailPart.length > 2 && tailPart.slice(-3) in IAMBIC_FOOT_DICT) {
      lastFootStr = IAMBIC_FOOT_DICT[tailPart.slice(-3)];
      tailPart = tailPart.slice(0, -3);
    }
    const tf = footFinder(IAMBIC_FOOT_DICT, tailPart, 2, 0, tailPart.length);
    if (tf.length === 0) return { footlist: [], scansionMarks: '' };
    tailFeet.push(...tf.map(f => f.foot));
    if (lastFootStr) tailFeet.push(lastFootStr);
  }

  const completeList = [...headFeet, ...footlist, ...tailFeet];
  // Promote pyrrhics as in Scandroid’s PromotePyrrhics
  for (let i = 0; i < completeList.length; i++) {
    if (completeList[i] === 'pyrrhic') {
      if (i < completeList.length - 1 && completeList[i + 1] === 'spondee') {
        // nothing
      } else {
        completeList[i] = '(iamb)';
      }
    }
  }

  const scansion = completeList.join('|');
  return { footlist: completeList, scansionMarks: scansion };
}

// ─── Anapestic scanning ──────────────────────────────────────────

export function scandroidAnapestic(
  marks: string,
  numFeet?: number
): { footlist: string[]; scansionMarks: string } {
  let remaining = marks;
  if (!numFeet) {
    const [q, r] = [Math.floor(remaining.length / 3), remaining.length % 3];
    let need = q;
    if (r > 0) need++;
    need = Math.max(need, altLineLenCalc(remaining));
    numFeet = need;
  }

  // Handle terminal slack (promotions etc.)
  if (remaining.slice(-2) === 'xx') remaining = remaining.slice(0, -1) + '%';
  let lastFootStr = '';
  if (remaining && remaining.slice(-1) === 'x') {
    let tailStart = remaining.lastIndexOf('/');
    tailStart = remaining.lastIndexOf('/', tailStart - 1);
    if (tailStart === -1) return { footlist: [], scansionMarks: '' };
    const tail = remaining.slice(tailStart);
    if (tail in ANAPESTIC_FOOT_DICT) {
      lastFootStr = ANAPESTIC_FOOT_DICT[tail];
      remaining = remaining.slice(0, tailStart);
    } else if (tail.length > 1 && tail.slice(1) in ANAPESTIC_FOOT_DICT) {
      lastFootStr = ANAPESTIC_FOOT_DICT[tail.slice(1)];
      remaining = remaining.slice(0, tailStart + 1);
    } else return { footlist: [], scansionMarks: '' };
  }

  // Promote slack runs (long sequences of unstressed)
  const slackRun = remaining.indexOf('xxxx');
  if (slackRun !== -1) {
    remaining = remaining.slice(0, slackRun + 2) + '%' + remaining.slice(slackRun + 3);
  }

  const len = remaining.length;
  const footlist: string[] = [];
  if (len === numFeet! * 3) {
    const feet = footFinder(ANAPESTIC_FOOT_DICT, remaining, 3, 0, len);
    if (feet.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...feet.map(f => f.foot));
  } else {
    const needDisyls = (numFeet! * 3) - len;
    if (needDisyls > numFeet!) return { footlist: [], scansionMarks: '' };
    const pattern = '2'.repeat(needDisyls) + '3'.repeat(numFeet! - needDisyls);
    const allPerms = uniquePermutations(pattern);
    let validPattern: string | null = null;
    for (const pat of allPerms) {
      let okay = true;
      let idx = 0;
      for (const d of pat) {
        const stride = parseInt(d);
        idx += stride;
        if (!'/%'.includes(remaining[idx - 1])) {
          okay = false;
          break;
        }
      }
      if (okay) {
        validPattern = pat;
        break;
      }
    }
    if (!validPattern) return { footlist: [], scansionMarks: '' };
    let pos = 0;
    for (const d of validPattern) {
      const stride = parseInt(d);
      const chunk = remaining.slice(pos, pos + stride);
      if (chunk in ANAPESTIC_FOOT_DICT) {
        footlist.push(ANAPESTIC_FOOT_DICT[chunk]);
        pos += stride;
      } else return { footlist: [], scansionMarks: '' };
    }
  }

  if (lastFootStr) footlist.push(lastFootStr);
  const scansion = footlist.join('|');
  return { footlist, scansionMarks: scansion };
}

// ─── Helper: unique permutations of a string ────────────────────

function uniquePermutations(s: string): string[] {
  if (s.length <= 1 || s.length > 9) return [s];
  const results: string[] = [];
  function permute(prefix: string, rest: string) {
    if (rest.length === 0) results.push(prefix);
    const seen = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
      if (seen.has(rest[i])) continue;
      seen.add(rest[i]);
      permute(prefix + rest[i], rest.slice(0, i) + rest.slice(i + 1));
    }
  }
  permute('', s);
  return results;
}

// ─── Public API: convert our relative stress to Scandroid marks ──

export function stressToMarks(stressArray: StressLevel[]): string {
  return stressArray.map(s => (s === 's' ? STRESS : SLACK)).join('');
}

export function marksToFeetString(footlist: string[]): string {
  return footlist.join(' | ');
}

// ─── Convenience: produce a ScansionResult from footlist ─────────

export function scansionResultFromFootlist(
  footlist: string[],
  meter: MetreName,
  complexity?: number
): ScansionResult {
  return {
    meter,
    scansion: marksToFeetString(footlist),
    certainty: 0, // not computed
    weightScore: 0,
    maxPossibleWeight: 0,
    algorithm: 'Scandroid',
  };
}
```

## clio/scansion.ts

```typescript
// scansion.ts — Unified gradient foot-fitting for McAleese's phonological method.
//
// DESIGN (2026-05-29 rewrite):
//   Meter selection and scansion-string assembly share ONE model.  For every
//   candidate meter we find — by dynamic programming — the best segmentation of
//   the line's actual relative-stress contour into that meter's feet, allowing
//   linguistically-grounded variation (gradient feet, single-foot substitutions,
//   anacrusis, catalexis, feminine endings, edge-licensed inversion).  The DP's
//   score decides the meter; the very same segmentation IS the scansion.  No more
//   disconnect between "which meter" and "what does the foot string look like".
//
//   Layered on top is McAleese's key-stress weighting: meters that place their
//   beats at the right edges of phonological phrases / intonational units
//   ("beginnings free, endings strict", Kiparsky/Hayes) are rewarded.
//
//   Gradient feet (per the project's 4-level scale  w < n < m < s): an iamb may
//   surface as ws / ns / wm; an anapest as wws / wns / wnm / nms; etc.  Strong
//   metrical positions accept s/m fully and n by promotion (more readily when the
//   syllable carries a lexical content stress demoted only by clash); weak
//   positions accept w/n, tolerate m as a mild demotion, and treat s as the
//   cardinal "stress maximum in weak position" violation (relaxed at a
//   phonological-phrase left edge, per Fabb 1997).

import {
  ClsWord,
  IntonationalUnit,
  PhonologicalPhrase,
  CliticGroup,
  KeyStress,
  MetreName,
  MeterScore,
  PhonologicalScansionDetail,
  StressLevel,
} from '../types.js';
import { isPunctuation, isQuoteTag } from './parser.js';

// ─── CONSTANTS: metre definitions & key-stress weights ──────────────

const METRES: Record<MetreName, { foot: string; sylCount: number }> = {
  iambic:       { foot: 'ws',  sylCount: 2 },
  trochaic:     { foot: 'sw',  sylCount: 2 },
  spondaic:     { foot: 'ss',  sylCount: 2 },
  pyrrhic:      { foot: 'ww',  sylCount: 2 },
  anapestic:    { foot: 'wws', sylCount: 3 },
  dactylic:     { foot: 'sww', sylCount: 3 },
  amphibrachic: { foot: 'wsw', sylCount: 3 },
  bacchic:      { foot: 'wss', sylCount: 3 },
};

// McAleese's prosodic-unit importance weights for key-stress scoring.
const WEIGHT = { IU: 3, PP: 2, PW3plus: 2, PW2: 1, CP: 1 } as const;

// Candidate base meters.  Iambic/trochaic/anapestic/dactylic/amphibrachic are
// the base meters of English verse and compete on equal footing.  Bacchic is
// included only as a marginal whole-line candidate (it normally appears one foot
// at a time); pyrrhic & spondaic never form a whole line and are handled solely
// as in-line substitution feet, never as standalone candidates.
const CANDIDATE_METERS: MetreName[] = [
  'iambic', 'trochaic', 'anapestic', 'dactylic', 'amphibrachic', 'bacchic',
];

// ─── FLATTENED, CONTEXT-RICH SYLLABLE STREAM ───────────────────────

interface FlatSyl {
  word: ClsWord;
  stress: StressLevel;          // relative stress (w/n/m/s)
  lexicalStress: number;        // 0/1/2 lexical stress (pre-phrase); enables re-promotion
  isContent: boolean;
  globalIndex: number;
  wordIdx: number;
  isWordStart: boolean;
  isWordEnd: boolean;
  isPoly: boolean;
  weight: 'H' | 'L';
  isPPStart: boolean;           // first syllable of a phonological phrase (Fabb left edge)
  caesuraBefore: boolean;       // line start OR an IU/punctuation boundary precedes this syllable
  clashAdjacent: boolean;       // an immediately neighbouring syllable is also strong (stress clash)
  isLineFinal: boolean;         // the very last syllable of the line (strongest metrical slot)
  promotable: boolean;          // Attridge promotion: a 'w' flanked by x/w (or line edge)
                                // on both sides may realise a beat
  extrametrical?: 'morphological' | 'light_noun' | 'derivational';
}

/**
 * Flatten a sentence's words into a context-rich syllable stream in linear
 * (reading) order.  Phrasing context (PP starts, caesurae) is derived from the
 * IU hierarchy by membership, so it stays correct even when clitic groups are
 * stored out of linear order inside a phonological phrase.
 */
function flattenSyllables(words: ClsWord[], ius?: IntonationalUnit[]): FlatSyl[] {
  // Map each word -> "iuIdx.ppIdx" key for caesura / PP-start detection.
  const ppKeyOf = new Map<ClsWord, string>();
  const iuIdxOf = new Map<ClsWord, number>();
  if (ius) {
    for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
      for (let ppIdx = 0; ppIdx < ius[iuIdx].phonologicalPhrases.length; ppIdx++) {
        for (const cg of ius[iuIdx].phonologicalPhrases[ppIdx].cliticGroups) {
          for (const tok of cg.tokens) {
            ppKeyOf.set(tok, `${iuIdx}.${ppIdx}`);
            iuIdxOf.set(tok, iuIdx);
          }
        }
      }
    }
  }

  const result: FlatSyl[] = [];
  let idx = 0;
  let wordCounter = 0;
  let prevIuIdx: number | undefined = undefined;
  let prevPPKey: string | undefined = undefined;
  let sawPunctSinceLastSyl = true; // line start counts as a boundary
  let prevWasPunct = false;

  for (const w of words) {
    // Quotation marks are tokens but not prosodic breaks — they neither close an
    // IU nor license a caesura (a quoted word is read in the same breath).
    if (isPunctuation(w.lexicalClass)) {
      if (!isQuoteTag(w.lexicalClass)) sawPunctSinceLastSyl = true;
      prevWasPunct = true;
      continue;
    }
    const isPoly = w.syllables.length > 1;
    const myIu = iuIdxOf.get(w);
    const myPP = ppKeyOf.get(w);
    const ppChanged = myPP !== undefined && myPP !== prevPPKey;
    const iuChanged = myIu !== undefined && myIu !== prevIuIdx;
    const caesura = sawPunctSinceLastSyl || iuChanged;

    for (let si = 0; si < w.syllables.length; si++) {
      const s = w.syllables[si];
      result.push({
        word: w,
        stress: s.relativeStress ?? 'w',
        lexicalStress: s.lexicalStress ?? s.stress ?? 0,
        isContent: w.isContent,
        globalIndex: idx++,
        wordIdx: wordCounter,
        isWordStart: si === 0,
        isWordEnd: si === w.syllables.length - 1,
        isPoly,
        weight: s.weight || 'L',
        isPPStart: ppChanged && si === 0,
        caesuraBefore: caesura && si === 0,
        clashAdjacent: false, // filled in below
        promotable: false,    // filled in below
        isLineFinal: false,   // filled in below
        extrametrical: s.extrametrical,
      });
    }
    prevIuIdx = myIu;
    prevPPKey = myPP;
    sawPunctSinceLastSyl = false;
    prevWasPunct = false;
    wordCounter++;
  }
  // Second pass: mark stress clashes (a strong syllable adjacent to another strong one).
  for (let i = 0; i < result.length; i++) {
    const prevStrong = i > 0 && isStrong(result[i - 1].stress);
    const nextStrong = i < result.length - 1 && isStrong(result[i + 1].stress);
    result[i].clashAdjacent = prevStrong || nextStrong;
  }
  // Third pass: Attridge promotion — an unstressed syllable flanked on BOTH
  // sides by syllables no stronger than 'w' (or by a line edge) can realise a
  // metrical beat ("promotion", Attridge 1982; the 4B4V 'o-with-beat').  This
  // is what lets "happens to BE a French poet" carry its mid-line beat on a
  // function verb without inventing lexical stress for it.
  const weakOrEdge = (i: number) =>
    i < 0 || i >= result.length || result[i].stress === 'x' || result[i].stress === 'w';
  for (let i = 0; i < result.length; i++) {
    result[i].promotable = result[i].stress === 'w' && weakOrEdge(i - 1) && weakOrEdge(i + 1);
  }
  if (result.length > 0) result[result.length - 1].isLineFinal = true;
  return result;
}

// ─── KEY-STRESS EXTRACTION (retained for display + right-edge weighting) ─

function collectIUTokens(iu: IntonationalUnit): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const pp of iu.phonologicalPhrases) tokens.push(...collectPPTokens(pp));
  return tokens;
}
function collectPPTokens(pp: PhonologicalPhrase): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const cg of pp.cliticGroups) tokens.push(...cg.tokens);
  return tokens;
}

/** The metrically diagnostic tail of a unit: rightmost strong syllable + its predecessor(s). */
function extractPhrasalTail(syls: FlatSyl[], maxLen: number = 2): FlatSyl[] {
  if (syls.length === 0) return [];
  let rightStrong = -1;
  for (let i = syls.length - 1; i >= 0; i--) {
    if (syls[i].stress === 's' || syls[i].stress === 'm') { rightStrong = i; break; }
  }
  if (rightStrong === -1) return syls.slice(-maxLen);
  const start = Math.max(0, rightStrong - (maxLen - 1));
  return syls.slice(start, rightStrong + 1);
}

function rightmostStressed(tokens: ClsWord[], flat: FlatSyl[]): FlatSyl | undefined {
  for (let i = flat.length - 1; i >= 0; i--) {
    const fs = flat[i];
    if (tokens.includes(fs.word) && fs.stress !== 'w' && fs.stress !== 'x') return fs;
  }
  return undefined;
}

export function extractKeyStresses(ius: IntonationalUnit[], words: ClsWord[]): KeyStress[] {
  const result: KeyStress[] = [];
  const flat = flattenSyllables(words);

  // Polysyllabic words: whole contour.
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const sc = w.syllables.length;
    if (sc < 2) continue;
    const pattern = w.syllables.map(s => s.relativeStress ?? 'w').join('');
    const weight = sc >= 3 ? WEIGHT.PW3plus : WEIGHT.PW2;
    const firstSylIdx = flat.findIndex(fs => fs.word === w);
    const positions = Array.from({ length: sc }, (_, j) => firstSylIdx + j);
    result.push({ unitType: 'PW', pattern, weight, positions });
  }

  for (const iu of ius) {
    const iuTokens = collectIUTokens(iu);
    if (iuTokens.length === 0) continue;
    const iuSyls = flat.filter(fs => iuTokens.includes(fs.word));
    if (iuSyls.length > 0) {
      const tail = extractPhrasalTail(iuSyls, 3);
      result.push({ unitType: 'IU', pattern: tail.map(fs => fs.stress).join(''), weight: WEIGHT.IU, positions: tail.map(fs => fs.globalIndex) });
    }
    for (const pp of iu.phonologicalPhrases) {
      const ppTokens = collectPPTokens(pp);
      if (ppTokens.length === 0) continue;
      const ppSyls = flat.filter(fs => ppTokens.includes(fs.word));
      if (ppSyls.length > 0) {
        const tail = extractPhrasalTail(ppSyls);
        result.push({ unitType: 'PP', pattern: tail.map(fs => fs.stress).join(''), weight: WEIGHT.PP, positions: tail.map(fs => fs.globalIndex) });
      }
      for (const cg of pp.cliticGroups) {
        if (cg.tokens.length === 0) continue;
        const cp = rightmostStressed(cg.tokens, flat);
        if (cp) result.push({ unitType: 'CP', pattern: cp.stress, weight: WEIGHT.CP, positions: [cp.globalIndex] });
      }
    }
  }
  return result;
}

// ─── GRADIENT SYLLABLE FIT ─────────────────────────────────────────

// A syllable is "strong" if it bears at least moderate relative stress.
function isStrong(s: StressLevel): boolean { return s === 's' || s === 'm'; }

/**
 * Score one syllable against an expected metrical position.
 * Weak positions: w/n welcome, m a mild demotion, s the cardinal violation.
 * Strong positions: s/m welcome, n a promotion (better when it is a content
 * stress demoted only by clash), w a missing beat.
 */
function scoreSyllable(syl: FlatSyl, expected: 'W' | 'S'): number {
  const a = syl.stress;
  if (expected === 'S') {
    if (a === 's') return 4;
    if (a === 'm') return 3;
    if (a === 'n') {
      // Promotion into a strong slot.  A content syllable whose lexical stress
      // is primary (demoted to 'n' only by a phrasal clash) re-promotes readily.
      if (syl.lexicalStress >= 2) return 2.5;
      // Line-final beat: the strongest metrical slot accepts a secondary
      // syllable (e.g. clause-final modal "might"), as in sung/musical verse.
      if (syl.isLineFinal) return 2.2;
      return syl.isContent ? 1.5 : 0.8;
    }
    // 'x' (zero-provision clitic) in a strong slot — the cardinal missing beat,
    // worse than a plain 'w': beating "the"/"a"/"of" is maximally unmetrical.
    if (a === 'x') return -3.2;
    // 'w' in a strong slot — a missing beat, UNLESS flanked by weakness on both
    // sides: Attridge promotion lets such a syllable realise the beat ("happens
    // to BE a").  Value sits just below the pyrrhic-substitution alternative
    // (2+2−1.6 = 2.4 for the foot) so duple meters keep their pyrrhics while
    // ternary meters — which have no cheap pyrrhic escape — recover the beat.
    if (syl.promotable) return 0.3;
    return syl.lexicalStress >= 2 ? 0 : -2.5;
  } else {
    // 'x' (zero-provision clitic) in a weak slot — the ideal upbeat, marginally
    // better than a plain weak syllable.
    if (a === 'x') return 2.2;
    if (a === 'w') return 2;
    if (a === 'n') return 1.6;
    if (a === 'm') {
      // Mild demotion; cheap at a PP left edge (Fabb) or in a stress clash
      // (one of two adjacent stresses must yield to the meter).
      if (syl.isPPStart) return 0.5;
      return syl.clashAdjacent ? -0.3 : -1.2;
    }
    // 's' in a weak slot — stress maximum in weak position (Fabb), the cardinal
    // violation in isolation, but a routine, cheap demotion inside a clash.
    if (syl.isPPStart) return -0.6;
    return syl.clashAdjacent ? -1.3 : -3.2;
  }
}

// ─── FOOT TEMPLATES PER METER (with substitution / edge penalties) ──

interface FootCtx { isStart: boolean; caesuraBefore: boolean; isEnd: boolean; }
interface Template {
  pattern: ('W' | 'S')[];
  score: (ctx: FootCtx) => number;   // base (penalty ≤ 0) for using this foot
  atStart?: boolean;                 // only legal as the line's first foot
  atEnd?: boolean;                   // only legal as the line's last foot
  isPrimary?: boolean;               // counts as a "clean" foot for the certainty metric
  countsAsFoot?: boolean;            // default true.  False for beat-less EDGE units
                                     // (anacrusis upbeats, orphan-W fallbacks): they
                                     // appear in the scansion string but are not feet,
                                     // so a pentameter with an upbeat is not "hexameter".
                                     // Naming-only — never affects scores or selection.
}

// Substitution / variation penalties (negative = cost).  Tuned so that an
// occasional substitution is cheap (one foot at a time) but a meter that needs
// substitution on most feet loses to the meter whose primary foot those are.
const P = {
  INV_EDGE: -0.4,   // duple inversion at a licensed left edge (line start / post-caesura)
  INV_MID:  -3.0,   // duple inversion mid-line (marked)
  TRI_IN_DUPLE: -2.2, // anapest/dactyl substituting inside a duple meter
  DUPLE_IN_TRI: -1.3, // duple foot substituting inside a triple meter (often catalexis)
  PYRR: -1.6,
  SPON: -1.6,
  CATAL: -0.4,      // catalexis (truncated final foot)
  FEM: -0.5,        // feminine ending / hypercatalexis (extra final weak)
  ANAC1: -0.5,      // single anacrusis upbeat (falling meters)
  ANAC2: -1.2,      // double anacrusis upbeat
  ACEPH: -0.6,      // acephalous / headless first foot (rising meters)
  ORPHAN: -8,       // last-resort single-syllable foot
};

const S = (n: number) => () => n;

function getTemplatesForMeter(meter: MetreName): Template[] {
  let t: Template[] = [];
  switch (meter) {
    case 'iambic':
      // No headless ['S'] start: a stressed iambic line-opening is a trochaic
      // INVERSION (below), and a line that needs inversion on two feet is really
      // trochaic — letting the DP discover that rather than masking it.
      t = [
        { pattern: ['W', 'S'], score: S(0), isPrimary: true },
        { pattern: ['S', 'W'], score: c => (c.isStart || c.caesuraBefore) ? P.INV_EDGE : P.INV_MID }, // inversion
        { pattern: ['W', 'W', 'S'], score: S(P.TRI_IN_DUPLE) },     // anapestic substitution
        { pattern: ['W', 'W'], score: S(P.PYRR) },                  // pyrrhic
        { pattern: ['S', 'S'], score: S(P.SPON) },                  // spondee
        { pattern: ['W', 'S', 'W'], score: S(P.FEM), atEnd: true }, // feminine ending
        { pattern: ['S'], score: S(P.CATAL), atEnd: true, isPrimary: true }, // final beat-bearing monosyllable
      ];
      break;
    case 'trochaic':
      t = [
        { pattern: ['S', 'W'], score: S(0), isPrimary: true },
        { pattern: ['S'], score: S(P.CATAL), atEnd: true, isPrimary: true }, // catalexis (very common)
        { pattern: ['W', 'S'], score: c => (c.isStart || c.caesuraBefore) ? P.INV_EDGE : P.INV_MID }, // rising inversion
        { pattern: ['S', 'W', 'W'], score: S(P.TRI_IN_DUPLE) },     // dactylic substitution
        { pattern: ['S', 'S'], score: S(P.SPON) },
        { pattern: ['W', 'W'], score: S(P.PYRR) },
        // A single opening upbeat is true anacrusis — extrametrical, not a foot.
        // A DOUBLE upbeat fills a whole metrical position (a pyrrhic-substituted
        // first foot: "By the | SHORES of | GIT-che | GU-mee" stays tetrameter),
        // so it still counts toward the meter-length name.
        { pattern: ['W'], score: S(P.ANAC1), atStart: true, countsAsFoot: false },       // anacrusis upbeat
        { pattern: ['W', 'W'], score: S(P.ANAC2), atStart: true },
      ];
      break;
    case 'anapestic':
      t = [
        { pattern: ['W', 'W', 'S'], score: S(0), isPrimary: true },
        { pattern: ['W', 'S'], score: S(P.DUPLE_IN_TRI) },          // iambic substitution / acephalous
        { pattern: ['S'], score: S(P.ACEPH), atStart: true },
        // NB: making this acephalous start PRIMARY was tried (2026-06-12) to
        // mirror the amphibrach's primary catalectic ending — it fixed some
        // standalone Cowper-type anapests but boosted anapest against IAMBIC
        // lines corpus-wide (epg64 −1.4pt): reverted.  The amphi/anapest
        // naming on shared grids is handled by sibling arbitration + the
        // stanza anacrusis anchor instead.
        { pattern: ['W', 'S'], score: c => (c.isStart || c.caesuraBefore) ? P.ACEPH : P.DUPLE_IN_TRI, atStart: true },
        { pattern: ['W', 'W', 'S', 'W'], score: S(P.FEM), atEnd: true },
        { pattern: ['W', 'S', 'W'], score: S(P.FEM), atEnd: true },
      ];
      break;
    case 'dactylic':
      t = [
        { pattern: ['S', 'W', 'W'], score: S(0), isPrimary: true },
        { pattern: ['S', 'W'], score: S(P.DUPLE_IN_TRI), atEnd: true, isPrimary: true }, // catalexis
        { pattern: ['S'], score: S(P.CATAL), atEnd: true, isPrimary: true },
        { pattern: ['S', 'W'], score: S(P.DUPLE_IN_TRI) },          // trochaic substitution
        { pattern: ['W'], score: S(P.ANAC1), atStart: true, countsAsFoot: false },       // anacrusis
        { pattern: ['W', 'W'], score: S(P.ANAC2), atStart: true },  // fills a foot slot (see trochaic)
      ];
      break;
    case 'amphibrachic':
      t = [
        { pattern: ['W', 'S', 'W'], score: S(0), isPrimary: true },
        { pattern: ['W', 'S'], score: S(P.CATAL), atEnd: true, isPrimary: true }, // catalexis
        { pattern: ['S', 'W'], score: S(P.ACEPH), atStart: true },  // acephalous (lost initial weak)
        { pattern: ['S'], score: S(P.ACEPH), atStart: true },
        { pattern: ['W', 'S', 'W', 'W'], score: S(P.FEM), atEnd: true },
        // Clipped clausula: the final foot reduced to its bare ictus ("alone
        // in his BELgian HELL" — beats 2,5,7).  Strictly this 1-slack final
        // interval is dolnik-leaning, but without the template the whole
        // amphibrachic fit collapsed to orphan feet (score ≈0.5) and the
        // family vanished from the rankings of clipped lines entirely.
        // Costed like a ternary-in-duple substitution (heavier than the
        // catalectic WS): at the cheaper DUPLE_IN_TRI it poached iambic
        // lines corpus-wide (epg64 −0.9pt).
        { pattern: ['S'], score: S(P.TRI_IN_DUPLE), atEnd: true },
      ];
      break;
    case 'bacchic':
      t = [
        { pattern: ['W', 'S', 'S'], score: S(0), isPrimary: true },
        { pattern: ['W', 'S'], score: S(P.CATAL), atEnd: true },
        { pattern: ['S', 'S'], score: S(P.ACEPH), atStart: true },
        { pattern: ['S'], score: S(P.ACEPH), atStart: true },
      ];
      break;
    default:
      t = [{ pattern: ['W', 'S'], score: S(0), isPrimary: true }];
  }
  // Last-resort fallbacks so the DP always reaches the end of any contour.
  // The orphan S bears a beat (counts as a defective foot); the orphan W does not.
  t.push({ pattern: ['S'], score: S(P.ORPHAN) });
  t.push({ pattern: ['W'], score: S(P.ORPHAN), countsAsFoot: false });
  return t;
}

// ─── DP FIT: best segmentation of the contour for one meter ─────────

interface FitResult {
  feet: number[];        // syllable count of each foot, in order
  footStrs: string[];    // stress letters per foot (before clash marking)
  beats: Set<number>;    // global indices that fall on a metrical Strong position
  score: number;         // total raw DP score
  maxScore: number;      // ideal score for this segmentation (4 per strong slot, 2 per weak)
  cleanFeet: number;     // # feet using a primary (un-substituted) template
  countedFeet: number;   // # genuine feet for the meter-length name (excludes
                         // beat-less edge units: anacrusis upbeats, orphan-W)
}

function fitMeter(syls: FlatSyl[], meter: MetreName): FitResult {
  const N = syls.length;
  const templates = getTemplatesForMeter(meter);

  interface Memo { score: number; feetLens: number[]; primaryFlags: boolean[]; countFlags: boolean[]; strongOffsets: number[][]; }
  const memo: (Memo | undefined)[] = new Array(N + 1);

  function solve(i: number): Memo {
    if (i === N) return { score: 0, feetLens: [], primaryFlags: [], countFlags: [], strongOffsets: [] };
    const cached = memo[i];
    if (cached) return cached;

    let best: Memo = { score: -Infinity, feetLens: [], primaryFlags: [], countFlags: [], strongOffsets: [] };
    const isStart = i === 0;
    const caesuraBefore = syls[i].caesuraBefore;

    for (const tmpl of templates) {
      const L = tmpl.pattern.length;
      if (i + L > N) continue;
      const isEnd = i + L === N;
      if (tmpl.atStart && !isStart) continue;
      if (tmpl.atEnd && !isEnd) continue;

      let footScore = tmpl.score({ isStart, caesuraBefore, isEnd });
      const strongOffs: number[] = [];
      let straddlesCaesura = false;
      for (let k = 0; k < L; k++) {
        footScore += scoreSyllable(syls[i + k], tmpl.pattern[k]);
        if (tmpl.pattern[k] === 'S') strongOffs.push(k);
        // A foot may begin at a caesura but must not contain one in its interior:
        // foot boundaries align with major prosodic breaks (commas, IU edges).
        if (k > 0 && syls[i + k].caesuraBefore) straddlesCaesura = true;
      }
      // Foot boundaries prefer to align with caesurae, but feet are abstract
      // units: metrists place caesurae mid-foot freely (masculine/feminine
      // caesura), and phrase-edge alignment is already rewarded separately by
      // the McAleese right-edge bonus.  Keep only a small nudge — a 3-syllable
      // foot is structurally MORE likely to contain a comma than a 2-syllable
      // one, so a heavy penalty here systematically taxed ternary meters in
      // comma-rich lines (Nabokov's "Exile" read duple wherever commas fell).
      if (straddlesCaesura) footScore -= 1.0;

      // NB: we deliberately do NOT add a blanket penalty for splitting a
      // polysyllabic word across a foot boundary.  Such splits are routine in
      // English verse ("Through E|den took") and are metrically harmless when
      // each syllable lands in a position matching its stress.  The genuinely
      // costly case — a word's stressed syllable forced into a weak slot — is
      // already penalised by scoreSyllable (Fabb's constraint).

      const sub = solve(i + L);
      if (sub.score === -Infinity) continue;
      const total = footScore + sub.score;
      if (total > best.score) {
        best = {
          score: total,
          feetLens: [L, ...sub.feetLens],
          primaryFlags: [!!tmpl.isPrimary, ...sub.primaryFlags],
          countFlags: [tmpl.countsAsFoot !== false, ...sub.countFlags],
          strongOffsets: [strongOffs, ...sub.strongOffsets],
        };
      }
    }
    memo[i] = best;
    return best;
  }

  const sol = solve(0);
  const feet: number[] = sol.feetLens;
  const footStrs: string[] = [];
  const beats = new Set<number>();
  let pos = 0;
  let cleanFeet = 0;
  let maxScore = 0;
  for (let f = 0; f < feet.length; f++) {
    const L = feet[f];
    const strongSet = new Set(sol.strongOffsets[f]);
    maxScore += strongSet.size * 4 + (L - strongSet.size) * 2; // ideal: 4 per strong slot, 2 per weak
    let str = '';
    // A foot counts as "clean" only when it uses a primary (un-substituted)
    // template AND is actually realised as the ideal: every strong slot bears
    // a real beat (s/m) and every weak slot is genuinely weak (w/n).  A primary
    // template with a promoted (n) beat or a stressed weak slot is NOT clean.
    let clean = sol.primaryFlags[f];
    for (let k = 0; k < L; k++) {
      const syl = syls[pos + k];
      str += syl.stress;
      if (strongSet.has(k)) { if (!isStrong(syl.stress)) clean = false; }
      else { if (isStrong(syl.stress)) clean = false; }
    }
    footStrs.push(str);
    for (const off of sol.strongOffsets[f]) beats.add(syls[pos + off].globalIndex);
    if (clean) cleanFeet++;
    pos += L;
  }
  const countedFeet = sol.countFlags.filter(Boolean).length;
  return { feet, footStrs, beats, score: sol.score, maxScore, cleanFeet, countedFeet };
}

// ─── McALEESE RIGHT-EDGE (KEY-STRESS) BONUS ─────────────────────────

/**
 * Reward a segmentation that places metrical beats at the right edges of
 * phonological phrases and intonational units ("endings strict").  Returns a
 * ratio in [0,1]: matched unit-weight over total unit-weight.  This is the
 * signal that distinguishes rising (iambic/anapestic) from falling
 * (trochaic/dactylic) polarity, since phrase-final stresses are beats only in
 * rising meters.
 */
function rightEdgeRatio(flat: FlatSyl[], ius: IntonationalUnit[] | undefined, beats: Set<number>): number {
  if (!ius || ius.length === 0) return 0;
  let matched = 0;
  let total = 0;
  const considerUnit = (tokens: ClsWord[], weight: number) => {
    const syls = flat.filter(fs => tokens.includes(fs.word));
    let edge: FlatSyl | undefined;
    for (let i = syls.length - 1; i >= 0; i--) {
      if (isStrong(syls[i].stress)) { edge = syls[i]; break; }
    }
    if (!edge) return;
    total += weight;
    if (beats.has(edge.globalIndex)) matched += weight;
  };
  for (const iu of ius) {
    considerUnit(collectIUTokens(iu), WEIGHT.IU);
    for (const pp of iu.phonologicalPhrases) considerUnit(collectPPTokens(pp), WEIGHT.PP);
  }
  return total > 0 ? matched / total : 0;
}

// ─── SCANSION STRING (with silent-beat clash markers) ───────────────

function buildScansionString(syls: FlatSyl[], feet: number[], ius?: IntonationalUnit[]): string {
  // Clitic-phrase membership: a clash within the same CP or word inserts a
  // silent beat ('-') before the second strong syllable (McAleese p.222).
  const cpOf = new Map<ClsWord, number>();
  if (ius) {
    let cpId = 0;
    for (const iu of ius) for (const pp of iu.phonologicalPhrases) for (const cg of pp.cliticGroups) {
      for (const tok of cg.tokens) cpOf.set(tok, cpId);
      cpId++;
    }
  }
  const out: string[] = [];
  let pos = 0;
  for (const L of feet) {
    let foot = '';
    for (let k = 0; k < L; k++) {
      const cur = syls[pos];
      if (pos > 0 && isStrong(cur.stress)) {
        const prev = syls[pos - 1];
        if (isStrong(prev.stress)) {
          const sameCP = cpOf.get(prev.word) !== undefined && cpOf.get(prev.word) === cpOf.get(cur.word);
          if (sameCP || prev.wordIdx === cur.wordIdx) foot += '-';
        }
      }
      foot += cur.stress;
      pos++;
    }
    out.push(foot);
  }
  return out.join('|');
}

// ─── DISPLAY / NAMING HELPERS ──────────────────────────────────────

// Greek-numeral foot-length names, exhaustive through 20 (icosameter) per the
// maintainer's standardised nomenclature.  Long lines that are genuinely metrical
// deserve a real meter name rather than the "N-feet" othering, so the ladder runs
// all the way up; beyond 20 the bare "N-feet" fallback remains (lines that long
// are almost never integrally metrical, and the prose-likeness hedge handles them).
const LINE_LENGTH_NAMES = [
  '', 'monometer', 'dimeter', 'trimeter', 'tetrameter', 'pentameter',
  'hexameter', 'heptameter', 'octameter', 'nonometer', 'decameter',
  'hendecameter', 'dodecameter', 'triskaidecameter', 'tetradecameter',
  'pentadecameter', 'hexadecameter', 'heptadecameter', 'octadecameter',
  'enneadecameter', 'icosameter',
];
function lineLengthName(feet: number): string {
  return LINE_LENGTH_NAMES[feet] || `${feet}-feet`;
}

// ─── TOP-LEVEL METER SCORING ────────────────────────────────────────

// A meter's small intrinsic prior.  Iamb is the unmarked default of English
// verse; bacchic is a marginal whole-line meter.  Kept tiny — only a tie-breaker.
const METER_PRIOR: Partial<Record<MetreName, number>> = { iambic: 0.02 };

// Deliberate, project-level bias toward ternary meters.  English prosody defaults
// toward duple readings, but this toolkit aims to open English verse to the more
// musical ternary rhythms of (e.g.) Russian Silver-Age sources in translation, so
// when a triple reading is genuinely competitive it is nudged ahead.  Kept small
// enough that it never overturns a clearly-duple line.
const TERNARY_BIAS = 0.02;
const TERNARY_METERS = new Set<MetreName>(['anapestic', 'dactylic', 'amphibrachic', 'bacchic']);
const DUPLE_METERS = new Set<MetreName>(['iambic', 'trochaic']);

// Weights against the (0..1) normalised fit fraction.
const REDGE_WEIGHT = 0.28;   // right-edge (key-stress) agreement — disambiguates polarity
const CLEAN_WEIGHT = 0.12;   // share of feet realised cleanly (real beats, no substitution)
const ONSET_WEIGHT = 0.05;   // left-edge onset cue — coarse rising vs falling polarity
// Below this combined score, no meter is convincing → free verse.
const FREE_VERSE_THRESHOLD = 0.62;

const FALLING_METERS = new Set<MetreName>(['trochaic', 'dactylic']);
const RISING_METERS = new Set<MetreName>(['iambic', 'anapestic', 'amphibrachic', 'bacchic']);

/**
 * Coarse onset polarity cue.  If the line's first *strong* syllable is its very
 * first syllable, the rhythm falls (trochaic/dactylic); if it is preceded by an
 * upbeat, the rhythm rises (iambic/anapestic/amphibrachic).  We deliberately use
 * the relative-stress contour (not lexical prominence) and only the coarse
 * rising/falling split — the finer "one vs two upbeats" distinction is unreliable
 * across acephalous/anacrustic variants.  Only rewards a match, never penalises.
 */
function onsetBonus(flat: FlatSyl[], meter: MetreName): number {
  let f0 = -1;
  for (let i = 0; i < flat.length; i++) { if (isStrong(flat[i].stress)) { f0 = i; break; } }
  if (f0 < 0) return 0;
  if (f0 === 0) return FALLING_METERS.has(meter) ? ONSET_WEIGHT : 0;
  return RISING_METERS.has(meter) ? ONSET_WEIGHT : 0;
}

// ─── METRICALITY ASSESSMENT (Option-0 prose-likeness hedge) ─────────
//
// A single decontextualised line is, in generative-metrics terms, almost always
// fittable to SOME grid (English prose alternates; phrase-ends are right-strong),
// so absolute fit cannot separate prose from verse — empirically, loose real
// verse ("Half a league…", Prufrock) scores BELOW expository prose.  What DOES
// separate them is non-periodicity accumulated AT LENGTH: a long run of text that
// (a) commits to no meter — its top candidates straddle BOTH the rising/falling
// and the duple/triple divides within a hair — and (b) realises that best fit only
// weakly.  This is a deliberately HIGH-PRECISION gate: it fires only on the
// unmistakable un-lineated-prose case and never on short, loose, or ternary verse
// (the project's prized cases).  It is advisory — it changes the displayed verdict
// WORDING only; the scansion, fit, ranking, foot count and certainty are intact.

// Necessary length: real metrical lines top out around the hepta-/octameter, so
// 9+ feet is almost never an integral line.  Combined (AND) with the commitment
// and confidence gates below, clean verse that happens to exceed this length keeps
// a healthy margin and certainty and is therefore spared.
const PROSE_MIN_FEET = 9;
const PROSE_MAX_MARGIN = 0.10;   // top1 − top2: prose does not commit to one meter
const PROSE_MAX_CERTAINTY = 66;  // and realises even its best fit only weakly

/** Does the top-3 ranking straddle BOTH polarity (rising/falling) AND foot-size
 *  (duple/triple)?  The fingerprint of a contour equidistant from every meter —
 *  present in prose, absent in committed verse (whose ties stay within a family). */
function rankingStraddles(ranking: MeterScore[]): boolean {
  const top = ranking.slice(0, 3).map(r => r.meter as MetreName);
  const rising = top.some(m => RISING_METERS.has(m));
  const falling = top.some(m => FALLING_METERS.has(m));
  const triple = top.some(m => TERNARY_METERS.has(m));
  const duple = top.some(m => DUPLE_METERS.has(m));
  return rising && falling && triple && duple;
}

/**
 * If a line reads as plausible prose (see above), return the advisory hedge
 * string; otherwise undefined.  Reads only fields already present on the detail,
 * so it runs as a late, non-destructive pipeline pass (`applyMetricalityLayer`).
 */
export function metricalityVerdict(detail: PhonologicalScansionDetail): string | undefined {
  if (detail.meterName === 'free verse') return undefined; // already non-committal
  if (detail.rhythmNote) return undefined;                 // accentual/dolnik already named
  if (detail.footCount < PROSE_MIN_FEET) return undefined;
  const ranking = detail.ranking;
  if (!ranking || ranking.length < 2) return undefined;
  const margin = ranking[0].score - ranking[1].score;
  if (margin >= PROSE_MAX_MARGIN) return undefined;        // commits to one meter
  if (detail.certainty >= PROSE_MAX_CERTAINTY) return undefined;
  if (!rankingStraddles(ranking)) return undefined;
  return `No consistent metered rhythm(s) discerned.  Reads as plausible prose. `
    + `(Closest fit: ${detail.meter}, ${detail.certainty}%)`;
}

/** Set `detail.metricalityNote` on every line that reads as plausible prose.
 *  Non-destructive: only the new advisory field is written. */
export function applyMetricalityLayer(details: PhonologicalScansionDetail[]): void {
  for (const d of details) d.metricalityNote = metricalityVerdict(d);
}

export function scoreMeters(
  keyStresses: KeyStress[],
  words: ClsWord[],
  ius?: IntonationalUnit[],
  force?: MetreName,
): PhonologicalScansionDetail {
  const flat = flattenSyllables(words, ius);
  const N = flat.length;

  if (N === 0) {
    return {
      all: '', keyStresses: '', meter: 'free verse', meterName: 'free verse',
      footCount: 0, summary: 'no syllables', scansion: '',
      certainty: 0, weightScore: 0, maxPossibleWeight: 0,
    };
  }

  let best: { meter: MetreName; fit: FitResult; finalScore: number; redge: number } | null = null;
  // Every candidate's composite fit score, so the top-N can be surfaced (display).
  const candidates: MeterScore[] = [];
  const fitsByMeter = new Map<MetreName, { fit: FitResult; finalScore: number; redge: number }>();

  // `force` re-fits the line under ONE specific meter (used by the stanza/
  // poem continuity rename: a near-tie line adopts the dominant meter, and
  // its scansion/foot-count/certainty must come from that meter's own fit).
  for (const meter of (force ? [force] : CANDIDATE_METERS)) {
    const fit = fitMeter(flat, meter);
    if (fit.feet.length === 0 || fit.maxScore <= 0) continue;
    const redge = rightEdgeRatio(flat, ius, fit.beats);
    // Fraction of this meter's own ideal that the contour achieves.  Normalising
    // by each meter's maximum removes the structural advantage duple meters would
    // otherwise enjoy (more strong slots ⇒ more points).
    const fitFraction = fit.score / fit.maxScore;
    const cleanRatio = fit.feet.length > 0 ? fit.cleanFeet / fit.feet.length : 0;
    const finalScore = fitFraction
      + REDGE_WEIGHT * redge
      + CLEAN_WEIGHT * cleanRatio
      + onsetBonus(flat, meter)
      + (TERNARY_METERS.has(meter) ? TERNARY_BIAS : 0)
      + (METER_PRIOR[meter] ?? 0);

    candidates.push({ meter, score: finalScore });
    fitsByMeter.set(meter, { fit, finalScore, redge });

    if (!best || finalScore > best.finalScore + 1e-9) {
      best = { meter, fit, finalScore, redge };
    }
  }

  // ── Ternary-sibling arbitration ──
  // When two ternary families (anapest/amphibrach/dactyl) fit the line with the
  // IDENTICAL beat grid, the difference is purely one of conventional naming —
  // the reading is the same.  Metrists then name the foot so that (1) poly-
  // syllabic words are not split across foot boundaries ("he HAPpens to | BE a"
  // not "pens to BE"), and (2) foot boundaries align with phrase breaks
  // ("at the FOE | and we CAMPED" not "the FOE and | we CAMPED").  Composite
  // scores within 5% are treated as naming noise.
  if (best && TERNARY_METERS.has(best.meter)) {
    const wordSplits = (fit: FitResult) => {
      let splits = 0, pos = 0;
      for (const L of fit.feet) {
        pos += L;
        if (pos < N && flat[pos].isPoly && !flat[pos].isWordStart) splits++;
      }
      return splits;
    };
    const straddles = (fit: FitResult) => {
      let count = 0, pos = 0;
      for (const L of fit.feet) {
        for (let k = 1; k < L; k++) if (flat[pos + k].caesuraBefore) { count++; break; }
        pos += L;
      }
      return count;
    };
    const sameBeats = (a: Set<number>, b: Set<number>) =>
      a.size === b.size && [...a].every(v => b.has(v));
    let chosen = { meter: best.meter, ...fitsByMeter.get(best.meter)! };
    for (const sib of TERNARY_METERS) {
      if (sib === chosen.meter) continue;
      const cand = fitsByMeter.get(sib);
      if (!cand || cand.finalScore < best.finalScore * 0.95) continue;
      if (!sameBeats(cand.fit.beats, best.fit.beats)) continue;
      const better =
        wordSplits(cand.fit) < wordSplits(chosen.fit) ||
        (wordSplits(cand.fit) === wordSplits(chosen.fit) &&
          (straddles(cand.fit) < straddles(chosen.fit) ||
           (straddles(cand.fit) === straddles(chosen.fit) && cand.finalScore > chosen.finalScore)));
      if (better) chosen = { meter: sib, ...cand };
    }
    if (chosen.meter !== best.meter) best = { meter: chosen.meter, fit: chosen.fit, finalScore: chosen.finalScore, redge: chosen.redge };
  }

  // Ranked candidate meters (best first) — the same finalScores computed above,
  // except that sibling arbitration (above) may have re-ordered same-grid
  // ternary names: the chosen name leads.
  const ranking: MeterScore[] = [...candidates].sort((a, b) => b.score - a.score);
  if (best) {
    const bi = ranking.findIndex(r => r.meter === best!.meter);
    if (bi > 0) { const [b] = ranking.splice(bi, 1); ranking.unshift(b); }
  }

  const totalWeight = keyStresses.reduce((s, k) => s + k.weight, 0);

  if (!best || (!force && best.finalScore < FREE_VERSE_THRESHOLD)) {
    // Free verse: still emit the bare relative-stress contour for display.
    return {
      all: '', keyStresses: '', meter: 'free verse', meterName: 'free verse',
      footCount: 0, summary: `IU=${ius?.length ?? 0} (below metrical threshold)`,
      scansion: flat.map(f => f.stress).join(''),
      certainty: 0, weightScore: 0, maxPossibleWeight: totalWeight,
      ranking,
    };
  }

  const { meter, fit, redge } = best;
  const scansion = buildScansionString(flat, fit.feet, ius);
  // Meter-length name counts only genuine feet (beat-less anacrusis upbeats and
  // orphan-W edge units are excluded), so an upbeat pentameter is not "hexameter".
  const footCount = fit.countedFeet;
  // A "line" whose every segment is a beat-less edge unit (e.g. a single
  // reduced syllable: "a") has no feet to name a meter from — free verse.
  if (footCount <= 0 && !force) {
    return {
      all: '', keyStresses: '', meter: 'free verse', meterName: 'free verse',
      footCount: 0, summary: `IU=${ius?.length ?? 0} (no beat-bearing feet)`,
      scansion: flat.map(f => f.stress).join(''),
      certainty: 0, weightScore: 0, maxPossibleWeight: totalWeight,
      ranking,
    };
  }
  // Certainty = proportion of segments realised by a clean (un-substituted) foot,
  // tempered by the right-edge agreement.  Denominator stays ALL segments
  // (fit.feet.length) so this naming fix changes no certainty values.
  const cleanRatio = fit.feet.length > 0 ? fit.cleanFeet / fit.feet.length : 0;
  const certainty = Math.max(0, Math.min(100, Math.round(100 * (0.7 * cleanRatio + 0.3 * redge))));

  const metreName = `${meter} ${lineLengthName(footCount)}`;
  const summary = `IU=${ius?.length ?? 0} PP=${ius?.reduce((s, iu) => s + iu.phonologicalPhrases.length, 0) ?? 0} feet=${footCount} clean=${fit.cleanFeet}/${fit.feet.length}`;

  return {
    all: '', keyStresses: '', meter: metreName, meterName: meter,
    footCount, summary, scansion, certainty,
    weightScore: Math.round(redge * totalWeight), maxPossibleWeight: totalWeight,
    ranking,
  };
}

// ─── NON-CLASSICAL RHYTHM LAYER (accentual / dolnik / taktovik) ─────────────
//
// Russian-metrics taxonomy (Gasparov), mandated for this project's domain
// (Silver-Age translations, song verse): between strict accentual-syllabic
// meter and free accentual verse lie the DOLNIK (inter-ictus intervals of 1–2
// slack syllables) and the TAKTOVIK (1–3).  McAleese's own procedure (A2 §5d/e)
// supplies the gate: accentual-family verse keeps a CONSTANT strong-stress
// count while the SYLLABLE count varies — whereas a loose accentual-syllabic
// poem (Frost) keeps both steady.  This layer only annotates (`rhythmNote`);
// the classical reading, scansion, and certainty are never altered.
//
// NB: "ballad" is deliberately NOT a verdict of this pass.  A ballad is a
// stanzaic FORM (quatrains, a rhyme scheme) that may be iambic, trochaic, or
// accentual; the rhythm fact this pass can honestly report is the alternating
// 4·3 ictus count.  Form identification belongs to the (rhyme-aware) form
// layer.

/** Per-line ictus profile parsed from a scansion string ("ns|wx|ns|ws|ws"). */
export interface IctusProfile {
  syllables: number;     // overt syllables (x/w/n/m/s letters)
  ictuses: number;       // beats: s/m, plus Attridge-promoted n (see below)
  intervals: number[];   // slack-syllable counts between consecutive ictuses
  anacrusis: number;     // slack syllables before the first ictus
}

export function ictusProfile(scansion: string): IctusProfile {
  const letters = scansion.replace(/[^xwnms]/g, '');
  const positions: number[] = [];
  for (let i = 0; i < letters.length; i++) {
    const c = letters[i];
    if (c === 's' || c === 'm') { positions.push(i); continue; }
    // Attridge promotion at the rhythm level: the strong beat is NOT solely
    // the s tier.  m always counts; an 'n' flanked on both sides by x/w (or a
    // line edge) realises a beat; and a 'w' in the DEEPEST valley — flanked by
    // zero-provision 'x' (or an edge) on both sides, e.g. "it IS an" — is
    // promoted too (three offbeats in a row are what duple rhythm forbids).
    // 'x' itself never carries a beat.
    if (c === 'n') {
      const lo = i === 0 || letters[i - 1] === 'x' || letters[i - 1] === 'w';
      const hi = i === letters.length - 1 || letters[i + 1] === 'x' || letters[i + 1] === 'w';
      if (lo && hi) positions.push(i);
    } else if (c === 'w') {
      const lo = i === 0 || letters[i - 1] === 'x';
      const hi = i === letters.length - 1 || letters[i + 1] === 'x';
      if (lo && hi) positions.push(i);
    }
  }
  const intervals: number[] = [];
  for (let i = 1; i < positions.length; i++) intervals.push(positions[i] - positions[i - 1] - 1);
  return {
    syllables: letters.length,
    ictuses: positions.length,
    intervals,
    anacrusis: positions.length > 0 ? positions[0] : letters.length,
  };
}

/** Classify pooled inter-ictus intervals into the dolnik/taktovik/accentual family. */
function intervalFamily(intervals: number[]): 'duple' | 'ternary' | 'dolnik' | 'taktovik' | 'accentual' | null {
  if (intervals.length === 0) return null;
  const within = (lo: number, hi: number) =>
    intervals.filter(v => v >= lo && v <= hi).length / intervals.length;
  if (within(1, 1) === 1) return 'duple';
  if (within(2, 2) === 1) return 'ternary';
  // ≥90% tolerance: an isolated clash (0) or long dip does not bump the family.
  if (within(1, 2) >= 0.9) return 'dolnik';
  if (within(1, 3) >= 0.9) return 'taktovik';
  return 'accentual';
}

const ICTUS_NAMES = ['', '1-ictus', '2-ictus', '3-ictus', '4-ictus', '5-ictus', '6-ictus'];
const ictusName = (k: number) => ICTUS_NAMES[k] || `${k}-ictus`;

/**
 * Stanza-level rhythm classification.  Fires only when:
 *   (a) syllable counts VARY across the stanza (range ≥ 2) — a steady-count
 *       stanza is accentual-syllabic territory and is left to the classical
 *       machinery (this is what keeps loose iambics like Frost untouched); and
 *   (b) no classical meter dominates confidently (≥60% of lines under one
 *       meter at mean certainty ≥70).
 * Then: alternating 4·3 ictuses → ballad; constant ictus count + interval
 * family → dolnik / taktovik / accentual.  Single lines (or 2-line stanzas)
 * get only the per-line free-verse refinement below.
 */
export function applyRhythmLayer(details: PhonologicalScansionDetail[]): void {
  const lines = details.filter(d => d.scansion && d.scansion.length > 0);
  for (const d of lines) d.rhythmNote = undefined;  // idempotent
  const profiles = lines.map(d => ictusProfile(d.scansion));

  if (lines.length >= 3) {
    const syls = profiles.map(p => p.syllables);
    const sylRange = Math.max(...syls) - Math.min(...syls);
    const counts = profiles.map(p => p.ictuses);

    if (sylRange >= 2) {
      // Classical-dominance guard.  Ternary SIBLINGS (anapest/amphibrach/
      // dactyl) are grouped as ONE family here: their grids coincide modulo
      // anacrusis, so a stanza reading amphi 7 / dact 3 / anap 2 (Nabokov's
      // "Exile", whose tetrameter·tetrameter·trimeter design also varies the
      // syllable count) is solidly classical — without the grouping it was
      // stamped "free verse (heterometric)".  A ≥70% family majority counts
      // as classical regardless of certainty; a CONFIDENT half-majority
      // (≥50% at mean certainty ≥70) does too — heterometric STANZA DESIGN
      // (tetrameter·tetrameter·trimeter) is classical verse, not free verse.
      // Genuine accentual verse scatters across families (Wyatt's best
      // single family covers 0.43) and passes under both bars.
      const byMeter = new Map<string, number[]>();
      lines.forEach((d) => {
        if (d.meterName === 'free verse') return;
        const family = TERNARY_METERS.has(d.meterName as MetreName) ? 'ternary' : d.meterName;
        if (!byMeter.has(family)) byMeter.set(family, []);
        byMeter.get(family)!.push(d.certainty);
      });
      let classical = false;
      for (const [, certs] of byMeter) {
        const coverage = certs.length / lines.length;
        const meanCert = certs.reduce((a, b) => a + b, 0) / certs.length;
        if (coverage >= 0.7 || (coverage >= 0.5 && meanCert >= 70)) { classical = true; break; }
      }

      if (!classical) {
        let note: string | undefined;

        // Alternating ictus counts (canonically 4·3): reported as a RHYTHM
        // fact only — whether it is a ballad stanza is a question of FORM
        // (quatrains + rhyme scheme), answered by the form layer, not here.
        const evens = counts.filter((_, i) => i % 2 === 0);
        const odds = counts.filter((_, i) => i % 2 === 1);
        const allEq = (a: number[], v: number) => a.length > 0 && a.every(x => x === v);
        if (counts.length >= 4 && allEq(evens, evens[0]) && allEq(odds, odds[0]) && evens[0] !== odds[0]) {
          const pooled = profiles.flatMap(p => p.intervals);
          const family = intervalFamily(pooled);
          const flavour = family === 'dolnik' ? 'dolnik' : 'accentual';
          // "4/3 ♪beat accentual" — no "alternating" (too long), "/" not "·" (so
          // "4·3" is not misread as 12), ♪ marks that these are beat counts.
          note = `${evens[0]}/${odds[0]} ♪beat ${flavour}`;
        } else {
          // Constant ictus count (mode covering ≥70% of lines, total spread ≤1).
          const mode = [...new Set(counts)].map(v => [v, counts.filter(c => c === v).length] as const)
            .sort((a, b) => b[1] - a[1])[0];
          const spread = Math.max(...counts) - Math.min(...counts);
          if (mode && mode[1] / counts.length >= 0.7 && spread <= 1) {
            const pooled = profiles.flatMap(p => p.intervals);
            const family = intervalFamily(pooled);
            if (family === 'dolnik') note = `${ictusName(mode[0])} dolnik`;
            else if (family === 'taktovik') note = `${ictusName(mode[0])} taktovik`;
            else if (family === 'accentual') note = `${mode[0]}-beat accentual`;
            // duple/ternary pooled intervals with varying syllable counts =
            // anacrusis/clausula variation only — classical machinery's domain.
          }
          // NB: a high-spread stanza with NO constant beat count is NOT stamped
          // here.  Forcing a "heterometric" rhythmNote onto every line both
          // polluted the per-line display and (because the continuity pass is
          // gated by rhythmNote) blocked the stanza-continuity rename.  Lines
          // instead keep their own meter and get a per-line dolnik/accentual
          // reading below; the whole-poem heterometric observation is reported
          // by the synopsis (summarizePoem), outside the per-line section.
        }
        if (note) for (const d of lines) d.rhythmNote = note;
      }
    }
  }

  // Per-line refinement: give a free-verse line its interval reading.
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i];
    if (d.rhythmNote || d.meterName !== 'free verse') continue;
    const p = profiles[i];
    if (p.ictuses < 2) continue;
    const family = intervalFamily(p.intervals);
    if (family === 'dolnik') d.rhythmNote = `${ictusName(p.ictuses)} dolnik line`;
    else if (family === 'taktovik') d.rhythmNote = `${ictusName(p.ictuses)} taktovik line`;
    else if (family === 'accentual') d.rhythmNote = `${p.ictuses}-beat accentual line`;
  }
}

/**
 * Stanza-level consensus (McAleese A2.1 §5b, "where there is a tie, use
 * surrounding patterns").  Each line keeps its own standalone scansion/meter;
 * but when a line's top meter merely *edges out* the stanza's dominant meter (a
 * near-tie, within `tie` of its own best fit), we annotate it with the dominant
 * meter via `consensusMeter` — making the divergence EXPLICIT rather than
 * silently homogenising it.  Confident lines (whose own meter clearly beats the
 * dominant) are left untouched, so genuine metrical variation stays visible.
 *
 * Mutates the passed details in place.  No-op for <2 lines or a stanza with no
 * unique dominant meter.
 */
export function applyStanzaConsensus(
  details: PhonologicalScansionDetail[],
  tie: number = 0.975,
): void {
  if (details.length < 2) return;
  const counts = new Map<string, number>();
  for (const d of details) {
    if (d.meterName === 'free verse') continue;
    counts.set(d.meterName, (counts.get(d.meterName) ?? 0) + 1);
  }
  // Dominant meter = the strict, unique plurality (≥2 lines).
  let dominant = '';
  let max = 0;
  let tied = false;
  for (const [m, c] of counts) {
    if (c > max) { max = c; dominant = m; tied = false; }
    else if (c === max) tied = true;
  }
  if (max < 2 || tied || !dominant) return;

  // Ternary ANACRUSIS ANCHOR (Gasparov): when the stanza's dominant meter is
  // ternary, the family is fixed by the stanza's anacrusis profile, not by the
  // per-line name race — a Russian ternary keeps a CONSTANT anacrusis (0 →
  // dactyl, 1 → amphibrach, 2 → anapest), while English anapestic verse mixes
  // full (2) and acephalous (1) openings.  So: constant 1 → amphibrachic
  // (Nabokov's "Exile"); any 2s present alongside 1s → anapestic (Cowper);
  // constant 0 → dactylic.  Overrides the plurality name for the ANNOTATION
  // target only; every line's standalone reading is preserved.
  if (TERNARY_METERS.has(dominant as MetreName)) {
    const anacs: number[] = [];
    for (const d of details) {
      if (!TERNARY_METERS.has(d.meterName as MetreName)) continue;
      const p = ictusProfile(d.scansion);
      if (p.ictuses >= 2 && p.anacrusis <= 2) anacs.push(p.anacrusis);
    }
    if (anacs.length >= 2) {
      const has = (v: number) => anacs.includes(v);
      let family: MetreName | null = null;
      if (has(2) && !has(0)) family = 'anapestic';
      else if (has(0) && !has(2)) family = anacs.every(a => a === 0) ? 'dactylic' : null;
      else if (anacs.every(a => a === 1)) family = 'amphibrachic';
      if (family && family !== dominant) dominant = family;
    }
  }

  for (const d of details) {
    d.consensusMeter = undefined; // idempotent: clear any prior annotation
    if (d.meterName === 'free verse' || d.meterName === dominant) continue;
    const own = d.ranking?.[0]?.score ?? 0;
    const dom = d.ranking?.find(r => r.meter === dominant)?.score ?? 0;
    // Ternary SIBLINGS (anapest/amphibrach/dactyl) share their slack/beat
    // alternation, so a 5% composite gap between them is naming noise — e.g. a
    // spondaic anacrusis ("big BOOKS that are HURting…") lets the dactylic fit
    // edge out the stanza's amphibrachs by seizing the clash syllable as an
    // extra beat (Gasparov: an over-stressed anacrusis does NOT change the
    // meter).  Non-sibling divergence keeps the stricter 0.975 near-tie.
    const siblings = TERNARY_METERS.has(d.meterName as MetreName)
      && TERNARY_METERS.has(dominant as MetreName);
    const threshold = siblings ? 0.95 : tie;
    if (own > 0 && dom >= own * threshold) {
      const lengthWord = d.meter.split(' ')[1] ?? '';
      d.consensusMeter = (dominant + (lengthWord ? ' ' + lengthWord : '')).trim();
    }
  }
}

```

## clio/semantics.ts

```typescript
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

import { ClsWord } from '../types.js';
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

```

## clio/stress.ts

```typescript
// stress.ts — Lexical, compound, nuclear stress assignment using nounsing-pro
// (augmented CMU dictionary with 52+ columns), then conversion to McAleese's
// 4‑level relative system.

import * as nounsing from 'nounsing-pro';
import { ClsWord, Syllable, StressLevel, IntonationalUnit, PhonologicalPhrase } from '../types.js';
import { isPunctuation } from './parser.js';
import { collectPPTokens, syllabifyWord } from './phonological.js';
import { isStrandedPreposition, isContrastivePossessive, isVocative, isDeicticLocative } from './semantics.js';

// ─── CONSTANTS & CLASSIFICATIONS ──────────────────────────────────

/**
 * Content‑word POS tags (nouns, adjectives, lexical verbs, adverbs).
 * Excludes:
 *   - determiners (including demonstratives)  – function words
 *   - possessive pronouns (PRP$)               – function words
 *   - Wh‑words (WDT, WP, WP$, WRB)            – function words
 *   - prepositions, conjunctions, particles, etc.
 */
const CONTENT_POS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS',   // nouns
  'JJ', 'JJR', 'JJS',           // adjectives
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ',  // lexical verbs (excludes modals MD)
  'RB', 'RBR', 'RBS',           // adverbs
  'CD',                         // cardinal numbers (content-like)
  'PDT',                        // predeterminers / quantifiers ("all", "both", "half") — carry quantificational stress
  'RP',                         // phrasal-verb particles ("coming IN", "take OFF") — they bear the phrasal stress
]);

/**
 * Spatial words that act as phrasal-verb PARTICLES (stress-bearing: "coming IN",
 * "moving ON", "give UP") as opposed to prepositions ("in the house" → reduced).
 * The parser usually tags a true particle `RP` (handled by CONTENT_POS above),
 * but often mis-tags it `IN`/`RB` with an adverbial/particle dependency on the
 * verb — `isPhrasalParticle` recovers those.  A genuine preposition keeps a
 * `prep`/`pobj` dependency on a NOUN and is (correctly) left as a function word.
 */
const PARTICLE_LEMMAS = new Set([
  'in', 'on', 'out', 'off', 'up', 'down', 'over', 'away', 'back',
  'along', 'around', 'about', 'through', 'apart', 'aside', 'forth', 'together',
]);

/** A phrasal-verb particle the parser tagged IN/RB (not RP): stress-bearing. */
function isPhrasalParticle(word: ClsWord): boolean {
  if (word.lexicalClass === 'RP') return true;
  const dep = word.dependency?.dependentType;
  return PARTICLE_LEMMAS.has(word.word.toLowerCase())
    && (dep === 'prt' || dep === 'advmod');
}

/** Demonstratives that, used pronominally (not determining a following noun),
 *  are a stressed focus: "What's THAT?", "Give me THIS." */
const DEMONSTRATIVE_LEMMAS = new Set(['that', 'this', 'these', 'those']);

/**
 * A demonstrative used as a *pronoun* (the clause-final focus), rather than as a
 * determiner of a following noun.  The parser often tags focus "that" as `IN`
 * (complementizer) and it then reduces to `x` — but "What's THAT?" puts the
 * sentence's prominence on it.  Detected as a demonstrative lemma that is the
 * last non-punctuation word of the line (so "Is THAT grass" — a determiner — is
 * untouched).
 */
function isFocusDemonstrative(words: ClsWord[], wi: number): boolean {
  if (!DEMONSTRATIVE_LEMMAS.has(words[wi].word.toLowerCase())) return false;
  for (let k = wi + 1; k < words.length; k++) {
    if (!isPunctuation(words[k].lexicalClass)) return false; // a word follows → determiner use
  }
  return true;
}

/**
 * Clitic POS categories: function words that are *proclitic* — prepositions /
 * subordinators (IN), infinitival "to" (TO), possessive determiners (PRP$) and
 * wh-determiners/possessives/adverbs (WDT/WP$/WRB).  A
 * *monosyllabic* word in one of these classes is reduced in running speech
 * (Selkirk's clitic; McAleese's "beginnings free") and should floor at 'w'
 * (overt-weak, *promotable*), never 'n'.  Leaving a CMU-primary monosyllable
 * like "on"/"my"/"where"/"from" at 'n' produced flat function-word runs (Pound's
 * "So on my" = n·n·n, "where strange" = n·n).
 *
 * Deliberately EXCLUDES:
 *   - modals (MD: "shall"/"might") and personal pronouns (PRP: "I"/"thee"/"you")
 *     — they carry real stress (the clause-final beat in "…fast as you MIGHT").
 *   - determiners (DT) entirely.  The quantificational / negative / demonstrative
 *     ones ("no one", "all verse", "this", "each") carry stress (cf. the
 *     maintainer's PDT-as-content rule); and flooring even the pure articles
 *     a/an tips Tarlinskaja's razor-thin iambic↔anapestic line ("…else a
 *     laugher's license", margin 0.009) into a wrong meter.  "the" already reads
 *     'x' via its CMU-0 stress, so determiners need no extra handling here.
 *   - coordinators (CC: and/but/or).  "and" already reads 'x' (CMU-0); flooring
 *     "but"→w fires earlier than its baseline path and ripples to suppress an
 *     adjacent pronoun's clash-promotion, tipping Tarlinskaja's razor-thin
 *     iambic↔anapestic line — and coordinators bear no part of the n-run problem.
 * Polysyllabic function words are also untouched, so their internal contour is
 * preserved (be·NEATH = x·n, un·der·NEATH = x·x·n).
 */
// NB: deliberately NOT including DT/PRP/MD/WP here.  Monosyllabic pronouns,
// determiners, and modals at 'n' are PROMOTABLE into metrical beats — which
// real iambic verse exploits constantly ("but HE gave NO one ELSE",
// "fast as you MIGHT").  Flooring them to 'w' was tried (2026-06-12) and
// flipped the Mandelstam anapest and the Tarlinskaja iambic: reverted.
const CLITIC_POS = new Set(['IN', 'TO', 'PRP$', 'WDT', 'WP$', 'WRB']);

/** A reducible monosyllabic proclitic (see CLITIC_POS). */
function isMonosyllabicClitic(word: ClsWord): boolean {
  return !word.isContent
    && word.syllables.length === 1
    && CLITIC_POS.has(word.lexicalClass);
}

/**
 * Temporal, locative, and discourse adverbs that behave as function words
 * in verse — they typically occupy weak metrical positions and should not
 * receive the primary-stress treatment of content adverbs.
 */
const FUNCTION_ADVERBS = new Set([
  'then', 'so', 'here', 'there', 'where', 'when', 'why', 'how',
  'thus', 'hence', 'thence', 'whence',
  'now', 'ago', 'afterwards', 'afterward', 'beforehand',
  'meanwhile', 'nevertheless', 'nonetheless', 'however',
  'therefore', 'furthermore', 'moreover',
  'besides', 'instead', 'rather',
  'quite', 'almost', 'nearly', 'just', 'only',
  'even', 'also', 'too', 'very', 'indeed',
  'already', 'yet', 'still', 'again', 'ever', 'never',
  'always', 'often', 'sometimes', 'usually',
  'today', 'tomorrow', 'yesterday', 'tonight',
]);

/**
 * Rising (iambic) disyllabic function words — prepositions, conjunctions, and
 * deictic adverbs that stress the SECOND syllable (be·CAUSE, a·BOUT, be·TWEEN).
 * A handful are recorded fully-reduced ("00") in the augmented dictionary; for
 * those the all-zero re-stamp must fix the FINAL syllable, NOT take the
 * disyllabic forestress default (which mis-read be·CAUSE as BE·cause).  The
 * re-stamp only fires on a genuine all-zero entry, so listing a word that
 * already carries a peak is harmless.  Trochaic IN·to / UN·to / ON·to are
 * deliberately excluded — they correctly keep forestress.
 */
const RISING_FUNCTION_WORDS = new Set([
  'because', 'about', 'above', 'around', 'across', 'along', 'among', 'amongst',
  'against', 'amid', 'amidst', 'apart', 'ahead', 'aside', 'away', 'aloft',
  'alone', 'aloud', 'anew', 'awhile', 'ago',
  'before', 'behind', 'below', 'beneath', 'beside', 'besides', 'between',
  'beyond', 'within', 'without',
]);

/**
 * Oblique (object/dative) pronouns.  In clause-final position these are
 * canonically unstressed and do NOT attract the beat ("…and beHIND me", not
 * "…and behind ME"), unlike a clause-final modal or content word.  Used to keep
 * the "endings strict" upbeat rule from promoting a final object pronoun.
 */
const OBLIQUE_PRONOUNS = new Set([
  'me', 'him', 'her', 'us', 'them', 'thee', 'ye',
]);

/**
 * Subject-pronoun contractions (pronoun + auxiliary).  These are a known data
 * anomaly: FinNLP mis-tags the line-initial "I"-forms as FW, and nounsing records
 * "i'm" with stress 0 while its sibling "i'll" gets 1 — so "I'm" sank to 'x'
 * (Zero-Provision) whereas "I'll" read 'n'.  A contracted subject pronoun is an
 * overt syllable, never a maximally-reduced clitic, so a dictionary-zero one is
 * restamped to its siblings' weak stress (below).  This is a TARGETED fix for that
 * specific inconsistency — it does NOT change how clitics, prepositions, articles,
 * or bare pronouns floor (those keep their broad 'x'/contour behaviour).
 */
const PRONOUN_SUBJECT_CONTRACTIONS = new Set([
  "i'm", "i'll", "i've", "i'd",
  "you're", "you'll", "you've", "you'd",
  "he'll", "he'd", "she'll", "she'd", "it'll",
  "we're", "we'll", "we've", "we'd",
  "they're", "they'll", "they've", "they'd",
]);

/**
 * Poetic aphaeresis / clipping forms (apostrophe-stripped, lowercased) of
 * function words — prepositions and adverbs.  These are OOV, so without special
 * handling they default to a *stressed content* reading (the parser tags
 * "'neath" as NNP → primary stress!).  Only applied when an apostrophe is
 * actually present (so a literal "mid"/"side"/"cross" is left alone).
 */
const APHAERESIS_CLITICS = new Set([
  'neath',  // beneath
  'gainst', // against
  'twixt',  // betwixt
  'mid',    // amid
  'midst',  // amidst
  'mongst', // amongst
  'tween',  // between
  'pon',    // upon
  'oer',    // o'er  = over
  'neer',   // ne'er = never
  'eer',    // e'er  = ever
  'tis',    // 'tis  = it is   (apostrophe-guarded, so a literal "tis" is untouched)
  'twas',   // 'twas = it was
  'twere',  // 'twere = it were
  'twill',  // 'twill = it will (guard protects the fabric "twill")
]);

/**
 * Augmented-CMU data anomalies: for a couple of very common monosyllables the
 * dictionary's ONLY profile is the letter-name spelling pronunciation of an
 * abbreviation homograph — "am" → "EY1 EH1 M" (= A.M.), "us" → "Y UW1 EH1 S"
 * (= U.S.) — inflating the syllable count of any line containing them.  We
 * restore the ordinary CMU citation form (AE1 M / AH1 S: one heavy syllable,
 * citation stress 1) before the dictionary is consulted.
 */
const ANOMALOUS_MONOSYLLABLES: Record<string, { syllab: string; stress?: number; weight?: 'H' | 'L' }> = {
  am: { syllab: '(AE m)' },
  us: { syllab: '(AH s)' },
  // "a" = letter-name "EY1" in the augmented dictionary; the article is the
  // canonical Zero-Provision clitic (schwa, open syllable) → stress 0, light.
  a: { syllab: '(AH)', stress: 0, weight: 'L' },
};

/**
 * Copula, auxiliary, aspectual, and light verbs that act as function words
 * in verse — they do not carry the main semantic or prosodic weight of a phrase
 * and should not be treated as content words for stress rules.
 */
const FUNCTION_VERBS = new Set([
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'done', 'doing',
  'get', 'gets', 'got', 'getting', 'gotten',
  'start', 'starts', 'started', 'starting',
  'begin', 'begins', 'began', 'beginning', 'begun',
  'keep', 'keeps', 'kept', 'keeping',
  'stop', 'stops', 'stopped', 'stopping',
  'continue', 'continues', 'continued', 'continuing',
  'let', 'lets', "let's"
]);

/** The copula / auxiliary forms of BE — they reduce in connected speech whether
 *  used as copula ("she IS fair" → reduced) or auxiliary ("is going"). */
const BE_FORMS = new Set(['be', 'am', 'is', 'are', 'was', 'were', 'being']);

/**
 * Exclamatory / vocative interjections.  These are emphatic, expressive elements —
 * never zero-provision clitics — yet FinNLP routinely mis-tags vocative "O" as a
 * preposition (IN) and "Lo" as a proper noun (NNP), which would otherwise floor
 * them to 'x'.  Keyed off the lemma (not the unreliable tag), they are raised to at
 * least 'n'; an exclaimed one ("O!", "Oh!") is lifted a further tier by the
 * interjection-emphasis pass at the end of assignRelativeStresses.  Apostrophe
 * forms (o'er = over, e'er = ever) are NOT here — they are aphaeresis clitics.
 */
const EXCLAM_INTERJECTIONS = new Set([
  'o', 'oh', 'ah', 'ay', 'aye', 'lo', 'alas', 'alack', 'hark', 'fie', 'woe',
  'ho', 'oho', 'aha', 'ahoy', 'hurrah', 'huzza',
]);

/**
 * Honest baseline relative prominence for a FUNCTION word (McAleese step 1b:
 * "w=weak, n=some stress, m=subordinate strong, s=strong").  A monosyllabic
 * function word bears no lexical *some-stress*; the dictionary's citation stress
 * (which marks "and"/"in"/"my"/"could" as primary) is a CITATION artefact, not
 * connected-speech prominence.  We floor it to its true reading prominence — the
 * meter layer still PROMOTES it to a beat where the metre calls for it (McAleese's
 * Appendix-A Test 2: stressless "than"/"in" stay weak in the contour; the metre
 * lifts only "from", which carries latent stress).  Returns the tier to floor to,
 * or null to leave the word untouched.
 *
 *   'x' (zero-provision) — pure schwa-proclitics that fully reduce: coordinators
 *       (CC: and/or/but/nor), monosyllabic prepositions & subordinators (IN), the
 *       infinitival/prepositional "to" (TO), possessive determiners (PRP$/WP$:
 *       my/your/his/her/its/our/their/whose).
 *   'w' (overt-weak, still meter-promotable) — full-vowel function words: personal
 *       pronouns (PRP), modals (MD), existential "there" (EX), the copula/auxiliary
 *       BE forms, the AUXILIARY uses of have/do (by dependency role — a main-verb
 *       "have"/"did" keeps its beat), and reduced deictic/discourse adverbs.
 *
 * Content words and the internal contour of POLYSYLLABIC function words
 * (be·NEATH = x·n, with·OUT) are returned null (untouched).
 */
function relativeFloorFor(word: ClsWord): StressLevel | null {
  if (word.isContent) return null;
  if (word.syllables.length !== 1) return null; // keep polysyllabic function contour
  const pos = word.lexicalClass;
  const lemma = word.word.toLowerCase().replace(/['’]/g, '');

  // Pure schwa-proclitics → zero-provision 'x'.
  if (pos === 'CC' || pos === 'PRP$' || pos === 'WP$' || pos === 'TO') return 'x';
  if (pos === 'IN') return 'x'; // prepositions / subordinators cliticise

  // Full-vowel weak function words → overt-weak 'w' (meter-promotable).
  if (pos === 'PRP' || pos === 'MD' || pos === 'EX') return 'w';
  if (BE_FORMS.has(lemma)) return 'w'; // copula & auxiliary BE both reduce
  // NB: have/do are deliberately NOT floored — unlike BE they routinely bear a
  // beat (main-verb "have"/"do", emphatic "DID"), and even as auxiliaries they
  // carry an iambic beat often enough ("what HAD I given") that flooring them
  // mis-reads such lines.  Their level is left to the clash filter + meter layer.
  if (FUNCTION_ADVERBS.has(lemma)) return 'w'; // so/then/here/there/when/just…
  return null;
}

/** Left‑stressed compound categories with example first‑word lists. */
const LEFT_STRESS_MATERIAL = new Set([
  'metal', 'wood', 'silk', 'cotton', 'glass', 'stone', 'iron', 'steel',
  'paper', 'plastic', 'gold', 'silver'
]);
const LEFT_STRESS_TIME = new Set([
  'morning', 'evening', 'summer', 'winter', 'spring', 'autumn',
  'christmas', 'easter', 'night', 'day'
]);
const LEFT_STRESS_MEASURE = new Set(['pint', 'dollar', 'foot', 'mile']);
const LEFT_STRESS_LOCATION = new Set([
  'city', 'mountain', 'river', 'street', 'valley', 'island',
  'town', 'village', 'country'
]);
const LEFT_STRESS_SELF = new Set(['self']);

// "Discard / ruin / spectral" noun-modifiers (N1) that reliably forestress as
// compounds: WASTE·land, SCRAP·yard, JUNK·yard, GHOST·town, DEAD·line,
// DUST·bowl, GRAVE·yard, BONE·yard, DEATH·bed.  (Eliot's "WASTE shore".)
const LEFT_STRESS_DISCARD = new Set([
  'waste', 'scrap', 'junk', 'ghost', 'dead', 'dust', 'grave', 'bone',
  'death', 'trash', 'garbage', 'ash', 'blood', 'rust', 'wreck',
]);
// Elemental / landscape noun-modifiers (N1) that reliably forestress:
// SEA·shore, MOON·light, STORM·cloud, WIND·mill, FIRE·place, SALT·marsh,
// FROST·bite, SAND·bar, SNOW·flake, TIDE·water, SHADOW·land.
const LEFT_STRESS_ELEMENTAL = new Set([
  'sea', 'moon', 'sun', 'star', 'storm', 'wind', 'fire', 'rain', 'snow',
  'ice', 'tide', 'wave', 'frost', 'mist', 'fog', 'mud', 'sand', 'salt',
  'earth', 'sky', 'dawn', 'dusk', 'shadow', 'flame', 'ember', 'smoke',
  'cloud', 'water', 'dew', 'hail', 'marsh', 'moor', 'flood', 'foam',
]);
// Fire / light-source N1 modifiers that forestress like the elemental set:
// TORCH·light, CANDLE·light, LAMP·light, LANTERN·light, BEACON·fire,
// HEARTH·stone, COAL·fire, GAS·light — and Pound's hyphenated TORCH·flames
// (parallel to WASTE·shore; "flames" is the head, "torch" the modifier).
const LEFT_STRESS_FIRELIGHT = new Set([
  'torch', 'candle', 'lamp', 'lantern', 'beacon', 'hearth', 'coal', 'gas',
]);
// Vehicle / conveyance N1 modifiers that forestress: SLEIGH·bells/blades,
// CART·wheel, WAGON·train, CAR·door, TRAIN·station, BOAT·house, TROLLEY·tickets.
// (Endocentric N+N where N1 is the conveyance the N2 belongs to / is part of.)
const LEFT_STRESS_VEHICLE = new Set([
  'sleigh', 'sled', 'cart', 'wagon', 'carriage', 'coach', 'train', 'tram',
  'trolley', 'car', 'boat', 'ship', 'plane', 'truck', 'bus', 'bike', 'bicycle',
]);
// Head nouns (N2) that keep phrasal/right stress even after a forestress
// modifier — chiefly food "made of N1" and a few lexical exceptions:
// apple PIE, summer DAY, Fifth AVenue.  These carve-outs keep the rule honest
// (a wrong forestress would mis-teach learners), so they OVERRIDE the N1 sets.
const RIGHT_STRESS_HEADS = new Set([
  'pie', 'cake', 'tart', 'pudding', 'mousse', 'soup', 'salad', 'sauce',
  'juice', 'avenue', 'day',
]);

/** Check if a pair of words forms a left‑stressed compound. */
export function isLeftStressedPair(w1: string, w2: string): boolean {
  const first = w1.toLowerCase();
  const second = w2.toLowerCase().replace(/'s$/, '');
  // A right-stressing head overrides any forestress modifier (apple PIE).
  if (RIGHT_STRESS_HEADS.has(second)) return false;
  if (LEFT_STRESS_MATERIAL.has(first)) return true;
  if (LEFT_STRESS_TIME.has(first)) return true;
  if (LEFT_STRESS_MEASURE.has(first)) return true;
  if (LEFT_STRESS_LOCATION.has(first)) return true;
  if (LEFT_STRESS_SELF.has(first)) return true;
  if (LEFT_STRESS_DISCARD.has(first)) return true;
  if (LEFT_STRESS_ELEMENTAL.has(first)) return true;
  if (LEFT_STRESS_FIRELIGHT.has(first)) return true;
  if (LEFT_STRESS_VEHICLE.has(first)) return true;
  return false;
}

/** True if `w2` is a head noun that keeps phrasal/right stress against an N1
 *  modifier (apple PIE, summer DAY, Fifth AVenue) — the marked right-stress
 *  exceptions to the otherwise fore-stressing Compound Stress Rule. */
export function isRightStressedHead(w2: string): boolean {
  return RIGHT_STRESS_HEADS.has(w2.toLowerCase().replace(/'s$/, ''));
}

/**
 * Direction of primary stress for an adjacent two-word modification structure,
 * the SINGLE source of truth shared by the lexical compound pass
 * (`applyCompoundStress`) and the Phrase-Stress phase (`computePhraseStress`),
 * so the two layers cannot disagree.
 *
 *   'left'  = fore-stress, primary on w1 — the Compound Stress Rule default for
 *             an N+N compound (Chomsky–Halle; McAleese's worked example marks
 *             ICE cream with primary on "ice", not "cream"): KITCHen table,
 *             WINdow frame, BEDroom door, plus the curated LEFT_STRESS_* sets.
 *   'right' = end-stress, primary on w2 — the marked exceptions: food/temporal
 *             "made of N1" heads (apple PIE, summer DAY), Adj+N which is phrasal
 *             not compound (sweet CREAM, red CAR), and proper-name sequences
 *             which carry their own right-headed prosody (New YORK, John SMITH).
 *   null    = not a compound/modification pair at all.
 *
 * The fore-stress default is restricted to COMMON-noun N+N: proper-noun pairs
 * (NNP/NNPS) are excluded because place- and personal-name sequences are not
 * reliably fore-stressed, and flipping them would mis-teach New YORK / John SMITH.
 */
export function compoundStressSide(
  w1: string, pos1: string, w2: string, pos2: string,
): 'left' | 'right' | null {
  const isNN = pos1.startsWith('N') && pos2.startsWith('N');
  const isAdjN = pos1.startsWith('J') && pos2.startsWith('N');
  if (!isNN && !isAdjN) return null;
  if (isLeftStressedPair(w1, w2)) return 'left';   // curated fore-stress modifier
  if (isRightStressedHead(w2)) return 'right';     // apple PIE, Fifth AVenue
  const proper = (p: string) => p === 'NNP' || p === 'NNPS';
  if (isNN && !proper(pos1) && !proper(pos2)) return 'left'; // common-N+N compound default
  return 'right';                                  // Adj+N phrasal / proper-name pair
}

/**
 * Lexicalised forestress COLLOCATIONS — fixed two-word phrases that stress the
 * LEFT element, even though the second word is not a noun (so the N+N/J+N
 * Compound Stress Rule does not reach them).  "GOOD old days/friend";
 * "the be-all and END-all".  Each entry's optional guard suppresses spurious
 * firing (e.g. "End ALL the wars" — the *verb* "end" + quantifier "all the
 * wars" — must NOT forestress; there "all" is a predeterminer PDT).
 */
const LEFT_STRESS_COLLOCATIONS: { w1: string; w2: string; ok?: (b: ClsWord) => boolean }[] = [
  { w1: 'good', w2: 'old' },                                    // GOOD old days
  { w1: 'end', w2: 'all', ok: w => w.lexicalClass !== 'PDT' },  // END-all (idiom), not "end ALL the wars"
];

/** True if (w1,w2) is a lexicalised forestress collocation in this context. */
function isLeftStressedCollocation(w1: ClsWord, w2: ClsWord): boolean {
  const b1 = w1.word.toLowerCase().replace(/[^a-z]/g, '');
  const b2 = w2.word.toLowerCase().replace(/[^a-z]/g, '');
  for (const c of LEFT_STRESS_COLLOCATIONS) {
    if (b1 === c.w1 && b2 === c.w2 && (!c.ok || c.ok(w2))) return true;
  }
  return false;
}

// ─── LEXICAL STRESS (pronouncingjs) ───────────────────────────────

const VOWEL_CHARS = new Set('aeiouyAEIOUY');

/** Archaic/locative pronominal compounds whose first element ends in a MEDIAL
 *  silent 'e' ("where·fore", "there·in"): the plain vowel-group count reads the
 *  'e' as a nucleus and over-counts.  Count the parts instead. */
const SILENT_E_COMPOUND_RE = /^(where|there|here)(fore|in|by|of|on|upon|at|to|with|out|after|under|unto|abouts?|soever)$/;

function countVowelGroups(word: string): number {
  {
    const m = word.toLowerCase().replace(/[^a-z]/g, '').match(SILENT_E_COMPOUND_RE);
    // Closed-class second elements; counted directly ("fore" would otherwise
    // read 2 — the small-word guard blocks the final-silent-e deduction).
    if (m) return 1 + (m[2] === 'soever' ? 3
      : /^(upon|after|under|unto|about)/.test(m[2]) ? 2 : 1);
  }
  const lower = word.toLowerCase().replace(/-/g, '').replace(/'s/g, '').replace(/'/g, '');
  const n = lower.length;
  let groups = 0;
  let inVowel = false;
  const vowelPositions: number[] = [];
  for (let i = 0; i < n; i++) {
    if (VOWEL_CHARS.has(lower[i])) {
      if (!inVowel) { groups++; vowelPositions.push(i); inVowel = true; }
    } else {
      inVowel = false;
    }
  }
  if (groups >= 3 && n > 2 && lower[n - 1] === 'e' && VOWEL_CHARS.has(lower[n - 1])) {
    const lastVowelStart = vowelPositions[vowelPositions.length - 1];
    if (lastVowelStart === n - 1) {
      groups--;
    }
  }
  return groups;
}

// ─── OUT-OF-VOCABULARY STRESS (two-tier fallback) ─────────────────
//
// When a word is absent from the augmented CMU dictionary, the old fallback
// blindly forestressed it (primary on syllable 0).  That mis-stresses the most
// common OOV case — *inflected/derived forms of common words* whose base IS in
// the lexicon ("voyaging" OOV, "voyage" present) — and many true OOV words too
// ("anfractuous" → AN·fractuous rather than an·FRAC·tuous).  We replace it with:
//   (1) MORPHOLOGICAL decomposition — strip a stress-neutral productive suffix,
//       reconstruct the stem's orthography, look it up, and reuse the stem's
//       *real* lexical stress (the suffix syllables are unstressed).
//   (2) the English Stress Rule (quantity-sensitive) for the genuine residual
//       (names, neologisms) with no recognisable stem.
// Both run ONLY in the OOV branch, so in-vocabulary scansion is untouched.

/** Strip one trailing doubled consonant (run·ning → run, stop·ped → stop). */
function deDouble(b: string): string {
  const m = b.match(/([^aeiou])\1$/i);
  return m ? b.slice(0, -1) : b;
}

/** True if a stem ends in a sibilant/affricate, so a following -s/-es is its own
 *  syllable (kiss·es, box·es, voy·a·ges) rather than a bare coda (cats). */
function isSibilantEnd(s: string): boolean {
  return /(s|z|x|sh|ch|ce|ge|se|ze|dge|tch)$/i.test(s);
}

/**
 * Stress-neutral productive suffixes (Hayes: these do not shift the stem's
 * stress).  `stems(base)` lists candidate stem spellings to try (order = most
 * likely first); `added(stem)` is how many *syllables* the suffix contributes.
 * Stress-SHIFTING suffixes (-ion/-ity/-ic/-ial/-ious/-ify…) are deliberately
 * omitted — treating them as neutral would mis-place the peak; they fall through
 * to the English Stress Rule (and are common enough to usually be in-lexicon).
 */
const SUFFIX_RULES: { suffix: string; stems: (b: string) => string[]; added: (stem: string) => number }[] = [
  { suffix: 'iness', stems: b => [b + 'y'],                 added: () => 1 }, // happi·ness ← happy
  { suffix: 'ily',   stems: b => [b + 'y'],                 added: () => 1 }, // happi·ly ← happy
  { suffix: 'ies',   stems: b => [b + 'y'],                 added: () => 0 }, // car·ries ← carry
  { suffix: 'ied',   stems: b => [b + 'y'],                 added: () => 0 }, // car·ried ← carry
  { suffix: 'ness',  stems: b => [b],                       added: () => 1 },
  { suffix: 'ment',  stems: b => [b],                       added: () => 1 },
  { suffix: 'less',  stems: b => [b],                       added: () => 1 },
  { suffix: 'ful',   stems: b => [b],                       added: () => 1 },
  { suffix: 'ings',  stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ing',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 }, // voy·a·ging ← voyage
  { suffix: 'est',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ed',    stems: b => [b + 'e', b, deDouble(b)], added: stem => /[td]$/.test(stem) ? 1 : 0 },
  { suffix: 'eth',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 }, // archaic 3sg: go·eth, fall·eth, mak·eth
  { suffix: 'ith',   stems: b => [b + 'y', b + 'e', b], added: () => 1 },     // archaic 3sg of -y verbs: sa·ith ← say
  { suffix: 'er',    stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ly',    stems: b => [b],                       added: () => 1 }, // soft·ly ← soft
  { suffix: 'es',    stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
  { suffix: 's',     stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
];

/**
 * Tier 1 — derive an OOV word's numeric stress (2=primary, 1=secondary, 0=none)
 * by stripping a stress-neutral suffix and reusing the in-lexicon stem's stress.
 * Returns null if no productive suffix yields a known stem.
 */
function morphologicalStress(w: string): { pattern: number[]; suffix: string } | null {
  for (const rule of SUFFIX_RULES) {
    if (!w.endsWith(rule.suffix)) continue;
    const base = w.slice(0, w.length - rule.suffix.length);
    if (base.length < 2) continue; // guard tiny stems (sing → s+ing)
    for (const stem of rule.stems(base)) {
      if (stem.length < 2) continue;
      const data = nounsing.all(stem);
      const raw = data && data.length ? (data[0].stress?.stressTrans || '') : '';
      if (!raw) continue;
      const stemNumeric = [...raw].map(c => mapCMUStress(parseInt(c, 10)));
      if (stemNumeric.length === 0) continue;
      const added = rule.added(stem);
      return { pattern: [...stemNumeric, ...new Array(added).fill(0)], suffix: added >= 1 ? rule.suffix : '' };
    }
  }
  return null;
}

/** Archaic verbal suffixes whose orthographic peel cleanly separates a silent-
 *  consonant stem from the suffix for DISPLAY (know·est not kno·west).  Other
 *  suffixes keep the default orthographic syllabifier (it handles them well). */
const DISPLAY_PEEL_SUFFIXES = new Set(['est', 'eth', 'ith']);

/** Heavy syllable (orthographic estimate): long vowel (digraph/VCe) or closed
 *  by a coda consonant.  Light = open with a single short vowel. */
function syllableIsHeavy(syl: string): boolean {
  const s = syl.toLowerCase();
  if (/[aeiouy]{2}/.test(s)) return true;        // vowel digraph / diphthong → long
  if (/[aeiou][^aeiouy]e$/.test(s)) return true; // V·C·e → long ("ate", "ime")
  if (/[^aeiouy]$/.test(s)) return true;         // closed syllable (coda present)
  return false;
}

/**
 * Pre-stressing derivational suffixes (Hayes' "pre-stress 1/2"): they fix the
 * primary on a syllable counted from the word's end (`offset` = syllables back,
 * so primary index = n − offset).  -ic/-tion fix the penult (offset 2),
 * -ity/-graphy/-ical fix the antepenult (offset 3).  Longest-match-first
 * (enforced by the length sort below).
 *
 * The 2026-06-10 batch was DERIVED from the augmented CMU data itself
 * (nounsing's `suffixType` shift classes cross-checked against the `mainStress`
 * column over 3+-syllable words; every adopted ending ≥ 0.90 purity, most ≥ 0.96,
 * N ≥ 60).  This includes onomastic endings (-ski/-sky/-son/-berg/-gton …) that
 * matter for OOV proper names — frequent in translation work.  `-ary` is
 * preantepenult and only fires on 4+-syllable words (the n ≥ offset guard),
 * so BI-na-ry / ca-NA-ry style 3-syllable words fall through safely.
 * NOTE: vowel-hiatus suffixes (-ion/-ial/-ious) can be undercounted by the
 * orthographic syllable counter, so those stay approximate (documented limit).
 */
const PRESTRESS_SUFFIXES: { suffix: string; offset: number }[] = [
  // hand-curated originals (Hayes)
  { suffix: 'graphy', offset: 3 }, { suffix: 'ically', offset: 4 },
  { suffix: 'ation', offset: 2 }, { suffix: 'ition', offset: 2 },
  { suffix: 'itude', offset: 3 }, { suffix: 'ical', offset: 3 },
  { suffix: 'logy', offset: 3 }, { suffix: 'nomy', offset: 3 },
  { suffix: 'cracy', offset: 3 }, { suffix: 'pathy', offset: 3 },
  { suffix: 'meter', offset: 3 }, { suffix: 'tion', offset: 2 },
  { suffix: 'sion', offset: 2 }, { suffix: 'ity', offset: 3 },
  { suffix: 'ety', offset: 3 }, { suffix: 'ify', offset: 3 },
  { suffix: 'ics', offset: 2 }, { suffix: 'ic', offset: 2 },
  // data-derived 2026-06-10: final-stressing (ultShift)
  { suffix: 'ette', offset: 1 }, { suffix: 'ese', offset: 1 },
  { suffix: 'eer', offset: 1 }, { suffix: 'ique', offset: 1 },
  // -oon is a reliable final-stresser (bal·LOON, car·TOON, co·COON, after·NOON);
  // OOV-only.  -ee/-ade are deliberately NOT added: they are impure (COF·fee,
  // com·RADE, DEC·ade) and would mis-stress more than they fix.
  { suffix: 'oon', offset: 1 },
  // data-derived: penult-stressing
  { suffix: 'ion', offset: 2 }, { suffix: 'sive', offset: 2 },
  { suffix: 'lla', offset: 2 }, { suffix: 'llo', offset: 2 },
  { suffix: 'lli', offset: 2 }, { suffix: 'tti', offset: 2 },
  { suffix: 'ina', offset: 2 }, { suffix: 'ino', offset: 2 },
  { suffix: 'ano', offset: 2 }, { suffix: 'ana', offset: 2 },
  { suffix: 'ini', offset: 2 },
  { suffix: 'ski', offset: 2 }, { suffix: 'sky', offset: 2 },
  // data-derived: antepenult-stressing
  { suffix: 'ate', offset: 3 }, { suffix: 'cal', offset: 3 },
  { suffix: 'onal', offset: 3 }, { suffix: 'nger', offset: 3 },
  { suffix: 'son', offset: 3 }, { suffix: 'man', offset: 3 },
  { suffix: 'berg', offset: 3 }, { suffix: 'gton', offset: 3 },
  // data-derived: preantepenult-stressing (4+ syllables only via the guard)
  { suffix: 'ary', offset: 4 },
].sort((a, b) => b.suffix.length - a.suffix.length);

/**
 * Tier 2 — the English Stress Rule for genuine OOV (no recognisable stem).
 * First honours a pre-stressing derivational suffix (terRIF·ic, ac·TIV·i·ty,
 * pho·TOG·ra·phy).  Otherwise it is quantity-sensitive with final-syllable
 * extrametricality: monosyllables take primary; disyllables keep the English
 * forestress default; for 3+ syllables the final is extrametrical and stress
 * falls on a heavy penult, else the antepenult (Hayes 1982).  This fixes e.g.
 * an·FRAC·tuous / e·NIG·ma where blind forestress erred.
 */
function englishStressRule(w: string, isContent: boolean): number[] {
  const n = countVowelGroups(w);
  const primary = isContent ? 2 : 1;
  if (n <= 1) return [primary];
  for (const { suffix, offset } of PRESTRESS_SUFFIXES) {
    if (w.endsWith(suffix) && n >= offset) {
      const pattern = new Array(n).fill(0);
      pattern[n - offset] = primary;
      return pattern;
    }
  }
  if (n === 2) return [primary, 0]; // English disyllabic default (trochaic)
  const sylls = syllabifyWord(w, n);
  const pattern = new Array(n).fill(0);
  const penult = n - 2;                 // final (n-1) is extrametrical
  const heavyPenult = sylls[penult] ? syllableIsHeavy(sylls[penult]) : true;
  pattern[heavyPenult ? penult : Math.max(0, n - 3)] = primary;
  return pattern;
}

/**
 * Per-syllable heaviness from nounsing's `syllStruct` CV transcription
 * ("L.CL.CLC": C = consonant, L = lax/short nucleus, T = tense/long nucleus).
 * Heavy = tense nucleus OR closed syllable (a coda consonant after the nucleus).
 * Returns undefined when the segment count doesn't match the syllable count, so
 * callers fall back to the orthographic estimate.
 */
function heavyFromSyllStruct(syllStruct: string | undefined, n: number): boolean[] | undefined {
  if (!syllStruct) return undefined;
  const segs = syllStruct.split('.');
  if (segs.length !== n) return undefined;
  return segs.map(seg => {
    const vi = seg.search(/[LT]/);
    if (vi < 0) return false;
    return seg[vi] === 'T' || vi < seg.length - 1;
  });
}

/**
 * The syllable index that should bear the default stress of a polysyllabic word
 * whose dictionary entry records NO stress at all (an all-zero pattern — the
 * maximally-reduced citation form of a few function words, chiefly "into"=00).
 * Every lexical word bears at least one stress, so we restore it: a pre-stressing
 * suffix fixes the count-from-end syllable; otherwise the English forestress
 * default for disyllables (IN-to, ON-to), and the quantity-sensitive penult/
 * antepenult (Hayes) for longer words.  Mirrors englishStressRule's placement.
 * `heavyFlags` (real per-syllable quantity from nounsing's syllStruct) replaces
 * the orthographic heaviness guess when the word is in-vocabulary.
 */
function defaultStressIndex(word: string, n: number, heavyFlags?: boolean[]): number {
  for (const { suffix, offset } of PRESTRESS_SUFFIXES) {
    if (word.endsWith(suffix) && n >= offset) return n - offset;
  }
  if (n <= 2) return 0;                 // English disyllabic forestress default
  const penult = n - 2;                 // final (n-1) extrametrical
  const heavyPenult = heavyFlags
    ? heavyFlags[penult]
    : (() => { const sylls = syllabifyWord(word, n); return sylls[penult] ? syllableIsHeavy(sylls[penult]) : true; })();
  return heavyPenult ? penult : Math.max(0, n - 3);
}

/**
 * Map CMU stress (0=unstressed, 1=primary, 2=secondary) to
 * McAleese's numeric scale: 0=unstressed, 1=secondary, 2=primary.
 */
function mapCMUStress(cmuStress: number): number {
  if (cmuStress === 1) return 2;   // primary → 2
  if (cmuStress === 2) return 1;   // secondary → 1
  return 0;                        // unstressed → 0
}

/**
 * Assign per‑syllable lexical stress to each word in a sentence.
 *
 * Uses the first CMU pronunciation.  Function words have their
 * primary stress downgraded to secondary (2 → 1).
 */
export function assignLexicalStress(words: ClsWord[]): void {
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    if (isPunctuation(word.lexicalClass)) {
      word.syllables = [];
      continue;
    }

    // Explicitly assign 0 syllables to possessive/contraction clitic "'s"
    if (word.word === "'s") {
      word.syllables = [];
      continue;
    }

    // Poetic aphaeresis clipping ('neath, o'er, 'gainst…) → treat as the reduced
    // function word it stands for, instead of the OOV default (NNP → stressed).
    // Guard on an actual apostrophe (split off as the prior token, or internal),
    // so a literal "mid"/"side"/"cross" is untouched.
    {
      const bare = word.word.toLowerCase().replace(/['’]/g, '');
      const hasApostrophe = /['’]/.test(word.word)
        || (wi > 0 && (words[wi - 1].word === "'" || words[wi - 1].word === '’'));
      if (hasApostrophe && APHAERESIS_CLITICS.has(bare)) {
        word.isContent = false;
        // One weak monosyllable; lexical 0 + function ⇒ maps to 'x' (reduced clitic).
        word.syllables = [{ text: word.word, phones: '', stress: 0, lexicalStress: 0 }];
        continue;
      }
    }

    let lookupWord = word.word.toLowerCase();

    // Letter-name dictionary anomalies ("am" = A.M., "us" = U.S.): stamp the
    // ordinary citation monosyllable directly (see ANOMALOUS_MONOSYLLABLES).
    {
      const fix = ANOMALOUS_MONOSYLLABLES[lookupWord];
      if (fix) {
        const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
        word.isContent = isContent;
        const numeric = fix.stress ?? (isContent ? 2 : 1);   // citation primary; function words reduce to secondary
        word.syllables = [{ text: word.word, phones: fix.syllab, weight: fix.weight ?? 'H', stress: numeric, lexicalStress: numeric }];
        continue;
      }
    }

    // Elided article fused to its host (th'expense, th'inconstant): "th'" is
    // non-syllabic, so the HOST word's dictionary entry is the right source for
    // stress and syllable count — otherwise the fused token goes OOV and takes
    // the disyllabic forestress default (TH'EX-pense instead of th'ex-PENSE).
    {
      const m = lookupWord.match(/^th['’](.+)$/);
      if (m && m[1].length >= 2) lookupWord = m[1];
    }

    let allData = nounsing.all(lookupWord);
    if (!allData && lookupWord.includes('-')) {
      const noHyphen = lookupWord.replace(/-/g, '');
      allData = nounsing.all(noHyphen);
    }
    if ((!allData || allData.length === 0) && lookupWord.includes('-')) {
      const parts = lookupWord.split('-');
      const partStresses: string[] = [];
      const partWeights: string[] = [];
      for (const part of parts) {
        const partData = nounsing.all(part);
        if (partData && partData.length > 0) {
          partStresses.push(partData[0].stress.stressTrans || '');
          partWeights.push(partData[0].weightPattern || '');
        }
      }
      if (partStresses.length === parts.length && partStresses.every(s => s.length > 0)) {
        const combinedStress = partStresses.join('');
        const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
        word.isContent = isContent;
        const syls: Syllable[] = [];
        for (let i = 0; i < combinedStress.length; i++) {
          const cmu = parseInt(combinedStress[i], 10);
          let numeric = mapCMUStress(cmu);
          if (!isContent && numeric === 2) numeric = 1;
          syls.push({ text: word.word, phones: '', stress: numeric, lexicalStress: numeric });
        }
        word.syllables = syls;
        continue;
      }
    }
    if (!allData || allData.length === 0) {
      const cleanWord = word.word.toLowerCase().replace(/-/g, '').replace(/['’]/g, '');
      const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
      word.isContent = isContent;
      // Tier 1: morphological stem (reuse real lexical stress); Tier 2: ESR.
      const morph = morphologicalStress(cleanWord);
      const pattern = morph ? morph.pattern : englishStressRule(cleanWord, isContent);
      // Record an archaic verbal suffix so the display splits know·est, not kno·west.
      if (morph && DISPLAY_PEEL_SUFFIXES.has(morph.suffix)) word.morphSuffix = morph.suffix;
      const syls: Syllable[] = pattern.map(numeric => {
        // Mirror the in-vocab function-word reduction (primary → secondary).
        const n = (!isContent && numeric === 2) ? 1 : numeric;
        return { text: word.word, phones: '', stress: n, lexicalStress: n };
      });
      word.syllables = syls;
      continue;
    }

    // For nouns with multiple pronunciations, prefer front‑stressed (noun form).
    let profile = allData[0];
    if (allData.length > 1 && word.lexicalClass.startsWith('N')) {
      for (const p of allData) {
        const stressStr = p.stress.stressTrans;
        if (stressStr && stressStr.length > 0 && (stressStr[0] === '1' || stressStr[0] === '2')) {
          profile = p;
          break;
        }
      }
    }

    let rawStress = profile.stress.stressTrans || '';   // e.g., "010"

    // The CMU syllabification is authoritative for the syllable count.  The
    // orthographic vowel-group count UNDER-counts vowel-hiatus / glide words
    // (goo·ey, play·ers, be·ing each read as a single vowel run), so it must NOT
    // truncate the dictionary's count — doing so collapsed those to one syllable.
    // Only clamp when stressTrans is genuinely LONGER than the CMU
    // syllabification (a rare data inconsistency).
    const syllsMatch = (profile.phonology.syllabification || '').match(/\([^)]+\)/g) || [];
    if (syllsMatch.length > 0 && rawStress.length > syllsMatch.length) {
      rawStress = rawStress.slice(0, syllsMatch.length);
    }

    // Synaeresis (verse vowel-gliding): an UNSTRESSED open syllable ending in a
    // high-front vowel (IY/IH), followed by an UNSTRESSED vowel-initial syllable,
    // glides into one syllable in verse — As·syr·i·an → as·syr·yan, var·i·ous →
    // var·yous, glor·i·ous → glor·yous.  It does NOT fire on a stressed nucleus
    // (be·ing, i·DE·a) or before a stressed vowel (cre·ATE), so those keep their
    // full count.  Distinct from the (removed) orthographic truncation: it merges
    // only genuine glide pairs, leaving goo·ey / play·ers / po·et intact.
    if (syllsMatch.length === rawStress.length && rawStress.length >= 2) {
      const tokensOf = (s: string) => s.replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean);
      const mStress: string[] = [];
      const mSylls: string[] = [];
      for (let i = 0; i < rawStress.length; i++) {
        const cur = tokensOf(syllsMatch[i]);
        const last = cur[cur.length - 1] ?? '';
        const next = i + 1 < rawStress.length ? tokensOf(syllsMatch[i + 1]) : [];
        if (i + 1 < rawStress.length
            && rawStress[i] === '0' && rawStress[i + 1] === '0'
            && (last === 'IY' || last === 'IH')
            && /^[AEIOU]/.test(next[0] ?? '')) {
          mStress.push('0');
          mSylls.push('(' + cur.concat(next).join(' ') + ')');
          i++; // absorb the glided syllable
        } else {
          mStress.push(rawStress[i]);
          mSylls.push(syllsMatch[i]);
        }
      }
      rawStress = mStress.join('');
      syllsMatch.splice(0, syllsMatch.length, ...mSylls);
    }

    // All-zero CMU pattern on a polysyllabic word: restore the default stress.
    // A handful of reduced function words (chiefly "into"=00) are recorded with
    // NO stress at all, which left every syllable at 'x' (in·to = x·x) — both
    // unlike careful usage (IN-to) and metrically inert.  Every lexical word
    // bears a stress, so we re-stamp a CMU primary on the default-stress syllable
    // (forestress for disyllables); function-word demotion downstream turns this
    // into a secondary, giving the natural IN-to contour.  Only fires on the
    // genuine all-zero artifact, so words that already carry a peak are untouched.
    if (rawStress.length >= 2 && /^0+$/.test(rawStress)) {
      const cw = word.word.toLowerCase().replace(/-/g, '').replace(/['’]/g, '');
      const heavy = heavyFromSyllStruct(profile.phonology.syllStruct, rawStress.length);
      // Rising/iambic function words (be·CAUSE, a·BOUT) recorded fully-reduced
      // take FINAL-syllable stress; everything else keeps the forestress default
      // (IN·to, and polysyllabic content artifacts).
      const idx = RISING_FUNCTION_WORDS.has(cw)
        ? rawStress.length - 1
        : defaultStressIndex(cw, rawStress.length, heavy);
      rawStress = rawStress.split('').map((c, i) => (i === idx ? '1' : '0')).join('');
    }

    // Targeted fix for the "I'm" anomaly: a subject-pronoun contraction the
    // dictionary records as fully unstressed ("i'm"=0, while "i'll"=1) is restamped
    // to a weak (function) stress, so it reads like its siblings ('n') rather than
    // sinking to Zero-Provision 'x'.  Narrow by construction — only fires on a
    // monosyllabic, genuinely all-zero pronoun contraction; everything else is
    // left exactly as it was.
    if (rawStress === '0' && PRONOUN_SUBJECT_CONTRACTIONS.has(lookupWord)) {
      rawStress = '1';
    }

    const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
    word.isContent = isContent;

    const syllables: Syllable[] = [];
    const weightsArray = (profile.weightPattern || '').split(' ').filter(x => x === 'H' || x === 'L');

    // Determine extrametricality classification for the final syllable.
    // Uses Hayes (1980) constraints: only Light edge syllables, only noun final syllables,
    // morphological s/z (plural/tense) markers, and derivational suffixes in adjectives.
    const sClassifier = profile.S ?? '';
    // Extrametricality is a property of nouns / derived adjectives.  Key it off
    // the word's actual sentence POS (from the parser), NOT nounsing's lexical
    // pos — otherwise function words like the preposition "underneath" (which the
    // CMU data may tag nominally) wrongly lose the stress on their final syllable.
    const isNoun = word.lexicalClass.startsWith('N');
    const isAdj = word.lexicalClass.startsWith('JJ');
    const finalWeight = profile.weight.find(w => w.syllable === 'final')?.heaviness ?? '';
    const nsylls = rawStress.length;

    let extrametricalType: Syllable['extrametrical'] = undefined;
    if (nsylls >= 2) {
      if ((sClassifier === 'S' || sClassifier === 'SCluster') && isNoun) {
        extrametricalType = 'morphological';
      } else if (isNoun && finalWeight === 'L' && nsylls >= 3) {
        extrametricalType = 'light_noun';
      } else if (isAdj && profile.morphology.suffix === 'suffix') {
        extrametricalType = 'derivational';
      }
    }

    const phonesTokens = profile.phonology.phones.split(' ');
    let phoneIdx = 0;

    for (let i = 0; i < rawStress.length; i++) {
      const ch = rawStress[i];
      const cmu = parseInt(ch, 10);
      let numeric = mapCMUStress(cmu);
      // Function words are reduced in running speech, but their INTERNAL stress
      // contour must be preserved: demote the primary syllable to secondary AND
      // the secondary syllables to none, so the lexical peak stays the peak.
      // (Flattening primary→secondary alone would tie "un" and "neath" in
      //  "underneath", letting a later clash invert it to ÚN-der-neath.)
      if (!isContent) {
        if (numeric === 2) numeric = 1;
        else if (numeric === 1) numeric = 0;
      }

      const wPatLen = weightsArray.length;
      const rLen = rawStress.length;
      const wIdx = wPatLen - (rLen - i);
      const weight = wIdx >= 0 && wIdx < wPatLen ? weightsArray[wIdx] as 'H' | 'L' : 'L';

      const sylTextMatch = syllsMatch[i];
      const sylText = sylTextMatch ? sylTextMatch.replace(/[()]/g, '') : word.word;

      const sylPhonesMatch = syllsMatch[i] || '';
      const isLastSyl = i === rawStress.length - 1;

      syllables.push({
        text: sylText,
        phones: sylPhonesMatch,
        weight,
        stress: numeric,
        lexicalStress: numeric,
        relativeStress: undefined,
        extrametrical: isLastSyl ? extrametricalType : undefined,
      });
    }

    if (extrametricalType) {
        word.lexicalDetails = `extrametrical_${extrametricalType}`;
    }

    // A focus demonstrative ("What's THAT?", "Give me THIS.") carries PRIMARY
    // stress; CMU lists the weak/reduced (complementizer) form, which would leave
    // it merely 'n' after the nuclear boost.  Force its peak to primary so the
    // sentence's prominence lands on it.
    if (isFocusDemonstrative(words, wi) && syllables.length > 0) {
      const pk = syllables.reduce((a, b) => (b.stress >= a.stress ? b : a));
      pk.stress = 2;
      pk.lexicalStress = 2;
    }

    word.syllables = syllables;
  }
}

// ─── COMPOUND STRESS RULE ─────────────────────────────────────────

/**
 * Adjust stresses for nominal compounds.
 *
 * Fore-stressed by default: an N+N compound puts primary (2) on the first
 * element, secondary (1) on the second — the Compound Stress Rule (Chomsky–
 * Halle; McAleese marks ICE cream with primary on "ice", KITCHen table,
 * WINdow frame).  The marked right-stress exceptions — food/temporal "made of"
 * heads (apple PIE), Adj+N phrases (sweet CREAM), and proper-name sequences
 * (New YORK) — reverse it.  All of this lives in `compoundStressSide`.
 */
export function applyCompoundStress(ius: IntonationalUnit[]): void {
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const words = collectPPTokens(pp);
      // We don't want compound stress applied between arbitrary words across a phrase!
      // Only apply to ADJACENT content words!
      const contentWords = words.filter(w => w.isContent);
      for (let i = 0; i < contentWords.length - 1; i++) {
        const w1 = contentWords[i];
        const w2 = contentWords[i + 1];

        // Wait, they must be adjacent in the sentence!
        if (Math.abs(w1.absoluteIndex - w2.absoluteIndex) !== 1) continue;

        const side = compoundStressSide(w1.word, w1.lexicalClass, w2.word, w2.lexicalClass);
        if (side === null) continue;

        if (side === 'left') {
          setPrimaryStress(w1, 2);
          setPrimaryStress(w2, 1);
        } else {
          setPrimaryStress(w1, 1);
          setPrimaryStress(w2, 2);
        }
      }
    }
  }
}

/** Locate the syllable with the highest stress and set it to `value`. */
export function setPrimaryStress(word: ClsWord, value: number): void {
  let maxIdx = -1;
  let maxVal = -1;
  for (let i = 0; i < word.syllables.length; i++) {
    if (word.syllables[i].stress > maxVal) {
      maxVal = word.syllables[i].stress;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) {
    word.syllables[maxIdx].stress = value;
  }
}

// ─── NUCLEAR STRESS RULE ──────────────────────────────────────────

/**
 * Recursively assign higher stress to content words from right to left.
 * Only the rightmost content word receives a boost (+1 above lexical primary).
 * All other content words keep their lexical stress.
 * This preserves lexical stress for meter detection while still indicating
 * the nuclear accent for phonological phrasing.
 */
export function applyNuclearStress(ius: IntonationalUnit[]): void {
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const words = collectPPTokens(pp).sort((a, b) => a.index - b.index);
      // The nuclear accent normally lands on the rightmost CONTENT word.
      let target: ClsWord | null = null;
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i].isContent) { target = words[i]; break; }
      }
      // But a content-less phrase ending in a non-oblique personal pronoun puts
      // the nuclear accent on that final pronoun (NSR: the accent falls on the
      // last accentable item; a clause-final addressee/focus pronoun bears it —
      // "…to YOU").  Only when there is no content word to carry it, so "I KNOW
      // you" is untouched; oblique objects (me/him/them) stay deaccented.
      if (!target) {
        let lastIdx = -1;
        for (let i = words.length - 1; i >= 0; i--) {
          if (!isPunctuation(words[i].lexicalClass)) { lastIdx = i; break; }
        }
        if (lastIdx >= 0) {
          const w = words[lastIdx];
          if (w.lexicalClass === 'PRP'
              && !OBLIQUE_PRONOUNS.has(w.word.toLowerCase().replace(/['’]/g, ''))) {
            target = w;
          }
        }
      }
      if (target) {
        let maxIdx = -1;
        let maxVal = -1;
        for (let j = 0; j < target.syllables.length; j++) {
          if (target.syllables[j].stress > maxVal) {
            maxVal = target.syllables[j].stress;
            maxIdx = j;
          }
        }
        if (maxIdx >= 0) target.syllables[maxIdx].stress += 1;
      }
    }
  }
}

// ─── RELATIVE STRESS ASSIGNMENT (4‑LEVEL) ─────────────────────────

/**
 * Phrase-edge sets used for the "endings strict / beginnings loose" floor gate.
 * McAleese (after Hayes & Kaun): metrical and lexical stress coincide at the
 * ENDS of phonological units (clitic phrase 90% / phonological phrase 97% /
 * intonational unit 99%); Selkirk notes a function word is not reduced at the
 * end of a clitic phrase ("of" never → "o'" there).  So a function word at the
 * right edge of a PP or IU — or the phrase-stress PEAK (nucleus) of its PP —
 * resists the citation-floor reduction, while interior / left-edge function
 * words reduce as before.  Reads the Phrase-Stress phase (word.phraseStress).
 */
function phraseEdgeSets(ius: IntonationalUnit[]): {
  ppFinal: Set<ClsWord>; iuFinal: Set<ClsWord>; ppPeak: Set<ClsWord>;
} {
  const ppFinal = new Set<ClsWord>();
  const iuFinal = new Set<ClsWord>();
  const ppPeak = new Set<ClsWord>();
  for (const iu of ius) {
    let iuLast: ClsWord | null = null;
    for (const pp of iu.phonologicalPhrases) {
      const toks = collectPPTokens(pp)
        .filter(w => !isPunctuation(w.lexicalClass))
        .sort((a, b) => a.index - b.index);
      if (toks.length === 0) continue;
      const last = toks[toks.length - 1];
      ppFinal.add(last);
      iuLast = last;
      let peak = toks[0];
      let peakVal = peak.phraseStress ?? 0;
      for (const t of toks) {
        const v = t.phraseStress ?? 0;
        if (v > peakVal) { peak = t; peakVal = v; }
      }
      // Only protect a genuine nuclear ramp peak (phraseStress ≥ 2): an all-floor
      // PP (all function words, or the Phase-Stress phase not run) has no nucleus
      // to protect, so we must not spuriously shield its first token.
      if (peakVal >= 2) ppPeak.add(peak);
    }
    if (iuLast) iuFinal.add(iuLast);
  }
  return { ppFinal, iuFinal, ppPeak };
}

/**
 * Convert numeric per‑syllable stress to McAleese’s symbolic levels
 * (w, n, m, s) and resolve adjacent identical stresses using dependency
 * information.
 */
export function assignRelativeStresses(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Phrase-edge sets for the endings-strict floor gate (read from Phase-Stress).
  const edges = phraseEdgeSets(ius);
  // Syllables raised by dependency-mined prominence (stranded preposition,
  // contrastive possessive, vocative): protected from the per-PP trailing-run
  // flatten so the recovered beat survives.
  const prominenceProtected = new Set<Syllable>();

  // First pass: numeric → symbolic (0→w, 1→n, 2→m, 3+→s)
  // Use lexicalStress (pre-nuclear) so nuclear stress doesn't corrupt meter detection.
  for (const word of words) {
    for (const syl of word.syllables) {
      const val = syl.lexicalStress ?? syl.stress;
      if (val === 0) {
        // Zero-Provision (`x`) for a maximally-reduced clitic: a stressless
        // syllable of a function word reads *below* a stressless content
        // syllable (the/a/of/and… vs. the weak syllable of a content word).
        // EXCEPTION: an aphaeresis clipping ('neath/o'er/'gainst…) is the
        // *lexically-stressed* syllable of its base word surviving the clip — an
        // overt syllable carrying real stress, merely reduced in context.  `x`
        // means extrametrical (Hayes' zero-provision), which it is NOT; so it
        // floors at `w` (overt weak), promotable like any weak syllable.
        const bare = word.word.toLowerCase().replace(/['’]/g, '');
        // Function VERBS (copula/aux/aspectual: be/is/keeps/began…) and
        // function ADVERBS (deictic/scalar: just/now/then/here/there…) floor
        // at 'w', not 'x': both classes carry full, unreducible vowels —
        // 'x' is for schwa-able clitics (the/a/of/and).  At 'w' they remain
        // Attridge-promotable, recovering e.g. the dactylic opening beat of
        // "JUST for a riband to STICK in his coat" (Browning).
        if (word.isContent || APHAERESIS_CLITICS.has(bare)
            || FUNCTION_VERBS.has(bare) || FUNCTION_ADVERBS.has(bare)) {
          syl.relativeStress = 'w';
        } else {
          syl.relativeStress = 'x';
        }
      } else if (val === 1) {
        syl.relativeStress = 'n';
      } else if (val === 2) {
        syl.relativeStress = 'm';
      } else {
        syl.relativeStress = 's';
      }
      // Monosyllabic function clitic → floor at 'w' (overt-weak, promotable),
      // never 'n'.  A CMU-primary monosyllabic preposition/determiner/possessive/
      // wh-word/coordinator is reduced in running speech; flooring it at 'n' is
      // what produced the flat function-word runs ("So on my", "where strange").
      // (Pure clitics the/a/of already read 'x' via the val===0 branch.)
      if (syl.relativeStress === 'n'
          && (isMonosyllabicClitic(word) || word.word.toLowerCase() === 'am')) {
        // "am" (1sg copula) is reliably reduced — far more so than beat-bearing
        // is/are/was/were — so it floors at 'w' (still Attridge-promotable) rather
        // than surfacing at 'm' as a spurious beat in "As I am BLOOD…".  Kept to
        // this one form: flooring all be-verbs regressed Wyatt's accentual + corpus.
        syl.relativeStress = 'w';
      }
      // Downgrade extrametrical syllables by one level.  We do NOT push a weak
      // syllable to 'x' here: 'x' (zero-provision) is reserved for maximally-
      // reduced *clitics*, whereas a weak *content* syllable (e.g. the feminine
      // ending "li·cense") stays 'w' per the maintainer's tier semantics.
      if (syl.extrametrical === 'morphological') {
        if (syl.relativeStress === 'n') syl.relativeStress = 'w';
        else if (syl.relativeStress === 'm') syl.relativeStress = 'n';
        else if (syl.relativeStress === 's') syl.relativeStress = 'm';
      }
    }

    // Honest baseline prominence: floor a monosyllabic function word to its true
    // reading prominence ('x' schwa-clitic / 'w' overt-weak), never raising it.
    // The dictionary's citation stress on "and"/"in"/"my"/"could" is an artefact;
    // the meter layer re-promotes these where the metre needs a beat.
    //
    // ENDINGS STRICT / BEGINNINGS LOOSE (McAleese; Selkirk): withhold the floor
    // for a function word at the right edge of a PP or IU, or one that is its
    // PP's phrase-stress peak — it resists reduction there (a stranded/clause-
    // final "to"/"you"/"of" is not crushed to a clitic).  Oblique object
    // pronouns (me/him/thee…) are excepted: they stay default-deaccented even
    // phrase-finally ("I gave it to HIM" only under focus, handled later).
    const lemma = word.word.toLowerCase().replace(/['’]/g, '');
    const edgeProtected =
      (edges.iuFinal.has(word) || edges.ppFinal.has(word) || edges.ppPeak.has(word))
      && !OBLIQUE_PRONOUNS.has(lemma);
    const floor = relativeFloorFor(word);
    if (floor && !edgeProtected) {
      const fr = STRESS_RANK[floor];
      for (const syl of word.syllables) {
        if (STRESS_RANK[syl.relativeStress ?? 'w'] > fr) syl.relativeStress = floor;
      }
    }

    // Dependency-mined prominence (the parse IS the semantic layer): recover the
    // beat a flat POS floor would crush.  A STRANDED preposition ("waiting FOR",
    // "stare AT") and a CONTRASTIVE possessive ("THY choice, not mine") bear
    // real stress → raise the peak to at least 'n' (promotable); a VOCATIVE
    // address ("Sing, O GODDESS") to at least 'm'.  Raise-only; the raised peak
    // is protected from the per-PP trailing-run flatten below.
    let promoteTo: StressLevel | null = null;
    if (isVocative(word, words) || isDeicticLocative(word, words)) promoteTo = 'm';
    else if (isStrandedPreposition(word, words) || isContrastivePossessive(word, words)) promoteTo = 'n';
    if (promoteTo) {
      const pk = wordPeak(word);
      if (pk && STRESS_RANK[pk.relativeStress ?? 'w'] < STRESS_RANK[promoteTo]) {
        pk.relativeStress = promoteTo;
      }
      if (pk) prominenceProtected.add(pk);
    }

    // Exclamatory interjection ("O", "Oh", "Ah", "Lo", "Alas"): emphatic, never
    // reduced — raise its peak to at least 'n' (corrects the mis-tag that floored
    // vocative "O"→IN→'x').  Raise-only; an exclaimed one is lifted further below.
    if (EXCLAM_INTERJECTIONS.has(word.word.toLowerCase())) {
      const pk = wordPeak(word);
      if (pk && STRESS_RANK[pk.relativeStress ?? 'w'] < STRESS_RANK.n) pk.relativeStress = 'n';
    }
  }

  // Apply nuclear stress boosts to relative stress.
  // `syl.stress` may be higher than `syl.lexicalStress` after applyNuclearStress
  // boosted the rightmost content word. Each level of increase promotes the
  // relative stress by one tier: w→n, n→m, m→s.
  for (const word of words) {
    for (const syl of word.syllables) {
      const base = syl.lexicalStress ?? 0;
      const boost = syl.stress - base;
      if (boost > 0) {
        let current = syl.relativeStress ?? 'w';
        for (let i = 0; i < boost; i++) {
          if (current === 'x') current = 'w';
          else if (current === 'w') current = 'n';
          else if (current === 'n') current = 'm';
          else if (current === 'm') current = 's';
        }
        syl.relativeStress = current;
      }
    }
  }

  // Second pass: resolve adjacent identical stresses within each phonological phrase
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const ppWords = collectPPTokens(pp);
      resolveAdjacentClashes(ppWords, prominenceProtected);
    }
  }

  // Third pass: resolve clashes across prosodic boundaries (PP and IU).
  // McAleese: when two adjacent syllables at a prosodic boundary have equal stress
  // and one is a function word, demote the function word (beginnings-free principle).
  resolveCrossBoundaryClashes(words, ius);

  // Compound forestress (linear surface order): a left-stressed compound's
  // prominence sits on its LEFT element (WASTE·shore, SEA·shore, GHOST·town).
  // The phrasal compound/nuclear rules run in hierarchy order, which a mis-
  // grouped parse can split (e.g. "a cavernous waste shore" separating
  // waste/shore), so we re-assert forestress here on true surface adjacency,
  // after the clash passes, so it survives the rightmost-content nuclear boost.
  resolveCompoundForestress(words);
  resolveCollocationForestress(words);
  resolveHyphenCompounds(words);

  // Fourth pass: resolve clashes on the LINEAR SURFACE order.  A stress clash is
  // a property of *contiguous pronounced* syllables (Hayes' "two contiguous
  // syllables"), i.e. surface order — but the phrasal passes above run in
  // hierarchy order, which a mis-grouped parse can scramble (e.g. "a cavernous
  // waste shore" leaving "waste"/"shore" non-adjacent in the tree though
  // contiguous in speech).  Catch any residual cardinal s–s clash here.
  resolveLinearClashes(words);

  // Exclaimed interjection: an interjection immediately followed by "!" (Oh!, Ah!,
  // O!, Lo!) is an emphatic peak — raise it one tier so it stands out from a flat
  // run of neighbouring function words ("But—Oh! ye lords…" was a monotone n·n·n,
  // with the interjection no louder than the conjunction beside it).  Narrow by
  // construction: only an UH whose very next token is "!".
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    if (w.lexicalClass !== 'UH' || w.syllables.length === 0) continue;
    if (words[i + 1].word !== '!') continue;
    const pk = wordPeak(w);
    if (!pk) continue;
    const r = STRESS_RANK[pk.relativeStress ?? 'w'];
    if (r < STRESS_RANK.s) pk.relativeStress = STRESS_LEVELS[r + 1];
  }

}

/** Ascending rank of the 5 relative-stress tiers, for level arithmetic. */
const STRESS_RANK: Record<StressLevel, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const STRESS_LEVELS: StressLevel[] = ['x', 'w', 'n', 'm', 's'];

/**
 * Re-assert left-stress on forestressed compounds over the LINEAR surface
 * sequence (e.g. WASTE·shore, SEA·shore, GHOST·town, STORM·cloud).  For each
 * pair of truly-adjacent content words (by absoluteIndex) that the Compound
 * Stress Rule marks left-stressed, the left element's peak is raised to the
 * pair's maximum prominence and the right element's peak is demoted one rung
 * below it — never raising the subordinate.  Runs on surface order so it works
 * even when the parse mis-groups the two into different phrases.
 */
function resolveCompoundForestress(words: ClsWord[]): void {
  const content = words.filter(w => w.isContent && !isPunctuation(w.lexicalClass));
  for (let i = 0; i < content.length - 1; i++) {
    const w1 = content[i];
    const w2 = content[i + 1];
    if (Math.abs(w1.absoluteIndex - w2.absoluteIndex) !== 1) continue; // truly adjacent
    const pos1 = w1.lexicalClass, pos2 = w2.lexicalClass;
    if (!(pos2.startsWith('N') && (pos1.startsWith('N') || pos1.startsWith('J')))) continue;
    if (!isLeftStressedPair(w1.word, w2.word)) continue;

    const s1 = wordPeak(w1);
    const s2 = wordPeak(w2);
    if (!s1 || !s2) continue;
    const r1 = STRESS_RANK[s1.relativeStress ?? 'w'];
    const r2 = STRESS_RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = STRESS_LEVELS[hi];                         // head ≥ both
    s2.relativeStress = STRESS_LEVELS[Math.min(r2, Math.max(0, hi - 1))]; // demote-only
  }
}

/**
 * Forestress lexicalised collocations (GOOD old, END-all) over the LINEAR
 * surface sequence.  Unlike `resolveCompoundForestress` this iterates ALL words
 * (not just content), because a collocation's second element may be a function
 * word ("end ALL" — "all" is a determiner): raise the left element's peak to the
 * pair maximum and demote the right one rung (demote-only, never raises the
 * subordinate).
 */
function resolveCollocationForestress(words: ClsWord[]): void {
  const seq = words
    .filter(w => !isPunctuation(w.lexicalClass) && w.syllables.length > 0)
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  for (let i = 0; i < seq.length - 1; i++) {
    const w1 = seq[i];
    const w2 = seq[i + 1];
    if (w2.absoluteIndex - w1.absoluteIndex !== 1) continue; // truly adjacent
    if (!isLeftStressedCollocation(w1, w2)) continue;

    const s1 = wordPeak(w1);
    const s2 = wordPeak(w2);
    if (!s1 || !s2) continue;
    const r1 = STRESS_RANK[s1.relativeStress ?? 'w'];
    const r2 = STRESS_RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = STRESS_LEVELS[hi];                         // left element ≥ both
    s2.relativeStress = STRESS_LEVELS[Math.min(r2, Math.max(0, hi - 1))]; // demote-only
  }
}

/**
 * Resolve the dual-strong clash at a hyphen seam inside a compound word
 * ("torch-flames", "blood-red").  The parser keeps a hyphenated compound as a
 * single token, so the word-level compound and clash passes never see its two
 * halves — left alone, both keep primary stress (s·s).  For a hyphenated content
 * word whose hyphen parts align 1:1 with its syllables, an adjacent s·s seam is
 * resolved with the same logic as a two-word compound: forestress the left if it
 * is a known forestress modifier, otherwise retract the left (the nuclear /
 * right-stress default, e.g. torch-FLAMES).
 */
function resolveHyphenCompounds(words: ClsWord[]): void {
  for (const w of words) {
    if (!w.isContent || !w.word.includes('-')) continue;
    const parts = w.word.split('-').filter(p => p.length > 0);
    if (parts.length < 2 || parts.length !== w.syllables.length) continue;
    for (let i = 0; i < w.syllables.length - 1; i++) {
      const a = w.syllables[i];
      const b = w.syllables[i + 1];
      // An equal-strong seam (s·s or m·m) is the unresolved compound clash.
      const equalStrong = a.relativeStress === b.relativeStress
        && (a.relativeStress === 's' || a.relativeStress === 'm');
      if (equalStrong) {
        if (isLeftStressedPair(parts[i], parts[i + 1])) demoteOneLevel(b); // BLOOD-red
        else demoteOneLevel(a);                                            // torch-FLAMES
      }
    }
  }
}

/**
 * THE CLASH FILTER — an absolute surface well-formedness constraint.
 *
 * On the STRESSED tier {n, m, s} no two *contiguous* syllables may carry the SAME
 * level: that is a stress clash (two equal prominences with no gradation between
 * them), which English categorically disallows.  Gradient pairs (sm/ms/sn/ns/mn/nm)
 * are fine — there is still a step down — as are runs of the unstressed tiers
 * {w, x} (an unstressed sequence is tolerated, if not ideal).  This generalises
 * McAleese's Appendix-A step 3d-ii ("stress clashes (ss, ms) > s-s") and Liberman
 * & Prince's (1977) grid alternation to every level of the strong tier.
 *
 * Resolution is DEMOTE-ONLY (never promote — promotion is the meter layer's job,
 * McAleese Test 2), so the contour is never inflated to break a clash; we iterate
 * to a fixed point (each change strictly lowers total stress mass, so it
 * terminates).  Which member yields is decided by `demoteRightOfClash` (grid-based
 * relative prominence).  Runs on the LINEAR surface order because a clash is a
 * property of contiguous *pronounced* syllables (Hayes), which a mis-grouped
 * dependency parse can scatter across phrases.
 */
export function resolveLinearClashes(words: ClsWord[]): void {
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of words) for (const s of w.syllables) flat.push({ word: w, syl: s });

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 24) {
    changed = false;
    for (let i = 0; i < flat.length - 1; i++) {
      const a = flat[i];
      const b = flat[i + 1];
      const lvl = a.syl.relativeStress;
      if (lvl !== b.syl.relativeStress) continue;
      if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue; // only the stressed tier clashes
      // Intra-word clashes are NOT skipped: a hyphenated-compound seam
      // (deep·voiced, snow·storm, gate·bolts) or any word with two adjacent equal
      // stresses is still a clash, and must be made gradient like any other.

      if (demoteRightOfClash(flat, i)) demoteOneLevel(b.syl);
      else demoteOneLevel(a.syl);
      changed = true;
    }
  }
}

/**
 * Decide which member of an equal-stress clash at (i, i+1) yields.  Rather than a
 * blunt leftward retraction, a layered cascade consults — in descending
 * authority — lexical, syntactic, and phonological context, so the demotion is
 * theory-grounded and the arbitrary default fires only as a last resort.  Returns
 * true to demote the RIGHT member (i+1), false to demote the LEFT (i).
 *
 *   1. Lexical integrity (Kiparsky): never demote a polysyllable's own stress
 *      peak for an adjacent monosyllable — the monosyllable yields.
 *   2. Inherent lexical prominence: a primary-stressed syllable outranks a
 *      secondary one — the lower-lexical-stress member yields.
 *   3. Syntactic headedness (Nuclear Stress Rule; Liberman & Prince 1977; Cinque
 *      1993): when the two words stand in a direct head–dependent relation, the
 *      DEPENDENT yields to its governor (the phrasal head is the more prominent).
 *   4. Content/function asymmetry — a coarse proxy for headedness when no direct
 *      dependency links the pair: the function word yields.
 *   5. Phonological weight: a light (open, short-vowel) syllable reduces more
 *      readily than a heavy (closed / long-vowel) one — the lighter member yields.
 *   6. Rhythm Rule (Liberman & Prince 1977; Hayes 1984): the clash member abutting
 *      the stronger OUTER beat is that beat's off-beat, so it retracts — "wet
 *      CHURCH" retracts wet (church is nuclear), "LATE last NIGHT" retracts last
 *      onto late (night is the following beat).
 *   7. Default (Hayes): retract the LEFT stress.
 */
function demoteRightOfClash(
  flat: { word: ClsWord; syl: Syllable }[],
  i: number
): boolean {
  const a = flat[i];
  const b = flat[i + 1];

  // (1) lexical integrity
  const aPeak = a.word.syllables.length > 1 && a.syl === wordPeak(a.word);
  const bPeak = b.word.syllables.length > 1 && b.syl === wordPeak(b.word);
  if (aPeak && !bPeak && b.word.syllables.length === 1) return true;
  if (bPeak && !aPeak && a.word.syllables.length === 1) return false;

  // (2) inherent lexical prominence
  const la = a.syl.lexicalStress ?? a.syl.stress ?? 0;
  const lb = b.syl.lexicalStress ?? b.syl.stress ?? 0;
  if (la !== lb) return la > lb;

  // (3) syntactic headedness — the dependent yields to its governor
  if (a.word !== b.word) {
    const gov = getGovernor(a.word, b.word);
    if (gov === a.word) return true;   // a heads b → demote b
    if (gov === b.word) return false;  // b heads a → demote a
  }

  // (4) content/function asymmetry — the function word yields
  if (a.word.isContent !== b.word.isContent) return a.word.isContent;

  // (5) phonological weight — the lighter syllable yields
  if (a.syl.weight && b.syl.weight && a.syl.weight !== b.syl.weight) {
    return a.syl.weight === 'H'; // a heavy → demote the lighter b
  }

  // (6) Rhythm Rule — yield to the stronger adjacent (outer) beat
  const outerA = i - 1 >= 0 ? STRESS_RANK[flat[i - 1].syl.relativeStress ?? 'w'] : -1;
  const outerB = i + 2 < flat.length ? STRESS_RANK[flat[i + 2].syl.relativeStress ?? 'w'] : -1;
  if (outerA !== outerB) return outerB > outerA;

  // (7) default: retract the left
  return false;
}

/**
 * Scan across the linear sequence of syllables and adjust any adjacent
 * identical relative stress levels using syntactic governance.
 */
function resolveAdjacentClashes(words: ClsWord[], protect?: Set<Syllable>): void {
  // "Endings strict": when a phrase ends in a run of two or more bare function
  // words (e.g. "…fast as you MIGHT"), the metrical beat gravitates to one of
  // them; the others are upbeat.  Demote the others so a leftward governance
  // clash can't promote a medial off-beat ("you") over the phrase-final beat.
  // Phrases ending in a content word are untouched.
  {
    let runStart = words.length;
    while (runStart > 0 && !words[runStart - 1].isContent) runStart--;
    if (words.length - runStart >= 2) {
      // The beat is normally the run's last word, UNLESS that is a clause-final
      // oblique pronoun (me/him/them…), which is canonically unstressed — then
      // the beat falls on the preceding member ("and beHIND me", not "behind ME").
      let beatIdx = words.length - 1;
      if (OBLIQUE_PRONOUNS.has(words[beatIdx].word.toLowerCase()) && beatIdx > runStart) {
        beatIdx--;
      }
      for (let wi = runStart; wi < words.length; wi++) {
        if (wi === beatIdx) continue;
        const w = words[wi];
        const peak = wordPeak(w);
        for (const s of w.syllables) {
          // Protect a polysyllabic word's own lexical peak: never flatten a real
          // internal stress (be·HIND) to 'w' just because the word is functional.
          if (w.syllables.length > 1 && s === peak && (s.lexicalStress ?? s.stress) >= 1) continue;
          // Protect a dependency-mined prominence (stranded preposition etc.).
          if (protect && protect.has(s)) continue;
          s.relativeStress = 'w';
        }
      }
    }
  }

  // Flatten all syllables with reference to their owning word.
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of words) {
    for (const s of w.syllables) {
      flat.push({ word: w, syl: s });
    }
  }

  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    if (a.syl.relativeStress !== b.syl.relativeStress) continue;
    // Only the stressed tier {n,m,s} clashes; {w,x} may repeat (maintainer's rule:
    // an unstressed run is tolerated, never "resolved" by demoting a clitic to 'x').
    const lvl = a.syl.relativeStress;
    if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue;

    // Within-word strictness (Kiparsky): a polysyllabic word's own stress peak
    // must not be demoted below its word-mates by a clash with an adjacent
    // monosyllable.  Protect the peak; demote the monosyllable instead.
    const aPeak = a.word.syllables.length > 1 && a.syl === wordPeak(a.word);
    const bPeak = b.word.syllables.length > 1 && b.syl === wordPeak(b.word);
    if (aPeak && b.word.syllables.length === 1) {
      adjustAdjacent(a.syl, b.syl, governorDependentDirection);
      continue;
    }
    if (bPeak && a.word.syllables.length === 1) {
      adjustAdjacent(b.syl, a.syl, governorDependentDirection);
      continue;
    }

    // Otherwise use the syntactic governor relationship.
    const governor = getGovernor(a.word, b.word);
    if (governor === a.word) {
      // a governs b → a stronger, b weaker
      adjustAdjacent(a.syl, b.syl, governorDependentDirection);
    } else if (governor === b.word) {
      // b governs a → b stronger, a weaker
      adjustAdjacent(b.syl, a.syl, governorDependentDirection);
    }
    // If no relationship, leave untouched.
  }
}

/** The syllable bearing a word's lexical stress peak (used for within-word protection). */
function wordPeak(word: ClsWord): Syllable | undefined {
  let best: Syllable | undefined;
  let bestVal = -Infinity;
  for (const s of word.syllables) {
    const v = s.lexicalStress ?? s.stress;
    if (v > bestVal) { bestVal = v; best = s; }
  }
  return best;
}

/** Return the governor word if one directly governs the other, else null. */
function getGovernor(w1: ClsWord, w2: ClsWord): ClsWord | null {
  const dep1 = w1.dependency;
  const dep2 = w2.dependency;
  if (!dep1 || !dep2) return null;

  // Check if w2 is a dependent of w1.
  if (dep2.governor === w1) return w1;
  // Check if w1 is a dependent of w2.
  if (dep1.governor === w2) return w2;
  return null;
}

/** Adjustment direction: governor stronger (promote), dependent weaker (demote). */
function governorDependentDirection(gov: Syllable, dep: Syllable): void {
  const govStress = gov.relativeStress!;
  const depStress = dep.relativeStress!;

  // Promote governor (if possible)
  if (govStress === 'n') gov.relativeStress = 'm';
  else if (govStress === 'm') gov.relativeStress = 's';
  // 'w' or 's' stay the same (can't promote 's', can't easily promote 'w' to 'n' without risking equal)

  // Demote dependent (if possible)
  if (depStress === 's') dep.relativeStress = 'm';
  else if (depStress === 'm') dep.relativeStress = 'n';
  else if (depStress === 'n') dep.relativeStress = 'w';
  else if (depStress === 'w') dep.relativeStress = 'x';
}

/** Simple adjustment for two adjacent syllables. */
function adjustAdjacent(
  stronger: Syllable,
  weaker: Syllable,
  direction: (s: Syllable, w: Syllable) => void
): void {
  direction(stronger, weaker);
}

/** Demote a syllable's relative stress by one level: s→m, m→n, n→w, w→x, x stays x. */
function demoteOneLevel(syl: Syllable): void {
  const cur = syl.relativeStress;
  if (cur === 's') syl.relativeStress = 'm';
  else if (cur === 'm') syl.relativeStress = 'n';
  else if (cur === 'n') syl.relativeStress = 'w';
  else if (cur === 'w') syl.relativeStress = 'x';
}

/**
 * Resolve stress clashes across prosodic boundaries (PP and IU).
 * When adjacent syllables at a boundary have equal stress:
 *   - If one word is function and the other content, demote the function word
 *     (per "beginnings free": the start of a new unit can be weakened)
 *   - If both are same type, use dependency relationship
 *   - If no relationship exists, leave untouched
 */
function resolveCrossBoundaryClashes(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Build flat array with prosodic position tracking
  const flat: { word: ClsWord; syl: Syllable; ppKey: string }[] = [];
  for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
    const iu = ius[iuIdx];
    for (let ppIdx = 0; ppIdx < iu.phonologicalPhrases.length; ppIdx++) {
      const pp = iu.phonologicalPhrases[ppIdx];
      const ppWords = collectPPTokens(pp);
      for (const w of ppWords) {
        for (const s of w.syllables) {
          flat.push({ word: w, syl: s, ppKey: `${iuIdx}:${ppIdx}` });
        }
      }
    }
  }

  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    if (a.syl.relativeStress !== b.syl.relativeStress) continue;
    // Only the stressed tier {n,m,s} clashes; {w,x} may repeat (maintainer's rule).
    const lvl = a.syl.relativeStress;
    if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue;

    // Only adjust if they span a prosodic boundary
    if (a.ppKey === b.ppKey) continue;

    const aContent = a.word.isContent;
    const bContent = b.word.isContent;

    if (aContent && !bContent) {
      demoteOneLevel(b.syl);
    } else if (!aContent && bContent) {
      demoteOneLevel(a.syl);
    } else {
      // Both same content/function type — try dependency relationship.
      // (A blanket Selkirk "demote the PP-initial" was tried and regressed
      // litlab/prosodic: the linear-clash cascade's nuanced resolution — weight,
      // Rhythm Rule, governance — captures "beginnings loose" better than a flat
      // directional rule, so a clash with no governance is left for it.)
      const governor = getGovernor(a.word, b.word);
      if (governor === a.word) {
        adjustAdjacent(a.syl, b.syl, governorDependentDirection);
      } else if (governor === b.word) {
        adjustAdjacent(b.syl, a.syl, governorDependentDirection);
      }
    }
  }
}

/** Check whether a POS tag belongs to a content word category. */
function isContentWord(tag: string, word?: string): boolean {
  if (CONTENT_POS.has(tag)) {
    if (word) {
      const lower = word.toLowerCase();
      if (FUNCTION_ADVERBS.has(lower)) return false;
      if (FUNCTION_VERBS.has(lower)) return false;
    }
    return true;
  }
  return false;
}
```

## clio/tagfix.ts

```typescript
// tagfix.ts — Pre-parse POS-tag correction layer.
//
// FinNLP's en-pos tagger is structurally sound but carries a small tail of
// SYSTEMATIC tag errors that matter enormously for verse analysis, because a
// wrong tag flips a word's content/function status (→ its stress tier) and
// derails the en-parse dependency tree built from the tags.  This pass runs
// BETWEEN en-pos and en-parse (see parseDocument in parser.ts), so corrected
// tags repair both the tagging AND the resulting dependency structure — a
// post-hoc fix of the parse could never do that.
//
// Every rule below targets an error class actually observed in this repo's
// trials; rules are deliberately narrow (anti-gaming: each must be justified
// by the error it fixes, not by benchmark deltas).

/** Zero-derived irregular past participles that en-pos tags NN/VBP after a
 *  have-auxiliary ("had quit", "has put", "have read").  Only forms whose
 *  participle is identical to the base/noun spelling — the -en/-ed forms tag
 *  fine on their own. */
const ZERO_PARTICIPLES = new Set([
  'quit', 'put', 'set', 'cut', 'hit', 'let', 'shut', 'cast', 'cost', 'hurt',
  'burst', 'split', 'spread', 'bet', 'wed', 'read', 'rid', 'shed', 'thrust',
  'slit', 'bid', 'broadcast', 'upset', 'sunburst',
]);

const HAVE_FORMS = new Set(['have', 'has', 'had', 'having', "'ve", "'d"]);

/** Archaic / Early-Modern-English forms en-pos has no lexicon entries for —
 *  ubiquitous in the verse this toolkit exists to scan. */
const ARCHAIC_TAGS: Record<string, string> = {
  thou: 'PRP', thee: 'PRP', ye: 'PRP',
  thy: 'PRP$', thine: 'PRP$',
  art: 'VBP', wert: 'VBD', wast: 'VBD',
  doth: 'VBZ', hath: 'VBZ', dost: 'VBZ', hast: 'VBZ', saith: 'VBZ',
  didst: 'VBD', hadst: 'VBD', wouldst: 'MD', couldst: 'MD', shouldst: 'MD',
  shalt: 'MD', wilt: 'MD', canst: 'MD', mayst: 'MD', 'mightst': 'MD',
  wherefore: 'WRB', whither: 'WRB', whence: 'WRB',
  hither: 'RB', thither: 'RB', yon: 'JJ', yonder: 'RB',
  ere: 'IN', oft: 'RB', anon: 'RB',
};

/**
 * Correct a sentence's tags in place-safe fashion (returns a new array).
 * `tokens` and `tags` are the en-pos outputs, index-aligned.
 */
export function correctTags(tokens: string[], tags: string[]): string[] {
  const out = tags.slice();
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase();

    // 1. The pronoun "I".  en-norm lowercases sentence-initial "I" → "i",
    //    which en-pos then reads as a foreign word / letter name (FW).
    if (w === 'i' && out[i] === 'FW') out[i] = 'PRP';

    // 2. Archaic forms (thou/thy/doth/shalt/wherefore…): en-pos guesses
    //    NN/JJ/FW for these, wrecking both stress class and the parse.
    //    Guard "art": only when a pronoun precedes ("thou art"), since the
    //    noun reading ("the art of…") is the modern default.
    const archaic = ARCHAIC_TAGS[w];
    if (archaic && !/^(NNP|NNPS)$/.test(out[i])) {
      if (w === 'art') {
        const prev = i > 0 ? tokens[i - 1].toLowerCase() : '';
        if (prev === 'thou' || prev === 'ye' || prev === 'you') out[i] = 'VBP';
      } else {
        out[i] = archaic;
      }
    }

    // 3. Perfect-tense zero participles: have-form + ("quit"/"put"/"read"…)
    //    tagged as NN/VBP/VBD → VBN, so en-parse builds the verb chain
    //    instead of treating the participle as a direct-object noun
    //    ("I had quit the programming paradigm").  An intervening adverb
    //    ("had just quit") is allowed.
    if (ZERO_PARTICIPLES.has(w) && /^(NN|NNS|VBP|VBD|VB)$/.test(out[i])) {
      const prev1 = i > 0 ? tokens[i - 1].toLowerCase() : '';
      const prev2 = i > 1 ? tokens[i - 2].toLowerCase() : '';
      const prev1IsAdv = i > 0 && /^RB/.test(out[i - 1]);
      if (HAVE_FORMS.has(prev1) || (prev1IsAdv && HAVE_FORMS.has(prev2))) {
        out[i] = 'VBN';
      }
    }

    // 4. Impossible gerunds: a VBG tag on a token that does not end in
    //    -ing/-in' cannot be a gerund/present participle — it is an en-pos
    //    lexicon glitch.  The right tag depends on context: before a noun it
    //    is a noun modifier ("wisdom"/VBG teeth → NN); after a subject
    //    pronoun it is a finite verb ("as they bicycle/VBG through" → VBP,
    //    which keeps "through" a phrasal particle in the parse).  With no
    //    deciding context, leave the tag alone (en-parse treats VBG
    //    verb-ishly, the safer default).
    if (out[i] === 'VBG' && !/in[g'’]?$/.test(w)) {
      const prevTag = i > 0 ? out[i - 1] : '';
      const nextTag = i + 1 < tokens.length ? out[i + 1] : '';
      if (/^NNS?$/.test(nextTag)) out[i] = 'NN';
      else if (prevTag === 'PRP') out[i] = 'VBP';
    }

    // 5. Vocative "O" ("O wild West Wind"): en-pos gives NNP/JJ; it is an
    //    interjection (and must not become a content word with a beat by
    //    default).  Only the bare capital O — "o'er" etc. are handled by the
    //    aphaeresis lexicon in stress.ts.
    if (tokens[i] === 'O' && i + 1 < tokens.length && out[i] !== 'UH') out[i] = 'UH';
  }
  return out;
}

```

## depfix.ts

```typescript
// depfix.ts — Post-parse dependency repair via DepEdit rules (the `depedits`
// npm package, the maintainer's TypeScript port of DepEdit).
//
// Runs AFTER en-parse, complementing the pre-parse tag corrections in
// tagfix.ts: tagfix repairs what the tagger got wrong before the tree is
// built; this pass repairs systematic attachment errors en-parse makes even
// with correct tags.  Rules are written in DepEdit's declarative format
// (definitions ⟶ relations ⟶ actions, tab-separated) over en-parse's own
// label space (DOBJ/NSUBJ/DEP/…), so the round-trip is lossless and every
// rule is independently testable.
//
// The rule set is deliberately small and evidence-based — each rule cites the
// observed failure it corrects.  `depedits` is ESM-only; it is loaded lazily
// and failures degrade gracefully (the unrepaired parse is still a parse).

import { createRequire } from 'module';

interface FinDepNode {
  label: string;      // dependency label, e.g. "NSUBJ", "ROOT"
  type: string;       // phrase type, e.g. "NP", "VP"
  parent: number;     // 0-based index of governor token; -1 for root
}

// Observed failure (probe: "I had quit the programming paradigm"): en-parse
// attaches BOTH nouns of a noun compound to the verb as parallel objects
// ("programming ←DOBJ← quit", "paradigm ←DOBJ← quit"), and leaves the
// determiner dangling on the first noun as generic DEP.  The repairs:
//   1. Two adjacent common nouns sharing a governor with the same object
//      relation → the first is a compound modifier (AMOD) of the second.
//   2. A determiner left as DEP on a noun that has become a modifier →
//      re-attach it as DET to that noun's head (the true NP head).
const CALLIOPE_DEP_FIXES = [
  'xpos=/NNS?/&func=/DOBJ|IOBJ/;xpos=/NNS?/&func=/DOBJ|IOBJ/;xpos=/VB.*/\t#3>#1;#3>#2;#1.#2\t#2>#1;#1:func=AMOD',
  'xpos=/DT/&func=/DEP|EXT/;xpos=/NNS?/&func=/AMOD/;xpos=/NNS?.*/\t#2>#1;#3>#2\t#3>#1;#1:func=DET',
].join('\n');

let engine: { process(conllu: string): string } | null | undefined;

function loadEngine(): typeof engine {
  if (engine !== undefined) return engine;
  try {
    // This package compiles to ESM, where bare `require` does not exist, and
    // the parse path is synchronous, so dynamic import() is not an option:
    // createRequire gives a sync loader, and since `depedits` is itself
    // ESM-only this resolves via Node's require(esm) (≥20.17 / ≥22.12).  On
    // older runtimes it throws and the repair pass degrades to a no-op (the
    // unrepaired parse is still a parse).
    const req = createRequire(import.meta.url);
    const { DepEditEngine } = req('depedits');
    const e = new DepEditEngine();
    e.loadIniString(CALLIOPE_DEP_FIXES);
    engine = e;
  } catch {
    engine = null;
  }
  return engine;
}

/**
 * Repair systematic en-parse attachment errors.  Returns a new deps array
 * (same shape as en-parse's `toArray` output); on any failure returns the
 * input unchanged.
 */
export function applyDepFixes(tokens: string[], tags: string[], deps: FinDepNode[]): FinDepNode[] {
  const e = loadEngine();
  if (!e || tokens.length === 0 || deps.length !== tokens.length) return deps;
  try {
    const conllu = tokens.map((tok, i) => {
      const head = deps[i].parent >= 0 ? deps[i].parent + 1 : 0;
      const safe = tok.replace(/\s/g, '_') || '_';
      return `${i + 1}\t${safe}\t${safe}\t_\t${tags[i] || '_'}\t_\t${head}\t${deps[i].label || 'DEP'}\t_\t_`;
    }).join('\n') + '\n\n';
    const out = e.process(conllu);
    const fixed: FinDepNode[] = deps.map(d => ({ ...d }));
    for (const row of out.split('\n')) {
      const cols = row.split('\t');
      if (cols.length < 10) continue;
      const idx = parseInt(cols[0], 10) - 1;
      if (!(idx >= 0 && idx < fixed.length)) continue;
      const head = parseInt(cols[6], 10);
      fixed[idx].parent = Number.isFinite(head) ? head - 1 : fixed[idx].parent;
      if (cols[7] && cols[7] !== '_') fixed[idx].label = cols[7];
    }
    return fixed;
  } catch {
    return deps;
  }
}

```

## display.ts

```typescript
// display.ts — Unified, integrated CLI display for Calliope TS
// Shows ALL information layers in a single comprehensive view

import chalk from 'chalk';
import {
  ClsWord,
  ClsSentence,
  IntonationalUnit,
  PhonologicalPhrase,
  CliticGroup,
  StressLevel,
  LineResult,
  SyllableDisplayEntry,
  MeterScore,
} from './types.js';
import { isPunctuation } from './parser.js';
import { syllabifyWord, syllableVowelLengths } from './phonological.js';
import { computeCaesurae, CaesuraInfo } from './caesura.js';
import { computeBoundaries } from './calliope/boundaries.js';
import { summarizePoem, analyzePhonopoetics, type Phonopoetics, type RhymeRel } from './rhyme.js';

// ═══════════════════════════════════════════════════════════════════════
// COLOUR SYSTEM — Conceptually motivated palettes
// ═══════════════════════════════════════════════════════════════════════

// Lexical stress (numeric 0–3): blue→magenta→red→bold red
// Represents phonetic prominence from dictionary
const LEX0 = (s: string) => chalk.blue(s);
const LEX1 = (s: string) => chalk.magenta(s);
const LEX2 = (s: string) => chalk.red(s);
const LEX3 = (s: string) => chalk.red.bold(s);

function lexColour(val: number): (s: string) => string {
  if (val === 0) return LEX0;
  if (val === 1) return LEX1;
  if (val === 2) return LEX2;
  return LEX3;
}

// Relative / phonological stress (x w n m s): light-grey→cyan→green→yellow→bright red
// Represents phonological prominence after phrasal rules.  `x` = zero-provision
// (maximally-reduced clitic), one rung below the stressless-overt floor `w`.
// Light grey (not dark blue) so it stays legible on a black terminal.
const REL_X = (s: string) => chalk.hex('#b0b0b0')(s);
const REL_W = (s: string) => chalk.cyan(s);
const REL_N = (s: string) => chalk.green(s);
const REL_M = (s: string) => chalk.yellow(s);
const REL_S = (s: string) => chalk.redBright(s);

function relColour(rel: StressLevel): (s: string) => string {
  if (rel === 'x') return REL_X;
  if (rel === 'w') return REL_W;
  if (rel === 'n') return REL_N;
  if (rel === 'm') return REL_M;
  if (rel === 's') return REL_S;
  return chalk.gray.dim;
}

// Phrasal boundaries — distinct palette (purple/blue/green)
const B_CP = chalk.magentaBright;
const B_PP = chalk.blueBright;
const B_IU = chalk.greenBright;
const B_CAESURA = chalk.whiteBright.bold;       // hard caesura (overt: punctuation / IU edge)
const B_CAESURA_SOFT = chalk.cyan.dim;          // inferred caesura (phonological-phrase pause)
const B_FOOT = chalk.gray;
const B_SILENT = chalk.gray.dim;

// ── Graded boundary-strength colour (Wagner Ch.4–5): cold blue (weak) → warm red
// (strong).  The relational grid says boundaries differ in DEGREE, not just kind, so
// ϕ/ι brackets are tinted along a continuous spectrum by their NSBR-scaled strength
// (boundaries.ts).  κ (clitic-group) boundaries are the weakest tier — a constant dim
// blue.  This makes the boundary-strength dimension VISIBLE in the bracketing view.
const GRAD_STOPS: [number, [number, number, number]][] = [
  [0.00, [0x6a, 0x8c, 0xc7]],   // cold blue
  [0.30, [0x5f, 0xc7, 0xc0]],   // teal
  [0.55, [0xd9, 0xc2, 0x4d]],   // yellow
  [0.78, [0xe0, 0x91, 0x3f]],   // orange
  [1.00, [0xe0, 0x56, 0x4b]],   // red
];
function gradHex(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRAD_STOPS.length; i++) {
    const [t1, c1] = GRAD_STOPS[i - 1];
    const [t2, c2] = GRAD_STOPS[i];
    if (x <= t2) {
      const f = t2 === t1 ? 0 : (x - t1) / (t2 - t1);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
      return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
  }
  return '#e0564b';
}
/** Colour for a ϕ/ι bracket given its boundary strength (0..1). */
function boundaryColour(strength: number): (s: string) => string {
  return (s: string) => chalk.hex(gradHex(strength))(s);
}
const B_KAPPA = (s: string) => chalk.hex('#5a6f9e').dim(s);   // κ — weakest, dim blue

// Word roles
const W_CONTENT = chalk.white;
const W_FUNCTION = chalk.gray;
const W_DEP = chalk.italic.dim;

// Section headers
const H1 = chalk.bold.underline;
const H2 = chalk.bold;

const HR = '─'.repeat(70);
const HR_THIN = '─'.repeat(50);

// ═══════════════════════════════════════════════════════════════════════
// PER-SYLLABLE DATA STRUCTURE
// ═══════════════════════════════════════════════════════════════════════

interface ColSyl {
  chunk: string;
  word: string;
  pos: string;
  isContent: boolean;
  lexStress: number;
  relStress: StressLevel;
  cpId: number;
  ppId: number;
  iuId: number;
  isFirstInWord: boolean;
  isFirstInCP: boolean;
  isFirstInPP: boolean;
  isFirstInIU: boolean;
  isLastInCP: boolean;
  isLastInPP: boolean;
  isLastInIU: boolean;
  depLabel: string;
  govWord: string;
  globalIdx: number;
  wordRef: ClsWord;
}

function buildColSyls(words: ClsWord[], ius: IntonationalUnit[]): ColSyl[] {
  const result: ColSyl[] = [];
  let globalIdx = 0;

  for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
    const iu = ius[iuIdx];
    for (let ppIdx = 0; ppIdx < iu.phonologicalPhrases.length; ppIdx++) {
      const pp = iu.phonologicalPhrases[ppIdx];
      for (let cpIdx = 0; cpIdx < pp.cliticGroups.length; cpIdx++) {
        const cg = pp.cliticGroups[cpIdx];
        for (let tIdx = 0; tIdx < cg.tokens.length; tIdx++) {
          const w = cg.tokens[tIdx];
          if (isPunctuation(w.lexicalClass)) continue;
          const dep = w.dependency;
          const sylCount = w.syllables.length;
          const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix, w.morphPrefix);

          for (let si = 0; si < sylCount; si++) {
            const syl = w.syllables[si];
            const lex = syl.lexicalStress ?? syl.stress;
            const rel = syl.relativeStress ?? 'w';

            result.push({
              chunk: chunks[si] || w.word,
              word: w.word,
              pos: w.lexicalClass,
              isContent: w.isContent,
              lexStress: lex,
              relStress: rel,
              cpId: cpIdx,
              ppId: ppIdx,
              iuId: iuIdx,
              isFirstInWord: si === 0,
              isFirstInCP: tIdx === 0 && si === 0,
              isFirstInPP: cpIdx === 0 && tIdx === 0 && si === 0,
              isFirstInIU: ppIdx === 0 && cpIdx === 0 && tIdx === 0 && si === 0,
              isLastInCP: tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              isLastInPP: cpIdx === pp.cliticGroups.length - 1 &&
                tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              isLastInIU: ppIdx === iu.phonologicalPhrases.length - 1 &&
                cpIdx === pp.cliticGroups.length - 1 &&
                tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              depLabel: dep?.dependentType ?? '',
              govWord: dep?.governor?.word ?? '',
              globalIdx: globalIdx++,
              wordRef: w,
            });
          }
          // A 0-syllable possessive enclitic ('s) has no syllable column of its own;
          // append its surface to the preceding syllable so "Nature's" renders WITH its
          // 's instead of as bare "Nature" (and so its κ-boundary does not collapse into
          // the next group — the "Nature first" mis-bracketing the maintainer flagged).
          if (sylCount === 0 && w.lexicalClass === 'POS' && result.length > 0) {
            result[result.length - 1].chunk += w.word;
          }
        }
      }
    }
  }

  // Bracket-boundary flags via look-around over the SYLLABLE-bearing columns, so a
  // 0-syllable token (possessive 's, an elided clitic) can never swallow a κ/ϕ/ι
  // boundary: a column is first/last in its unit when the adjacent column belongs to a
  // different unit.  (Composite key, since cpId/ppId are indices LOCAL to their parent.)
  const uKey = (c: { iuId: number; ppId: number; cpId: number }, lvl: 'cp' | 'pp' | 'iu') =>
    lvl === 'cp' ? `${c.iuId}.${c.ppId}.${c.cpId}` : lvl === 'pp' ? `${c.iuId}.${c.ppId}` : `${c.iuId}`;
  for (let i = 0; i < result.length; i++) {
    const cur = result[i], prev = result[i - 1], next = result[i + 1];
    result[i].isFirstInCP = !prev || uKey(prev, 'cp') !== uKey(cur, 'cp');
    result[i].isLastInCP = !next || uKey(next, 'cp') !== uKey(cur, 'cp');
    result[i].isFirstInPP = !prev || uKey(prev, 'pp') !== uKey(cur, 'pp');
    result[i].isLastInPP = !next || uKey(next, 'pp') !== uKey(cur, 'pp');
    result[i].isFirstInIU = !prev || uKey(prev, 'iu') !== uKey(cur, 'iu');
    result[i].isLastInIU = !next || uKey(next, 'iu') !== uKey(cur, 'iu');
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// UNIFIED DISPLAY — All layers integrated
// ═══════════════════════════════════════════════════════════════════════

export function renderUnifiedDisplay(result: LineResult, rawLine?: string): string {
  const words = result.sentence.words;
  const ius = result.phonologicalHierarchy;
  const detail = result.phonologicalScansion;
  const colSyls = buildColSyls(words, ius);

  const lines: string[] = [];
  lines.push('');
  lines.push(HR);

  // ── Layer 1: Original text with word-role coloring ──────────────
  lines.push(H1('Original Text'));
  lines.push('');
  const textParts: string[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const wc = w.isContent ? W_CONTENT : W_FUNCTION;
    const posTag = W_DEP('(' + w.lexicalClass + ')');
    textParts.push(wc(w.word) + posTag);
  }
  lines.push('  ' + textParts.join(' '));
  lines.push('');

  // ── Layer 2: Phrasal structure tree ─────────────────────────────
  lines.push(H1('Phrasal Structure') + '  ' + B_IU('IU') + ' → ' + B_PP('PP') + ' → ' + B_CP('CP'));
  // Mini-legend: only the POS tags & dependencies that occur in THIS line.
  lines.push(...renderLineGlossary(words));
  lines.push('');

  const wordSet = new Set<ClsWord>();
  const dedupedEntries: { col: ColSyl; word: ClsWord }[] = [];
  for (const cs of colSyls) {
    if (!wordSet.has(cs.wordRef)) {
      wordSet.add(cs.wordRef);
      dedupedEntries.push({ col: cs, word: cs.wordRef });
    }
  }

  let lastIU = -1, lastPP = -1;
  for (const we of dedupedEntries) {
    const cs = we.col;
    if (cs.iuId !== lastIU) {
      lines.push(B_IU('  IU' + (cs.iuId + 1)));
      lastIU = cs.iuId;
      lastPP = -1;
    }
    if (cs.ppId !== lastPP) {
      lines.push(B_PP('    PP' + (cs.ppId + 1) + ': {'));
      lastPP = cs.ppId;
    }
    const dep = we.word.dependency;
    const depInfo = dep && dep.governorIndex > 0
      ? W_DEP(' ←' + dep.dependentType)
      : '';
    const wordLabel = W_CONTENT(we.word.word) + W_DEP('(' + we.word.lexicalClass + ')');
    lines.push('      ' + B_CP('[') + wordLabel + depInfo + B_CP(']'));
  }
  lines.push('    ' + B_PP('}'));
  lines.push('');

  // ── Layer 3: Lexical stress (numeric) ───────────────────────────
  lines.push(H1('Lexical Stress') + '  ' + LEX0('0') + LEX1('1') + LEX2('2') + LEX3('3') + '  (0=none 1=secondary 2=primary 3+=boosted)');
  lines.push('');

  const lexParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) lexParts.push(' ');
    lexParts.push(lexColour(cs.lexStress)(String(cs.lexStress)));
  }
  lines.push('  ' + lexParts.join(''));
  lines.push('');

  // ── Layer 3b: Phrase stress (genuine cyclic Compound + Nuclear Stress Rules) ───
  // The real phrase-stress stage (bracketing.ts): the SPE/Hayes cyclic CSR (compound
  // → primary LEFT) + NSR (phrase → primary RIGHT) over the dependency tree's
  // constituent bracketing.  1 = STRONGEST (the utterance nuclear); higher = weaker.
  // Reproduces "Mary 2, ate 3, sweet 4, ice 1, cream 5".  An integer prominence
  // ranking, computed INDEPENDENTLY of the relative contour below.
  lines.push(H1('Phrase Stress') + '  ' + chalk.dim('1 = strongest (utterance nuclear) → higher = weaker · 0 = none'));
  lines.push('');

  const phrParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) phrParts.push(' ');
    if (cs.isFirstInWord) {
      const ps = cs.wordRef.phraseStress || 0;
      const colour = ps === 0 ? chalk.dim
        : ps === 1 ? chalk.cyanBright           // the utterance nuclear (strongest)
        : ps <= 3 ? chalk.cyan                   // strong
        : chalk.dim;                             // weak / deeply demoted
      phrParts.push(colour(String(ps)));
    } else {
      phrParts.push(' '); // continuation syllable — keep word-start alignment
    }
  }
  lines.push('  ' + phrParts.join(''));
  lines.push('');

  // ── Layer 4: Relative stress (w/n/m/s) ──────────────────────────
  lines.push(H1('Relative Stress') + '  ' + REL_X('x') + REL_W('w') + REL_N('n') + REL_M('m') + REL_S('s') + '  (zero‑provision→weak→low→moderate→strong)');
  lines.push('');

  const relParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) relParts.push(' ');
    relParts.push(relColour(cs.relStress)(cs.relStress));
  }
  lines.push('  ' + relParts.join(''));
  lines.push('');

  // ── Layer 5: Phonological bracketing (graded by boundary strength) ──────
  lines.push(H1('Phonological Bracketing') + '  ' + B_KAPPA('[]') + ' κ  ' + B_PP('{}') + ' ϕ  ' + B_IU('<>') + ' ι' +
    chalk.dim('   — ϕ/ι tint: ') + boundaryColour(0.1)('weak') + chalk.dim('→') + boundaryColour(1)('strong'));
  lines.push('');

  // Graded boundary strengths (NSBR, boundaries.ts), zipped to the ϕ/ι opens as we
  // walk the syllable columns: each ϕ is tinted by the strength of the break that
  // introduced it (its left-edge boundary); κ stays the weakest dim-blue tier.
  const bounds = computeBoundaries(words, ius);
  let phiOrd = -1;
  let ppColourFn: (s: string) => string = B_PP;
  let iuColourFn: (s: string) => string = B_IU;
  const sylParts: string[] = [];
  let iuOpen = false, ppOpen = false, cpOpen = false;
  for (const cs of colSyls) {
    if (cs.isFirstInPP) {
      phiOrd++;
      const st = bounds.phi[phiOrd]?.strength ?? 0;
      ppColourFn = boundaryColour(st);
      if (cs.isFirstInIU) iuColourFn = boundaryColour(st);
    }
    if (cs.isFirstInIU && !iuOpen) { sylParts.push(iuColourFn('<')); iuOpen = true; }
    if (cs.isFirstInPP && !ppOpen) { sylParts.push(ppColourFn('{')); ppOpen = true; }
    if (cs.isFirstInCP && !cpOpen) { sylParts.push(B_KAPPA('[')); cpOpen = true; }

    if (cs.isFirstInWord && cs.globalIdx > 0) sylParts.push(' ');
    sylParts.push(relColour(cs.relStress)(cs.chunk));

    if (cs.isLastInCP && cpOpen) { sylParts.push(B_KAPPA(']')); cpOpen = false; }
    if (cs.isLastInPP && ppOpen) { sylParts.push(ppColourFn('}')); ppOpen = false; }
    if (cs.isLastInIU && iuOpen) { sylParts.push(iuColourFn('>')); iuOpen = false; }
  }
  lines.push('  ' + sylParts.join(''));
  lines.push('');

  // ── Layer 6: Metrical scansion with caesura ─────────────────────
  lines.push(H1('Metrical Scansion'));
  lines.push('');

  const scansion = detail.scansion;
  const feetRaw = scansion.split('|');

  interface LinearSyl {
    chunk: string;
    relStress: StressLevel;
    wordRef: ClsWord;
  }
  const linearSyls: LinearSyl[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const sylCount = w.syllables.length;
    const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix, w.morphPrefix);
    for (let si = 0; si < sylCount; si++) {
      linearSyls.push({
        chunk: chunks[si] || w.word,
        relStress: w.syllables[si].relativeStress ?? 'w',
        wordRef: w,
      });
    }
  }

  // Caesurae: hard at IU/punctuation breaks, plus one inferred (soft) medial
  // caesura at a phonological-phrase boundary for a punctuation-free line.
  const caesurae = computeCaesurae(words, ius, scansion);

  function isSyllableChar(ch: string): boolean {
    return 'xXwWnNmMsS'.includes(ch);
  }

  // Feet whose right edge carries a caesura take the caesura GLYPH as their
  // separator (matching the reading view's "xs ‖ xnw"), never a doubled "‖ |".
  const joinFeet = (feet: string[], caesAfter: boolean[]): string => {
    let out = '';
    for (let i = 0; i < feet.length; i++) {
      out += feet[i];
      if (i < feet.length - 1) out += caesAfter[i] ? ' ' : B_FOOT(' | ');
    }
    return out;
  };

  let sylIdx = 0;
  const footDisplays: string[] = [];
  const footCaes: boolean[] = [];
  let prevWordRef: ClsWord | null = null;
  for (const rawFoot of feetRaw) {
    let footOut = '';
    for (const ch of rawFoot) {
      if (ch === '-') {
        footOut += B_SILENT('·');
        continue;
      }
      if (!isSyllableChar(ch)) continue;
      if (sylIdx < linearSyls.length) {
        const ls = linearSyls[sylIdx];
        if (prevWordRef !== null && ls.wordRef !== prevWordRef) footOut += ' ';
        footOut += relColour(ls.relStress)(ls.chunk);
        prevWordRef = ls.wordRef;
        sylIdx++;
      }
    }
    const ck = caesurae.get(sylIdx); if (ck) footOut += ' ' + caesuraGlyph(ck);
    footCaes.push(!!ck);
    footDisplays.push(footOut);
  }
  lines.push('  ' + H2('Feet:   ') + joinFeet(footDisplays, footCaes));

  const stressDisplays: string[] = [];
  const stressCaes: boolean[] = [];
  let rIdx = 0;
  for (const rawFoot of feetRaw) {
    let s = '';
    for (const ch of rawFoot) {
      if (ch === '-') { s += B_SILENT('_'); continue; }
      if (!isSyllableChar(ch)) continue;
      if (rIdx < linearSyls.length) {
        s += relColour(linearSyls[rIdx].relStress)(linearSyls[rIdx].relStress);
        rIdx++;
      }
    }
    const ck2 = caesurae.get(rIdx); if (ck2) s += ' ' + caesuraGlyph(ck2);
    stressCaes.push(!!ck2);
    stressDisplays.push(s);
  }
  lines.push('  ' + H2('Stress: ') + joinFeet(stressDisplays, stressCaes));
  lines.push('');

  // ── Layer 7: Dependencies ───────────────────────────────────────
  lines.push(H1('Dependencies'));
  lines.push('');
  for (const we of dedupedEntries) {
    const w = we.word;
    if (isPunctuation(w.lexicalClass)) continue;
    const dep = w.dependency;
    if (!dep) continue;
    if (dep.governorIndex === 0 || dep.dependentType === 'root') {
      lines.push('  ' + B_IU('ROOT →') + ' ' + W_CONTENT(w.word));
    } else {
      lines.push('  ' +
        W_FUNCTION(w.word.padEnd(12)) +
        W_DEP('←' + dep.dependentType + '← ') +
        W_CONTENT(dep.governorName)
      );
    }
  }
  lines.push('');

  // ── Layer 8: Summary ────────────────────────────────────────────
  lines.push(H1('Summary'));
  lines.push('');
  lines.push('  ' + H2('Meter:    ') + detail.meter + chalk.dim('  (' + detail.footCount + ' feet)') + consensusNote(detail) + rhythmNoteStr(detail));
  const rank = formatRanking(detail.ranking);
  lines.push('  ' + H2('Fit:      ') + chalk.yellow(detail.certainty + '%') + (rank ? '   ' + rank : ''));
  lines.push('  ' + H2('Scansion: ') + detail.scansion);
  lines.push('  ' + H2('Summary:  ') + detail.summary);
  lines.push('');

  // ── Layer 9: Scandroid comparison (if available) ────────────────
  if (result.scandroidCorral || result.scandroidMaximise) {
    lines.push(H1('Scandroid Comparison'));
    lines.push('');
    if (result.scandroidCorral) {
      lines.push('  ' + H2('CW: ') + result.scandroidCorral.scansion);
    }
    if (result.scandroidMaximise) {
      lines.push('  ' + H2('MN: ') + result.scandroidMaximise.scansion);
    }
    lines.push('');
  }

  // ── Layer 10: Reading projection (stress gradient over the input) ──
  // A reading-view-style colourisation of the verbatim input, so the finalised
  // analysis always shows "something that looks like the input".  Falls back to
  // the parsed surface forms when the raw line wasn't supplied.
  lines.push(H1('Reading Projection') + chalk.dim('  — stress gradient over the input'));
  lines.push('');
  const projection = rawLine && rawLine.trim()
    ? projectStressOntoLine(rawLine, words)
    : words.filter(w => !isPunctuation(w.lexicalClass)).map(w => colourToken(w.word, w)).join(' ');
  lines.push('  ' + projection);
  lines.push('');

  // ── Layer 11: Legend ────────────────────────────────────────────
  lines.push(HR_THIN);
  lines.push(renderLegend());
  lines.push(HR);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// LEGEND
// ═══════════════════════════════════════════════════════════════════════

export function renderLegend(): string {
  return [
    H2('Legend'),
    '  ' + B_CP('[]') + ' Clitic Phrase  ' + B_PP('{}') + ' Phonological Phrase  ' + B_IU('<>') + ' Intonational Unit',
    '  ' + LEX0('0') + LEX1('1') + LEX2('2') + LEX3('3') + '  Lexical stress (0=none 1=secondary 2=primary 3+=boosted)',
    '  ' + REL_X('x') + REL_W('w') + REL_N('n') + REL_M('m') + REL_S('s') + '  Relative stress (zero‑provision→weak→low→moderate→strong)',
    '  ' + W_CONTENT('content') + '  ' + W_FUNCTION('function') + '  Word class',
    '  ' + B_CAESURA('‖') + ' Caesura (phrasal break)  ' + B_CAESURA_SOFT('¦') + ' Inferred caesura  ' +
      B_FOOT('|') + ' Foot boundary  ' + B_SILENT('·') + ' Silent beat',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// GLOSSARIES — Penn POS tags & grammatical dependencies
// (For the long-form Display Legend [menu] and the per-line mini-legend in the
//  detailed views.  NOT shown in the compact in-output legend above.)
// ═══════════════════════════════════════════════════════════════════════

interface Gloss { name: string; eg: string; }

// Penn Treebank POS tags that FinNLP's en-pos tagger assigns to words (the tags
// shown as "(TAG)" in the Original Text / Phrasal Structure layers).  Pure
// punctuation/symbol/list tags (, : . ( ) # $ SYM LS) are intentionally omitted —
// they label no lexical word in the prosodic analysis.  Grouped by word class so
// the distinctions read clearly.
const POS_GROUPS: { label: string; tags: [string, Gloss][] }[] = [
  { label: 'Nouns', tags: [
    ['NN',   { name: 'noun, singular or mass',  eg: 'table, water, dust' }],
    ['NNS',  { name: 'noun, plural',            eg: 'tables, waters' }],
    ['NNP',  { name: 'proper noun, singular',   eg: 'London, Pound' }],
    ['NNPS', { name: 'proper noun, plural',     eg: 'Americans, Smiths' }],
  ]},
  { label: 'Verbs & modals', tags: [
    ['VB',   { name: 'verb, base form',                 eg: 'throw, eat, run' }],
    ['VBD',  { name: 'verb, past tense',                eg: 'threw, ate, ran' }],
    ['VBG',  { name: 'verb, gerund / present part.',    eg: 'throwing, eating' }],
    ['VBN',  { name: 'verb, past participle',           eg: 'thrown, eaten' }],
    ['VBP',  { name: 'verb, non-3rd-sg present',        eg: '(I) throw, run' }],
    ['VBZ',  { name: 'verb, 3rd-sg present',            eg: 'throws, runs' }],
    ['MD',   { name: 'modal',                           eg: 'can, will, must' }],
  ]},
  { label: 'Adjectives & adverbs', tags: [
    ['JJ',   { name: 'adjective',               eg: 'green, large' }],
    ['JJR',  { name: 'adjective, comparative',  eg: 'greener, larger' }],
    ['JJS',  { name: 'adjective, superlative',  eg: 'greenest, largest' }],
    ['RB',   { name: 'adverb',                  eg: 'quickly, very' }],
    ['RBR',  { name: 'adverb, comparative',     eg: 'faster, better' }],
    ['RBS',  { name: 'adverb, superlative',     eg: 'fastest, best' }],
  ]},
  { label: 'Determiners & numbers', tags: [
    ['DT',   { name: 'determiner',              eg: 'the, a, an' }],
    ['PDT',  { name: 'predeterminer',           eg: 'all (the books), both' }],
    ['CD',   { name: 'cardinal number',         eg: 'one, two, three' }],
  ]},
  { label: 'Pronouns', tags: [
    ['PRP',  { name: 'personal pronoun',        eg: 'I, you, he, they' }],
    ['PRP$', { name: 'possessive pronoun',      eg: 'my, your, their' }],
  ]},
  { label: 'Wh-words', tags: [
    ['WDT',  { name: 'wh-determiner',           eg: 'which, that' }],
    ['WP',   { name: 'wh-pronoun',              eg: 'who, what' }],
    ['WP$',  { name: 'possessive wh-pronoun',   eg: 'whose' }],
    ['WRB',  { name: 'wh-adverb',               eg: 'when, where, why' }],
  ]},
  { label: 'Function & other', tags: [
    ['IN',   { name: 'preposition / subord. conj.', eg: 'in, of, although' }],
    ['TO',   { name: 'infinitival "to"',            eg: 'to (go)' }],
    ['CC',   { name: 'coordinating conjunction',    eg: 'and, but, or' }],
    ['RP',   { name: 'particle',                    eg: 'up (give up), off' }],
    ['EX',   { name: 'existential "there"',         eg: 'there (is)' }],
    ['POS',  { name: 'possessive ending',           eg: "'s, '" }],
    ['UH',   { name: 'interjection',                eg: 'oh, wow, ah' }],
    ['FW',   { name: 'foreign word',                eg: 'je ne sais quoi' }],
  ]},
];

// Grammatical dependency relations AS THE TOOLKIT DISPLAYS THEM (the lowercase
// labels shown as "←label", after FinNLP's relations are mapped to the
// Antelope/Universal-Dependencies scheme in parser.ts).  Grouped by role.
const DEP_GROUPS: { label: string; deps: [string, Gloss][] }[] = [
  { label: 'Core arguments', deps: [
    ['nsubj',     { name: 'nominal subject',            eg: 'I like you' }],
    ['nsubjpass', { name: 'nominal subject (passive)',  eg: 'I was given a chance' }],
    ['dobj',      { name: 'direct object',              eg: 'I like you' }],
    ['iobj',      { name: 'indirect object',            eg: 'she gave me a book' }],
    ['pobj',      { name: 'object of preposition (oblique)', eg: 'to the children' }],
  ]},
  { label: 'Clausal relations', deps: [
    ['ccomp',     { name: 'clausal complement',         eg: 'ordered to dig' }],
    ['xcomp',     { name: 'open clausal complement',    eg: 'told us to dig' }],
    ['advcl',     { name: 'adverbial clause modifier',  eg: 'walking as rain fell' }],
    ['acl',       { name: 'clausal modifier of a noun', eg: 'the man you love' }],
  ]},
  { label: 'Modifiers', deps: [
    ['amod',      { name: 'adjectival modifier',        eg: 'good to him' }],
    ['advmod',    { name: 'adverbial modifier',         eg: 'genetically modified' }],
    ['nummod',    { name: 'numeric modifier',           eg: '2 eggs' }],
    ['nmod',      { name: 'nominal modifier',           eg: 'news of the market' }],
    ['poss',      { name: 'possessive / nominal mod.',  eg: "Senka's match" }],
    ['det',       { name: 'determiner',                 eg: 'the book' }],
  ]},
  { label: 'Function & markers', deps: [
    ['prep',      { name: 'case / preposition marker',  eg: 'went to Rome' }],
    ['aux',       { name: 'auxiliary',                  eg: 'am going' }],
    ['auxpass',   { name: 'auxiliary (passive)',        eg: 'have been marked' }],
    ['cc',        { name: 'coordinating conjunction',   eg: 'Matt and Alex' }],
    ['mark',      { name: 'clause / complement marker', eg: 'if I like it' }],
    ['prt',       { name: 'verb particle',              eg: 'switched it off' }],
    ['expl',      { name: 'expletive',                  eg: 'there is' }],
    ['discourse', { name: 'discourse element',          eg: 'I like that :)' }],
    ['intj',      { name: 'interjection',               eg: 'pass it, please' }],
  ]},
  { label: 'Other', deps: [
    ['root',      { name: 'root (head of the sentence)', eg: 'the main predicate' }],
    ['dep',       { name: 'unspecified dependency',      eg: '(unresolved)' }],
    ['punct',     { name: 'punctuation',                 eg: 'Guys, calm!' }],
  ]},
];

// Flat lookups (used by the per-line mini-legend).
const POS_GLOSS: Record<string, Gloss> = Object.fromEntries(POS_GROUPS.flatMap(g => g.tags));
const DEP_GLOSS: Record<string, Gloss> = Object.fromEntries(DEP_GROUPS.flatMap(g => g.deps));

/** A glossary row, padded on the RAW strings (so chalk colour codes don't skew
 *  alignment).  `tagWidth` is sized to the widest tag in the table. */
function glossRow(tag: string, g: Gloss, tagWidth: number): string {
  return '  ' + chalk.cyan(tag.padEnd(tagWidth)) + W_CONTENT(g.name.padEnd(32)) + chalk.dim('e.g. ' + g.eg);
}

/**
 * The long-form legend triggered from the main menu's "Display Legend" option:
 * the compact legend PLUS full Penn POS-tag and grammatical-dependency glossaries.
 * (These glossaries are deliberately NOT part of the compact in-output legend.)
 */
export function renderFullLegend(): string {
  const out: string[] = [];
  out.push(renderLegend());
  out.push('');
  out.push(HR_THIN);
  out.push(H1('Part-of-Speech Tags') + chalk.dim('  — Penn Treebank, as tagged by en-pos'));
  const posWidth = Math.max(...POS_GROUPS.flatMap(g => g.tags.map(([t]) => t.length))) + 2;
  for (const grp of POS_GROUPS) {
    out.push('');
    out.push('  ' + H2(grp.label));
    for (const [tag, g] of grp.tags) out.push(glossRow(tag, g, posWidth));
  }
  out.push('');
  out.push(HR_THIN);
  out.push(H1('Grammatical Dependencies') + chalk.dim('  — relation of each word to its governor (←label)'));
  const depWidth = Math.max(...DEP_GROUPS.flatMap(g => g.deps.map(([d]) => d.length))) + 2;
  for (const grp of DEP_GROUPS) {
    out.push('');
    out.push('  ' + H2(grp.label));
    for (const [dep, g] of grp.deps) out.push(glossRow(dep, g, depWidth));
  }
  return out.join('\n');
}

/**
 * A compact per-line mini-legend: only the POS tags and dependency relations that
 * actually occur in THIS line's parse, defined briefly (no examples), for the head
 * of the detailed view's Phrasal Structure section.  Fits in one or two lines.
 */
function renderLineGlossary(words: ClsWord[]): string[] {
  const posSeen: string[] = [];
  const depSeen: string[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    if (!posSeen.includes(w.lexicalClass)) posSeen.push(w.lexicalClass);
    const dep = w.dependency;
    if (dep && dep.governorIndex > 0 && dep.dependentType && !depSeen.includes(dep.dependentType)) {
      depSeen.push(dep.dependentType);
    }
  }
  // Concise gloss for the mini-legend: drop the comma/parenthesis qualifier that
  // the full legend carries ("noun, singular or mass" → "noun").
  const brief = (name: string): string => name.split(/,| \(/)[0].trim();
  const out: string[] = [];
  if (posSeen.length) {
    const items = posSeen.map(t => chalk.cyan(t) + chalk.dim('=') + W_FUNCTION(brief(POS_GLOSS[t]?.name ?? t)));
    out.push('  ' + chalk.dim('PoS  ') + items.join(chalk.dim(' · ')));
  }
  if (depSeen.length) {
    const items = depSeen.map(d => chalk.cyan(d) + chalk.dim('=') + W_FUNCTION(brief(DEP_GLOSS[d]?.name ?? d)));
    out.push('  ' + chalk.dim('Dep  ') + items.join(chalk.dim(' · ')));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// READING VIEW — original formatting, stress-gradient coloured per syllable
// ═══════════════════════════════════════════════════════════════════════

/** One input line with its (1+) parsed sentence results. */
export interface ReadingLine {
  raw: string;            // the original line text, verbatim
  results: LineResult[];  // a line may parse into more than one sentence
}

/** A stanza: a run of consecutive non-blank input lines. */
export interface ReadingStanza {
  lines: ReadingLine[];
}

/** Surface form reduced to bare lowercase letters (drops apostrophes/hyphens). */
function normWordForm(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

/** Colour each orthographic syllable of an original token by its relative stress. */
function colourToken(tokenText: string, word: ClsWord): string {
  const sylCount = Math.max(1, word.syllables.length);
   const chunks = syllabifyWord(tokenText, sylCount, syllableVowelLengths(word.syllables), word.morphSuffix, word.morphPrefix); // partitions the WHOLE token
  const stresses = chunks.map((_, i) => word.syllables[i]?.relativeStress ?? 'w');

  // Fast path: chunks reconstruct the token exactly (the common case).
  if (chunks.join('') === tokenText) {
    return chunks.map((c, i) => relColour(stresses[i])(c)).join('');
  }

  // Fallback: the syllabifier dropped a delimiter (it strips hyphens), so walk
  // the ORIGINAL token char-by-char, assigning each kept char to its syllable
  // by the chunk lengths and emitting dropped hyphens verbatim.  Every original
  // character is emitted exactly once, so nothing is ever lost.
  const lens = chunks.map(c => c.length);
  let out = '';
  let ci = 0;
  let consumed = 0;
  for (const ch of tokenText) {
    if (ch === '-') { out += ch; continue; }      // dropped delimiter, verbatim
    while (ci < lens.length - 1 && consumed >= lens[ci]) { ci++; consumed = 0; }
    out += relColour(stresses[ci])(ch);
    consumed++;
  }
  return out;
}

/**
 * Project per-syllable stress colours back onto the original line, preserving
 * capitalisation, punctuation, spacing and any extrametrical fragments the
 * pipeline dropped (e.g. possessive "'s").  Word-like tokens are coloured;
 * everything between them (spaces, punctuation, dashes) is emitted verbatim.
 *
 * Alignment is tolerant: it matches each token to the next parsed word by
 * normalised form (equal, or token starts with the word — handling "cat's"),
 * with a small look-ahead resync so a stray/unsyllabified token never derails
 * the rest of the line.  No original character is ever dropped.
 */
export function projectStressOntoLine(rawLine: string, words: ClsWord[]): string {
  const tokenRe = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  let out = '';
  let cursor = 0;
  let wi = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rawLine)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out += rawLine.slice(cursor, start);          // gap text, verbatim
    cursor = end;
    const token = m[0];
    const tokNorm = normWordForm(token);

    const matches = (w: ClsWord | undefined): boolean => {
      if (!w) return false;
      const wn = normWordForm(w.word);
      return wn.length > 0 && (tokNorm === wn || tokNorm.startsWith(wn));
    };

    if (matches(words[wi])) {
      out += colourToken(token, words[wi]);
      wi++;
    } else {
      // Resync: a parsed word may have been skipped (e.g. unsyllabified "'s").
      let found = -1;
      for (let k = wi; k < Math.min(words.length, wi + 4); k++) {
        if (matches(words[k])) { found = k; break; }
      }
      if (found >= 0) {
        out += colourToken(token, words[found]);
        wi = found + 1;
      } else {
        out += token; // leave verbatim; do not advance the word cursor
      }
    }
  }
  out += rawLine.slice(cursor);                    // trailing text, verbatim
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// CAESURA RENDERING  (placement logic now lives in caesura.ts)
// ═══════════════════════════════════════════════════════════════════════

/** Render the glyph for a caesura, coloured by its boundary strength (Wagner
 *  Ch.4–5): a strong break is a warm-red '‖', a medium one an orange '¦', a weak
 *  one a dim '·' — the same cold-blue→warm-red spectrum as the brackets. */
function caesuraGlyph(info: CaesuraInfo): string {
  const glyph = info.kind === 'hard' ? '‖' : '¦';
  if (info.strength < 0.34) return chalk.hex(gradHex(info.strength))('·');
  return chalk.hex(gradHex(info.strength)).bold(glyph);
}

/** Colour a scansion string ("nws|nns|-wns") letter-by-letter, inserting caesura
 *  marks (at foot boundaries) when a caesura map is supplied. */
function colourScansionMap(scansion: string, caesurae?: Map<number, CaesuraInfo>): string {
  let out = '';
  let sc = 0;                       // syllables emitted so far
  const emitted = new Set<number>();
  const caesAt = (): string => {
    if (caesurae && caesurae.has(sc) && !emitted.has(sc)) {
      emitted.add(sc);
      return ' ' + caesuraGlyph(caesurae.get(sc)!) + ' ';
    }
    return '';
  };
  for (const ch of scansion) {
    if (ch === '|') {
      const c = caesAt();
      out += c || B_FOOT('|');
    } else if (ch === '-') {
      out += B_SILENT('-');
    } else if ('xwnms'.includes(ch)) {
      out += caesAt();              // a (rare) mid-foot caesura, inserted inline
      out += relColour(ch as StressLevel)(ch);
      sc++;
    } else {
      out += ch;
    }
  }
  return out;
}

const METER_ABBR: Record<string, string> = {
  iambic: 'iamb', trochaic: 'troch', anapestic: 'anap', dactylic: 'dact',
  amphibrachic: 'amph', bacchic: 'bacch', spondaic: 'spon', pyrrhic: 'pyrr',
  'free verse': 'free',
};

// ── Meter-family colours ───────────────────────────────────────────
// One consistent, legible LIGHT tone per metre family, reused EVERYWHERE a
// metre is named (the reading per-line meter, the top-3 ranking, and the
// synopsis).  The foot-count label (pentameter / octameter…) stays white — we
// tint only the family word, so the output is informative without being gaudy.
const METER_HUE: Record<string, (s: string) => string> = {
  iambic:       chalk.hex('#7fb8ff'),  // light blue
  trochaic:     chalk.hex('#ffc24d'),  // yellow / orange
  dactylic:     chalk.hex('#88e0a0'),  // mid / light green
  amphibrachic: chalk.hex('#ff9ec4'),  // pinkish
  anapestic:    chalk.hex('#ff7a6b'),  // reddish
  bacchic:      chalk.hex('#c08be6'),  // purple / wine
  spondaic:     chalk.hex('#b8b8b8'),
  pyrrhic:      chalk.hex('#b8b8b8'),
};
const METER_FALLBACK = chalk.hex('#cfd8e3'); // free verse / unknown

/** Tint a metre-family WORD (the first token of a metre name) by its hue. */
function meterFamilyColour(family: string): (s: string) => string {
  return METER_HUE[family.toLowerCase()] ?? METER_FALLBACK;
}

/** Colour a full metre label ("iambic pentameter"): family tinted, foot-count
 *  label left white.  Bare "free verse" / multi-word non-families: fallback. */
function colourMeterLabel(meter: string): string {
  const sp = meter.indexOf(' ');
  if (sp < 0) return meterFamilyColour(meter)(meter);
  const family = meter.slice(0, sp);
  const hue = METER_HUE[family.toLowerCase()];
  if (!hue) return METER_FALLBACK(meter);
  return hue(family) + chalk.whiteBright(meter.slice(sp));
}

/** Tint every metre-family word/abbreviation occurring inside a free-form
 *  string (used to colour the synopsis values without restructuring them).
 *  Longest-first so "iamb" inside "iambic" is not matched before the full word. */
const _METER_WORD_RE = /\b(iambic|trochaic|dactylic|amphibrachic|anapestic|bacchic|spondaic|pyrrhic|iamb|troch|dact|amph|anap|bacch|spon|pyrr)\b/gi;
function tintMeterNames(s: string): string {
  return s.replace(_METER_WORD_RE, (w) => {
    const key = w.toLowerCase();
    const fam = key.startsWith('iamb') ? 'iambic' : key.startsWith('troch') ? 'trochaic'
      : key.startsWith('dact') ? 'dactylic' : key.startsWith('amph') ? 'amphibrachic'
      : key.startsWith('anap') ? 'anapestic' : key.startsWith('bacch') ? 'bacchic'
      : key.startsWith('spon') ? 'spondaic' : 'pyrrhic';
    return meterFamilyColour(fam)(w);
  });
}

/** Compact top-3 meter fit scores, e.g. "anap 0.81 · iamb 0.77 · amph 0.74" —
 *  each family abbreviation tinted its hue, the score dimmed, no enclosing
 *  parentheses (set off from the meter name by a dim "|" at the call site). */
function formatRanking(ranking?: MeterScore[]): string {
  if (!ranking || ranking.length === 0) return '';
  const top = ranking.slice(0, 3).map(r =>
    meterFamilyColour(r.meter)(METER_ABBR[r.meter] ?? r.meter) + chalk.dim(' ' + r.score.toFixed(2)));
  return top.join(chalk.dim(' · '));
}

/** Divergence notes.  After the continuity rename, a near-tie line's BASE
 *  meter is already the stanza/poem-dominant one and `standaloneMeter` records
 *  the numerically-best standalone reading ("≈ continuity; standalone:
 *  dactylic tetrameter").  `consensusMeter` survives only when the forced
 *  re-fit failed — then the old "aligns w/" annotation still applies. */
function consensusNote(detail: { consensusMeter?: string; standaloneMeter?: string }): string {
  if (detail.standaloneMeter) {
    return chalk.dim.italic(`  ≈ continuity; standalone: ${detail.standaloneMeter}`);
  }
  if (!detail.consensusMeter) return '';
  return chalk.dim.italic(`  ↔ aligns w/ stanza ${detail.consensusMeter}`);
}

/** Non-classical rhythm annotation (dolnik / taktovik / accentual), set by the
 *  rhythm layer.  Shown as a separate chip AFTER the meter — it supplements the
 *  classical reading (in beats), it never replaces it. */
function rhythmNoteStr(detail: { rhythmNote?: string }): string {
  if (!detail.rhythmNote) return '';
  const note = detail.rhythmNote;
  // Some notes (the 4/3 accentual) already carry a ♪; don't double it.
  return chalk.magenta.dim('  ' + (note.includes('♪') ? note : '♪ ' + note));
}

/** Rhyme chip for a line: the end-rhyme scheme letter with its rhyme TYPE
 *  (e.g. "A(perfect)"; '·' = unrhymed), PLUS any pre-caesural INTERNAL rhymes,
 *  each parenthesised and cyan with its own type, shown before the end letter:
 *  e.g. "(C)(perfect) A(perfect)". */
function rhymeStr(detail: {
  rhyme?: { letter: string; type?: string; internal?: { letter: string; type?: string }[] };
}): string {
  const r = detail.rhyme;
  if (!r) return '';
  const parts: string[] = [];
  for (const iw of r.internal ?? []) {
    parts.push(chalk.cyan(`(${iw.letter})`) + (iw.type ? chalk.dim(`(${iw.type})`) : ''));
  }
  if (r.letter && r.letter !== '·') {
    parts.push(chalk.yellowBright(r.letter) + (r.type ? chalk.dim(`(${r.type})`) : ''));
  } else if (parts.length === 0) {
    parts.push(chalk.dim('·'));
  }
  return '  ' + parts.join(' ');
}

/** Non-punctuation, syllable-bearing words across all of a line's sentences. */
function collectLineWords(ln: ReadingLine): ClsWord[] {
  const ws: ClsWord[] = [];
  for (const res of ln.results) {
    for (const w of res.sentence.words) {
      if (!isPunctuation(w.lexicalClass) && w.syllables.length > 0) ws.push(w);
    }
  }
  return ws;
}

/**
 * The Phonopoetics block of the synopsis: end / caesural / head rhymes (each
 * letter coloured by the strongest relative-stress tier it spans), alliteration,
 * and acrostics.  Only subsections actually present in the poem are shown.
 */
function renderPhonopoetics(p: Phonopoetics): string[] {
  // a rhyme pair "word [A|L1(|kind)] -> word [A|L4]", letter tinted by top stress
  const rel = (r: RhymeRel): string => {
    const L = relColour(r.topStress)(r.letter);
    const D = chalk.dim;
    const kindTag = r.kind === 'end' ? '' : D('|' + r.kind);
    const typ = r.type ? D(` ${r.type}`) : '';
    return chalk.white(r.fromWord) + ' ' + D('[') + L + D('|') + D(r.fromLabel) + kindTag + D(']')
      + D(' → ') + chalk.white(r.toWord) + ' ' + D('[') + L + D('|') + D(r.toLabel) + D(']') + typ;
  };
  const SEP = chalk.dim('  ·  ');
  const sub: { label: string; body: string }[] = [];
  if (p.end.length)       sub.push({ label: 'End-Rhymes',      body: p.end.map(rel).join(SEP) });
  if (p.caesural.length)  sub.push({ label: 'Caesural Rhymes', body: p.caesural.map(rel).join(SEP) });
  if (p.head.length)      sub.push({ label: 'Head Rhymes',     body: p.head.map(rel).join(SEP) });
  if (p.alliteration.length) sub.push({
    label: 'Alliteration',
    body: p.alliteration.map(a => chalk.white(a.words.join(' ')) + chalk.dim(` (${a.label})`)).join(SEP),
  });
  if (p.acrostics.length) sub.push({
    label: 'Acrostic',
    body: p.acrostics.map(a =>
      a.firsts.map((f, i) => chalk.dim('[' + a.labels[i] + ':') + chalk.whiteBright(f) + chalk.dim(']')).join('')
      + chalk.dim(' → ') + chalk.yellowBright(a.word)).join(SEP),
  });
  if (sub.length === 0) return [];

  const out: string[] = ['', chalk.bold.cyan('Phonopoetics:')];
  const w = Math.max(...sub.map(s => s.label.length)) + 2;
  for (const s of sub) out.push('  ' + chalk.bold((s.label + ':').padEnd(w)) + s.body);
  return out;
}

/**
 * Reading view: the poem itself in its original formatting, each syllable
 * coloured by 4-tier relative stress, followed by a same-structure block of
 * per-line stress maps + meter (with top-3 fit scores).  This is the whole
 * output for this mode — not the full per-line analytic dump.
 */
/** A verse line CLOSED by terminal or clause punctuation is END-STOPPED (a
 *  prosodic pause at the line break); one ending on a word with no boundary
 *  punctuation RUNS ON — enjambment — its intonational unit spilling into the
 *  next line.  (Trailing quotes/brackets are ignored when judging the close.) */
function lineRunsOn(raw: string): boolean {
  const t = raw.replace(/["'’”»)\]]+$/, '').trimEnd();
  if (!t) return false;
  return !/[.!?;:,—–…]$/.test(t);
}

/** Poem-wide enjambment summary (end-stopped vs run-on line-ends), or null for
 *  a single line.  The final line is terminal by position, so only the
 *  line-INTERNAL breaks (lines 1..n-1) are judged. */
function summariseEnjambment(stanzas: ReadingStanza[]): string | null {
  const raws = stanzas.flatMap(st => st.lines.map(l => l.raw));
  if (raws.length < 2) return null;
  const interior = raws.slice(0, -1);
  const enjambed: number[] = [];
  interior.forEach((r, i) => { if (lineRunsOn(r)) enjambed.push(i + 1); });
  const n = interior.length, k = enjambed.length;
  if (k === 0) return 'end-stopped throughout';
  const where = k <= 6 ? ' (lines ' + enjambed.join(', ') + ')' : '';
  return k >= Math.ceil(n / 2)
    ? `predominantly enjambed — ${k} of ${n} line-ends run on${where}`
    : `mostly end-stopped — ${k} of ${n} line-ends enjambed${where}`;
}

export function renderReadingView(stanzas: ReadingStanza[]): string {
  const out: string[] = [];
  const multiStanza = stanzas.length > 1;

  out.push('');
  out.push(HR);
  out.push(H1('Reading View') + chalk.dim('  — stress gradient over input text'));
  out.push('');

  // ── Block 1: the poem, original formatting, syllables coloured ──
  // Multi-stanza poems get a right-aligned "Stanza N" counter in the blank line
  // before each stanza after the first (the gaps between stanzas).
  for (let s = 0; s < stanzas.length; s++) {
    if (multiStanza && s > 0) {
      out.push('');
      out.push(chalk.dim.italic(('Stanza ' + (s + 1)).padStart(HR.length)));
    }
    for (const ln of stanzas[s].lines) {
      out.push(projectStressOntoLine(ln.raw, collectLineWords(ln)));
    }
  }

  out.push('');
  out.push(HR_THIN);
  out.push(H1('Stress Maps, Meter, & Rhymes') + chalk.dim('  — top-3 fit scores per line'));
  out.push('');

  // ── Block 2: stress maps + meter, same stanza/line structure ──
  for (let s = 0; s < stanzas.length; s++) {
    const firstDetail = stanzas[s].lines.flatMap(l => l.results)[0]?.phonologicalScansion;
    const formNote = firstDetail?.formNote ? chalk.green.dim('  ❡ ' + firstDetail.formNote) : '';
    if (multiStanza) out.push(H2('Stanza ' + (s + 1)) + formNote);
    else if (formNote) out.push(formNote.trim());
    for (let l = 0; l < stanzas[s].lines.length; l++) {
      const ln = stanzas[s].lines[l];
      const baseLabel = multiStanza ? `S${s + 1}L${l + 1}` : `L${l + 1}`;
      if (ln.results.length === 0) {
        out.push('  ' + chalk.dim(baseLabel.padEnd(8) + '(no parse)'));
        continue;
      }
      for (let r = 0; r < ln.results.length; r++) {
        const res = ln.results[r];
        const d = res.phonologicalScansion;
        const label = ln.results.length > 1 ? `${baseLabel}.${r + 1}` : baseLabel;
        const caesurae = computeCaesurae(res.sentence.words, res.phonologicalHierarchy, d.scansion);
        const map = colourScansionMap(d.scansion, caesurae);
        const rank = formatRanking(d.ranking);
        out.push('  ' + chalk.bold(label.padEnd(8)) + map + '  ' +
          colourMeterLabel(d.meter) + (rank ? chalk.dim(' | ') + rank : '') + consensusNote(d) + rhythmNoteStr(d) + rhymeStr(d));
      }
    }
    if (multiStanza && s < stanzas.length - 1) out.push('');
  }

  // ── Block 3: Legend ──
  // Kept ABOVE the synopsis: the legend serves the Stress Maps & Meter, and the
  // Phonopoetics subsection of the synopsis below can run long — left at the
  // bottom it gets pushed out of the field of view.
  out.push('');
  out.push(HR_THIN);
  out.push(renderLegend());

  // ── Block 4: cumulative poem synopsis (non-interfering meta-measure) ──
  // Several top conclusions about the poem as a whole, drawn only from the
  // per-line determinations above — never overriding any of them.
  const synopsis = summarizePoem(stanzas.map(st => st.lines.flatMap(l => l.results)));
  if (synopsis.length > 0) {
    out.push('');
    out.push(HR_THIN);
    out.push(H1('Poem Synopsis') + chalk.dim(' In short, we have:'));
    out.push('');
    const w = Math.max(...synopsis.map(r => r.label.length)) + 2;
    for (const row of synopsis) {
      const label = chalk.bold.cyan((row.label + ':').padEnd(w));
      // Colour the value so the block is not a wall of white: tint any metre
      // names their family hue, and highlight the mean-fit %.
      let val = tintMeterNames(row.value);
      if (row.label === 'Meter') val = val.replace(/~\d+%/, (m) => chalk.yellow(m));
      out.push('  ' + label + val);
    }
    // Enjambment / end-stop — a poem-wide reading of the line-ends.
    const enj = summariseEnjambment(stanzas);
    if (enj) out.push('  ' + chalk.bold.cyan('Enjambment:'.padEnd(w)) + chalk.dim(enj));
    // Phonopoetics — end / caesural / head rhymes, alliteration, acrostic.
    out.push(...renderPhonopoetics(analyzePhonopoetics(stanzas.map(st => st.lines.flatMap(l => l.results)))));
  }

  out.push('');
  out.push(HR);
  return out.join('\n');
}

```

## engine.ts

```typescript
// engine.ts — the prosody-engine abstraction (type-only; no runtime deps, so
// the concrete engines can import this without a cycle).
//
// Two engines produce the SAME shape — a per-sentence prosodic hierarchy with
// lexical/phrase/relative stress populated on the words:
//   • "calliope" — the faithful, default, syntax-driven rebuild (Match-Theory
//     hierarchy + Scenario A–O relation-keyed stress);
//   • "clio"     — a frozen snapshot of the prior pipeline, the legacy /
//     alternative parse, selectable via the CLI.
// Everything downstream (metrical scoring, rhyme/form, display, synopsis) is
// shared and engine-agnostic.

import { ClsSentence, IntonationalUnit } from './types.js';

export type EngineName = 'calliope' | 'clio';

export interface ProsodyEngine {
  readonly name: EngineName;
  /** Populate lexical/phrase/relative stress on `sent.words` and return the
   *  sentence's intonational units (the prosodic hierarchy). */
  analyzeSentence(sent: ClsSentence): IntonationalUnit[];
}

```

## index.ts

```typescript
#!/usr/bin/env node
import * as fs from 'fs';
import * as readline from 'readline';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { parseDocument, isPunctuation } from './parser.js';
import { ProsodyEngine } from './engine.js';
import { calliopeEngine } from './calliope/engine.js';
import { clioEngine } from './clio/engine.js';
// The FROZEN Clio pipeline + renderers (its own copy of the whole computational
// tree).  When Clio is active the CLI runs entirely through these, so live changes
// to the regular (Calliope) pipeline — scorer included — cannot affect Clio.
import {
  analyzeReadingDocumentClio,
  renderUnifiedDisplay as clioRenderUnifiedDisplay,
  renderReadingView as clioRenderReadingView,
  renderFullLegend as clioRenderFullLegend,
  parseDocument as clioParseDocument,
  isPunctuation as clioIsPunctuation,
} from './clio/pipeline.js';
import {
  renderHierarchy,
  renderKeyStresses,
  flattenDisplayEntries,
} from './phonological.js';
import { extractKeyStresses, scoreMeters, applyStanzaConsensus, applyRhythmLayer, applyMetricalityLayer } from './scansion.js';
import { applyRhymeAndForm } from './rhyme.js';
import {
  scandroidCorralWeird,
  scandroidMaximizeNormal,
  stressToMarks,
} from './scandroid.js';
import {
  renderUnifiedDisplay,
  renderFullLegend,
  renderReadingView,
  type ReadingStanza,
} from './display.js';
import type {
  ClsSentence,
  ClsWord,
  MetreName,
  IntonationalUnit,
  StressLevel,
  ScansionResult,
  LineResult,
  PhonologicalScansionDetail,
  SyllableDisplayEntry,
  FootDisplayEntry,
  FormattedDisplay,
  DisplayOptions,
} from './types.js';

// The active prosody engine for this process: Calliope (faithful, default) or
// Clio (the frozen legacy / alternative parse), chosen by `--clio` or the REPL
// menu.  The exported analysis functions default their `engine` parameter to
// this, so library callers (tests, trials, benchmark) transparently use the
// active engine without signature churn.
let activeEngine: ProsodyEngine = calliopeEngine;

/**
 * Stanza-level discourse givenness (Wagner Ch.7, the plan's Gap 13) — CAREFUL and
 * cross-line only.  A CONTENT word repeated from an EARLIER line of the same stanza
 * is discourse-given, so it may be subordinated relative to a new-information sister
 * (the relativiser reads `discourseGiven`).  Constraints that protect single-line
 * scanning and thematically-focused words:
 *   • the first line is never marked (no prior context);
 *   • a lemma repeated WITHIN a single line is FOCUSED, not given → never marked
 *     (Eliot's "Nothing … nothing", a refrain);
 *   • only the 2nd-and-later occurrence (across lines) is marked, never the first;
 *   • single-line input has no previous line, so nothing is marked — the standout
 *     isolated-line feature is untouched.
 * Mutates `discourseGiven` on the words; must run BEFORE the per-line relativisation.
 */
function markStanzaGivenness(docPerLine: ClsSentence[][]): void {
  if (docPerLine.length < 2) return;                       // single line → no givenness
  const key = (w: ClsWord) => w.word.toLowerCase().replace(/['’]/g, '');
  // Lemmas that appear ≥2× within ANY one line are focal (refrain/emphasis) — exempt.
  const focal = new Set<string>();
  for (const sents of docPerLine) {
    const counts = new Map<string, number>();
    for (const sent of sents) for (const w of sent.words) {
      if (!w.isContent) continue;
      const k = key(w);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, n] of counts) if (n >= 2) focal.add(k);
  }
  const seen = new Set<string>();                          // content lemmas in PRIOR lines
  for (const sents of docPerLine) {
    const thisLine = new Set<string>();
    for (const sent of sents) for (const w of sent.words) {
      if (!w.isContent) continue;
      const k = key(w);
      if (seen.has(k) && !focal.has(k)) w.discourseGiven = true;
      thisLine.add(k);
    }
    for (const k of thisLine) seen.add(k);
  }
}

/**
 * Scan one VERSE LINE (which may parse into several grammatical sentences).
 *
 * The line — not the sentence — is the metrical domain (McAleese; Kiparsky's
 * "phonological phrasing determines the location of caesurae in verse").  A
 * line like "You'll slurp potato soup. No straws! Suck gauze." is ONE iambic
 * pentameter with internal intonational breaks, not three fragments each
 * carrying its own meter.  So the linguistic passes (lexical stress, phrasal
 * hierarchy, compound/nuclear/relative stress) run per sentence — those rules
 * are intra-sentence by nature — but the metrical fit runs once over the
 * line's full concatenated syllable stream, with each sentence's IUs preserved
 * as IU boundaries (→ hard caesurae) inside the line.
 */
function processLine(sents: ClsSentence[], engine: ProsodyEngine = activeEngine): LineResult | null {
  if (sents.length === 0) return null;

  const iusPerSent: IntonationalUnit[][] = [];
  for (const sent of sents) {
    // The selected engine runs the per-sentence linguistic passes (lexical →
    // hierarchy → compound/nuclear → phrase → relative stress) and returns the
    // prosodic hierarchy.  Calliope (default) and Clio differ only here.
    const sentIus = engine.analyzeSentence(sent);
    iusPerSent.push(sentIus);
  }

  // Merge the sentences' streams into the line-level scansion domain.
  const words = sents.flatMap(s => s.words);
  const ius = iusPerSent.flat();
  let merged: ClsSentence;
  if (sents.length === 1) {
    merged = sents[0];
  } else {
    // Re-index sequentially so per-sentence 1-based indices don't collide in
    // any downstream order-by-index logic.  (All hierarchy/dependency passes
    // above are already complete and reference words by object identity.)
    words.forEach((w, i) => { w.index = i + 1; });
    merged = {
      index: sents[0].index,
      nodes: null,
      dependencies: sents.flatMap(s => s.dependencies),
      words,
      xml: '',
    };
  }

  const keyStresses = extractKeyStresses(ius, words);

  // Full phonological scansion over the whole line.
  const phonoDetail = scoreMeters(keyStresses, words, ius);
  phonoDetail.all = renderHierarchy(ius, words);
  phonoDetail.keyStresses = renderKeyStresses(ius, words, keyStresses);

  // Scandroid – use the actual foot count from the phonological detection
  const stressPattern: StressLevel[] = words.flatMap((w) =>
    w.syllables.map((s) => s.relativeStress ?? 'w')
  );
  const marks = stressToMarks(stressPattern);
  const actualFeet = phonoDetail.footCount > 0 ? phonoDetail.footCount : 5; // fallback only if unknown
  const corral = scandroidCorralWeird(marks, actualFeet);
  const max = scandroidMaximizeNormal(marks, actualFeet);

  const corralResult: ScansionResult | undefined = corral.footlist.length
    ? {
        meter: 'iambic',
        scansion: corral.footlist.map(f => f.replace(/[()]/g, '')).join(' | '),
        certainty: 0,
        weightScore: 0,
        maxPossibleWeight: 0,
        algorithm: 'Scandroid Corral the Weird',
      }
    : undefined;
  const maxResult: ScansionResult | undefined = max.footlist.length
    ? {
        meter: 'iambic',
        scansion: max.footlist.map(f => f.replace(/[()]/g, '')).join(' | '),
        certainty: 0,
        weightScore: 0,
        maxPossibleWeight: 0,
        algorithm: 'Scandroid Maximise the Normal',
      }
    : undefined;

  return {
    sentence: merged,
    phonologicalHierarchy: ius,
    keyStresses,
    phonologicalScansion: phonoDetail,
    scandroidCorral: corralResult,
    scandroidMaximise: maxResult,
  };
}

/**
 * Analyse a multi‑line text with stanza awareness.
 * Returns a list of stanza arrays, each containing the per‑line results.
 */

/**
 * Continuity rename (maintainer directive 2026-06-14): a line whose standalone
 * meter merely edges out the stanza/poem-dominant meter (consensusMeter set by
 * applyStanzaConsensus) ADOPTS the dominant meter as its base reading — the
 * scansion, foot count, and certainty are re-fitted under that meter — and the
 * numerically-best standalone meter is kept as a concise note
 * (`standaloneMeter`).  Metrical continuity outranks a hair of fit score.
 */
function applyContinuityRename(results: LineResult[]): void {
  // A stanza-level rhythm verdict (set on at least half the lines) means the
  // group reads as accentual/dolnik/taktovik — classical continuity renaming
  // does not apply there.
  const noted = results.filter(r => r.phonologicalScansion.rhythmNote).length;
  if (results.length > 0 && noted >= results.length / 2) return;
  for (const res of results) {
    const d = res.phonologicalScansion;
    if (!d.consensusMeter) continue;
    const family = d.consensusMeter.split(' ')[0] as MetreName;
    const forced = scoreMeters(res.keyStresses, res.sentence.words, res.phonologicalHierarchy, family);
    if (!forced || forced.meterName === 'free verse' || forced.footCount <= 0) continue;
    d.standaloneMeter = d.meter;
    d.meter = forced.meter;
    d.meterName = forced.meterName;
    d.footCount = forced.footCount;
    d.scansion = forced.scansion;
    d.certainty = forced.certainty;
    d.summary = forced.summary;
    d.consensusMeter = undefined;
  }
}

export function analyzeStanzas(text: string, useScandroid = true, engine: ProsodyEngine = activeEngine): LineResult[][] {
  const stanzas = text.split(/\n\s*\n/);
  const results: LineResult[][] = [];
  for (const stanza of stanzas) {
    const lines = stanza.split('\n').filter(l => l.trim() !== '');
    const stanzaResults: LineResult[] = [];
    // Parse every line first, then mark cross-line discourse givenness BEFORE the
    // per-line stress passes (relativisation reads `discourseGiven`).  Only the
    // default (Calliope) relativiser consults it; Clio ignores the flag.
    const docs = lines.map(line => parseDocument(line));
    markStanzaGivenness(docs.map(d => d.sentences));
    for (const doc of docs) {
      const res = processLine(doc.sentences, engine);
      if (res) stanzaResults.push(res);
    }
    // Resolve near-tie lines toward the stanza's dominant meter (explicit, non-
    // destructive: annotates phonologicalScansion.consensusMeter), then classify
    // non-classical rhythm (dolnik/taktovik/accentual → rhythmNote; ballad is a
    // FORM verdict and belongs to the rhyme-aware form layer).
    applyStanzaConsensus(stanzaResults.map(r => r.phonologicalScansion));
    // Classical-vs-accentual is decided FIRST (rhythm layer); continuity
    // renaming applies only where no stanza-level accentual/dolnik verdict
    // fired — otherwise the rename would snowball weak scattered classical
    // readings into false dominance (Wyatt lost its "4-beat accentual").
    applyRhythmLayer(stanzaResults.map(r => r.phonologicalScansion));
    applyContinuityRename(stanzaResults);
    results.push(stanzaResults);
  }
  // Poem-scale continuity: lines left un-renamed (their own stanza had no
  // unique dominant) get a second chance against the poem-wide dominant.
  if (results.length > 1) {
    const all = results.flat();
    applyStanzaConsensus(all.map(r => r.phonologicalScansion));
    applyContinuityRename(all);
    for (const st of results) applyRhythmLayer(st.map(r => r.phonologicalScansion));
  }
  // Prose-likeness hedge (Option 0): advisory, runs after the rhythm layer so it
  // can defer to any accentual/dolnik verdict; annotation-only (metricalityNote).
  applyMetricalityLayer(results.flatMap(st => st.map(r => r.phonologicalScansion)));
  // Rhyme scheme + poetic-form identification spans stanzas (sonnets, terza
  // rima); annotation-only (rhyme/formNote on each line's detail).
  applyRhymeAndForm(results);
  return results;
}

/**
 * Convenience wrapper: analyse a multi‑line text, ignore stanza breaks,
 * return a flat list of LineResult for each line.
 */
export function analyzeText(text: string, useScandroid = true, engine: ProsodyEngine = activeEngine): LineResult[] {
  const stanzaResults = analyzeStanzas(text, useScandroid, engine);
  return stanzaResults.flat();
}

/**
 * Analyse a document for the reading view: like analyzeStanzas, but retains
 * each original input line alongside its (1+) parsed sentence results so the
 * stress gradient can be projected back over the verbatim text.
 */
export function analyzeReadingDocument(text: string, engine: ProsodyEngine = activeEngine): ReadingStanza[] {
  const stanzas = text.split(/\n\s*\n/);
  const out: ReadingStanza[] = [];
  for (const stanza of stanzas) {
    const rawLines = stanza.split('\n').filter(l => l.trim() !== '');
    if (rawLines.length === 0) continue;
    const rawDocs = rawLines.map(raw => ({ raw, doc: parseDocument(raw) }));
    markStanzaGivenness(rawDocs.map(rd => rd.doc.sentences));
    const lines = rawDocs.map(({ raw, doc }) => {
      const res = processLine(doc.sentences, engine);
      return { raw, results: res ? [res] : [] };
    });
    applyStanzaConsensus(lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
    applyRhythmLayer(lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
    applyContinuityRename(lines.flatMap(l => l.results));
    out.push({ lines });
  }
  if (out.length > 1) {
    const all = out.flatMap(st => st.lines.flatMap(l => l.results));
    applyStanzaConsensus(all.map(r => r.phonologicalScansion));
    applyContinuityRename(all);
    for (const st of out) applyRhythmLayer(st.lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
  }
  applyMetricalityLayer(out.flatMap(st => st.lines.flatMap(l => l.results.map(r => r.phonologicalScansion))));
  applyRhymeAndForm(out.map(st => st.lines.flatMap(l => l.results)));
  return out;
}

// ─── CLI HELPERS ────────────────────────────────────────────────

function showResults(text: string): void {
  // Use the reading-document analysis so each LineResult keeps its verbatim input
  // line (for the tail Reading Projection) and the stanza-consensus annotation.
  // Clio routes through its own frozen pipeline + renderer.
  const isClio = activeEngine.name === 'clio';
  const stanzas = (isClio ? analyzeReadingDocumentClio : analyzeReadingDocument)(text);
  const render = isClio ? clioRenderUnifiedDisplay : renderUnifiedDisplay;

  for (let s = 0; s < stanzas.length; s++) {
    if (stanzas.length > 1) {
      console.log('\n' + chalk.bold('═══ Stanza ' + (s + 1) + ' ═══'));
    }
    for (const ln of stanzas[s].lines) {
      for (const res of ln.results) {
        console.log(render(res, ln.raw));
      }
    }
  }
}

function showReadingView(text: string): void {
  const isClio = activeEngine.name === 'clio';
  const stanzas = (isClio ? analyzeReadingDocumentClio : analyzeReadingDocument)(text);
  console.log((isClio ? clioRenderReadingView : renderReadingView)(stanzas));
}

// ─── MULTI-LINE INPUT (paste-friendly) ──────────────────────────
// Goal: the user pastes a whole poem (stanza breaks and all) and presses Enter
// ONCE to scan it; Esc returns to the menu.  The trick is distinguishing a blank
// line that is a *stanza break* (part of the pasted burst) from a blank line that
// means *"I'm done"* (a deliberate, later keystroke).  A paste streams in as one
// rapid burst (sub-ms between lines); a human Enter comes after a real pause.  So
// once a burst has been seen, the next Enter that arrives after an idle gap
// submits — flushing the current line whether or not the paste ended in a newline.
// The pure decision below is unit-tested (a TTY can't be driven from CI).

export const ML_IDLE_MS = 120;

export type MLEvent =
  | { kind: 'char'; str: string; gap: number }
  | { kind: 'return'; gap: number }
  | { kind: 'backspace'; gap: number }
  | { kind: 'escape' }
  | { kind: 'eof' };

export interface MLState { lines: string[]; cur: string; sawBurst: boolean; }
export type MLResult = 'continue' | 'submit' | 'cancel';

export function newMLState(): MLState { return { lines: [], cur: '', sawBurst: false }; }

function mlHasContent(st: MLState): boolean {
  return st.cur.trim() !== '' || st.lines.some(l => l.trim() !== '');
}

/**
 * Fold one input event into the multi-line buffer, returning whether to keep
 * reading ('continue'), scan the buffer ('submit'), or abandon it ('cancel').
 *  • A burst-speed Enter (gap < ML_IDLE_MS) is always a line break — so pasted
 *    stanza-break blank lines are preserved.
 *  • After a burst, the first idle Enter submits (flushing any pending line).
 *  • With no burst (slow hand-typing), a non-empty line + Enter is a line break and
 *    a blank line submits — the conventional "blank line to finish".
 *  • Esc cancels (→ menu); Ctrl-D submits whatever is there.
 */
export function feedMultilineEvent(st: MLState, ev: MLEvent): MLResult {
  switch (ev.kind) {
    case 'escape':
      return 'cancel';
    case 'eof':
      if (st.cur.length) { st.lines.push(st.cur); st.cur = ''; }
      return mlHasContent(st) ? 'submit' : 'cancel';
    case 'backspace':
      if (st.cur.length) st.cur = st.cur.slice(0, -1);
      return 'continue';
    case 'char': {
      if (ev.gap < ML_IDLE_MS) st.sawBurst = true;
      // A pasted chunk may arrive with embedded newlines in one event.
      const parts = ev.str.split(/\r\n|\r|\n/);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) { st.lines.push(st.cur); st.cur = ''; }
        st.cur += parts[i];
      }
      return 'continue';
    }
    case 'return': {
      if (ev.gap < ML_IDLE_MS) {           // burst-speed → a line break (keep blanks)
        st.sawBurst = true;
        st.lines.push(st.cur); st.cur = '';
        return 'continue';
      }
      // Deliberate (idle) Enter.
      if (st.sawBurst || st.cur.trim() === '') {
        if (st.cur.length) { st.lines.push(st.cur); st.cur = ''; }
        return mlHasContent(st) ? 'submit' : 'continue';
      }
      // Slow hand-typing of a fresh non-empty line → just a line break.
      st.lines.push(st.cur); st.cur = '';
      return 'continue';
    }
  }
}

/** Strip trailing blank lines (e.g. a paste's trailing newline) from a buffer. */
function trimTrailingBlanks(lines: string[]): string[] {
  const out = lines.slice();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/**
 * Read a pasteable multi-line block from the TTY in raw mode (so Esc and the
 * paste-burst timing are observable).  Resolves to the lines, or null if the user
 * pressed Esc (→ return to menu).
 */
async function readPastableBlock(): Promise<string[] | null> {
  const stdin = process.stdin;
  return new Promise<string[] | null>((resolve) => {
    const st = newMLState();
    let lastTime = Date.now();
    readline.emitKeypressEvents(stdin);
    const wasRaw = !!(stdin as any).isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    const onKey = (str: string | undefined, key: any) => {
      const now = Date.now();
      const gap = now - lastTime;
      lastTime = now;
      key = key || {};
      if (key.ctrl && key.name === 'c') {                  // Ctrl-C → quit
        cleanup(); process.stdout.write('\n'); process.exit(0);
      }
      let ev: MLEvent | null = null;
      if (key.name === 'escape') ev = { kind: 'escape' };
      else if (key.ctrl && key.name === 'd') ev = { kind: 'eof' };
      else if (key.name === 'return' || key.name === 'enter') ev = { kind: 'return', gap };
      else if (key.name === 'backspace') ev = { kind: 'backspace', gap };
      else if (str && !key.ctrl && !key.meta) ev = { kind: 'char', str, gap };
      if (!ev) return;                                     // ignore arrows / fn keys
      // Echo (raw mode does not echo for us).
      if (ev.kind === 'char') process.stdout.write(str!);
      else if (ev.kind === 'return') process.stdout.write('\n');
      else if (ev.kind === 'backspace' && st.cur.length) process.stdout.write('\b \b');

      const result = feedMultilineEvent(st, ev);
      if (result === 'submit') { cleanup(); process.stdout.write('\n'); resolve(st.lines); }
      else if (result === 'cancel') { cleanup(); process.stdout.write('\n'); resolve(null); }
    };

    function cleanup() {
      stdin.removeListener('keypress', onKey);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
    }
    stdin.on('keypress', onKey);
  });
}

async function replMode(): Promise<void> {
  const prompts = (await import('prompts')).default;

  console.log('');
  console.log(chalk.bold('     CALLIOPE_TS — Phonological Poetry Scansion (CLI)  '));
  console.log(chalk.dim('• Multi-Step Syntactic, Phonological, & Prosodic Analysis •'));
  console.log('');

  let running = true;
  while (running) {
    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'Choose an action:',
      choices: [
        { title: 'Parse & Scan (multi-line reading view)', value: 'reading-multi' },
        { title: 'Single Line Analysis (detailed view)', value: 'scan' },
        { title: 'Line-by-Line Analysis (detailed view)', value: 'multiline' },
        { title: 'Parse & Scan from File (reading view)', value: 'reading-file' },
        { title: 'Analyze from File (detailed view)', value: 'file' },
        { title: 'Ask Clio instead (alternative parse) — toggle engine', value: 'engine' },
        { title: 'Display Legend', value: 'legend' },
        { title: 'Exit', value: 'exit' },
      ],
    });

    if (!response.action || response.action === 'exit') {
      running = false;
      console.log(chalk.dim('\nGoodbye.\n'));
      break;
    }

    if (response.action === 'engine') {
      // Toggle between Calliope (faithful, default) and Clio (the legacy /
      // alternative parse).  Clio is Calliope's historian sister — sometimes
      // on point, but not the primary poetic voice.
      activeEngine = activeEngine.name === 'calliope' ? clioEngine : calliopeEngine;
      const label = activeEngine.name === 'clio'
        ? 'Clio — legacy / alternative parse'
        : 'Calliope — faithful, default';
      console.log(chalk.dim(`\n  Active engine: ${chalk.bold(label)}\n`));
      continue;
    }

    if (response.action === 'legend') {
      const legend = activeEngine.name === 'clio' ? clioRenderFullLegend : renderFullLegend;
      console.log('\n' + legend() + '\n');
      continue;
    }

    if (response.action === 'scan') {
      const lineResponse = await prompts({
        type: 'text',
        name: 'line',
        message: 'Enter a line of verse:',
      });
      if (lineResponse.line && lineResponse.line.trim()) {
        try {
          showResults(lineResponse.line.trim());
        } catch (err) {
          console.error(chalk.red('Error during scansion:'), err);
        }
      }
      continue;
    }

    if (response.action === 'file' || response.action === 'reading-file') {
      const render = response.action === 'reading-file' ? showReadingView : showResults;
      const fileResponse = await prompts({
        type: 'text',
        name: 'path',
        message: 'Enter file path:',
      });
      if (fileResponse.path && fileResponse.path.trim()) {
        try {
          const text = fs.readFileSync(fileResponse.path.trim(), 'utf-8');
          render(text);
        } catch (err) {
          console.error(chalk.red('Error reading file:'), err);
        }
      }
      continue;
    }

    if (response.action === 'multiline' || response.action === 'reading-multi') {
      const render = response.action === 'reading-multi' ? showReadingView : showResults;
      console.log(chalk.dim('Paste your poem and press Enter to scan it.   (Esc to cancel)'));
      const block = await readPastableBlock();
      if (block === null) continue;          // Esc → back to the menu
      const lines = trimTrailingBlanks(block);
      if (lines.length > 0) {
        try {
          render(lines.join('\n'));
        } catch (err) {
          console.error(chalk.red('Error during scansion:'), err);
        }
      }
      continue;
    }
  }
}

// ─── PARSE-AUDIT DIAGNOSTIC ──────────────────────────────────────
//
// `--debug-parse` dumps, per word, the full chain the scansion rests on: POS
// tag, dependency role + governor, prosodic membership (IU.PP.CP), and the
// lexical / phrase / relative stress.  This is the audit instrument for the
// POS + dependency + correction layers — read alongside trials/parse_audit.mjs,
// which tabulates tag/dependency distributions and anomalies over a corpus.
function debugParse(text: string): void {
  // Clio audits through its own frozen parser; Calliope through the live one.
  const isClio = activeEngine.name === 'clio';
  const parse = isClio ? clioParseDocument : parseDocument;
  const isPunct = isClio ? clioIsPunctuation : isPunctuation;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const doc = parse(line);
    console.log('\n' + chalk.bold.cyan('› ' + line));
    for (const sent of doc.sentences) {
      // Route the audit dump through the active engine so --debug-parse reflects
      // whichever engine (Calliope / Clio) is selected.
      const ius = activeEngine.analyzeSentence(sent);
      const loc = new Map<ClsWord, string>();
      ius.forEach((iu, ii) =>
        iu.phonologicalPhrases.forEach((pp, pi) =>
          pp.cliticGroups.forEach((cg, ci) =>
            cg.tokens.forEach(t => loc.set(t, `${ii + 1}.${pi + 1}.${ci + 1}`)))));
      console.log(chalk.dim('  word         POS    C/F  dep            ←governor     IU.PP.CP  lex   phr  rel   canon      name'));
      for (const w of sent.words) {
        if (isPunctuation(w.lexicalClass)) continue;
        const d = w.dependency;
        const gov = d && d.governor ? d.governor.word : '—';
        const cf = w.isContent ? 'C' : 'f';
        const lex = w.syllables.map(s => (s.lexicalStress ?? s.stress)).join('');
        const rel = w.syllables.map(s => s.relativeStress).join('');
        // Calliope substrate (Stage 1): normalised relation + person/place flags.
        const canon = w.canonicalRel ?? '-';
        const name = w.isPersonName && w.isPlaceName ? 'P+C'
          : w.isPersonName ? 'person' : w.isPlaceName ? 'place' : '';
        console.log('  ' + w.word.padEnd(12) + w.lexicalClass.padEnd(6) + ' ' + cf + '   '
          + (d ? d.dependentType : '?').padEnd(14) + ' ' + String(gov).padEnd(13) + ' '
          + (loc.get(w) ?? '-').padEnd(9) + ' ' + lex.padEnd(5) + ' '
          + String(w.phraseStress).padEnd(4) + ' ' + rel.padEnd(5) + ' '
          + canon.padEnd(10) + ' ' + name);
      }
    }
  }
}

// ─── CLI ENTRY POINT ─────────────────────────────────────────────

async function main(): Promise<void> {
  let rawArgs = process.argv.slice(2);
  // --reading / -r : emit the compact reading view (poem in original formatting,
  // syllables stress-coloured, + per-line stress maps) instead of the full dump.
  const reading = rawArgs.includes('--reading') || rawArgs.includes('-r');
  rawArgs = rawArgs.filter(a => a !== '--reading' && a !== '-r');
  // --debug-parse : dump the per-word POS / dependency / prosody / stress chain.
  const debugParseMode = rawArgs.includes('--debug-parse');
  rawArgs = rawArgs.filter(a => a !== '--debug-parse');
  // --clio : run the frozen legacy / alternative parse engine instead of the
  // default faithful Calliope engine.
  if (rawArgs.includes('--clio')) activeEngine = clioEngine;
  rawArgs = rawArgs.filter(a => a !== '--clio');
  const show = debugParseMode ? debugParse : reading ? showReadingView : showResults;

  // Explicit arguments take precedence over piped stdin — otherwise running
  // `calliope_ts "some line"` from a script/CI (where stdin is a non-TTY but
  // empty) silently analysed the empty pipe and ignored the argument.
  if (rawArgs.length > 0) {
    // Check if first arg is a file
    const firstArg = rawArgs[0];
    if (fs.existsSync(firstArg) && fs.statSync(firstArg).isFile()) {
      const text = fs.readFileSync(firstArg, 'utf-8');
      show(text);
      return;
    }
    // Otherwise treat as text input
    const text = rawArgs.join(' ');
    show(text);
    return;
  }

  // No arguments: piped input (file redirect / heredoc) is the document.
  if (!process.stdin.isTTY) {
    const text = fs.readFileSync(0, 'utf-8');
    show(text);
    return;
  }

  // No arguments: launch interactive REPL
  await replMode();
}

// Is this module being run directly as the CLI, or imported as a library?
// A plain `process.argv[1] === fileURLToPath(import.meta.url)` check breaks under
// `npm install -g`: npm invokes us through a symlink in its bin directory, so
// process.argv[1] is that symlink's path, not the real dist/index.js. The two
// never match, `main()` never fires, and the command exits silently. Resolve
// symlinks on BOTH sides before comparing so the global command actually runs.
let isMain = false;
if (process.argv[1]) {
  try {
    isMain = fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isMain = false;
  }
}
if (isMain) {
  main().catch(err => {
    console.error(chalk.red('Fatal error:'), err);
    process.exit(1);
  });
}
```

## parser.ts

```typescript
// parser.ts — Syntactic dependency parser powered by UDPipe (English GUM model),
// producing a ClsDocument with a full dependency graph and a phrase‑structure node
// tree in the Universal Dependencies format used in McAleese's Calliope.
//
// HISTORY: this module previously ran a staged FinNLP pipeline
// (en-norm → lexed → en-pos → en-parse) with hand-written tag/dep correction
// layers (tagfix.ts / depfix.ts) to patch en-parse's systematic errors. It now
// delegates tokenisation, POS tagging, and dependency parsing to UDPipe via the
// `udpipe-node` package (a pure-WASM build — no native binary, no subprocess),
// which is a far more accurate parser. UDPipe's output maps cleanly onto the
// existing data model:
//   • XPOS column is Penn Treebank  → ClsWord.lexicalClass (unchanged downstream)
//   • DEPREL column is Universal Dependencies → ClsDependency.dependentType
// The correction layers are therefore no longer applied on this path.

import { createUDPipe } from 'udpipe-node/wasm';
import type { UDSentence, UDWord } from 'udpipe-node';
import { correctUDPipePos } from './calliope/postag.js';
import { pennTagOf } from './calliope/udpos.js';
import {
  ClsDocument,
  ClsSentence,
  ClsWord,
  ClsDependency,
  ClsNode,
} from './types.js';

// ── UDPipe instance (lazy singleton) ────────────────────────────────
// The "./wasm" entry point pre-initialises the WASM runtime via top-level await,
// so by the time this module is imported the engine is ready and construction /
// parsing are fully synchronous — `parseDocument` keeps its synchronous contract.
let _nlp: ReturnType<typeof createUDPipe> | null = null;
function nlp(): ReturnType<typeof createUDPipe> {
  // CALLIOPE_UDPIPE_MODEL lets us swap the UDPipe model (EWT / GUM / LinES /
  // ParTUT) for auditing — different treebanks tag XPOS quite differently, so the
  // model choice materially affects the parse the phonological pipeline consumes.
  // Unset → the bundled GUM model.
  const modelPath = process.env.CALLIOPE_UDPIPE_MODEL || undefined;
  return (_nlp ??= createUDPipe({ defaultInputMode: 'presegmented', modelPath }));
}

// ── POS / punctuation classification (unchanged) ─────────────────────

const CONTENT_POS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS',
  'JJ', 'JJR', 'JJS',
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ',
  'RB', 'RBR', 'RBS',
  'CD',                         // cardinal numbers (content‑like)
]);

/** Punctuation POS tags that should not be syllabified. */
const PUNCT_TAGS = new Set([
  ',', '.', ':', ';', '!', '?',
  '-LRB-', '-RRB-', '``', "''",
  '--', '...', '"', "'",
  '(', ')', '[', ']', '{', '}',
]);

export function isPunctuation(tag: string): boolean {
  return PUNCT_TAGS.has(tag);
}

/**
 * Quotation-mark tags. Quotes are tokens (never syllabified) but NOT prosodic
 * breaks: a quoted word inside a clause is read in one breath — no intonational
 * boundary, no caesura.
 */
const QUOTE_TAGS = new Set(['``', "''", '"', "'"]);

export function isQuoteTag(tag: string): boolean {
  return QUOTE_TAGS.has(tag);
}

function isContentWord(tag: string): boolean {
  return CONTENT_POS.has(tag);
}

/**
 * Lowercase the first alphabetic character of every line. Kept available but
 * NOT called by default — empirically net-negative with UDPipe (see parseDocument).
 */
export function lowerLineInitials(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[A-Za-z]/, (c) => c.toLowerCase()))
    .join('\n');
}

// Archaic / Early-Modern English forms the UD model (trained on modern text)
// systematically mis-tags. This is a closed lexicon of forms that are virtually
// never modern words, so an unconditional retag is safe domain adaptation for a
// verse tool (it replaces the role the old en-pos correction layer played for
// these tokens). Surface forms are matched lowercased, sans apostrophes.
const ARCHAIC_POS: Record<string, string> = {
  thy: 'PRP$', thine: 'PRP$',
  thee: 'PRP', thou: 'PRP', ye: 'PRP',
  hath: 'VBZ', doth: 'VBZ', saith: 'VBZ',
  hast: 'VBP', dost: 'VBP', wilt: 'MD',
  shalt: 'MD', canst: 'MD', wouldst: 'MD', shouldst: 'MD', couldst: 'MD',
  hadst: 'VBD', didst: 'VBD', wast: 'VBD', wert: 'VBD',
};

// ── Dash handling (unchanged) ────────────────────────────────────────

/**
 * Standalone en/em/figure/bar/minus dashes (or a run of 2+ hyphens) are prosodic
 * breaks (a dash caesura), not stress-bearing tokens. Re-tagged to the Penn dash
 * class ':' so they drop out of syllabification & scansion and mark a pause.
 */
const DASH_GLYPH_RE = /^(?:[‒–—―−]+|-{2,})$/;
function isDashGlyph(word: string): boolean {
  return DASH_GLYPH_RE.test(word);
}

const DASH_CLASS = '‒–—―−';
const DASH_GLYPHS_RE = new RegExp(`[${DASH_CLASS}]`, 'g');
const DASH_PAREN_RE = new RegExp(`([${DASH_CLASS}])([^${DASH_CLASS}]*?[.!?][^${DASH_CLASS}]*?)([${DASH_CLASS}])`, 'g');

/**
 * Normalize dash *usages* to colon-class clause-breaks BEFORE parsing. A dash is
 * an ι (intonational-unit) boundary — a stronger pause than a comma. We fold
 * every dash usage into a canonical glyph, neutralise sentence-final punctuation
 * inside a dash-delimited parenthetical (so the line stays one sentence), then
 * rewrite the dashes to a colon-class break (which prosodic.ts reads as an ι
 * boundary). Unspaced hyphen compounds ("torch-flames") are left intact.
 */
function normalizeDashesToClauseBreaks(text: string): string {
  text = text.replace(/(^|\s)-+(?=\s|$)/g, '$1–');
  text = text.replace(/-{2,}/g, '–');
  text = text.replace(DASH_PAREN_RE, (_m, a, inner, b) => a + inner.replace(/[.!?]+/g, ',') + b);
  text = text.replace(DASH_GLYPHS_RE, ' : ');
  text = text.replace(/(?:\s*:\s*){2,}/g, ' : ')
             .replace(/\s+:/g, ' :')
             .replace(/:(\S)/g, ': $1')
             .replace(/^\s*:\s*/, '')
             .replace(/\s{2,}/g, ' ')
             .trim();
  return text;
}

// ── Clitic / contraction re‑merge (UDPipe-specific) ──────────────────
// UDPipe tokenises contractions and elisions on the apostrophe boundary, e.g.
//   it's   → it + 's            don't → do + n't        we'll → we + 'll
//   th'expense → th' + expense  'Tis  → ' + Tis         fix'd → fix + 'd
// For scansion a contraction must be ONE orthographic word (one syllable count,
// one stress domain). We re-merge using UDPipe's SpaceAfter flag (which marks
// tokens that were contiguous in the source) plus the apostrophe shape:
//   • a LEFT clitic  (apostrophe-initial, or n't) merges into the previous word,
//     EXCEPT the possessive 's (XPOS=POS), which stays split (as it always has);
//   • a RIGHT proclitic (a short apostrophe-final piece like "th'", or a bare
//     leading apostrophe before an aphaeresis like 'tis/'twas) merges into the
//     next word.

const APOS = /['’]/;
const LEFT_CLITIC_RE = /^['’]([a-z]+)?$|^n['’]?t$/i;       // 's 've 'll 'd 're 'm n't
const RIGHT_PROCLITIC_RE = /^[a-z]{1,3}['’]$/i;            // th' o' d' ne'
const APHAERESIS = new Set(['tis', 'twas', 'twere', 'twill', 'twould', 'gainst', 'neath', 'tween', 'twixt', 'til', 'cause', 'em', 'round', 'bout']);

interface Cluster {
  tokens: UDWord[];
  repr: UDWord;       // the token that carries the syntactic role / POS
}

/** Group UDPipe words into orthographic clusters, re-merging clitics. */
function clusterWords(uds: UDWord[]): { clusters: Cluster[]; idToCluster: Map<number, number> } {
  const idToCluster = new Map<number, number>();
  const clusters: Cluster[] = [];

  for (let i = 0; i < uds.length; i++) {
    const w = uds[i];
    const prev = uds[i - 1];
    const contiguous = prev ? prev.spaceAfter === false : false;
    const isLeftClitic =
      contiguous && w.xpos !== 'POS' && LEFT_CLITIC_RE.test(w.form);

    if (isLeftClitic && clusters.length > 0) {
      clusters[clusters.length - 1].tokens.push(w);
      idToCluster.set(w.id, clusters.length - 1);
      continue;
    }
    clusters.push({ tokens: [w], repr: w });
    idToCluster.set(w.id, clusters.length - 1);
  }

  // Right-merge pass: a cluster that is a lone proclitic (th') or a bare leading
  // apostrophe before an aphaeresis ('tis) folds into the following cluster.
  const merged: Cluster[] = [];
  for (let c = 0; c < clusters.length; c++) {
    const cl = clusters[c];
    const next = clusters[c + 1];
    const onlyTok = cl.tokens.length === 1 ? cl.tokens[0] : null;
    const contiguous = onlyTok ? onlyTok.spaceAfter === false : false;
    const nextWord = next?.repr;

    const isProclitic =
      !!onlyTok && contiguous && !!nextWord &&
      (RIGHT_PROCLITIC_RE.test(onlyTok.form) ||
        (/^['’]$/.test(onlyTok.form) && APHAERESIS.has(nextWord.form.toLowerCase())));

    if (isProclitic && next) {
      next.tokens.unshift(onlyTok!);                 // prepend proclitic
      for (const t of cl.tokens) idToCluster.set(t.id, merged.length); // re-point to next cluster's eventual index
      // The next cluster will be pushed next iteration; fix its index mapping then.
      // Mark by leaving cl out (skip pushing it).
      // Re-point all of next's tokens to current merged length too:
      continue;
    }
    merged.push(cl);
  }

  // Rebuild idToCluster cleanly against the merged list (indices shifted by right-merges).
  idToCluster.clear();
  for (let c = 0; c < merged.length; c++) {
    for (const t of merged[c].tokens) idToCluster.set(t.id, c);
    // representative = first token that is neither a left-clitic nor a proclitic
    merged[c].repr =
      merged[c].tokens.find(
        (t) => !(t.xpos !== 'POS' && LEFT_CLITIC_RE.test(t.form)) && !RIGHT_PROCLITIC_RE.test(t.form) && !/^['’]$/.test(t.form),
      ) ?? merged[c].tokens[0];
  }

  return { clusters: merged, idToCluster };
}

// Dependency labels are passed through to `ClsDependency.dependentType` as RAW
// Universal Dependencies relations (obl, nsubj:pass, compound, nmod:poss, …) —
// they are deliberately NOT folded into the old Stanford names. The canonical
// normaliser `calliope/deps.ts` maps every UD relation onto the engine's Scenario
// label space (canonicalRel), so new UD tags are accommodated there, not hidden
// here.

// ── Public API ───────────────────────────────────────────────────────

export function parseDocument(text: string): ClsDocument {
  // Normalise curly/typographic apostrophes to straight ' so contractions and
  // elisions tokenise identically regardless of glyph.
  text = text.replace(/[‘’ʼ′]/g, "'");
  // Collapse runs of sentence-final punctuation (ellipsis, "!!") to a single mark.
  text = text.replace(/([.!?])\1+/g, '$1');
  // Dashes → colon-class clause-breaks (see helper above).
  text = normalizeDashesToClauseBreaks(text);

  // NOTE on line-initial caps: lowering the first letter of each line before
  // tagging (the role the old `normalizeCaps` played) was tested and is NET
  // NEGATIVE with UDPipe — it recovers cases like "Nap"/"Gap" (UH→NN) but a
  // line-initial capital often HELPS UDPipe's parse (e.g. "Through Eden took…"
  // parses "Eden" as nsubj when capitalised, obl when lowercased), so it changes
  // more scansions than it fixes. Left disabled; see lowerLineInitials() below.

  const udSentences: UDSentence[] = nlp().parse(text, { inputMode: 'presegmented' });

  const sentences: ClsSentence[] = [];
  let absoluteOffset = 0;

  udSentences.forEach((ud, si) => {
    const { clusters, idToCluster } = clusterWords(ud.words);

    // ---- 1. Build ClsWord array ----
    const words: ClsWord[] = clusters.map((cl, i) => {
      // Preserve the ORIGINAL case of the surface form (UDPipe keeps it); only
      // lowercase a private lookup key for the archaic-lexicon / dash checks.
      // Lowercasing `word` itself lost every proper-noun capital ("pakistan",
      // "marcel proust") in the display and projection; downstream stress/name
      // lookups all lowercase internally, so case in `word` is display-only.
      const surfaceRaw = cl.tokens.map((t) => t.form).join('');
      const surface = surfaceRaw.toLowerCase();
      // Penn tag: use the raw XPOS when it already is Penn (EWT/GUM), else derive
      // it from UPOS+FEATS (LinES/ParTUT emit non-Penn XPOS the pipeline can't read).
      const rawTag = pennTagOf(cl.repr);
      const archaic = ARCHAIC_POS[surface.replace(/['’]/g, '')];
      const tag = isDashGlyph(surfaceRaw) ? ':' : (archaic ?? rawTag);
      return {
        index: i + 1,
        lexicalClass: tag,
        lexicalDetails: cl.repr.feats,
        lexicalPlural: tag === 'NNS' || tag === 'NNPS',
        position: '',
        word: surfaceRaw,
        absoluteIndex: absoluteOffset + i,
        isContent: isContentWord(tag),
        syllables: [],
        phraseStress: 0,
        dependency: undefined,
        node: undefined,
      };
    });

    // Sentence-initial de-capitalisation (mirrors en-norm.normalizeCaps in the
    // pre-UD path): lower the first letter of the sentence's first word UNLESS it
    // is a proper noun, so "The"→"the" and "I"→"i" (an orthographic capital forced
    // by line position carries no lexical signal) while mid-line proper nouns
    // ("Marcel Proust", "Pakistan") keep their caps for display/projection.
    for (const w of words) {
      if (isPunctuation(w.lexicalClass)) continue;
      if (!/^(NNP|NNPS)$/.test(w.lexicalClass) && /^[A-Z]/.test(w.word)) {
        w.displayWord = w.word;      // keep the original surface for reports/phonopoetics
        w.word = w.word[0].toLowerCase() + w.word.slice(1);
      }
      break;
    }

    // ---- 2. Build ClsDependency array ----
    const dependencies: ClsDependency[] = [];
    clusters.forEach((cl, depIdx) => {
      const r = cl.repr;
      let govIdx: number | undefined;
      if (r.head === 0) {
        govIdx = undefined;                            // attaches to root
      } else {
        const g = idToCluster.get(r.head);
        // If the representative's head fell inside its own cluster (e.g. a copula
        // clitic), follow that clitic's head out of the cluster.
        if (g === depIdx) {
          const external = cl.tokens
            .map((t) => idToCluster.get(t.head))
            .find((gi) => gi !== undefined && gi !== depIdx);
          govIdx = external;
        } else {
          govIdx = g;
        }
      }

      const depWord = words[depIdx];
      const govWord = govIdx !== undefined ? words[govIdx] : null;

      dependencies.push({
        index: depIdx + 1,
        governorIndex: govIdx !== undefined ? govIdx + 1 : 0,
        dependentIndex: depIdx + 1,
        dependentType: govIdx === undefined ? 'root' : r.deprel,
        governorName: govWord ? govWord.word : 'ROOT',
        dependentName: depWord.word,
        governor: govWord as unknown as ClsWord,
        dependent: depWord,
      });
    });

    // Ensure a ROOT dependency exists.
    if (!dependencies.some((d) => d.governorIndex === 0) && words.length > 0) {
      dependencies.push({
        index: 0,
        governorIndex: 0,
        dependentIndex: 1,
        dependentType: 'root',
        governorName: 'ROOT',
        dependentName: words[0].word,
        governor: null as unknown as ClsWord,
        dependent: words[0],
      });
    }

    // Back‑reference: each word stores the dependency edge where it is dependent.
    words.forEach((w) => {
      w.dependency = dependencies.find((d) => d.dependent === w);
    });

    // UDPipe XPOS correction (the role en-pos + tagfix.ts played pre-UD): fix the
    // systematic mis-tags UDPipe makes on terse, decontextualised verse via
    // en-lexicon cross-check.  Runs HERE (in the parser, after deps are attached)
    // so direct `parseDocument` consumers — and every engine — see corrected tags;
    // rule (3) needs the dependency back-references just set above.
    correctUDPipePos({ index: si + 1, nodes: null, dependencies, words, xml: '' });

    // ---- 3. Build phrase‑structure node tree from the dependency graph ----
    const rootNode = buildDepNodeTree(words, dependencies);
    const wordNodeMap = new Map<number, ClsNode>();
    collectWordNodes(rootNode, wordNodeMap);
    words.forEach((w) => {
      w.node = wordNodeMap.get(w.index);
    });

    sentences.push({
      index: si + 1,
      nodes: rootNode,
      dependencies,
      words,
      xml: '',
    });

    absoluteOffset += words.length;
  });

  return { sentences, xml: '' };
}

// ── Dependency → constituency projection ─────────────────────────────
// phonological.ts groups clitic groups into phonological phrases by finding the
// smallest phrase node containing them, so it needs a properly nested, position-
// ordered constituency tree. We synthesise one by projection: each head plus its
// dependent subtrees forms a phrase, labelled by the head's POS family.

function phraseType(tag: string): string {
  if (/^(NN|NNS|NNP|NNPS|PRP|PRP\$|DT|CD|WP|WDT|EX)$/.test(tag)) return 'NP';
  if (/^(VB|VBD|VBG|VBN|VBP|VBZ|MD)$/.test(tag)) return 'VP';
  if (/^(IN|TO)$/.test(tag)) return 'PP';
  if (/^(JJ|JJR|JJS)$/.test(tag)) return 'ADJP';
  if (/^(RB|RBR|RBS|WRB)$/.test(tag)) return 'ADVP';
  return 'XP';
}

function buildDepNodeTree(words: ClsWord[], deps: ClsDependency[]): ClsNode {
  const sq: ClsNode = { index: '1', nodeName: 'SQ', parent: null, contains: [] };
  if (words.length === 0) return sq;

  // children[g] = list of dependent word-indices (1-based) governed by g (1-based);
  // roots are governed by 0.
  const children = new Map<number, number[]>();
  for (const d of deps) {
    if (d.dependentIndex < 1 || d.dependentIndex > words.length) continue;
    const g = d.governorIndex;
    if (!children.has(g)) children.set(g, []);
    children.get(g)!.push(d.dependentIndex);
  }

  const build = (wordIdx: number, parent: ClsNode): ClsNode => {
    const word = words[wordIdx - 1];
    const kids = (children.get(wordIdx) ?? []).filter((k) => k !== wordIdx);
    if (kids.length === 0) {
      const leaf = createWordLeaf(word);
      leaf.parent = parent;
      return leaf;
    }
    const node: ClsNode = {
      index: `ph_${wordIdx}`,
      nodeName: phraseType(word.lexicalClass),
      parent,
      contains: [],
    };
    // Order head + dependents by surface position for a projective tree.
    const ordered = [...kids, wordIdx].sort((a, b) => a - b);
    for (const idx of ordered) {
      if (idx === wordIdx) {
        const leaf = createWordLeaf(word);
        leaf.parent = node;
        node.contains.push(leaf);
      } else {
        node.contains.push(build(idx, node));
      }
    }
    return node;
  };

  const roots = (children.get(0) ?? []).sort((a, b) => a - b);
  if (roots.length === 0) {
    // No explicit root: attach all words as leaves under SQ.
    for (const w of words) {
      const leaf = createWordLeaf(w);
      leaf.parent = sq;
      sq.contains.push(leaf);
    }
    return sq;
  }
  for (const r of roots) {
    const child = build(r, sq);
    sq.contains.push(child);
  }

  // Attach any orphan words (rare) directly under SQ.
  const attached = new Set<number>();
  collectAttachedWordIndices(sq, attached);
  for (const w of words) {
    if (!attached.has(w.index)) {
      const leaf = createWordLeaf(w);
      leaf.parent = sq;
      sq.contains.push(leaf);
    }
  }
  return sq;
}

// ── Leaf / traversal helpers (unchanged) ─────────────────────────────

function createWordLeaf(word: ClsWord): ClsNode {
  return {
    index: `w${word.index}`,
    nodeName: word.index.toString(),
    parent: null,
    contains: [word],
  };
}

function collectWordNodes(node: ClsNode, map: Map<number, ClsNode>): void {
  for (const child of node.contains) {
    if (child instanceof Object && 'word' in (child as any)) {
      map.set((child as ClsWord).index, node);
    } else if (child instanceof Object && 'index' in (child as any)) {
      collectWordNodes(child as ClsNode, map);
    }
  }
}

function collectAttachedWordIndices(node: ClsNode, set: Set<number>): void {
  for (const child of node.contains) {
    if (child instanceof Object && 'word' in (child as any)) {
      set.add((child as ClsWord).index);
    } else if (child instanceof Object && 'index' in (child as any)) {
      collectAttachedWordIndices(child as ClsNode, set);
    }
  }
}

```

## phonological.ts

```typescript
// phonological.ts — Constructs the prosodic hierarchy (CP, PP, IU)
// from the parsed sentence, replicating McAleese’s method.

import {
  ClsSentence,
  ClsWord,
  ClsNode,
  CliticGroup,
  PhonologicalPhrase,
  IntonationalUnit,
  KeyStress,
  StressLevel,
  SyllableDisplayEntry,
} from './types.js';
import { isPunctuation } from './parser.js';


/**
 * Build the full phonological hierarchy for a sentence.
 *
 * 1. Split into Intonational Units at punctuation tokens.
 * 2. Within each IU, build Clitic Groups by attaching function words
 *    to their governing content word (contiguous grouping).
 * 3. Group Clitic Groups into Phonological Phrases using the phrase
 *    structure tree (PPs correspond to VP and PP nodes).
 */
export function buildPhonologicalHierarchy(
  sentence: ClsSentence
): IntonationalUnit[] {
  const words = sentence.words;
  if (words.length === 0) return [];

  // ---- Step 1: split into IU segments by punctuation ----
  const iuSegments = splitByPunctuation(words);

  const ius: IntonationalUnit[] = [];

  for (const seg of iuSegments) {
    // ---- Step 2: build Clitic Groups for this segment ----
    const cgs = buildCliticGroups(seg);

    // ---- Step 3: group CPs into PPs using the phrase tree ----
    const pps = groupIntoPhonologicalPhrases(cgs, seg, sentence.nodes);

    ius.push({ phonologicalPhrases: pps });
  }

  return ius;
}

// ─── Intonational Unit splitting ───────────────────────────────

/** Punctuation POS tags that trigger an IU boundary.  Quotation marks are
 *  deliberately EXCLUDED: quotes are not prosodic breaks (a quoted word inside
 *  a clause is read in one breath), and treating them as IU boundaries
 *  fragmented the line's phonological hierarchy — flipping meters.  Parentheses
 *  stay: a parenthetical aside IS an intonational break. */
const PUNCT_TAGS = new Set([
  '.', ',', ':', ';', '!', '?',
  '-LRB-', '-RRB-', '(', ')',    // parentheses (true parentheticals);
  '[', ']', '{', '}',            // FinNLP emits literal bracket tags
]);

function splitByPunctuation(words: ClsWord[]): ClsWord[][] {
  const segments: ClsWord[][] = [];
  let current: ClsWord[] = [];

  for (const w of words) {
    if (PUNCT_TAGS.has(w.lexicalClass)) {
      // The punctuation token itself is not part of the prosodic
      // hierarchy; it acts as a boundary.
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(w);
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

// ─── Clitic Group construction ────────────────────────────────

/**
 * Content‑word POS tags (expand as needed).
 * Content words serve as the head of a Clitic Group.
 */
const CONTENT_TAGS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS',  // nouns
  'JJ', 'JJR', 'JJS',          // adjectives
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ',  // verbs (excl. modals)
  'RB', 'RBR', 'RBS',          // adverbs
  'CD',                         // cardinal numbers (content‑like)
]);

function isContent(w: ClsWord): boolean {
  return CONTENT_TAGS.has(w.lexicalClass);
}

/**
 * Build contiguous Clitic Groups for a segment of words.
 *
 * A CP consists of exactly one content word plus any contiguous
 * function words that are dependents of that content word.
 * Function words attach to the nearest content word to their right
 * if they depend on it, or to the left content word otherwise.
 */
function buildCliticGroups(words: ClsWord[]): CliticGroup[] {
  const groups: CliticGroup[] = [];
  const assigned = new Set<ClsWord>();

  // First pass: create CPs for all content words and attach their dependents
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (assigned.has(w)) continue;

    if (isContent(w)) {
      // Start a new CP with this content word.
      const cpWords: ClsWord[] = [];

      // Attach preceding unassigned function words that depend on w.
      // Skip over already-assigned content words to reach function words.
      let j = i - 1;
      while (j >= 0) {
        const prev = words[j];
        if (assigned.has(prev)) {
          j--;
          continue; // skip assigned words (content or otherwise)
        }
        if (isContent(prev)) break; // unassigned content → stop
        // prev is an unassigned function word
        if (dependsOn(prev, w)) {
          cpWords.unshift(prev);
          assigned.add(prev);
        } else {
          break;
        }
        j--;
      }

      // Add the content word itself.
      cpWords.push(w);
      assigned.add(w);

      // Attach following unassigned function words that depend on w.
      // Skip over already-assigned content words.
      let k = i + 1;
      while (k < words.length) {
        const next = words[k];
        if (assigned.has(next)) {
          k++;
          continue; // skip assigned words
        }
        if (isContent(next)) break; // unassigned content → stop
        // next is an unassigned function word
        if (dependsOn(next, w)) {
          cpWords.push(next);
          assigned.add(next);
        } else {
          break;
        }
        k++;
      }

      groups.push({ tokens: cpWords });
    }
  }

  // Second pass: any remaining unassigned function words become degenerate CPs
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!assigned.has(w)) {
      groups.push({ tokens: [w] });
      assigned.add(w);
    }
  }

  // Sort groups by the index of their first token to maintain sentence order
  groups.sort((a, b) => a.tokens[0].index - b.tokens[0].index);

  return groups;
}

/** True if `dependent` has `head` as its direct governor. */
function dependsOn(dependent: ClsWord, head: ClsWord): boolean {
  const dep = dependent.dependency;
  return !!(dep && dep.governor === head);
}

// ─── Phonological Phrase grouping via phrase tree ──────────────

/**
 * Assigns each CP (identified by its head word) to a Phonological
 * Phrase.  The mapping uses the phrase‑structure tree: a PP node
 * (or VP node) becomes a Phonological Phrase containing all CPs
 * whose head words fall inside that node’s subtree.
 */
function groupIntoPhonologicalPhrases(
  cgs: CliticGroup[],
  segmentWords: ClsWord[],
  rootNode: ClsNode | null
): PhonologicalPhrase[] {
  if (!rootNode) {
    // Fallback: every CP is its own PP.
    return cgs.map(cg => ({ cliticGroups: [cg] }));
  }

  // Collect all phrase nodes that are candidates for PPs:
  // VP and PP nodes (as in Antelope’s output, VP and PP are the
  // maximal projections that McAleese uses as PPs).
  const phraseNodes = collectPhraseNodes(rootNode);

  // For each CP, determine which phrase node contains its head word,
  // preferring the smallest (most specific) node.
  const cpToPP = new Map<CliticGroup, ClsNode | null>();

  for (const cg of cgs) {
    const headWord = cg.tokens.find(w => isContent(w))!;
    if (!headWord) {
      cpToPP.set(cg, null);
      continue;
    }
    const containingNode = findMinimalContainingNode(headWord, phraseNodes);
    cpToPP.set(cg, containingNode);
  }

  // Build PP objects: each unique phrase node becomes a PP,
  // containing all CPs assigned to it.  CPs with no containing node
  // are grouped into a single “orphan” PP.
  const ppMap = new Map<ClsNode | null, CliticGroup[]>();
  for (const cg of cgs) {
    const node = cpToPP.get(cg) ?? null;
    if (!ppMap.has(node)) ppMap.set(node, []);
    ppMap.get(node)!.push(cg);
  }

  // Merge orphan CPs (node=null) into the PP of the nearest adjacent
  // non-orphan CP within the same IU segment. This ensures function-word
  // CPs (like determiners) that have no parse-tree node stay with the
  // CPs they modify.
  // Strategy: iterate CPs in order; if an orphan sits next to a non-orphan
  // in the ordered list, merge it into that non-orphan's PP.
  const orphanPPKey: ClsNode = { index: '__orphan_group__', nodeName: '__orphan_group__', parent: null, contains: [] } as any;
  if (ppMap.has(null)) {
    const orphans = ppMap.get(null)!;
    ppMap.delete(null);
    // Create a synthetic key for all orphans so they merge with nearest adjacent PP.
    // We'll merge them in the final ordering step below.
    ppMap.set(orphanPPKey, []);
  }

  // Build PPs respecting order and merging adjacent orphans into
  // the nearest non-orphan PP.
  const cgOrder = [...cgs].sort((a, b) => a.tokens[0].index - b.tokens[0].index);

  // Collect unique non-orphan node keys in order
  const nodeKeysInOrder: (ClsNode | null)[] = [];
  for (const cg of cgOrder) {
    const node = cpToPP.get(cg) ?? null;
    if (node === null) continue; // orphans handled below
    if (!nodeKeysInOrder.includes(node)) {
      nodeKeysInOrder.push(node);
    }
  }

  // Assign each orphan CG to the PP of the nearest adjacent non-orphan CG.
  const orphanToNode = new Map<CliticGroup, ClsNode | null>();
  for (const cg of cgOrder) {
    const node = cpToPP.get(cg) ?? null;
    if (node !== null) continue; // not an orphan
    // Look backward for nearest non-orphan CG
    let foundNode: ClsNode | null = null;
    for (let idx = cgOrder.indexOf(cg) - 1; idx >= 0; idx--) {
      const n = cpToPP.get(cgOrder[idx]) ?? null;
      if (n !== null) { foundNode = n; break; }
    }
    // If none found backward, look forward
    if (!foundNode) {
      for (let idx = cgOrder.indexOf(cg) + 1; idx < cgOrder.length; idx++) {
        const n = cpToPP.get(cgOrder[idx]) ?? null;
        if (n !== null) { foundNode = n; break; }
      }
    }
    orphanToNode.set(cg, foundNode);
  }

  // Build PP objects: each unique phrase node becomes a PP,
  // containing all CPs assigned to it (including merged orphans).
  const finalPPMap = new Map<ClsNode, CliticGroup[]>();
  for (const cg of cgOrder) {
    const node = cpToPP.get(cg) ?? null;
    const effectiveNode = node !== null ? node : (orphanToNode.get(cg) ?? orphanPPKey);
    if (!finalPPMap.has(effectiveNode)) finalPPMap.set(effectiveNode, []);
    finalPPMap.get(effectiveNode)!.push(cg);
  }

  const pps: PhonologicalPhrase[] = [];
  for (const [, cpList] of finalPPMap) {
    cpList.sort((a, b) => a.tokens[0].index - b.tokens[0].index);
    pps.push({ cliticGroups: cpList });
  }
  pps.sort((a, b) => a.cliticGroups[0].tokens[0].index - b.cliticGroups[0].tokens[0].index);
  return pps;
}


/** Recursively collect all major syntactic constituent nodes (VP, PP, NP, ADJP, ADVP). */
function collectPhraseNodes(node: ClsNode): ClsNode[] {
  const result: ClsNode[] = [];
  const phraseTypes = new Set(['VP', 'PP', 'NP', 'ADJP', 'ADVP']);
  if (phraseTypes.has(node.nodeName)) {
    result.push(node);
  }
  for (const child of node.contains) {
    // Skip ClsWord leaves (they have a `word` property)
    if ((child as ClsWord).word !== undefined) continue;
    // Now child must be a ClsNode
    const childNode = child as ClsNode;
    if (childNode.nodeName !== undefined) {
      result.push(...collectPhraseNodes(childNode));
    }
  }
  return result;
}

/**
 * Find the smallest phrase node (from the candidate list) that
 * contains the given word, or null if none does.
 */
function findMinimalContainingNode(
  word: ClsWord,
  phraseNodes: ClsNode[]
): ClsNode | null {
  let best: ClsNode | null = null;
  let bestSize = Infinity;

  for (const node of phraseNodes) {
    if (nodeContainsWord(node, word)) {
      const size = nodeSize(node);
      if (size < bestSize) {
        bestSize = size;
        best = node;
      }
    }
  }
  return best;
}

/** Check whether a node’s subtree includes the given word. */
function nodeContainsWord(node: ClsNode, word: ClsWord): boolean {
  for (const child of node.contains) {
    if ((child as ClsWord).word !== undefined && (child as ClsWord).index !== undefined) {
      if ((child as ClsWord).index === word.index) return true;
    } else if ((child as ClsNode).nodeName !== undefined) {
      if (nodeContainsWord(child as ClsNode, word)) return true;
    }
  }
  return false;
}

/** Approximate size of a node’s subtree (number of word leaves). */
function nodeSize(node: ClsNode): number {
  let count = 0;
  for (const child of node.contains) {
    if ((child as ClsWord).word !== undefined) {
      // leaf word
      count++;
    } else if ((child as ClsNode).nodeName !== undefined) {
      count += nodeSize(child as ClsNode);
    }
  }
  return count;
}

// ─── Utility exports for scansion.ts and index.ts ─────────────

export function collectIUTokens(iu: IntonationalUnit): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const pp of iu.phonologicalPhrases) {
    tokens.push(...collectPPTokens(pp));
  }
  return tokens;
}

export function collectPPTokens(pp: PhonologicalPhrase): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const cg of pp.cliticGroups) {
    tokens.push(...cg.tokens);
  }
  return tokens;
}

// ─── RENDERING FUNCTIONS (REPLACED) ────────────────────────────

/**
 * Build a flat list of all syllables with their stress and global index,
 * and a flag indicating whether it is the final syllable of its word.
 */
interface FlatMeta {
  stress: StressLevel;
  globalIndex: number;
  isFinalSylOfWord: boolean;
}

function flattenWithMeta(words: ClsWord[]): FlatMeta[] {
  const result: FlatMeta[] = [];
  let idx = 0;
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const syls = w.syllables;
    for (let i = 0; i < syls.length; i++) {
      result.push({
        stress: syls[i].relativeStress ?? 'w',
        globalIndex: idx,
        isFinalSylOfWord: i === syls.length - 1,
      });
      idx++;
    }
  }
  return result;
}

/**
 * Core renderer that walks the hierarchy and produces the bracket string.
 * If `keySet` is given, only positions whose global index is in the set are
 * shown with their actual stress; all other positions become 'x'.
 */
function renderStressString(
  ius: IntonationalUnit[],
  flat: FlatMeta[],
  keySet?: Set<number>
): string {
  let result = '';
  let sylIdx = 0;   // pointer into flat array

  for (const iu of ius) {
    result += '<';
    for (const pp of iu.phonologicalPhrases) {
      result += '{';
      for (const cg of pp.cliticGroups) {
        result += '[';
        let firstWord = true;
        for (const word of cg.tokens) {
          if (!firstWord) result += '/';   // word break marker
          firstWord = false;
          const syls = word.syllables;
          // polysyllabic word: insert '\' before first syllable
          if (syls.length > 1) result += '\\';

          for (let s = 0; s < syls.length; s++) {
            const meta = flat[sylIdx];
            sylIdx++;
            const stress = meta.stress;
            if (keySet) {
              result += keySet.has(meta.globalIndex) ? stress : 'x';
            } else {
              result += stress;
            }
          }
        }
        result += ']';
      }
      result += '}';
    }
    result += '>';
  }
  return result;
}

/**
 * Render the full phonological hierarchy into the bracket notation
 * used by McAleese, e.g. "<{[nm/ws\n]}mn/sw\]m]}>".
 */
export function renderHierarchy(ius: IntonationalUnit[], words: ClsWord[]): string {
  const flat = flattenWithMeta(words);
  return renderStressString(ius, flat);
}

/**
 * Render the key‑stress string: only syllables that participate in
 * key‑stress patterns are shown with their stress symbol; all others become 'x'.
 */
export function renderKeyStresses(
  ius: IntonationalUnit[],
  words: ClsWord[],
  keyStresses: KeyStress[]
): string {
  const flat = flattenWithMeta(words);
  const keySet = new Set<number>();
  for (const ks of keyStresses) {
    for (const pos of ks.positions) {
      keySet.add(pos);
    }
  }
  return renderStressString(ius, flat, keySet);
}

// ─── DISPLAY HELPERS ─────────────────────────────────────────────

/**
 * Split a word into orthographic syllable chunks using the Maximum Onset Principle.
 * Respects English phonotactics: digraphs stay together, consonants go to
 * the onset of the following syllable when they form a legal cluster.
 */
const VOWEL_CHARS = new Set('aeiouyAEIOUY');
const CONSONANT_DIGRAPHS = new Set(['th','sh','ch','wh','ph','gh','ck','ng','nk','tch','dge','sc','sk','sp','st']);

// ARPABET vowels, split into "free/long" (can end a syllable → favours an OPEN
// split: e·ven, ta·ble, o·pen) and "checked/short" (needs a coda → favours a
// CLOSED split: sev·en, prob·lem, rob·in).  This is the vowel-length cue that
// orthography alone cannot supply; it comes from nounsing-pro's per-syllable
// phones.  Display-only: it never affects meter scoring.
const ARPABET_VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);
const FREE_VOWELS = new Set(['IY', 'EY', 'AY', 'OW', 'UW', 'AW', 'OY', 'ER', 'AO']);

export type VowelLength = 'long' | 'short' | 'unknown';

/** Classify a syllable's vowel (from its ARPABET phones) as free/long vs checked/short. */
export function vowelLengthOf(phones: string): VowelLength {
  if (!phones) return 'unknown';
  // Per-syllable phones may be parenthesised and stress-digited, e.g. "(s EH)".
  for (const tok of phones.trim().split(/\s+/)) {
    const v = tok.replace(/[^A-Za-z]/g, '').toUpperCase();  // strip parens/digits
    if (ARPABET_VOWELS.has(v)) return FREE_VOWELS.has(v) ? 'long' : 'short';
  }
  return 'unknown';
}

/** Per-syllable vowel lengths for a word, to guide open/closed syllabification. */
export function syllableVowelLengths(
  syllables: { phones: string; stress?: number; lexicalStress?: number }[],
): VowelLength[] {
  return syllables.map(s => {
    const len = vowelLengthOf(s.phones);
    const stressed = (s.lexicalStress ?? s.stress ?? 0) >= 1;
    // Only a *stressed* checked vowel closes its syllable; a reduced/unstressed
    // syllable stays open (beau·ti·ful, not beau·tif·ul; mem·o·ry, not mem·or·y).
    if (len === 'short' && !stressed) return 'unknown';
    return len;
  });
}

/**
 * Opaque lexicalised compounds whose orthographic syllable boundary the
 * maximal-onset syllabifier cuts in the wrong place (some·one → so·meone, because
 * the lone medial 'm' is greedily taken as the onset of syllable 2).  We supply
 * the morpheme boundary explicitly: the constituents are real words, so each is
 * syllabified on its own and re-joined.  Applied ONLY when the parts' own
 * syllable counts sum to the requested count, so a mismatched parse falls through
 * to the general algorithm rather than mis-splitting.  Display-only (never affects
 * stress or meter, which derive from the CMU syllable count, not this chunking).
 */
const LEXICAL_COMPOUND_PARTS: Record<string, string[]> = {
  someone: ['some', 'one'], anyone: ['any', 'one'], everyone: ['every', 'one'], noone: ['no', 'one'],
  something: ['some', 'thing'], anything: ['any', 'thing'], everything: ['every', 'thing'], nothing: ['no', 'thing'],
  somebody: ['some', 'body'], anybody: ['any', 'body'], everybody: ['every', 'body'], nobody: ['no', 'body'],
  somewhere: ['some', 'where'], anywhere: ['any', 'where'], everywhere: ['every', 'where'], nowhere: ['no', 'where'],
  somehow: ['some', 'how'], somewhat: ['some', 'what'], someday: ['some', 'day'],
  sometime: ['some', 'time'], sometimes: ['some', 'times'], someplace: ['some', 'place'],
  itself: ['it', 'self'], himself: ['him', 'self'], herself: ['her', 'self'], myself: ['my', 'self'],
  yourself: ['your', 'self'], oneself: ['one', 'self'],
  themselves: ['them', 'selves'], ourselves: ['our', 'selves'], yourselves: ['your', 'selves'],
  into: ['in', 'to'], onto: ['on', 'to'], unto: ['un', 'to'], upon: ['up', 'on'],
  within: ['with', 'in'], without: ['with', 'out'], throughout: ['through', 'out'],
  cannot: ['can', 'not'], become: ['be', 'come'], became: ['be', 'came'],
  // Archaic/locative pronominal compounds (frequent in verse).  The medial
  // silent 'e' of the first element ("where·fore") otherwise inflates the
  // orthographic vowel-group count and mis-places the boundary.
  wherefore: ['where', 'fore'], therefore: ['there', 'fore'],
  wherein: ['where', 'in'], therein: ['there', 'in'], herein: ['here', 'in'],
  whereby: ['where', 'by'], thereby: ['there', 'by'], hereby: ['here', 'by'],
  whereof: ['where', 'of'], thereof: ['there', 'of'], hereof: ['here', 'of'],
  whereto: ['where', 'to'], thereto: ['there', 'to'], hereto: ['here', 'to'],
  whereon: ['where', 'on'], thereon: ['there', 'on'],
  whereat: ['where', 'at'], thereat: ['there', 'at'],
  whereupon: ['where', 'upon'], thereupon: ['there', 'upon'], hereupon: ['here', 'upon'],
  hereafter: ['here', 'after'], thereafter: ['there', 'after'], whereafter: ['where', 'after'],
  heretofore: ['here', 'to', 'fore'], hitherto: ['hither', 'to'],
};

/** Orthographic syllable estimate for a single sub-word (silent-final-e aware). */
function quickSyllableCount(s: string): number {
  const lower = s.toLowerCase();
  const pos: number[] = [];
  let inV = false;
  for (let i = 0; i < lower.length; i++) {
    if (VOWEL_CHARS.has(lower[i])) { if (!inV) { pos.push(i); inV = true; } }
    else inV = false;
  }
  let groups = pos.length;
  if (groups >= 2 && lower.endsWith('e') && pos[pos.length - 1] === lower.length - 1) groups--;
  return Math.max(1, groups);
}

export function syllabifyWord(word: string, syllableCount: number, vowelLengths?: VowelLength[], morphSuffix?: string, morphPrefix?: string): string[] {
  if (syllableCount <= 1) return [word];

  // Morpheme-aware prefix peel: when OOV stress assignment validated a productive
  // prefix ("dis"), split it off as the first syllable(s) so the stem keeps its
  // spelling (dis·il·lu·sions, not di·sil·lu·sions — the Maximal Onset principle
  // would otherwise pull the prefix's final consonant into the next syllable).
  // The prefix's own syllable count is estimated orthographically; the stem gets
  // the remaining syllables.
  if (morphPrefix && syllableCount >= 2
      && word.toLowerCase().startsWith(morphPrefix)
      && word.length > morphPrefix.length + 1) {
    const prefixSylls = quickSyllableCount(morphPrefix);
    if (prefixSylls < syllableCount) {
      const prefixChunk = word.slice(0, morphPrefix.length);
      const stemChunk = word.slice(morphPrefix.length);
      const stemChunks = syllabifyWord(stemChunk, syllableCount - prefixSylls,
        vowelLengths ? vowelLengths.slice(prefixSylls) : undefined, morphSuffix);
      // If the prefix is polysyllabic, syllabify it on its own; monosyllabic → as-is.
      const prefixChunks = prefixSylls > 1
        ? syllabifyWord(prefixChunk, prefixSylls)
        : [prefixChunk];
      const result = [...prefixChunks, ...stemChunks];
      if (result.length === syllableCount) return result;
    }
  }

  // Lexical compound boundary (someone → some·one, not so·meone).  Only when the
  // constituents' own syllable counts add up to the requested total.
  {
    const key = word.toLowerCase().replace(/[^a-z]/g, '');
    const parts = LEXICAL_COMPOUND_PARTS[key];
    if (parts && key === word.toLowerCase()) {
      const counts = parts.map(quickSyllableCount);
      if (counts.reduce((a, b) => a + b, 0) === syllableCount) {
        const out: string[] = [];
        let off = 0;
        for (let p = 0; p < parts.length; p++) {
          const seg = word.slice(off, off + parts[p].length);
          off += parts[p].length;
          out.push(...syllabifyWord(seg, counts[p]));
        }
        if (out.length === syllableCount) return out;
      }
    }
  }

  // Morpheme-aware peel: when OOV stress assignment validated a productive
  // archaic suffix (-est/-eth/-ith), split it off as the final syllable so the
  // stem keeps its spelling (know·est, not kno·west; know·eth, not kno·weth).
  if (morphSuffix && syllableCount >= 2
      && word.toLowerCase().endsWith(morphSuffix)
      && word.length > morphSuffix.length + 1) {
    const stem = word.slice(0, word.length - morphSuffix.length);
    const suffixChunk = word.slice(word.length - morphSuffix.length);
    const stemChunks = syllabifyWord(stem, syllableCount - 1, vowelLengths?.slice(0, syllableCount - 1));
    return [...stemChunks, suffixChunk];
  }

  // For hyphenated words, use hyphen as syllable boundary if counts match
  if (word.includes('-')) {
    const parts = word.split('-');
    if (parts.length === syllableCount) {
      return parts;
    }
  }

  const cleanWord = word.replace(/-/g, '');
  if (cleanWord.length <= syllableCount) {
    if (cleanWord.length === syllableCount) return cleanWord.split('');
    return [word];
  }

  const hyphenMap: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== '-') hyphenMap.push(i);
  }

  const lower = cleanWord.toLowerCase();
  const n = lower.length;

  // Common English consonant digraphs.  "kn"/"gn"/"wr" are EXCLUDED: they are
  // digraphs only WORD-INITIALLY (where the first consonant is silent — "know",
  // "gnaw", "write"), and the digraph set is used only for MEDIAL boundary
  // placement.  In medial position ("frankness") "kn" is two pronounced
  // consonants: /k/ closes the first syllable (frank), /n/ opens the second
  // (ness) — treating it as a medial digraph sends both to the next syllable
  // ("fran-kness"), which is wrong.
  const DIGRAPHS = new Set(['ch', 'sh', 'th', 'wh', 'ph', 'gh', 'ck', 'ng']);
  // Digraphs that commonly end syllables (codas)
  const CODA_DIGRAPHS = new Set(['ch', 'sh', 'ck', 'ng', 'th']);
  // "Muta cum liquida": an obstruent + liquid/glide that, between vowels, stays
  // together as the onset of the following syllable (maximal-onset principle):
  // se·cret, be·tween, chil·dren, pro·gram, re·gret.  Deliberately EXCLUDES the
  // s+stop clusters (st/sp/sc/sk), which in medial position split after a short
  // vowel (mis·ter, dis·turb, whis·per) rather than maximising the onset.
  const MEDIAL_ONSET = new Set([
    'bl', 'br', 'cl', 'cr', 'dr', 'dw', 'fl', 'fr', 'gl', 'gr',
    'pl', 'pr', 'tr', 'tw',
  ]);
  // Legal English 3-consonant onsets (s + voiceless stop + liquid/glide) plus
  // the orthographic clusters thr/shr/chr/phr/sch (single onset phonemically).
  const TRIPLE_ONSET = new Set([
    'str', 'spr', 'scr', 'spl', 'squ', 'thr', 'shr', 'chr', 'phr', 'sch',
  ]);
  // Final "consonant + le" forms its own syllable (ta·ble, lit·tle, ap·ple,
  // tem·ple, bot·tle): the single consonant immediately before "le" joins it.
  const endsConsonantLe = n >= 3 && lower.endsWith('le') && !VOWEL_CHARS.has(lower[n - 3]);
  // Non-syllabic past-tense "-ed": the 'e' in a final "…Xed" (X a consonant other
  // than t/d) is silent (re·turned, not re·tur·ned).  After t/d it IS syllabic
  // (want·ed, embed·ded), so those are excluded.
  const endsSilentEd = n >= 3 && lower.endsWith('ed')
    && !VOWEL_CHARS.has(lower[n - 3]) && lower[n - 3] !== 't' && lower[n - 3] !== 'd';
  // Non-syllabic inflectional "-es": the 'e' in a final "…Xes" (X a consonant
  // other than a vowel — so "goes"/"shoes" are excluded, where 'e' is part of a
  // vowel digraph) is silent when the nucleus count exceeds the CMU syllable
  // count.  This is the VCe pattern extended to plurals/3sg: the 'e' makes the
  // preceding vowel long and is not itself pronounced (receives = re·CEIVES,
  // makes = MAKES, writes = WRITES).  When the stem ends in a sibilant
  // (bus→buses, bush→bushes) the 'e' IS syllabic, but in that case the nucleus
  // count already matches the syllable count and this check never fires — the
  // surplus-nucleus guard makes it safe.
  const endsSilentEs = n >= 3 && lower.endsWith('es')
    && !VOWEL_CHARS.has(lower[n - 3]);

  interface Nucleus { start: number; end: number }
  const nuclei: Nucleus[] = [];
  let i = 0;
  while (i < n) {
    if (VOWEL_CHARS.has(lower[i])) {
      const vs = i;
      while (i < n && VOWEL_CHARS.has(lower[i])) i++;
      const isLoneFinalE = (i === n && (i - vs) === 1 && lower[vs] === 'e');
      if (isLoneFinalE && nuclei.length >= 2) {
        // silent-e: a lone 'e' at word end after 2+ nuclei is typically silent
      } else {
        nuclei.push({ start: vs, end: i });
      }
    } else {
      i++;
    }
  }

  if (nuclei.length === 0) return [word];

  // If we have a surplus nucleus and the word ends in a non-syllabic "-ed",
  // drop that silent 'e' first (preferred over a generic consonant-count merge,
  // which would otherwise mis-segment e.g. "returned" → "re·tur·ned").
  if (nuclei.length > syllableCount && endsSilentEd) {
    const last = nuclei[nuclei.length - 1];
    if (last.start === n - 2 && last.end === n - 1) nuclei.pop();
  }
  // Same for non-syllabic "-es": drop the silent 'e' when there's a surplus
  // (receives = 3 nuclei → 2 syllables → drop → re·ceives, not recei·ves).
  if (nuclei.length > syllableCount && endsSilentEs) {
    const last = nuclei[nuclei.length - 1];
    if (last.start === n - 2 && last.end === n - 1) nuclei.pop();
  }

  // Vowel hiatus: if we have TOO FEW nuclei, a multi-vowel nucleus (≥2 vowel
  // characters scanned as one group) is a HIATUS — two syllabic vowels in
  // adjacent syllables — not a diphthong.  Split the rightmost multi-vowel
  // nucleus, peeling off its last vowel char as a new nucleus, until nuclei
  // match the syllable count.  English hiatus tends word-ward ("-ia", "-eo"),
  // so rightmost-first is the right priority.  This respects the authoritative
  // CMU syllable count ("hysterias" = 4: hys·te·ri·as, not 3) and prevents the
  // crude fallback chunker from producing nonsensical splits like "hy·ST·eri·as"
  // (treating "ST" as a syllable nucleus).
  while (nuclei.length < syllableCount) {
    let splitIdx = -1;
    for (let j = nuclei.length - 1; j >= 0; j--) {
      if (nuclei[j].end - nuclei[j].start >= 2) { splitIdx = j; break; }
    }
    if (splitIdx < 0) break;                         // no multi-vowel nucleus left
    const nuc = nuclei[splitIdx];
    nuclei.splice(splitIdx, 1,
      { start: nuc.start, end: nuc.end - 1 },
      { start: nuc.end - 1, end: nuc.end });
  }

  while (nuclei.length > syllableCount && nuclei.length > 1) {
    let minConsonants = Infinity;
    let mergeIdx = 0;
    for (let j = 0; j < nuclei.length - 1; j++) {
      const consonantsBetween = nuclei[j + 1].start - nuclei[j].end;
      if (consonantsBetween < minConsonants) { minConsonants = consonantsBetween; mergeIdx = j; }
    }
    nuclei[mergeIdx] = { start: nuclei[mergeIdx].start, end: nuclei[mergeIdx + 1].end };
    nuclei.splice(mergeIdx + 1, 1);
  }

  const useWord = word;
  const useN = n;

  if (nuclei.length === syllableCount) {
    const boundaries: number[] = [0];
    for (let j = 0; j < nuclei.length - 1; j++) {
      const gapStart = nuclei[j].end;
      const gapEnd = nuclei[j + 1].start;
      const consonants = gapEnd - gapStart;
      let boundary: number;
      if (consonants <= 0) {
        boundary = gapEnd;
      } else if (consonants === 1) {
        // Single intervocalic consonant: Maximal Onset (open, V·CV) by default,
        // but a checked/short stressed vowel CLOSES the syllable (VC·V):
        // sev·en / rob·in / lem·on, vs. open e·ven / o·pen / ro·bot after a free
        // (long) vowel.  Falls back to MOP when vowel length is unknown (OOV).
        boundary = (vowelLengths && vowelLengths[j] === 'short') ? gapEnd : gapStart;
      } else if (consonants === 2) {
        const pair = lower.substring(gapStart, gapEnd);
        if (MEDIAL_ONSET.has(pair)) {
          // Onset cluster (muta cum liquida) normally begins the next syllable
          // (ta·ble, se·cret, pro·gram) — UNLESS a checked/short vowel closes the
          // syllable, in which case one consonant stays behind (prob·lem, frac·ture).
          boundary = (vowelLengths && vowelLengths[j] === 'short') ? gapStart + 1 : gapStart;
        } else if (DIGRAPHS.has(pair)) {
          if (CODA_DIGRAPHS.has(pair)) {
            // Common coda: digraph goes with preceding syllable
            boundary = gapEnd;
          } else {
            // Common onset: digraph goes with following syllable
            boundary = gapStart;
          }
        } else {
          // Not a cluster/digraph: split (first consonant with prev, second with next)
          boundary = gapStart + 1;
        }
      } else {
        // 3+ consonants: maximise the onset — a legal THREE-consonant onset
        // (s + stop + liquid/glide) carries whole to the next syllable ONLY
        // when the preceding vowel is known to be long/free (a stressed short
        // vowel takes the s as its coda: mis·tress, but a free vowel opens:
        // de·stroy with reduced e).  Else a final 2-consonant onset cluster or
        // digraph carries; otherwise only the last consonant (chil·dren).
        const lastThree = lower.substring(gapEnd - 3, gapEnd);
        const lastTwo = lower.substring(gapEnd - 2, gapEnd);
        if (TRIPLE_ONSET.has(lastThree) && vowelLengths && vowelLengths[j] === 'long') {
          boundary = gapEnd - 3;
        } else if (MEDIAL_ONSET.has(lastTwo) || DIGRAPHS.has(lastTwo)) {
          boundary = gapEnd - 2;
        } else {
          boundary = gapEnd - 1;
        }
      }
      // Final "consonant + le" overrides: the consonant before "le" joins it.
      if (endsConsonantLe && j === nuclei.length - 2) {
        boundary = n - 3;
      }
      if (boundary >= n) boundary = n - 1;
      if (boundary <= boundaries[boundaries.length - 1]) {
        boundary = boundaries[boundaries.length - 1] + 1;
      }
      boundaries.push(boundary);
    }
    boundaries.push(n);

    const result: string[] = [];
    for (let j = 0; j < boundaries.length - 1; j++) {
      const origStart = hyphenMap.length > 0 ? hyphenMap[boundaries[j]] : boundaries[j];
      const origEnd = hyphenMap.length > 0 ? (boundaries[j + 1] < hyphenMap.length ? hyphenMap[boundaries[j + 1]] : word.length) : boundaries[j + 1];
      result.push(word.slice(origStart, origEnd));
    }
    while (result.length < syllableCount) result.push('');
    return result.slice(0, syllableCount);
  }

  const result: string[] = [];
  let start = 0;
  for (let s = 0; s < syllableCount - 1; s++) {
    const remaining = syllableCount - s;
    const remainingChars = n - start;
    const idealLen = Math.round(remainingChars / remaining);
    let end = start + Math.max(2, idealLen);
    if (end > n - (remaining - 1) * 2) end = n - (remaining - 1) * 2;
    if (end <= start + 1) end = start + 2;
    if (end > n) end = n;
    const origStart = hyphenMap.length > 0 ? hyphenMap[start] : start;
    const origEnd = hyphenMap.length > 0 ? (end < hyphenMap.length ? hyphenMap[end] : word.length) : end;
    result.push(word.slice(origStart, origEnd));
    start = end;
  }
  const origStart = hyphenMap.length > 0 ? hyphenMap[start] : start;
  result.push(word.slice(origStart));
  while (result.length < syllableCount) result.push('');
  return result.slice(0, syllableCount);
}

/**
 * Flatten all syllables into display entries with word context.
 * Each entry carries the original word text, the syllable text
 * (orthographic chunk), the syllable's position within the word,
 * and its relative stress level.
 */
export function flattenDisplayEntries(words: ClsWord[]): SyllableDisplayEntry[] {
  const result: SyllableDisplayEntry[] = [];
  let globalIdx = 0;
  let wordIdx = 0;

  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const sylCount = w.syllables.length;
    const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix, w.morphPrefix);
    for (let si = 0; si < sylCount; si++) {
      result.push({
        wordText: w.word,
        sylText: chunks[si],
        sylIndex: si,
        sylCount,
        relativeStress: w.syllables[si].relativeStress ?? 'w',
        globalIndex: globalIdx++,
        wordIndex: wordIdx,
      });
    }
    wordIdx++;
  }

  return result;
}
```

## phrasestress.ts

```typescript
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

import { ClsWord } from './types.js';
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

```

## rhyme.ts

```typescript
// rhyme.ts — Rhyme-pair classification, stanza rhyme-scheme detection, and
// poetic FORM identification.
//
// Rhyme typology follows the maintainer's LYRICAL app (meter_exemplars.ts
// RHYME_TYPES) so the two toolkits stay cross-compatible: perfect / rich /
// family / assonant / consonant / augmented / diminished / wrenched / eye /
// identical, with the structural qualifiers masculine / feminine / dactylic.
// Phonology comes from the augmented CMU dictionary (nounsing-pro); the
// orthographic (eye/wrenched) tier is a deliberately guarded fallback.
//
// FORM is a stanza/poem-level verdict (this is where "ballad" lives — a
// quatrain with ballad rhyme AND alternating 4·3 beats — NOT in the rhythm
// pass).  Form names align with LYRICAL's FORM_REGISTRY where they overlap
// (Couplet, Triplet, Quatrain, Limerick, Petrarchan/Shakespearean Sonnet…).

import * as nounsing from 'nounsing-pro';
import { ClsWord, LineResult, PhonologicalScansionDetail, StressLevel } from './types.js';
import { isPunctuation } from './parser.js';
import { ictusProfile } from './scansion.js';
import { preCaesuralWords } from './caesura.js';

export type RhymeTypeName =
  | 'identical' | 'rich' | 'perfect' | 'family'
  | 'assonant' | 'consonant' | 'augmented' | 'diminished'
  | 'wrenched' | 'eye';

export interface RhymePair {
  type: RhymeTypeName;
  /** masculine (stress on final syllable) / feminine (penult) / dactylic (antepenult) */
  structure?: 'masculine' | 'feminine' | 'dactylic';
}

const VOWEL_RE = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)/;
const PLOSIVES = new Set(['B', 'D', 'G', 'P', 'T', 'K']);
const FRICATIVES = new Set(['V', 'DH', 'Z', 'ZH', 'JH', 'F', 'TH', 'S', 'SH', 'CH', 'HH']);
const NASALS = new Set(['M', 'N', 'NG']);

const isVowelPhone = (p: string) => VOWEL_RE.test(p);
const base = (p: string) => p.replace(/[0-9]/g, '');
const sameFamily = (a: string, b: string) =>
  (PLOSIVES.has(a) && PLOSIVES.has(b)) || (FRICATIVES.has(a) && FRICATIVES.has(b)) || (NASALS.has(a) && NASALS.has(b));

function phonesOf(word: string): string[] | null {
  const clean = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return null;
  try {
    const ph = nounsing.firstPhonesForWord(clean);
    if (typeof ph === 'string' && ph.length > 0) return ph.split(' ');
  } catch { /* OOV */ }
  return null;
}

/** Index of the LAST stressed (1/2) vowel; falls back to the last vowel. */
function lastStressedIdx(ph: string[]): number {
  let lastVowel = -1;
  for (let i = ph.length - 1; i >= 0; i--) {
    if (!isVowelPhone(ph[i])) continue;
    if (lastVowel < 0) lastVowel = i;
    if (/[12]$/.test(ph[i])) return i;
  }
  return lastVowel;
}

/** masculine/feminine/dactylic from how many vowels FOLLOW the rhyming vowel. */
function structureOf(ph: string[], idx: number): RhymePair['structure'] {
  let after = 0;
  for (let i = idx + 1; i < ph.length; i++) if (isVowelPhone(ph[i])) after++;
  return after === 0 ? 'masculine' : after === 1 ? 'feminine' : 'dactylic';
}

/** Guarded orthographic tier: shared ending ≥3 chars, matching final phone if
 *  known, and never on a shared bare "-ing" (mass false positives). */
function orthographicTier(a: string, b: string, pa: string[] | null, pb: string[] | null): RhymeTypeName | null {
  const wa = a.toLowerCase().replace(/[^a-z]/g, '');
  const wb = b.toLowerCase().replace(/[^a-z]/g, '');
  if (wa.length < 3 || wb.length < 3) return null;
  let common = 0;
  while (common < Math.min(wa.length, wb.length) && wa[wa.length - 1 - common] === wb[wb.length - 1 - common]) common++;
  if (common < 3) return null;
  if (wa.slice(-3) === 'ing' && wb.slice(-3) === 'ing' && common <= 4) return null;
  if (pa && pb && base(pa[pa.length - 1]) !== base(pb[pb.length - 1])) return null;
  // Wrenched when the shared ending is an UNSTRESSED suffix of a polysyllable
  // (temperate/date, manifestation/convention); plain eye-rhyme otherwise.
  const polyUnstressed = (ph: string[] | null) => {
    if (!ph) return false;
    const idx = lastStressedIdx(ph);
    return idx >= 0 && structureOf(ph, idx) !== 'masculine';
  };
  return polyUnstressed(pa) !== polyUnstressed(pb) ? 'wrenched' : 'eye';
}

/** Classify the rhyme relation between two line-end words (or null). */
export function classifyRhymePair(a: string, b: string): RhymePair | null {
  const wa = a.toLowerCase().replace(/[^a-z']/g, '');
  const wb = b.toLowerCase().replace(/[^a-z']/g, '');
  if (!wa || !wb) return null;
  const pa = phonesOf(a);
  const pb = phonesOf(b);
  if (wa === wb) return { type: 'identical', structure: pa ? structureOf(pa, lastStressedIdx(pa)) : undefined };
  if (!pa || !pb) {
    const t = orthographicTier(a, b, pa, pb);
    return t ? { type: t } : null;
  }
  const ia = lastStressedIdx(pa);
  const ib = lastStressedIdx(pb);
  if (ia < 0 || ib < 0) return null;
  const ra = pa.slice(ia);
  const rb = pb.slice(ib);
  const structure = structureOf(pa, ia);
  const sameStructure = structure === structureOf(pb, ib);

  const norm = (seg: string[]) => seg.map(base);
  const na = norm(ra);
  const nb = norm(rb);
  const partsEqual = na.length === nb.length && na.every((p, i) => p === nb[i]);

  if (partsEqual && sameStructure) {
    const onsetA = ia > 0 ? base(pa[ia - 1]) : '';
    const onsetB = ib > 0 ? base(pb[ib - 1]) : '';
    return { type: onsetA === onsetB ? 'rich' : 'perfect', structure };
  }

  const vowelSame = na[0] === nb[0];
  const codaA = na.slice(1).filter(p => !isVowelPhone(p));
  const codaB = nb.slice(1).filter(p => !isVowelPhone(p));
  const codaEq = codaA.length === codaB.length && codaA.every((p, i) => p === codaB[i]);

  if (vowelSame) {
    // Same stressed vowel.  Matching-length codas whose consonants pair up
    // within one phonetic family (wet/deck, dame/grain) → family rhyme.
    if (codaA.length === codaB.length && codaA.length > 0
        && codaA.every((p, i) => p === codaB[i] || sameFamily(p, codaB[i]))) {
      return { type: 'family', structure };
    }
    // One extra trailing consonant on the second/first word (bray/brave).
    if (codaA.length + 1 === codaB.length && codaA.every((p, i) => p === codaB[i])) return { type: 'augmented', structure };
    if (codaB.length + 1 === codaA.length && codaB.every((p, i) => p === codaA[i])) return { type: 'diminished', structure };
    return { type: 'assonant', structure };
  }
  if (codaEq && codaA.length > 0) return { type: 'consonant', structure };
  const t = orthographicTier(a, b, pa, pb);
  return t ? { type: t } : null;
}

// Strength tiers for scheme detection.
const STRONG: Set<RhymeTypeName> = new Set(['identical', 'rich', 'perfect', 'family']);
const SLANT: Set<RhymeTypeName> = new Set(['assonant', 'consonant', 'augmented', 'diminished', 'wrenched', 'eye']);
// Full rhyme only — the stricter bar a pre-caesural INTERNAL rhyme must clear.
const STRICT_INTERNAL: Set<RhymeTypeName> = new Set(['identical', 'rich', 'perfect']);

export interface LineRhyme {
  endWord: string;
  letter: string;          // scheme letter ('A', 'B', …; '·' = unrhymed)
  type?: RhymeTypeName;    // relation to the matched earlier line
  matchedLine?: number;    // 0-based index within the stanza
}

/** Detect a stanza's rhyme scheme from its line-end words.  Strong rhymes
 *  bind; slant-tier rhymes bind only when no strong candidate exists. */
export function detectScheme(endWords: string[]): LineRhyme[] {
  const out: LineRhyme[] = [];
  let nextLetter = 0;
  for (let i = 0; i < endWords.length; i++) {
    let best: { j: number; pair: RhymePair } | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const pair = classifyRhymePair(endWords[j], endWords[i]);
      if (!pair) continue;
      if (STRONG.has(pair.type)) { best = { j, pair }; break; }    // nearest strong wins
      if (!best && SLANT.has(pair.type)) best = { j, pair };       // else nearest slant
    }
    if (best) {
      out.push({ endWord: endWords[i], letter: out[best.j].letter, type: best.pair.type, matchedLine: best.j });
    } else {
      out.push({ endWord: endWords[i], letter: String.fromCharCode(65 + (nextLetter++ % 26)) });
    }
  }
  // Rebind pass: a STRONG rhyme claims its partner back from an earlier
  // slant-tier binding.  (Sonnet 130: "rare" first slant-binds to the red/head
  // group, then "compare" arrives as its perfect partner — the couplet wins.)
  for (let k = 0; k < out.length; k++) {
    const r = out[k];
    if (r.matchedLine === undefined || !r.type || !STRONG.has(r.type)) continue;
    const target = out[r.matchedLine];
    if (target.matchedLine !== undefined && target.type && SLANT.has(target.type)) {
      const fresh = String.fromCharCode(65 + (nextLetter++ % 26));
      target.letter = fresh;
      target.type = undefined;
      target.matchedLine = undefined;
      r.letter = fresh;
    }
  }
  // Lines whose letter never recurs are unrhymed: mark '·' for readability.
  const counts = new Map<string, number>();
  for (const r of out) counts.set(r.letter, (counts.get(r.letter) ?? 0) + 1);
  for (const r of out) if ((counts.get(r.letter) ?? 0) < 2) r.letter = '·';
  // Re-letter the survivors in order of first appearance (A, B, C…).
  const remap = new Map<string, string>();
  let k = 0;
  for (const r of out) {
    if (r.letter === '·') continue;
    if (!remap.has(r.letter)) remap.set(r.letter, String.fromCharCode(65 + (k++ % 26)));
    r.letter = remap.get(r.letter)!;
  }
  return out;
}

const schemeStr = (rs: LineRhyme[]) => rs.map(r => r.letter).join('');

/** Canonical scheme for FORM matching: every line gets a letter in sequential
 *  first-appearance order, unrhymed lines (·) each their own — so "·A·A"
 *  compares as "ABCB". */
function canonicalScheme(rs: LineRhyme[]): string {
  const remap = new Map<string, string>();
  let k = 0;
  const next = () => String.fromCharCode(65 + (k++ % 26));
  let out = '';
  for (const r of rs) {
    if (r.letter === '·') { out += next(); continue; }
    if (!remap.has(r.letter)) remap.set(r.letter, next());
    out += remap.get(r.letter)!;
  }
  return out;
}

/** Stanza-level form verdict (LYRICAL-compatible names where they overlap). */
function stanzaForm(rhymes: LineRhyme[], details: PhonologicalScansionDetail[]): string | undefined {
  const s = canonicalScheme(rhymes);
  const n = rhymes.length;
  const meters = details.map(d => (d.consensusMeter ?? d.meter).split(' ')[0]);
  const dominant = (name: string, frac = 0.5) => meters.filter(m => m === name).length / n >= frac;

  if (n === 2 && s === 'AA') return 'couplet';
  if (n === 3) {
    if (s === 'ABA') return 'triplet (tercet, ABA)';
    if (s === 'AAA') return 'mono-rhymed triplet';
  }
  if (n === 4) {
    // Beat counts for the ballad gate: footCount (classical) or ictus count.
    const beats = details.map((d, i) =>
      d.footCount > 0 ? d.footCount : ictusProfile(d.scansion).ictuses);
    const alt43 = beats.length === 4 && beats[0] === beats[2] && beats[1] === beats[3]
      && beats[0] === beats[1] + 1;
    if (s === 'ABAB' || s === 'ABCB') {
      if (alt43) return `ballad stanza (${s}, ${beats[0]}·${beats[1]})`;
      return s === 'ABAB' ? 'quatrain (cross-rhymed, ABAB)' : `ballad-rhyme quatrain (ABCB)`;
    }
    if (s === 'ABBA') return 'quatrain (envelope, ABBA)';
    if (s === 'AABB') return 'quatrain (couplet pair, AABB)';
    if (s === 'AAAA') return 'mono-rhymed quatrain';
  }
  if (n === 5 && s === 'AABBA') {
    const ternary = meters.filter(m => m === 'anapestic' || m === 'amphibrachic' || m === 'dactylic').length >= 3;
    return ternary ? 'limerick (AABBA, ternary)' : 'limerick rhyme (AABBA)';
  }
  if (n === 6 && s === 'ABABCC') return 'sextilla / Venus-and-Adonis stanza (ABABCC)';
  if (n === 7 && s === 'ABABBCC') return 'rhyme royal (ABABBCC)';
  if (n === 8 && (s === 'ABABABCC' || s === 'ABABABAB')) return `octave (${s})`;

  // Unrhymed stanza: blank verse when iambic pentameter dominates.
  const unrhymed = rhymes.every(r => r.letter === '·');
  if (unrhymed && n >= 3) {
    const iambicPenta = details.filter(d =>
      (d.consensusMeter ?? d.meter) === 'iambic pentameter').length / n;
    if (iambicPenta >= 0.6) return 'blank verse';
    if (details.every(d => d.meterName === 'free verse') || details.some(d => d.rhythmNote)) return undefined; // rhythm layer already speaks
  }
  return undefined;
}

/** Poem-level form verdicts that span stanzas (sonnets, terza rima…). */
function poemForm(stanzas: { rhymes: LineRhyme[]; details: PhonologicalScansionDetail[] }[]): string | undefined {
  const all = stanzas.flatMap(st => st.rhymes);
  const n = all.length;
  // Whole-poem scheme with stanza-local letters concatenated is NOT meaningful;
  // re-detect across the full poem for sonnet/terza checks.
  if (n === 14) {
    const rs = detectScheme(all.map(r => r.endWord));
    const s = canonicalScheme(rs);
    if (/^ABABCDCDEFEFGG$/.test(s)) return 'Shakespearean Sonnet';
    if (/^ABBAABBA/.test(s)) return 'Petrarchan Sonnet';
    if (s.endsWith('GG') || /(..)\1*..$/.test(s)) {
      // 14 iambic-pentameter lines with a closing couplet still reads sonnet-like.
      const last2 = rs[12].letter !== '·' && rs[12].letter === rs[13].letter;
      const iambicPenta = stanzas.flatMap(st => st.details)
        .filter(d => (d.consensusMeter ?? d.meter) === 'iambic pentameter').length / 14;
      if (last2 && iambicPenta >= 0.5) return 'sonnet (14 lines, closing couplet)';
    }
  }
  // Terza rima: chained tercets ABA BCB CDC…
  if (stanzas.length >= 3 && stanzas.every(st => st.rhymes.length === 3)) {
    let chained = true;
    for (let i = 0; i + 1 < stanzas.length && chained; i++) {
      const mid = stanzas[i].rhymes[1].endWord;
      const nxt = stanzas[i + 1].rhymes;
      const p1 = classifyRhymePair(mid, nxt[0].endWord);
      const p3 = classifyRhymePair(mid, nxt[2].endWord);
      if (!(p1 && STRONG.has(p1.type)) || !(p3 && STRONG.has(p3.type))) chained = false;
    }
    if (chained) return 'terza rima (ABA BCB CDC…)';
  }
  return undefined;
}

/** Syllable-bearing (non-punctuation) words of a line, in linear order. */
function lineWords(line: LineResult): ClsWord[] {
  return line.sentence.words.filter(w => !isPunctuation(w.lexicalClass) && w.syllables.length > 0);
}

/** Reader-facing surface of a word: the original case when the parser's
 *  sentence-initial de-capitalisation touched it ("Nap"->word:"nap"), else `word`.
 *  Rhyme CLASSIFICATION stays on `word` (it lowercases internally anyway); only
 *  what we REPORT uses this. */
function surfaceOf(w: ClsWord): string {
  return w.displayWord ?? w.word;
}

/** Last syllable-bearing word of a line (across its merged sentences). */
function lineEndWord(line: LineResult): string {
  const ws = lineWords(line);
  return ws.length ? surfaceOf(ws[ws.length - 1]) : '';
}

// ─── INTERNAL (PRE-CAESURAL) RHYME — additive layer ─────────────────
//
// The per-stanza END-rhyme scheme (detectScheme) is the primary, UNTOUCHED
// system: every line keeps its end letter AND its rhyme type.  Layered ON TOP,
// a word immediately preceding a caesura that FULLY rhymes (identical/rich/
// perfect — never the looser slant tiers, which on a caesura word are mostly
// coincidental noise) with an end word, or with another such internal word, is
// annotated as an INTERNAL rhyme.  It reuses the end-rhyme letter it echoes, or
// — for an internal-only pair — a fresh letter that does not collide with the
// stanza's end letters.  Internal rhymes render parenthesised before the end
// letter ("(A)B"), each carrying its own type.  Purely additive: the end
// scheme's letters and types are never modified.

/** Attach pre-caesural internal rhymes to each line's `detail.rhyme`, on top of
 *  the per-stanza end scheme `rhymes` (from detectScheme).  Mutates in place. */
function attachInternalRhymes(lines: LineResult[], rhymes: LineRhyme[]): void {
  interface Pos { line: number; word: string; kind: 'end' | 'internal'; }
  const positions: Pos[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lw = lineWords(lines[i]);
    const endObj = lw.length ? lw[lw.length - 1] : undefined;
    positions.push({ line: i, word: rhymes[i].endWord, kind: 'end' });
    const pre = preCaesuralWords(
      lines[i].sentence.words, lines[i].phonologicalHierarchy, lines[i].phonologicalScansion.scansion);
    for (const { word } of pre) {
      if (word === endObj || !word.isContent) continue;  // the end word / function words are not internal-rhyme bearers
      positions.push({ line: i, word: word.word, kind: 'internal' });
    }
  }
  // Union-find over positions.  End-end links are NOT made (detectScheme already
  // lettered the ends); only links INVOLVING an internal, at the full-rhyme tier.
  const parent = positions.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let a = 0; a < positions.length; a++) {
    for (let b = a + 1; b < positions.length; b++) {
      if (positions[a].kind === 'end' && positions[b].kind === 'end') continue;
      if (!positions[a].word || !positions[b].word) continue;
      const pair = classifyRhymePair(positions[a].word, positions[b].word);
      if (pair && STRICT_INTERNAL.has(pair.type)) union(a, b);
    }
  }
  // Letter per class: a class containing a lettered end takes that end's letter;
  // an internal-only class of >=2 gets a fresh letter clear of the stanza's ends.
  const endLetterAt = new Map<number, string>();
  positions.forEach((p, i) => { if (p.kind === 'end' && rhymes[p.line].letter !== '\u00b7') endLetterAt.set(i, rhymes[p.line].letter); });
  const used = new Set<string>(rhymes.filter(r => r.letter !== '\u00b7').map(r => r.letter));
  let code = 0;
  const freshLetter = () => { let c: string; do { c = String.fromCharCode(65 + (code++ % 26)); } while (used.has(c)); used.add(c); return c; };
  const classMembers = new Map<number, number[]>();
  for (let i = 0; i < positions.length; i++) { const r = find(i); if (!classMembers.has(r)) classMembers.set(r, []); classMembers.get(r)!.push(i); }
  const classLetter = new Map<number, string>();
  for (const [root, members] of classMembers) {
    if (members.length < 2) continue;
    const endMember = members.find(m => endLetterAt.has(m));
    if (endMember !== undefined) classLetter.set(root, endLetterAt.get(endMember)!);
    else if (members.some(m => positions[m].kind === 'internal')) classLetter.set(root, freshLetter());
  }
  const typeOf = (p: number): RhymeTypeName | undefined => {
    for (const m of classMembers.get(find(p)) ?? []) {
      if (m === p) continue;
      const pair = classifyRhymePair(positions[m].word, positions[p].word);
      if (pair && STRICT_INTERNAL.has(pair.type)) return pair.type;
    }
    return undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const internal: { word: string; letter: string; type?: string }[] = [];
    positions.forEach((p, idx) => {
      if (p.line !== i || p.kind !== 'internal') return;
      const letter = classLetter.get(find(idx));
      if (letter) internal.push({ word: p.word, letter, type: typeOf(idx) });
    });
    const endLetter = rhymes[i].letter;
    const intStr = internal.map(x => `(${x.letter})`).join('');
    const notation = intStr + (endLetter !== '\u00b7' ? endLetter : (internal.length ? '' : '\u00b7'));
    lines[i].phonologicalScansion.rhyme = {
      endWord: rhymes[i].endWord,
      letter: endLetter,
      type: rhymes[i].type,
      matchedLine: rhymes[i].matchedLine,
      internal: internal.length ? internal : undefined,
      notation,
    };
  }
}

/**
 * Annotate rhyme letters/types (`detail.rhyme`) and form verdicts
 * (`detail.formNote`) across a poem.  Stanza forms are per-stanza; a poem-level
 * form (sonnet, terza rima) overrides stanza notes.  Annotation-only — no
 * meter/scansion/certainty is touched.
 */
export function applyRhymeAndForm(stanzas: LineResult[][]): void {
  // FORM detection uses per-stanza end-rhyme schemes (relative, restarting each
  // stanza) — that is what couplet/quatrain/sonnet patterns are defined over.
  const analyzed = stanzas.map(lines => {
    const details = lines.map(l => l.phonologicalScansion);
    const rhymes = detectScheme(lines.map(lineEndWord));
    return { lines, details, rhymes };
  });
  for (const { details, rhymes } of analyzed) {
    const form = stanzaForm(rhymes, details);
    for (const d of details) d.formNote = form;
  }
  const pform = poemForm(analyzed);
  if (pform) for (const { details } of analyzed) for (const d of details) d.formNote = pform;
  // Per-stanza end-rhyme letters + TYPES (detectScheme), then the additive
  // pre-caesural internal-rhyme layer.  Writes `detail.rhyme`; the original
  // end-rhyme display is restored and extended, never replaced.
  for (const { lines, rhymes } of analyzed) attachInternalRhymes(lines, rhymes);
}

// ─── PHONOPOETICS — poem-wide end / caesural / head rhyme, alliteration,
//     acrostic, with the maintainer's three-phase lettering ─────────────
//
// Lettering proceeds in three phases over ONE shared alphabet:
//   1. END words (line 1→N): each rhyme group gets a letter A,B,C…; a later word
//      reuses an earlier group's letter when it rhymes with it (across stanzas).
//   2. CAESURAL words (pre-caesura): continue the alphabet (new letter per new
//      caesural rhyme); a caesural word reuses an END letter ONLY if it rhymes
//      with that exact end group.
//   3. HEAD words (line-initial): continue the alphabet, a new letter per head
//      rhyme (head rhymes do not reuse end/caesural letters).
// Alliteration carries NO letters; an acrostic's letters are inherent.
// Each rhyme letter is to be COLOURED by the strongest relative-stress tier among
// the syllables it spans (`topStress`) — done at the display layer.

const STRESS_ORDER: StressLevel[] = ['x', 'w', 'n', 'm', 's'];
function topStressOf(...ws: (ClsWord | undefined)[]): StressLevel {
  let best: StressLevel = 'x';
  for (const w of ws) {
    if (!w) continue;
    for (const s of w.syllables) {
      const r = s.relativeStress ?? 'w';
      if (STRESS_ORDER.indexOf(r) > STRESS_ORDER.indexOf(best)) best = r;
    }
  }
  return best;
}

/** First consonant phoneme of a word (for alliteration), or '' if vowel-initial/OOV. */
function onsetPhone(word: string): string {
  const ph = phonesOf(word);
  if (!ph || ph.length === 0) return '';
  const p0 = base(ph[0]);
  return isVowelPhone(p0) ? '' : p0;
}

export interface RhymeRel {
  fromWord: string; fromLabel: string;       // the rhyme site being annotated
  toWord: string;   toLabel: string;         // its partner
  letter: string;
  type?: RhymeTypeName;
  kind: 'end' | 'caesural' | 'head';
  topStress: StressLevel;                    // strongest tier spanned (letter colour)
}
export interface Phonopoetics {
  endScheme: string;                         // poem-wide canonical end scheme ("ABAB…")
  end: RhymeRel[];
  caesural: RhymeRel[];
  head: RhymeRel[];
  alliteration: { label: string; words: string[] }[];
  acrostics: { labels: string[]; firsts: string[]; word: string }[];
}

/** Whole-poem phonopoetic analysis: structured data for the Phonopoetics
 *  synopsis section.  Read-only — never mutates the per-line scansion. */
export function analyzePhonopoetics(stanzas: LineResult[][]): Phonopoetics {
  const multi = stanzas.length > 1;
  interface PL { line: LineResult; label: string; }
  const PLs: PL[] = [];
  stanzas.forEach((st, s) => st.forEach((line, l) =>
    PLs.push({ line, label: multi ? `S${s + 1}L${l + 1}` : `L${l + 1}` })));

  const endObj = (pl: PL): ClsWord | undefined => { const ws = lineWords(pl.line); return ws[ws.length - 1]; };
  const headObj = (pl: PL): ClsWord | undefined => lineWords(pl.line).find(w => w.isContent);
  const caesuralObjs = (pl: PL): ClsWord[] => {
    const end = endObj(pl);
    const pre = preCaesuralWords(pl.line.sentence.words, pl.line.phonologicalHierarchy, pl.line.phonologicalScansion.scansion);
    return pre.map(p => p.word).filter(w => w !== end && w.isContent);
  };

  // ── Phase 1: END rhymes (poem-wide) ──
  const endWords = PLs.map(pl => lineEndWord(pl.line));
  const es = detectScheme(endWords);
  const endScheme = canonicalScheme(es);
  const byLetter = new Map<string, number[]>();
  es.forEach((r, i) => { if (r.letter !== '·') { (byLetter.get(r.letter) ?? byLetter.set(r.letter, []).get(r.letter)!).push(i); } });
  let nextCode = byLetter.size;
  const freshLetter = (): string => String.fromCharCode(65 + (nextCode++ % 26));

  const end: RhymeRel[] = [];
  for (const [letter, idxs] of byLetter) {
    for (let k = 1; k < idxs.length; k++) {
      const i = idxs[k], j = idxs[k - 1]; // j earlier, i later → show earlier → later
      end.push({
        fromWord: endWords[j], fromLabel: PLs[j].label,
        toWord: endWords[i], toLabel: PLs[i].label,
        letter, type: es[i].type, kind: 'end',
        topStress: topStressOf(endObj(PLs[i]), endObj(PLs[j])),
      });
    }
  }

  // ── Phase 2: CAESURAL rhymes ──
  interface CW { pl: number; word: ClsWord; letter?: string; pLabel?: string; pWord?: string; type?: RhymeTypeName; }
  const cws: CW[] = [];
  PLs.forEach((pl, i) => caesuralObjs(pl).forEach(w => cws.push({ pl: i, word: w })));
  // (a) bind to an exact END group it rhymes with → reuse that end letter
  for (const cw of cws) {
    for (let i = 0; i < PLs.length; i++) {
      if (es[i].letter === '·') continue;             // unrhymed end → not a "pair"
      const ew = endObj(PLs[i]); if (!ew || ew === cw.word) continue;
      const pair = classifyRhymePair(cw.word.word, ew.word);
      if (pair && STRICT_INTERNAL.has(pair.type)) {
        cw.letter = es[i].letter; cw.pLabel = PLs[i].label; cw.pWord = surfaceOf(ew); cw.type = pair.type; break;
      }
    }
  }
  // (b) caesural↔caesural among the still-unbound → fresh letters
  const unbound = cws.filter(c => !c.letter);
  for (let i = 0; i < unbound.length; i++) {
    if (unbound[i].letter) continue;
    for (let j = 0; j < i; j++) {
      const pair = classifyRhymePair(unbound[i].word.word, unbound[j].word.word);
      if (pair && STRICT_INTERNAL.has(pair.type)) {
        if (!unbound[j].letter) unbound[j].letter = freshLetter();
        unbound[i].letter = unbound[j].letter;
        // only the later member is annotated (points back) so each pair shows once
        unbound[i].pLabel = PLs[unbound[j].pl].label; unbound[i].pWord = surfaceOf(unbound[j].word); unbound[i].type = pair.type;
        break;
      }
    }
  }
  const caesural: RhymeRel[] = cws.filter(c => c.letter && c.pLabel).map(c => ({
    fromWord: surfaceOf(c.word), fromLabel: PLs[c.pl].label,
    toWord: c.pWord!, toLabel: c.pLabel!,
    letter: c.letter!, type: c.type, kind: 'caesural' as const,
    topStress: topStressOf(c.word),
  }));

  // ── Phase 3: HEAD rhymes (line-initial) — fresh letters, no reuse ──
  interface HW { pl: number; word: ClsWord; letter?: string; pLabel?: string; pWord?: string; type?: RhymeTypeName; }
  const hws: HW[] = PLs.map((pl, i) => ({ pl: i, word: headObj(pl)! })).filter(h => h.word);
  for (let i = 0; i < hws.length; i++) {
    if (hws[i].letter) continue;
    for (let j = 0; j < i; j++) {
      const pair = classifyRhymePair(hws[i].word.word, hws[j].word.word);
      if (pair && STRICT_INTERNAL.has(pair.type)) {
        if (!hws[j].letter) hws[j].letter = freshLetter();
        hws[i].letter = hws[j].letter;
        // only the later member is annotated (points back) so each pair shows once
        hws[i].pLabel = PLs[hws[j].pl].label; hws[i].pWord = surfaceOf(hws[j].word); hws[i].type = pair.type;
        break;
      }
    }
  }
  const head: RhymeRel[] = hws.filter(h => h.letter && h.pLabel).map(h => ({
    fromWord: surfaceOf(h.word), fromLabel: PLs[h.pl].label,
    toWord: h.pWord!, toLabel: h.pLabel!,
    letter: h.letter!, type: h.type, kind: 'head' as const,
    topStress: topStressOf(h.word),
  }));

  // ── Alliteration: maximal runs (≥2) of content words sharing first letter AND
  //    first consonant phoneme (function words may sit between, but do not count). ──
  const alliteration: { label: string; words: string[] }[] = [];
  for (const pl of PLs) {
    const cw = lineWords(pl.line).filter(w => w.isContent);
    let run: ClsWord[] = [];
    const flush = () => { if (run.length >= 2) alliteration.push({ label: pl.label, words: run.map(surfaceOf) }); run = []; };
    for (const w of cw) {
      const letter0 = (w.word.match(/[a-z]/i)?.[0] ?? '').toLowerCase();
      const phone0 = onsetPhone(w.word);
      if (!letter0 || !phone0) { flush(); continue; }
      if (run.length === 0) { run = [w]; continue; }
      const prev = run[run.length - 1];
      const pLetter = (prev.word.match(/[a-z]/i)?.[0] ?? '').toLowerCase();
      if (letter0 === pLetter && phone0 === onsetPhone(prev.word)) run.push(w);
      else { flush(); run = [w]; }
    }
    flush();
  }

  // ── Acrostic: per-stanza (and, if multi-stanza, whole-poem) first letters that
  //    spell a dictionary word (≥3 letters). ──
  const acrostics: { labels: string[]; firsts: string[]; word: string }[] = [];
  const firstLetterOf = (line: LineResult): string => {
    const ws = lineWords(line);
    return ws.length ? (ws[0].word.match(/[a-z]/i)?.[0] ?? '').toUpperCase() : '';
  };
  const checkAcrostic = (lines: LineResult[], labels: string[]) => {
    const firsts = lines.map(firstLetterOf);
    if (firsts.some(f => !f)) return;
    const word = firsts.join('');
    if (word.length >= 3 && phonesOf(word)) acrostics.push({ labels, firsts, word });
  };
  stanzas.forEach((st, s) => checkAcrostic(st, st.map((_, l) => multi ? `S${s + 1}L${l + 1}` : `L${l + 1}`)));
  if (multi) checkAcrostic(stanzas.flat(), PLs.map(p => p.label));

  return { endScheme, end, caesural, head, alliteration, acrostics };
}

// ─── POEM-LEVEL META-MEASURE (synopsis) ─────────────────────────────
//
// A cumulative, NON-INTERFERING reading of the whole poem, shown at the foot of
// the reading views.  It draws solely on determinations already made per line
// (meter, rhythm, rhyme, form) and never overrides them.  Deliberately offers
// SEVERAL top conclusions rather than forcing a single verdict.

// Canonical end-rhyme schemes of the LYRICAL FORM_REGISTRY forms whose pattern is
// expressible in plain letters (refrain forms — villanelle, pantoum, rondeau … —
// need repetition checking and are deferred).  Used to NOTE whole-poem rhyme-
// scheme alignment in the synopsis; the per-stanza/poem form layer remains the
// authority for the FORM verdict itself.
const REGISTRY_FORM_SCHEMES: { lines: number; scheme: string; name: string }[] = [
  { lines: 2,  scheme: 'AA',             name: 'Couplet' },
  { lines: 3,  scheme: 'ABA',            name: 'Triplet' },
  { lines: 4,  scheme: 'ABAB',           name: 'Quatrain' },
  { lines: 5,  scheme: 'AABBA',          name: 'Limerick' },
  { lines: 6,  scheme: 'ABABCC',         name: 'Sextilla' },
  { lines: 7,  scheme: 'ABABBCC',        name: 'Septet (rhyme royal)' },
  { lines: 9,  scheme: 'AAABBBCCC',      name: 'Triad' },
  { lines: 10, scheme: 'ABABCDECDE',     name: 'English Ode' },
  { lines: 14, scheme: 'ABABCDCDEFEFGG', name: 'Shakespearean Sonnet' },
  { lines: 14, scheme: 'ABBAABBACDCDCD', name: 'Petrarchan Sonnet' },
  { lines: 14, scheme: 'ABBAABBACDECDE', name: 'Petrarchan Sonnet' },
];

function matchRegistryForm(totalLines: number, canonicalEndScheme: string): string | undefined {
  return REGISTRY_FORM_SCHEMES.find(f => f.lines === totalLines && f.scheme === canonicalEndScheme)?.name;
}

/** A labelled line of the poem synopsis (display renders each). */
export interface SynopsisRow { label: string; value: string; }

const descriptorOf = (d: PhonologicalScansionDetail): string =>
  d.metricalityNote ? 'plausible prose'
    : d.rhythmNote ? d.rhythmNote                 // accentual/dolnik/taktovik → beats
    : d.meterName === 'free verse' ? 'free verse'
    : d.meter;                                    // e.g. "iambic pentameter"

// Compact metre labels for the synopsis ("iambic pentameter" → "iamb penta").
// Rhythm notes ("4/3 ♪beat accentual"), "free verse", and "plausible prose" are
// left untouched (they are not family+foot labels).
const _FAMILY_ABBR: Record<string, string> = {
  iambic: 'iamb', trochaic: 'troch', dactylic: 'dact', anapestic: 'anap',
  amphibrachic: 'amph', bacchic: 'bacch', spondaic: 'spon', pyrrhic: 'pyrr',
};
const _FOOT_ABBR: Record<string, string> = {
  monometer: 'mono', dimeter: 'di', trimeter: 'tri', tetrameter: 'tetra',
  pentameter: 'penta', hexameter: 'hexa', heptameter: 'hepta', octameter: 'octa',
};
function abbrevMeter(label: string): string {
  const parts = label.split(' ');
  if (parts.length === 2 && _FAMILY_ABBR[parts[0]] && _FOOT_ABBR[parts[1]]) {
    return `${_FAMILY_ABBR[parts[0]]} ${_FOOT_ABBR[parts[1]]}`;
  }
  return label;
}

/**
 * Build the cumulative poem synopsis: top meter(s)/mixed meters (accentual forms
 * reported in beats), the poem-wide rhyme scheme (with internal rhymes), and the
 * poetic-form alignment.  Reads only existing per-line determinations.
 */
export function summarizePoem(stanzas: LineResult[][]): SynopsisRow[] {
  const lines = stanzas.flat();
  const details = lines.map(l => l.phonologicalScansion);
  const N = details.length;
  const rows: SynopsisRow[] = [];
  if (N === 0) return rows;

  // ── Meter — several top conclusions, never forced into one ──
  const tally = new Map<string, number>();
  for (const d of details) tally.set(descriptorOf(d), (tally.get(descriptorOf(d)) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  let meterVal: string;
  if (N === 1) {
    meterVal = abbrevMeter(ranked[0][0]);
  } else if (ranked[0][1] / N >= 0.6) {
    const rest = ranked.slice(1, 3).map(([m, c]) => `${abbrevMeter(m)} (${c})`);
    meterVal = `predominantly ${abbrevMeter(ranked[0][0])} (${ranked[0][1]}/${N})`
      + (rest.length ? `; also ${rest.join(', ')}` : '');
  } else {
    meterVal = 'Mixed | ' + ranked.slice(0, 3).map(([m, c]) => `${abbrevMeter(m)} (${c}/${N})`).join(' · ');
  }
  // "Rhythm" = the metre make-up; "Meter" = the mean fit % (the maintainer's
  // synopsis taxonomy).
  rows.push({ label: 'Rhythm', value: meterVal });

  // ── Meter — mean of the per-line fit certainties ──
  const meanCert = Math.round(details.reduce((s, d) => s + d.certainty, 0) / N);
  rows.push({ label: 'Meter', value: `~${meanCert}% mean line-wise fit` });

  // ── Form — the form layer's verdict(s) + registry-scheme alignment.  (The
  // detailed rhyme listing now lives in the Phonopoetics section; the synopsis
  // carries only the canonical End-Rhyme Scheme, below.) ──
  const endRhymes = N >= 2 ? detectScheme(lines.map(lineEndWord)) : [];
  const endScheme = endRhymes.length ? canonicalScheme(endRhymes) : '';
  const hasEndRhyme = endRhymes.some(r => r.letter !== '·');
  const forms = [...new Set(details.map(d => d.formNote).filter((x): x is string => !!x))];
  let formVal: string | undefined = forms.length ? forms.join(' · ') : undefined;
  if (N >= 2) {
    const reg = matchRegistryForm(N, endScheme);
    if (reg && !(formVal && formVal.includes(reg))) {
      formVal = (formVal ? formVal + ' · ' : '') + `aligns with the ${reg} scheme`;
    }
  }
  if (formVal) rows.push({ label: 'Form', value: formVal });

  // ── End-Rhyme Scheme — poem-wide canonical scheme, its own row (only end
  // rhymes are matched against forms; caesural/head live in Phonopoetics). ──
  if (hasEndRhyme) rows.push({ label: 'End-Rhyme Scheme', value: endScheme });

  // ── Heterometric advisory — the whole-poem observation that per-line beat
  // counts vary widely (kept OUT of the per-line display, as an advisory here). ──
  const beats = details.map(d => (d.footCount > 0 ? d.footCount : ictusProfile(d.scansion).ictuses));
  const lo = Math.min(...beats), hi = Math.max(...beats);
  if (N >= 3 && hi - lo >= 3) {
    rows.push({ label: 'Note', value: `line lengths vary — ${lo}–${hi} beats per line` });
  }

  return rows;
}

```

## scandroid.ts

```typescript
// scandroid.ts — Optional Scandroid integration: provides classic iambic and
// anapestic scansion algorithms from Hartman’s Scandroid, adapted to TypeScript.
// This module is purely functional; it does not modify the main pipeline and
// can be omitted without affecting the phonological scansion.

import { StressLevel, MetreName, ScansionResult } from './types.js';

// ─── Constants from scanstrings.py ─────────────────────────────────

const STRESS = '/';
const SLACK = 'x';
const PROMOTED = '%';
const FOOTDIV = '|';

/** Foot dictionary for iambic lines (Scandroid’s footDict). */
const IAMBIC_FOOT_DICT: Record<string, string> = {
  'x/': 'iamb',
  'xx': 'pyrrhic',
  '//': 'spondee',
  '/x': 'trochee',
  'x/x': 'amphibrach',
  '//x': 'palimbacchius',
  'xx/': 'anapest',
  '/': 'defective',
  '/xx': 'dactyl',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '%x': '(trochee)',
  'x/xx': '2nd paeon',
  'xx/x': '3rd paeon',
};

/** Foot dictionary for anapestic lines (Scandroid’s AnapSubs). */
const ANAPESTIC_FOOT_DICT: Record<string, string> = {
  'xx/': 'anapest',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x/': 'iamb',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '//': 'spondee',
  'xx/x': '3rd paeon',
  'x/x': 'amphibrach',
  '///': 'molossus',
  '/x%': '(cretic)',
  '//x': 'palimbacchius',
};

// ─── Utility functions (adapted from scanutilities.py) ────────────

/** Generator-like function to walk through a string in chunks, matching a dictionary. */
function footFinder(
  fDict: Record<string, string>,
  str: string,
  chunkSize: number,
  start: number,
  end: number
): Array<{ foot: string; index: number }> {
  const result: Array<{ foot: string; index: number }> = [];
  let pos = start;
  while (pos < end) {
    const chunk = str.slice(pos, pos + chunkSize);
    if (chunk in fDict) {
      pos += chunkSize;
      result.push({ foot: fDict[chunk], index: pos });
    } else {
      // signal failure by returning empty array
      return [];
    }
  }
  return result;
}

/** Find the longest match of a RegExp in a string (last occurrence of longest length). */
function longestMatch(rx: RegExp, s: string): { start: number; length: number } | null {
  let start = -1, length = 0;
  let current = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s.slice(current))) !== null) {
    const mStart = current + m.index;
    const mEnd = mStart + m[0].length;
    if (mEnd - mStart >= length) {
      start = mStart;
      length = mEnd - mStart;
    }
    current = mStart + 1;
  }
  return start >= 0 ? { start, length } : null;
}

/** Compute line length in feet by counting non-adjacent stresses (for anapestic estimation). */
function altLineLenCalc(marks: string): number {
  const arr = marks.split('');
  for (let i = 0; i < arr.length; i++) {
    if (i === 0 || arr[i - 1] === '/') {
      if (arr[i] === '/') arr[i] = 'x';
    }
  }
  return arr.filter(ch => ch === '/').length;
}

// ─── Complexity measurement (from Scandroid’s _measureComplexity) ──

function iambicComplexity(footlist: string[], numFeet: number): number {
  if (footlist.length !== numFeet) return 100;
  let prevIsTrochee = false;
  let points = 0;
  for (let i = 0; i < footlist.length; i++) {
    let f = footlist[i];
    if (f.startsWith('(') && f.endsWith(')')) f = f.slice(1, -1);
    if (['spondee', 'pyrrhic', 'trochee'].includes(f)) points += 2;
    if (['anapest', 'defective', '3rd paeon', 'amphibrach', 'palimbacchius', '2nd paeon'].includes(f)) points += 4;
    if (['dactyl', 'cretic', 'bacchius'].includes(f)) points += 10;
    if (f === 'trochee') {
      if (i === footlist.length - 1) points += 6;
      if (prevIsTrochee) points += 8;
      prevIsTrochee = true;
    } else prevIsTrochee = false;
    if ((f === 'trochee' || f === 'defective') /* bounds test omitted for simplicity */) points += 4;
  }
  return points;
}

function anapesticComplexity(footlist: string[]): number {
  if (footlist.length === 0) return 100;
  let points = 0;
  for (const f of footlist) {
    if (f === 'bacchius') points += 2;
    else if (f === '(anapest)') points += 1;
    else if (f === 'iamb' || f === '(iamb)') points += 2;
    else if (f === 'cretic') points += 4;
    else if (['spondee', 'pyrrhic'].includes(f)) points += 4;
    else if (['amphibrach', '3rd paeon'].includes(f)) points += 4;
    else if (['2nd paeon', 'molossus', 'palimbacchius'].includes(f)) points += 5;
  }
  return points;
}

// ─── Iambic Algorithm 1: Corral the Weird ─────────────────────────

export function scandroidCorralWeird(
  marks: string,
  numFeet: number
): { footlist: string[]; scansionMarks: string } {
  const footlist: string[] = [];
  let remaining = marks;
  let lastFoot = '';

  // Step 1: handle terminal slack (extra syllables at end)
  const normLen = numFeet * 2;
  if (remaining.length > normLen + 1 && ['x/xx', 'xx/x'].includes(remaining.slice(-4))) {
    lastFoot = IAMBIC_FOOT_DICT[remaining.slice(-4)];
    remaining = remaining.slice(0, -4);
  } else if (remaining.length >= normLen && ['x/x', '//x'].includes(remaining.slice(-3))) {
    lastFoot = IAMBIC_FOOT_DICT[remaining.slice(-3)];
    remaining = remaining.slice(0, -3);
  }

  // Step 2: handle acephalous (headless) line
  if (remaining.length <= normLen - 2 && (remaining.startsWith('/x/x') || remaining.startsWith('/xxx'))) {
    footlist.push('defective');
    remaining = remaining.slice(1);
  }

  const currLen = remaining.length;
  const needFeet = numFeet - footlist.length - (lastFoot ? 1 : 0);
  const targetLen = needFeet * 2;

  if (currLen === targetLen) {
    const feet = footFinder(IAMBIC_FOOT_DICT, remaining, 2, 0, currLen);
    if (feet.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...feet.map(f => f.foot));
  } else if (currLen < targetLen) {
    // seek a defective foot (single stress)
    const candidate = remaining.indexOf('x//');
    if (candidate === -1 || candidate % 2 !== 0) return { footlist: [], scansionMarks: '' };
    const defectivePos = candidate + 2;
    const before = footFinder(IAMBIC_FOOT_DICT, remaining, 2, 0, defectivePos);
    if (before.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...before.map(f => f.foot));
    footlist.push('defective');
    const after = footFinder(IAMBIC_FOOT_DICT, remaining, 2, defectivePos + 1, currLen);
    if (after.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...after.map(f => f.foot));
  } else {
    // need anapests to fill extra syllables
    const need = currLen - targetLen;
    // collect candidate positions for anapest insertion
    const candidates: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (remaining.slice(i, i + 4) === '/xx/') candidates.push(i + 1);
    }
    if (candidates.length < need) {
      for (let i = 0; i < remaining.length; i++) {
        if (remaining.slice(i, i + 3) === 'xx/') candidates.push(i);
      }
    }
    let pos = 0;
    let anapestsUsed = 0;
    while (pos < currLen) {
      if (anapestsUsed < need && candidates.includes(pos)) {
        const chunk = remaining.slice(pos, pos + 3);
        if (!(chunk in IAMBIC_FOOT_DICT)) return { footlist: [], scansionMarks: '' };
        footlist.push(IAMBIC_FOOT_DICT[chunk]);
        pos += 3;
        anapestsUsed++;
      } else {
        const chunk = remaining.slice(pos, pos + 2);
        if (!(chunk in IAMBIC_FOOT_DICT)) return { footlist: [], scansionMarks: '' };
        footlist.push(IAMBIC_FOOT_DICT[chunk]);
        pos += 2;
      }
    }
  }

  if (lastFoot) footlist.push(lastFoot);

  // Generate scansion string with foot divisions
  const scansion = footlist.map(f => f.startsWith('(') ? f : f).join('|'); // simplistic
  return { footlist, scansionMarks: scansion };
}

// ─── Iambic Algorithm 2: Maximize the Normal ─────────────────────

export function scandroidMaximizeNormal(
  marks: string,
  numFeet: number
): { footlist: string[]; scansionMarks: string } {
  const possIambRE = /(x[x/])+/;
  const match = longestMatch(possIambRE, marks);
  if (!match) return { footlist: [], scansionMarks: '' };
  const { start, length } = match;
  const runEnd = start + length;
  const headMarks = marks.slice(0, start);
  const tailMarks = marks.slice(runEnd);
  const mainMarks = marks.slice(start, runEnd);
  const footlist: string[] = [];
  const headFeet: string[] = [];
  const tailFeet: string[] = [];

  // Scan the regular middle stretch
  const mainFeet = footFinder(IAMBIC_FOOT_DICT, mainMarks, 2, 0, mainMarks.length);
  if (mainFeet.length === 0) return { footlist: [], scansionMarks: '' };
  footlist.push(...mainFeet.map(f => f.foot));

  // Scan head
  if (headMarks.length > 0) {
    if (headMarks.length % 2 === 0) {
      const hf = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, 0, headMarks.length);
      if (hf.length === 0) return { footlist: [], scansionMarks: '' };
      headFeet.push(...hf.map(f => f.foot));
    } else {
      if (headMarks.startsWith('/x')) {
        headFeet.push('defective');
        const rest = headMarks.slice(1);
        if (rest.length > 0) {
          const hf = footFinder(IAMBIC_FOOT_DICT, rest, 2, 0, rest.length);
          if (hf.length === 0) return { footlist: [], scansionMarks: '' };
          headFeet.push(...hf.map(f => f.foot));
        }
      } else {
        // try to find an anapest in the head
        const anap = headMarks.indexOf('xx/');
        if (anap === -1) return { footlist: [], scansionMarks: '' };
        const before = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, 0, anap);
        if (before.length === 0) return { footlist: [], scansionMarks: '' };
        headFeet.push(...before.map(f => f.foot));
        headFeet.push('anapest');
        const after = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, anap + 3, headMarks.length);
        if (after.length === 0) return { footlist: [], scansionMarks: '' };
        headFeet.push(...after.map(f => f.foot));
      }
    }
  }

  // Scan tail
  if (tailMarks.length > 0) {
    let lastFootStr = '';
    let tailPart = tailMarks;
    if (tailPart.slice(-1) === 'x' && tailPart.length > 2 && tailPart.slice(-3) in IAMBIC_FOOT_DICT) {
      lastFootStr = IAMBIC_FOOT_DICT[tailPart.slice(-3)];
      tailPart = tailPart.slice(0, -3);
    }
    const tf = footFinder(IAMBIC_FOOT_DICT, tailPart, 2, 0, tailPart.length);
    if (tf.length === 0) return { footlist: [], scansionMarks: '' };
    tailFeet.push(...tf.map(f => f.foot));
    if (lastFootStr) tailFeet.push(lastFootStr);
  }

  const completeList = [...headFeet, ...footlist, ...tailFeet];
  // Promote pyrrhics as in Scandroid’s PromotePyrrhics
  for (let i = 0; i < completeList.length; i++) {
    if (completeList[i] === 'pyrrhic') {
      if (i < completeList.length - 1 && completeList[i + 1] === 'spondee') {
        // nothing
      } else {
        completeList[i] = '(iamb)';
      }
    }
  }

  const scansion = completeList.join('|');
  return { footlist: completeList, scansionMarks: scansion };
}

// ─── Anapestic scanning ──────────────────────────────────────────

export function scandroidAnapestic(
  marks: string,
  numFeet?: number
): { footlist: string[]; scansionMarks: string } {
  let remaining = marks;
  if (!numFeet) {
    const [q, r] = [Math.floor(remaining.length / 3), remaining.length % 3];
    let need = q;
    if (r > 0) need++;
    need = Math.max(need, altLineLenCalc(remaining));
    numFeet = need;
  }

  // Handle terminal slack (promotions etc.)
  if (remaining.slice(-2) === 'xx') remaining = remaining.slice(0, -1) + '%';
  let lastFootStr = '';
  if (remaining && remaining.slice(-1) === 'x') {
    let tailStart = remaining.lastIndexOf('/');
    tailStart = remaining.lastIndexOf('/', tailStart - 1);
    if (tailStart === -1) return { footlist: [], scansionMarks: '' };
    const tail = remaining.slice(tailStart);
    if (tail in ANAPESTIC_FOOT_DICT) {
      lastFootStr = ANAPESTIC_FOOT_DICT[tail];
      remaining = remaining.slice(0, tailStart);
    } else if (tail.length > 1 && tail.slice(1) in ANAPESTIC_FOOT_DICT) {
      lastFootStr = ANAPESTIC_FOOT_DICT[tail.slice(1)];
      remaining = remaining.slice(0, tailStart + 1);
    } else return { footlist: [], scansionMarks: '' };
  }

  // Promote slack runs (long sequences of unstressed)
  const slackRun = remaining.indexOf('xxxx');
  if (slackRun !== -1) {
    remaining = remaining.slice(0, slackRun + 2) + '%' + remaining.slice(slackRun + 3);
  }

  const len = remaining.length;
  const footlist: string[] = [];
  if (len === numFeet! * 3) {
    const feet = footFinder(ANAPESTIC_FOOT_DICT, remaining, 3, 0, len);
    if (feet.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...feet.map(f => f.foot));
  } else {
    const needDisyls = (numFeet! * 3) - len;
    if (needDisyls > numFeet!) return { footlist: [], scansionMarks: '' };
    const pattern = '2'.repeat(needDisyls) + '3'.repeat(numFeet! - needDisyls);
    const allPerms = uniquePermutations(pattern);
    let validPattern: string | null = null;
    for (const pat of allPerms) {
      let okay = true;
      let idx = 0;
      for (const d of pat) {
        const stride = parseInt(d);
        idx += stride;
        if (!'/%'.includes(remaining[idx - 1])) {
          okay = false;
          break;
        }
      }
      if (okay) {
        validPattern = pat;
        break;
      }
    }
    if (!validPattern) return { footlist: [], scansionMarks: '' };
    let pos = 0;
    for (const d of validPattern) {
      const stride = parseInt(d);
      const chunk = remaining.slice(pos, pos + stride);
      if (chunk in ANAPESTIC_FOOT_DICT) {
        footlist.push(ANAPESTIC_FOOT_DICT[chunk]);
        pos += stride;
      } else return { footlist: [], scansionMarks: '' };
    }
  }

  if (lastFootStr) footlist.push(lastFootStr);
  const scansion = footlist.join('|');
  return { footlist, scansionMarks: scansion };
}

// ─── Helper: unique permutations of a string ────────────────────

function uniquePermutations(s: string): string[] {
  if (s.length <= 1 || s.length > 9) return [s];
  const results: string[] = [];
  function permute(prefix: string, rest: string) {
    if (rest.length === 0) results.push(prefix);
    const seen = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
      if (seen.has(rest[i])) continue;
      seen.add(rest[i]);
      permute(prefix + rest[i], rest.slice(0, i) + rest.slice(i + 1));
    }
  }
  permute('', s);
  return results;
}

// ─── Public API: convert our relative stress to Scandroid marks ──

export function stressToMarks(stressArray: StressLevel[]): string {
  return stressArray.map(s => (s === 's' ? STRESS : SLACK)).join('');
}

export function marksToFeetString(footlist: string[]): string {
  return footlist.join(' | ');
}

// ─── Convenience: produce a ScansionResult from footlist ─────────

export function scansionResultFromFootlist(
  footlist: string[],
  meter: MetreName,
  complexity?: number
): ScansionResult {
  return {
    meter,
    scansion: marksToFeetString(footlist),
    certainty: 0, // not computed
    weightScore: 0,
    maxPossibleWeight: 0,
    algorithm: 'Scandroid',
  };
}
```

## scansion.ts

```typescript
// scansion.ts — Unified gradient foot-fitting for McAleese's phonological method.
//
// DESIGN (2026-05-29 rewrite):
//   Meter selection and scansion-string assembly share ONE model.  For every
//   candidate meter we find — by dynamic programming — the best segmentation of
//   the line's actual relative-stress contour into that meter's feet, allowing
//   linguistically-grounded variation (gradient feet, single-foot substitutions,
//   anacrusis, catalexis, feminine endings, edge-licensed inversion).  The DP's
//   score decides the meter; the very same segmentation IS the scansion.  No more
//   disconnect between "which meter" and "what does the foot string look like".
//
//   Layered on top is McAleese's key-stress weighting: meters that place their
//   beats at the right edges of phonological phrases / intonational units
//   ("beginnings free, endings strict", Kiparsky/Hayes) are rewarded.
//
//   Gradient feet (per the project's 4-level scale  w < n < m < s): an iamb may
//   surface as ws / ns / wm; an anapest as wws / wns / wnm / nms; etc.  Strong
//   metrical positions accept s/m fully and n by promotion (more readily when the
//   syllable carries a lexical content stress demoted only by clash); weak
//   positions accept w/n, tolerate m as a mild demotion, and treat s as the
//   cardinal "stress maximum in weak position" violation (relaxed at a
//   phonological-phrase left edge, per Fabb 1997).

import {
  ClsWord,
  IntonationalUnit,
  PhonologicalPhrase,
  CliticGroup,
  KeyStress,
  MetreName,
  MeterScore,
  PhonologicalScansionDetail,
  StressLevel,
} from './types.js';
import { isPunctuation, isQuoteTag } from './parser.js';

// ─── CONSTANTS: metre definitions & key-stress weights ──────────────

const METRES: Record<MetreName, { foot: string; sylCount: number }> = {
  iambic:       { foot: 'ws',  sylCount: 2 },
  trochaic:     { foot: 'sw',  sylCount: 2 },
  spondaic:     { foot: 'ss',  sylCount: 2 },
  pyrrhic:      { foot: 'ww',  sylCount: 2 },
  anapestic:    { foot: 'wws', sylCount: 3 },
  dactylic:     { foot: 'sww', sylCount: 3 },
  amphibrachic: { foot: 'wsw', sylCount: 3 },
  bacchic:      { foot: 'wss', sylCount: 3 },
};

// McAleese's prosodic-unit importance weights for key-stress scoring.
const WEIGHT = { IU: 3, PP: 2, PW3plus: 2, PW2: 1, CP: 1 } as const;

// Candidate base meters.  Iambic/trochaic/anapestic/dactylic/amphibrachic are
// the base meters of English verse and compete on equal footing.  Bacchic is
// included only as a marginal whole-line candidate (it normally appears one foot
// at a time); pyrrhic & spondaic never form a whole line and are handled solely
// as in-line substitution feet, never as standalone candidates.
const CANDIDATE_METERS: MetreName[] = [
  'iambic', 'trochaic', 'anapestic', 'dactylic', 'amphibrachic', 'bacchic',
];

// ─── FLATTENED, CONTEXT-RICH SYLLABLE STREAM ───────────────────────

interface FlatSyl {
  word: ClsWord;
  stress: StressLevel;          // relative stress (w/n/m/s)
  lexicalStress: number;        // 0/1/2 lexical stress (pre-phrase); enables re-promotion
  isContent: boolean;
  globalIndex: number;
  wordIdx: number;
  isWordStart: boolean;
  isWordEnd: boolean;
  isPoly: boolean;
  weight: 'H' | 'L';
  isPPStart: boolean;           // first syllable of a phonological phrase (Fabb left edge)
  caesuraBefore: boolean;       // line start OR an IU/punctuation boundary precedes this syllable
  clashAdjacent: boolean;       // an immediately neighbouring syllable is also strong (stress clash)
  isLineFinal: boolean;         // the very last syllable of the line (strongest metrical slot)
  promotable: boolean;          // Attridge promotion: a 'w' flanked by x/w (or line edge)
                                // on both sides may realise a beat
  extrametrical?: 'morphological' | 'light_noun' | 'derivational';
}

/**
 * Flatten a sentence's words into a context-rich syllable stream in linear
 * (reading) order.  Phrasing context (PP starts, caesurae) is derived from the
 * IU hierarchy by membership, so it stays correct even when clitic groups are
 * stored out of linear order inside a phonological phrase.
 */
function flattenSyllables(words: ClsWord[], ius?: IntonationalUnit[]): FlatSyl[] {
  // Map each word -> "iuIdx.ppIdx" key for caesura / PP-start detection.
  const ppKeyOf = new Map<ClsWord, string>();
  const iuIdxOf = new Map<ClsWord, number>();
  if (ius) {
    for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
      for (let ppIdx = 0; ppIdx < ius[iuIdx].phonologicalPhrases.length; ppIdx++) {
        for (const cg of ius[iuIdx].phonologicalPhrases[ppIdx].cliticGroups) {
          for (const tok of cg.tokens) {
            ppKeyOf.set(tok, `${iuIdx}.${ppIdx}`);
            iuIdxOf.set(tok, iuIdx);
          }
        }
      }
    }
  }

  const result: FlatSyl[] = [];
  let idx = 0;
  let wordCounter = 0;
  let prevIuIdx: number | undefined = undefined;
  let prevPPKey: string | undefined = undefined;
  let sawPunctSinceLastSyl = true; // line start counts as a boundary
  let prevWasPunct = false;

  for (const w of words) {
    // Quotation marks are tokens but not prosodic breaks — they neither close an
    // IU nor license a caesura (a quoted word is read in the same breath).
    if (isPunctuation(w.lexicalClass)) {
      if (!isQuoteTag(w.lexicalClass)) sawPunctSinceLastSyl = true;
      prevWasPunct = true;
      continue;
    }
    const isPoly = w.syllables.length > 1;
    const myIu = iuIdxOf.get(w);
    const myPP = ppKeyOf.get(w);
    const ppChanged = myPP !== undefined && myPP !== prevPPKey;
    const iuChanged = myIu !== undefined && myIu !== prevIuIdx;
    const caesura = sawPunctSinceLastSyl || iuChanged;

    for (let si = 0; si < w.syllables.length; si++) {
      const s = w.syllables[si];
      result.push({
        word: w,
        stress: s.relativeStress ?? 'w',
        lexicalStress: s.lexicalStress ?? s.stress ?? 0,
        isContent: w.isContent,
        globalIndex: idx++,
        wordIdx: wordCounter,
        isWordStart: si === 0,
        isWordEnd: si === w.syllables.length - 1,
        isPoly,
        weight: s.weight || 'L',
        isPPStart: ppChanged && si === 0,
        caesuraBefore: caesura && si === 0,
        clashAdjacent: false, // filled in below
        promotable: false,    // filled in below
        isLineFinal: false,   // filled in below
        extrametrical: s.extrametrical,
      });
    }
    prevIuIdx = myIu;
    prevPPKey = myPP;
    sawPunctSinceLastSyl = false;
    prevWasPunct = false;
    wordCounter++;
  }
  // Second pass: mark stress clashes (a strong syllable adjacent to another strong one).
  for (let i = 0; i < result.length; i++) {
    const prevStrong = i > 0 && isStrong(result[i - 1].stress);
    const nextStrong = i < result.length - 1 && isStrong(result[i + 1].stress);
    result[i].clashAdjacent = prevStrong || nextStrong;
  }
  // Third pass: Attridge promotion — an unstressed syllable flanked on BOTH
  // sides by syllables no stronger than 'w' (or by a line edge) can realise a
  // metrical beat ("promotion", Attridge 1982; the 4B4V 'o-with-beat').  This
  // is what lets "happens to BE a French poet" carry its mid-line beat on a
  // function verb without inventing lexical stress for it.
  const weakOrEdge = (i: number) =>
    i < 0 || i >= result.length || result[i].stress === 'x' || result[i].stress === 'w';
  for (let i = 0; i < result.length; i++) {
    result[i].promotable = result[i].stress === 'w' && weakOrEdge(i - 1) && weakOrEdge(i + 1);
  }
  if (result.length > 0) result[result.length - 1].isLineFinal = true;
  return result;
}

// ─── KEY-STRESS EXTRACTION (retained for display + right-edge weighting) ─

function collectIUTokens(iu: IntonationalUnit): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const pp of iu.phonologicalPhrases) tokens.push(...collectPPTokens(pp));
  return tokens;
}
function collectPPTokens(pp: PhonologicalPhrase): ClsWord[] {
  const tokens: ClsWord[] = [];
  for (const cg of pp.cliticGroups) tokens.push(...cg.tokens);
  return tokens;
}

/** The metrically diagnostic tail of a unit: rightmost strong syllable + its predecessor(s). */
function extractPhrasalTail(syls: FlatSyl[], maxLen: number = 2): FlatSyl[] {
  if (syls.length === 0) return [];
  let rightStrong = -1;
  for (let i = syls.length - 1; i >= 0; i--) {
    if (syls[i].stress === 's' || syls[i].stress === 'm') { rightStrong = i; break; }
  }
  if (rightStrong === -1) return syls.slice(-maxLen);
  const start = Math.max(0, rightStrong - (maxLen - 1));
  return syls.slice(start, rightStrong + 1);
}

function rightmostStressed(tokens: ClsWord[], flat: FlatSyl[]): FlatSyl | undefined {
  for (let i = flat.length - 1; i >= 0; i--) {
    const fs = flat[i];
    if (tokens.includes(fs.word) && fs.stress !== 'w' && fs.stress !== 'x') return fs;
  }
  return undefined;
}

export function extractKeyStresses(ius: IntonationalUnit[], words: ClsWord[]): KeyStress[] {
  const result: KeyStress[] = [];
  const flat = flattenSyllables(words);

  // Polysyllabic words: whole contour.
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const sc = w.syllables.length;
    if (sc < 2) continue;
    const pattern = w.syllables.map(s => s.relativeStress ?? 'w').join('');
    const weight = sc >= 3 ? WEIGHT.PW3plus : WEIGHT.PW2;
    const firstSylIdx = flat.findIndex(fs => fs.word === w);
    const positions = Array.from({ length: sc }, (_, j) => firstSylIdx + j);
    result.push({ unitType: 'PW', pattern, weight, positions });
  }

  for (const iu of ius) {
    const iuTokens = collectIUTokens(iu);
    if (iuTokens.length === 0) continue;
    const iuSyls = flat.filter(fs => iuTokens.includes(fs.word));
    if (iuSyls.length > 0) {
      const tail = extractPhrasalTail(iuSyls, 3);
      result.push({ unitType: 'IU', pattern: tail.map(fs => fs.stress).join(''), weight: WEIGHT.IU, positions: tail.map(fs => fs.globalIndex) });
    }
    for (const pp of iu.phonologicalPhrases) {
      const ppTokens = collectPPTokens(pp);
      if (ppTokens.length === 0) continue;
      const ppSyls = flat.filter(fs => ppTokens.includes(fs.word));
      if (ppSyls.length > 0) {
        const tail = extractPhrasalTail(ppSyls);
        result.push({ unitType: 'PP', pattern: tail.map(fs => fs.stress).join(''), weight: WEIGHT.PP, positions: tail.map(fs => fs.globalIndex) });
      }
      for (const cg of pp.cliticGroups) {
        if (cg.tokens.length === 0) continue;
        const cp = rightmostStressed(cg.tokens, flat);
        if (cp) result.push({ unitType: 'CP', pattern: cp.stress, weight: WEIGHT.CP, positions: [cp.globalIndex] });
      }
    }
  }
  return result;
}

// ─── GRADIENT SYLLABLE FIT ─────────────────────────────────────────

// A syllable is "strong" if it bears at least moderate relative stress.
function isStrong(s: StressLevel): boolean { return s === 's' || s === 'm'; }

/**
 * Score one syllable against an expected metrical position.
 * Weak positions: w/n welcome, m a mild demotion, s the cardinal violation.
 * Strong positions: s/m welcome, n a promotion (better when it is a content
 * stress demoted only by clash), w a missing beat.
 */
function scoreSyllable(syl: FlatSyl, expected: 'W' | 'S'): number {
  const a = syl.stress;
  if (expected === 'S') {
    if (a === 's') return 4;
    if (a === 'm') return 3;
    if (a === 'n') {
      // Promotion into a strong slot.  A content syllable whose lexical stress
      // is primary (demoted to 'n' only by a phrasal clash) re-promotes readily.
      if (syl.lexicalStress >= 2) return 2.5;
      // Line-final beat: the strongest metrical slot accepts a secondary
      // syllable (e.g. clause-final modal "might"), as in sung/musical verse.
      if (syl.isLineFinal) return 2.2;
      return syl.isContent ? 1.5 : 0.8;
    }
    // 'x' (zero-provision clitic) in a strong slot — the cardinal missing beat,
    // worse than a plain 'w': beating "the"/"a"/"of" is maximally unmetrical.
    if (a === 'x') return -3.2;
    // 'w' in a strong slot — a missing beat, UNLESS flanked by weakness on both
    // sides: Attridge promotion lets such a syllable realise the beat ("happens
    // to BE a").  Value sits just below the pyrrhic-substitution alternative
    // (2+2−1.6 = 2.4 for the foot) so duple meters keep their pyrrhics while
    // ternary meters — which have no cheap pyrrhic escape — recover the beat.
    if (syl.promotable) return 0.3;
    return syl.lexicalStress >= 2 ? 0 : -2.5;
  } else {
    // 'x' (zero-provision clitic) in a weak slot — the ideal upbeat, marginally
    // better than a plain weak syllable.
    if (a === 'x') return 2.2;
    if (a === 'w') return 2;
    if (a === 'n') return 1.6;
    if (a === 'm') {
      // Mild demotion; cheap at a PP left edge (Fabb) or in a stress clash
      // (one of two adjacent stresses must yield to the meter).
      if (syl.isPPStart) return 0.5;
      return syl.clashAdjacent ? -0.3 : -1.2;
    }
    // 's' in a weak slot — stress maximum in weak position (Fabb), the cardinal
    // violation in isolation, but a routine, cheap demotion inside a clash.
    if (syl.isPPStart) return -0.6;
    return syl.clashAdjacent ? -1.3 : -3.2;
  }
}

// ─── FOOT TEMPLATES PER METER (with substitution / edge penalties) ──

interface FootCtx { isStart: boolean; caesuraBefore: boolean; isEnd: boolean; }
interface Template {
  pattern: ('W' | 'S')[];
  score: (ctx: FootCtx) => number;   // base (penalty ≤ 0) for using this foot
  atStart?: boolean;                 // only legal as the line's first foot
  atEnd?: boolean;                   // only legal as the line's last foot
  isPrimary?: boolean;               // counts as a "clean" foot for the certainty metric
  countsAsFoot?: boolean;            // default true.  False for beat-less EDGE units
                                     // (anacrusis upbeats, orphan-W fallbacks): they
                                     // appear in the scansion string but are not feet,
                                     // so a pentameter with an upbeat is not "hexameter".
                                     // Naming-only — never affects scores or selection.
}

// Substitution / variation penalties (negative = cost).  Tuned so that an
// occasional substitution is cheap (one foot at a time) but a meter that needs
// substitution on most feet loses to the meter whose primary foot those are.
const P = {
  INV_EDGE: -0.4,   // duple inversion at a licensed left edge (line start / post-caesura)
  INV_MID:  -3.0,   // duple inversion mid-line (marked)
  TRI_IN_DUPLE: -2.2, // anapest/dactyl substituting inside a duple meter
  DUPLE_IN_TRI: -1.3, // duple foot substituting inside a triple meter (often catalexis)
  PYRR: -1.6,
  SPON: -1.6,
  CATAL: -0.4,      // catalexis (truncated final foot)
  FEM: -0.5,        // feminine ending / hypercatalexis (extra final weak)
  ANAC1: -0.5,      // single anacrusis upbeat (falling meters)
  ANAC2: -1.2,      // double anacrusis upbeat
  ACEPH: -0.6,      // acephalous / headless first foot (rising meters)
  ORPHAN: -8,       // last-resort single-syllable foot
};

const S = (n: number) => () => n;

function getTemplatesForMeter(meter: MetreName): Template[] {
  let t: Template[] = [];
  switch (meter) {
    case 'iambic':
      // No headless ['S'] start: a stressed iambic line-opening is a trochaic
      // INVERSION (below), and a line that needs inversion on two feet is really
      // trochaic — letting the DP discover that rather than masking it.
      t = [
        { pattern: ['W', 'S'], score: S(0), isPrimary: true },
        { pattern: ['S', 'W'], score: c => (c.isStart || c.caesuraBefore) ? P.INV_EDGE : P.INV_MID }, // inversion
        { pattern: ['W', 'W', 'S'], score: S(P.TRI_IN_DUPLE) },     // anapestic substitution
        { pattern: ['W', 'W'], score: S(P.PYRR) },                  // pyrrhic
        { pattern: ['S', 'S'], score: S(P.SPON) },                  // spondee
        { pattern: ['W', 'S', 'W'], score: S(P.FEM), atEnd: true }, // feminine ending
        { pattern: ['S'], score: S(P.CATAL), atEnd: true, isPrimary: true }, // final beat-bearing monosyllable
      ];
      break;
    case 'trochaic':
      t = [
        { pattern: ['S', 'W'], score: S(0), isPrimary: true },
        { pattern: ['S'], score: S(P.CATAL), atEnd: true, isPrimary: true }, // catalexis (very common)
        { pattern: ['W', 'S'], score: c => (c.isStart || c.caesuraBefore) ? P.INV_EDGE : P.INV_MID }, // rising inversion
        { pattern: ['S', 'W', 'W'], score: S(P.TRI_IN_DUPLE) },     // dactylic substitution
        { pattern: ['S', 'S'], score: S(P.SPON) },
        { pattern: ['W', 'W'], score: S(P.PYRR) },
        // A single opening upbeat is true anacrusis — extrametrical, not a foot.
        // A DOUBLE upbeat fills a whole metrical position (a pyrrhic-substituted
        // first foot: "By the | SHORES of | GIT-che | GU-mee" stays tetrameter),
        // so it still counts toward the meter-length name.
        { pattern: ['W'], score: S(P.ANAC1), atStart: true, countsAsFoot: false },       // anacrusis upbeat
        { pattern: ['W', 'W'], score: S(P.ANAC2), atStart: true },
      ];
      break;
    case 'anapestic':
      t = [
        { pattern: ['W', 'W', 'S'], score: S(0), isPrimary: true },
        { pattern: ['W', 'S'], score: S(P.DUPLE_IN_TRI) },          // iambic substitution / acephalous
        { pattern: ['S'], score: S(P.ACEPH), atStart: true },
        // NB: making this acephalous start PRIMARY was tried (2026-06-12) to
        // mirror the amphibrach's primary catalectic ending — it fixed some
        // standalone Cowper-type anapests but boosted anapest against IAMBIC
        // lines corpus-wide (epg64 −1.4pt): reverted.  The amphi/anapest
        // naming on shared grids is handled by sibling arbitration + the
        // stanza anacrusis anchor instead.
        { pattern: ['W', 'S'], score: c => (c.isStart || c.caesuraBefore) ? P.ACEPH : P.DUPLE_IN_TRI, atStart: true },
        { pattern: ['W', 'W', 'S', 'W'], score: S(P.FEM), atEnd: true },
        { pattern: ['W', 'S', 'W'], score: S(P.FEM), atEnd: true },
      ];
      break;
    case 'dactylic':
      t = [
        { pattern: ['S', 'W', 'W'], score: S(0), isPrimary: true },
        { pattern: ['S', 'W'], score: S(P.DUPLE_IN_TRI), atEnd: true, isPrimary: true }, // catalexis
        { pattern: ['S'], score: S(P.CATAL), atEnd: true, isPrimary: true },
        { pattern: ['S', 'W'], score: S(P.DUPLE_IN_TRI) },          // trochaic substitution
        { pattern: ['W'], score: S(P.ANAC1), atStart: true, countsAsFoot: false },       // anacrusis
        { pattern: ['W', 'W'], score: S(P.ANAC2), atStart: true },  // fills a foot slot (see trochaic)
      ];
      break;
    case 'amphibrachic':
      t = [
        { pattern: ['W', 'S', 'W'], score: S(0), isPrimary: true },
        { pattern: ['W', 'S'], score: S(P.CATAL), atEnd: true, isPrimary: true }, // catalexis
        { pattern: ['S', 'W'], score: S(P.ACEPH), atStart: true },  // acephalous (lost initial weak)
        { pattern: ['S'], score: S(P.ACEPH), atStart: true },
        { pattern: ['W', 'S', 'W', 'W'], score: S(P.FEM), atEnd: true },
        // Clipped clausula: the final foot reduced to its bare ictus ("alone
        // in his BELgian HELL" — beats 2,5,7).  Strictly this 1-slack final
        // interval is dolnik-leaning, but without the template the whole
        // amphibrachic fit collapsed to orphan feet (score ≈0.5) and the
        // family vanished from the rankings of clipped lines entirely.
        // Costed like a ternary-in-duple substitution (heavier than the
        // catalectic WS): at the cheaper DUPLE_IN_TRI it poached iambic
        // lines corpus-wide (epg64 −0.9pt).
        { pattern: ['S'], score: S(P.TRI_IN_DUPLE), atEnd: true },
      ];
      break;
    case 'bacchic':
      t = [
        { pattern: ['W', 'S', 'S'], score: S(0), isPrimary: true },
        { pattern: ['W', 'S'], score: S(P.CATAL), atEnd: true },
        { pattern: ['S', 'S'], score: S(P.ACEPH), atStart: true },
        { pattern: ['S'], score: S(P.ACEPH), atStart: true },
      ];
      break;
    default:
      t = [{ pattern: ['W', 'S'], score: S(0), isPrimary: true }];
  }
  // Last-resort fallbacks so the DP always reaches the end of any contour.
  // The orphan S bears a beat (counts as a defective foot); the orphan W does not.
  t.push({ pattern: ['S'], score: S(P.ORPHAN) });
  t.push({ pattern: ['W'], score: S(P.ORPHAN), countsAsFoot: false });
  return t;
}

// ─── DP FIT: best segmentation of the contour for one meter ─────────

interface FitResult {
  feet: number[];        // syllable count of each foot, in order
  footStrs: string[];    // stress letters per foot (before clash marking)
  beats: Set<number>;    // global indices that fall on a metrical Strong position
  score: number;         // total raw DP score
  maxScore: number;      // ideal score for this segmentation (4 per strong slot, 2 per weak)
  cleanFeet: number;     // # feet using a primary (un-substituted) template
  countedFeet: number;   // # genuine feet for the meter-length name (excludes
                         // beat-less edge units: anacrusis upbeats, orphan-W)
}

function fitMeter(syls: FlatSyl[], meter: MetreName): FitResult {
  const N = syls.length;
  const templates = getTemplatesForMeter(meter);

  interface Memo { score: number; feetLens: number[]; primaryFlags: boolean[]; countFlags: boolean[]; strongOffsets: number[][]; }
  const memo: (Memo | undefined)[] = new Array(N + 1);

  function solve(i: number): Memo {
    if (i === N) return { score: 0, feetLens: [], primaryFlags: [], countFlags: [], strongOffsets: [] };
    const cached = memo[i];
    if (cached) return cached;

    let best: Memo = { score: -Infinity, feetLens: [], primaryFlags: [], countFlags: [], strongOffsets: [] };
    const isStart = i === 0;
    const caesuraBefore = syls[i].caesuraBefore;

    for (const tmpl of templates) {
      const L = tmpl.pattern.length;
      if (i + L > N) continue;
      const isEnd = i + L === N;
      if (tmpl.atStart && !isStart) continue;
      if (tmpl.atEnd && !isEnd) continue;

      let footScore = tmpl.score({ isStart, caesuraBefore, isEnd });
      const strongOffs: number[] = [];
      let straddlesCaesura = false;
      for (let k = 0; k < L; k++) {
        footScore += scoreSyllable(syls[i + k], tmpl.pattern[k]);
        if (tmpl.pattern[k] === 'S') strongOffs.push(k);
        // A foot may begin at a caesura but must not contain one in its interior:
        // foot boundaries align with major prosodic breaks (commas, IU edges).
        if (k > 0 && syls[i + k].caesuraBefore) straddlesCaesura = true;
      }
      // Foot boundaries prefer to align with caesurae, but feet are abstract
      // units: metrists place caesurae mid-foot freely (masculine/feminine
      // caesura), and phrase-edge alignment is already rewarded separately by
      // the McAleese right-edge bonus.  Keep only a small nudge — a 3-syllable
      // foot is structurally MORE likely to contain a comma than a 2-syllable
      // one, so a heavy penalty here systematically taxed ternary meters in
      // comma-rich lines (Nabokov's "Exile" read duple wherever commas fell).
      if (straddlesCaesura) footScore -= 1.0;

      // NB: we deliberately do NOT add a blanket penalty for splitting a
      // polysyllabic word across a foot boundary.  Such splits are routine in
      // English verse ("Through E|den took") and are metrically harmless when
      // each syllable lands in a position matching its stress.  The genuinely
      // costly case — a word's stressed syllable forced into a weak slot — is
      // already penalised by scoreSyllable (Fabb's constraint).

      const sub = solve(i + L);
      if (sub.score === -Infinity) continue;
      const total = footScore + sub.score;
      if (total > best.score) {
        best = {
          score: total,
          feetLens: [L, ...sub.feetLens],
          primaryFlags: [!!tmpl.isPrimary, ...sub.primaryFlags],
          countFlags: [tmpl.countsAsFoot !== false, ...sub.countFlags],
          strongOffsets: [strongOffs, ...sub.strongOffsets],
        };
      }
    }
    memo[i] = best;
    return best;
  }

  const sol = solve(0);
  const feet: number[] = sol.feetLens;
  const footStrs: string[] = [];
  const beats = new Set<number>();
  let pos = 0;
  let cleanFeet = 0;
  let maxScore = 0;
  for (let f = 0; f < feet.length; f++) {
    const L = feet[f];
    const strongSet = new Set(sol.strongOffsets[f]);
    maxScore += strongSet.size * 4 + (L - strongSet.size) * 2; // ideal: 4 per strong slot, 2 per weak
    let str = '';
    // A foot counts as "clean" only when it uses a primary (un-substituted)
    // template AND is actually realised as the ideal: every strong slot bears
    // a real beat (s/m) and every weak slot is genuinely weak (w/n).  A primary
    // template with a promoted (n) beat or a stressed weak slot is NOT clean.
    let clean = sol.primaryFlags[f];
    for (let k = 0; k < L; k++) {
      const syl = syls[pos + k];
      str += syl.stress;
      if (strongSet.has(k)) { if (!isStrong(syl.stress)) clean = false; }
      else { if (isStrong(syl.stress)) clean = false; }
    }
    footStrs.push(str);
    for (const off of sol.strongOffsets[f]) beats.add(syls[pos + off].globalIndex);
    if (clean) cleanFeet++;
    pos += L;
  }
  const countedFeet = sol.countFlags.filter(Boolean).length;
  return { feet, footStrs, beats, score: sol.score, maxScore, cleanFeet, countedFeet };
}

// ─── McALEESE RIGHT-EDGE (KEY-STRESS) BONUS ─────────────────────────

/**
 * Reward a segmentation that places metrical beats at the right edges of
 * phonological phrases and intonational units ("endings strict").  Returns a
 * ratio in [0,1]: matched unit-weight over total unit-weight.  This is the
 * signal that distinguishes rising (iambic/anapestic) from falling
 * (trochaic/dactylic) polarity, since phrase-final stresses are beats only in
 * rising meters.
 */
function rightEdgeRatio(flat: FlatSyl[], ius: IntonationalUnit[] | undefined, beats: Set<number>): number {
  if (!ius || ius.length === 0) return 0;
  let matched = 0;
  let total = 0;
  const considerUnit = (tokens: ClsWord[], weight: number) => {
    const syls = flat.filter(fs => tokens.includes(fs.word));
    let edge: FlatSyl | undefined;
    for (let i = syls.length - 1; i >= 0; i--) {
      if (isStrong(syls[i].stress)) { edge = syls[i]; break; }
    }
    if (!edge) return;
    total += weight;
    if (beats.has(edge.globalIndex)) matched += weight;
  };
  for (const iu of ius) {
    considerUnit(collectIUTokens(iu), WEIGHT.IU);
    for (const pp of iu.phonologicalPhrases) considerUnit(collectPPTokens(pp), WEIGHT.PP);
  }
  return total > 0 ? matched / total : 0;
}

// ─── SCANSION STRING (with silent-beat clash markers) ───────────────

function buildScansionString(syls: FlatSyl[], feet: number[], ius?: IntonationalUnit[]): string {
  // Clitic-phrase membership: a clash within the same CP or word inserts a
  // silent beat ('-') before the second strong syllable (McAleese p.222).
  const cpOf = new Map<ClsWord, number>();
  if (ius) {
    let cpId = 0;
    for (const iu of ius) for (const pp of iu.phonologicalPhrases) for (const cg of pp.cliticGroups) {
      for (const tok of cg.tokens) cpOf.set(tok, cpId);
      cpId++;
    }
  }
  const out: string[] = [];
  let pos = 0;
  for (const L of feet) {
    let foot = '';
    for (let k = 0; k < L; k++) {
      const cur = syls[pos];
      if (pos > 0 && isStrong(cur.stress)) {
        const prev = syls[pos - 1];
        if (isStrong(prev.stress)) {
          const sameCP = cpOf.get(prev.word) !== undefined && cpOf.get(prev.word) === cpOf.get(cur.word);
          if (sameCP || prev.wordIdx === cur.wordIdx) foot += '-';
        }
      }
      foot += cur.stress;
      pos++;
    }
    out.push(foot);
  }
  return out.join('|');
}

// ─── DISPLAY / NAMING HELPERS ──────────────────────────────────────

// Greek-numeral foot-length names, exhaustive through 20 (icosameter) per the
// maintainer's standardised nomenclature.  Long lines that are genuinely metrical
// deserve a real meter name rather than the "N-feet" othering, so the ladder runs
// all the way up; beyond 20 the bare "N-feet" fallback remains (lines that long
// are almost never integrally metrical, and the prose-likeness hedge handles them).
const LINE_LENGTH_NAMES = [
  '', 'monometer', 'dimeter', 'trimeter', 'tetrameter', 'pentameter',
  'hexameter', 'heptameter', 'octameter', 'nonometer', 'decameter',
  'hendecameter', 'dodecameter', 'triskaidecameter', 'tetradecameter',
  'pentadecameter', 'hexadecameter', 'heptadecameter', 'octadecameter',
  'enneadecameter', 'icosameter',
];
function lineLengthName(feet: number): string {
  return LINE_LENGTH_NAMES[feet] || `${feet}-feet`;
}

// ─── TOP-LEVEL METER SCORING ────────────────────────────────────────

// A meter's small intrinsic prior.  Iamb is the unmarked default of English
// verse; bacchic is a marginal whole-line meter.  Kept tiny — only a tie-breaker.
const METER_PRIOR: Partial<Record<MetreName, number>> = { iambic: 0.02 };

// Deliberate, project-level bias toward ternary meters.  English prosody defaults
// toward duple readings, but this toolkit aims to open English verse to the more
// musical ternary rhythms of (e.g.) Russian Silver-Age sources in translation, so
// when a triple reading is genuinely competitive it is nudged ahead.  Kept small
// enough that it never overturns a clearly-duple line.
const TERNARY_BIAS = 0.02;
const TERNARY_METERS = new Set<MetreName>(['anapestic', 'dactylic', 'amphibrachic', 'bacchic']);
const DUPLE_METERS = new Set<MetreName>(['iambic', 'trochaic']);

// Weights against the (0..1) normalised fit fraction.
const REDGE_WEIGHT = 0.28;   // right-edge (key-stress) agreement — disambiguates polarity
const CLEAN_WEIGHT = 0.12;   // share of feet realised cleanly (real beats, no substitution)
const ONSET_WEIGHT = 0.05;   // left-edge onset cue — coarse rising vs falling polarity
// Below this combined score, no meter is convincing → free verse.
const FREE_VERSE_THRESHOLD = 0.62;

const FALLING_METERS = new Set<MetreName>(['trochaic', 'dactylic']);
const RISING_METERS = new Set<MetreName>(['iambic', 'anapestic', 'amphibrachic', 'bacchic']);

/**
 * Coarse onset polarity cue.  If the line's first *strong* syllable is its very
 * first syllable, the rhythm falls (trochaic/dactylic); if it is preceded by an
 * upbeat, the rhythm rises (iambic/anapestic/amphibrachic).  We deliberately use
 * the relative-stress contour (not lexical prominence) and only the coarse
 * rising/falling split — the finer "one vs two upbeats" distinction is unreliable
 * across acephalous/anacrustic variants.  Only rewards a match, never penalises.
 */
function onsetBonus(flat: FlatSyl[], meter: MetreName): number {
  let f0 = -1;
  for (let i = 0; i < flat.length; i++) { if (isStrong(flat[i].stress)) { f0 = i; break; } }
  if (f0 < 0) return 0;
  if (f0 === 0) return FALLING_METERS.has(meter) ? ONSET_WEIGHT : 0;
  return RISING_METERS.has(meter) ? ONSET_WEIGHT : 0;
}

// ─── METRICALITY ASSESSMENT (Option-0 prose-likeness hedge) ─────────
//
// A single decontextualised line is, in generative-metrics terms, almost always
// fittable to SOME grid (English prose alternates; phrase-ends are right-strong),
// so absolute fit cannot separate prose from verse — empirically, loose real
// verse ("Half a league…", Prufrock) scores BELOW expository prose.  What DOES
// separate them is non-periodicity accumulated AT LENGTH: a long run of text that
// (a) commits to no meter — its top candidates straddle BOTH the rising/falling
// and the duple/triple divides within a hair — and (b) realises that best fit only
// weakly.  This is a deliberately HIGH-PRECISION gate: it fires only on the
// unmistakable un-lineated-prose case and never on short, loose, or ternary verse
// (the project's prized cases).  It is advisory — it changes the displayed verdict
// WORDING only; the scansion, fit, ranking, foot count and certainty are intact.

// Necessary length: real metrical lines top out around the hepta-/octameter, so
// 9+ feet is almost never an integral line.  Combined (AND) with the commitment
// and confidence gates below, clean verse that happens to exceed this length keeps
// a healthy margin and certainty and is therefore spared.
const PROSE_MIN_FEET = 9;
const PROSE_MAX_MARGIN = 0.10;   // top1 − top2: prose does not commit to one meter
// …and realises even its best fit only weakly.  This ceiling is an empirical
// calibration against the relative-stress contour, NOT a theory — re-fit when the
// contour changes.  Verified (2026-06-21, after the dependency-driven ϕ rebuild):
// across 1736 real litlab verse lines, ZERO pass the length+margin+straddle gates,
// so the certainty ceiling never gates real verse — its only job is to admit the
// genuinely-prose case, which the improved contour now realises at 68%.
const PROSE_MAX_CERTAINTY = 70;

/** Does the top-3 ranking straddle BOTH polarity (rising/falling) AND foot-size
 *  (duple/triple)?  The fingerprint of a contour equidistant from every meter —
 *  present in prose, absent in committed verse (whose ties stay within a family). */
function rankingStraddles(ranking: MeterScore[]): boolean {
  const top = ranking.slice(0, 3).map(r => r.meter as MetreName);
  const rising = top.some(m => RISING_METERS.has(m));
  const falling = top.some(m => FALLING_METERS.has(m));
  const triple = top.some(m => TERNARY_METERS.has(m));
  const duple = top.some(m => DUPLE_METERS.has(m));
  return rising && falling && triple && duple;
}

/**
 * If a line reads as plausible prose (see above), return the advisory hedge
 * string; otherwise undefined.  Reads only fields already present on the detail,
 * so it runs as a late, non-destructive pipeline pass (`applyMetricalityLayer`).
 */
export function metricalityVerdict(detail: PhonologicalScansionDetail): string | undefined {
  if (detail.meterName === 'free verse') return undefined; // already non-committal
  if (detail.rhythmNote) return undefined;                 // accentual/dolnik already named
  if (detail.footCount < PROSE_MIN_FEET) return undefined;
  const ranking = detail.ranking;
  if (!ranking || ranking.length < 2) return undefined;
  const margin = ranking[0].score - ranking[1].score;
  if (margin >= PROSE_MAX_MARGIN) return undefined;        // commits to one meter
  if (detail.certainty >= PROSE_MAX_CERTAINTY) return undefined;
  if (!rankingStraddles(ranking)) return undefined;
  return `No consistent metered rhythm(s) discerned.  Reads as plausible prose. `
    + `(Closest fit: ${detail.meter}, ${detail.certainty}%)`;
}

/** Set `detail.metricalityNote` on every line that reads as plausible prose.
 *  Non-destructive: only the new advisory field is written. */
export function applyMetricalityLayer(details: PhonologicalScansionDetail[]): void {
  for (const d of details) d.metricalityNote = metricalityVerdict(d);
}

export function scoreMeters(
  keyStresses: KeyStress[],
  words: ClsWord[],
  ius?: IntonationalUnit[],
  force?: MetreName,
): PhonologicalScansionDetail {
  const flat = flattenSyllables(words, ius);
  const N = flat.length;

  if (N === 0) {
    return {
      all: '', keyStresses: '', meter: 'free verse', meterName: 'free verse',
      footCount: 0, summary: 'no syllables', scansion: '',
      certainty: 0, weightScore: 0, maxPossibleWeight: 0,
    };
  }

  let best: { meter: MetreName; fit: FitResult; finalScore: number; redge: number } | null = null;
  // Every candidate's composite fit score, so the top-N can be surfaced (display).
  const candidates: MeterScore[] = [];
  const fitsByMeter = new Map<MetreName, { fit: FitResult; finalScore: number; redge: number }>();

  // `force` re-fits the line under ONE specific meter (used by the stanza/
  // poem continuity rename: a near-tie line adopts the dominant meter, and
  // its scansion/foot-count/certainty must come from that meter's own fit).
  for (const meter of (force ? [force] : CANDIDATE_METERS)) {
    const fit = fitMeter(flat, meter);
    if (fit.feet.length === 0 || fit.maxScore <= 0) continue;
    const redge = rightEdgeRatio(flat, ius, fit.beats);
    // Fraction of this meter's own ideal that the contour achieves.  Normalising
    // by each meter's maximum removes the structural advantage duple meters would
    // otherwise enjoy (more strong slots ⇒ more points).
    const fitFraction = fit.score / fit.maxScore;
    const cleanRatio = fit.feet.length > 0 ? fit.cleanFeet / fit.feet.length : 0;
    const finalScore = fitFraction
      + REDGE_WEIGHT * redge
      + CLEAN_WEIGHT * cleanRatio
      + onsetBonus(flat, meter)
      + (TERNARY_METERS.has(meter) ? TERNARY_BIAS : 0)
      + (METER_PRIOR[meter] ?? 0);

    candidates.push({ meter, score: finalScore });
    fitsByMeter.set(meter, { fit, finalScore, redge });

    if (!best || finalScore > best.finalScore + 1e-9) {
      best = { meter, fit, finalScore, redge };
    }
  }

  // ── Ternary-sibling arbitration ──
  // When two ternary families (anapest/amphibrach/dactyl) fit the line with the
  // IDENTICAL beat grid, the difference is purely one of conventional naming —
  // the reading is the same.  Metrists then name the foot so that (1) poly-
  // syllabic words are not split across foot boundaries ("he HAPpens to | BE a"
  // not "pens to BE"), and (2) foot boundaries align with phrase breaks
  // ("at the FOE | and we CAMPED" not "the FOE and | we CAMPED").  Composite
  // scores within 5% are treated as naming noise.
  if (best && TERNARY_METERS.has(best.meter)) {
    const wordSplits = (fit: FitResult) => {
      let splits = 0, pos = 0;
      for (const L of fit.feet) {
        pos += L;
        if (pos < N && flat[pos].isPoly && !flat[pos].isWordStart) splits++;
      }
      return splits;
    };
    const straddles = (fit: FitResult) => {
      let count = 0, pos = 0;
      for (const L of fit.feet) {
        for (let k = 1; k < L; k++) if (flat[pos + k].caesuraBefore) { count++; break; }
        pos += L;
      }
      return count;
    };
    const sameBeats = (a: Set<number>, b: Set<number>) =>
      a.size === b.size && [...a].every(v => b.has(v));
    let chosen = { meter: best.meter, ...fitsByMeter.get(best.meter)! };
    for (const sib of TERNARY_METERS) {
      if (sib === chosen.meter) continue;
      const cand = fitsByMeter.get(sib);
      if (!cand || cand.finalScore < best.finalScore * 0.95) continue;
      if (!sameBeats(cand.fit.beats, best.fit.beats)) continue;
      const better =
        wordSplits(cand.fit) < wordSplits(chosen.fit) ||
        (wordSplits(cand.fit) === wordSplits(chosen.fit) &&
          (straddles(cand.fit) < straddles(chosen.fit) ||
           (straddles(cand.fit) === straddles(chosen.fit) && cand.finalScore > chosen.finalScore)));
      if (better) chosen = { meter: sib, ...cand };
    }
    if (chosen.meter !== best.meter) best = { meter: chosen.meter, fit: chosen.fit, finalScore: chosen.finalScore, redge: chosen.redge };
  }

  // Ranked candidate meters (best first) — the same finalScores computed above,
  // except that sibling arbitration (above) may have re-ordered same-grid
  // ternary names: the chosen name leads.
  const ranking: MeterScore[] = [...candidates].sort((a, b) => b.score - a.score);
  if (best) {
    const bi = ranking.findIndex(r => r.meter === best!.meter);
    if (bi > 0) { const [b] = ranking.splice(bi, 1); ranking.unshift(b); }
  }

  const totalWeight = keyStresses.reduce((s, k) => s + k.weight, 0);

  if (!best || (!force && best.finalScore < FREE_VERSE_THRESHOLD)) {
    // Free verse: still emit the bare relative-stress contour for display.
    return {
      all: '', keyStresses: '', meter: 'free verse', meterName: 'free verse',
      footCount: 0, summary: `IU=${ius?.length ?? 0} (below metrical threshold)`,
      scansion: flat.map(f => f.stress).join(''),
      certainty: 0, weightScore: 0, maxPossibleWeight: totalWeight,
      ranking,
    };
  }

  const { meter, fit, redge } = best;
  const scansion = buildScansionString(flat, fit.feet, ius);
  // Meter-length name counts only genuine feet (beat-less anacrusis upbeats and
  // orphan-W edge units are excluded), so an upbeat pentameter is not "hexameter".
  const footCount = fit.countedFeet;
  // A "line" whose every segment is a beat-less edge unit (e.g. a single
  // reduced syllable: "a") has no feet to name a meter from — free verse.
  if (footCount <= 0 && !force) {
    return {
      all: '', keyStresses: '', meter: 'free verse', meterName: 'free verse',
      footCount: 0, summary: `IU=${ius?.length ?? 0} (no beat-bearing feet)`,
      scansion: flat.map(f => f.stress).join(''),
      certainty: 0, weightScore: 0, maxPossibleWeight: totalWeight,
      ranking,
    };
  }
  // Certainty = proportion of segments realised by a clean (un-substituted) foot,
  // tempered by the right-edge agreement.  Denominator stays ALL segments
  // (fit.feet.length) so this naming fix changes no certainty values.
  const cleanRatio = fit.feet.length > 0 ? fit.cleanFeet / fit.feet.length : 0;
  const certainty = Math.max(0, Math.min(100, Math.round(100 * (0.7 * cleanRatio + 0.3 * redge))));

  const metreName = `${meter} ${lineLengthName(footCount)}`;
  const summary = `IU=${ius?.length ?? 0} PP=${ius?.reduce((s, iu) => s + iu.phonologicalPhrases.length, 0) ?? 0} feet=${footCount} clean=${fit.cleanFeet}/${fit.feet.length}`;

  return {
    all: '', keyStresses: '', meter: metreName, meterName: meter,
    footCount, summary, scansion, certainty,
    weightScore: Math.round(redge * totalWeight), maxPossibleWeight: totalWeight,
    ranking,
  };
}

// ─── NON-CLASSICAL RHYTHM LAYER (accentual / dolnik / taktovik) ─────────────
//
// Russian-metrics taxonomy (Gasparov), mandated for this project's domain
// (Silver-Age translations, song verse): between strict accentual-syllabic
// meter and free accentual verse lie the DOLNIK (inter-ictus intervals of 1–2
// slack syllables) and the TAKTOVIK (1–3).  McAleese's own procedure (A2 §5d/e)
// supplies the gate: accentual-family verse keeps a CONSTANT strong-stress
// count while the SYLLABLE count varies — whereas a loose accentual-syllabic
// poem (Frost) keeps both steady.  This layer only annotates (`rhythmNote`);
// the classical reading, scansion, and certainty are never altered.
//
// NB: "ballad" is deliberately NOT a verdict of this pass.  A ballad is a
// stanzaic FORM (quatrains, a rhyme scheme) that may be iambic, trochaic, or
// accentual; the rhythm fact this pass can honestly report is the alternating
// 4·3 ictus count.  Form identification belongs to the (rhyme-aware) form
// layer.

/** Per-line ictus profile parsed from a scansion string ("ns|wx|ns|ws|ws"). */
export interface IctusProfile {
  syllables: number;     // overt syllables (x/w/n/m/s letters)
  ictuses: number;       // beats: s/m, plus Attridge-promoted n (see below)
  intervals: number[];   // slack-syllable counts between consecutive ictuses
  anacrusis: number;     // slack syllables before the first ictus
}

export function ictusProfile(scansion: string): IctusProfile {
  const letters = scansion.replace(/[^xwnms]/g, '');
  const positions: number[] = [];
  for (let i = 0; i < letters.length; i++) {
    const c = letters[i];
    if (c === 's' || c === 'm') { positions.push(i); continue; }
    // Attridge promotion at the rhythm level: the strong beat is NOT solely
    // the s tier.  m always counts; an 'n' flanked on both sides by x/w (or a
    // line edge) realises a beat; and a 'w' in the DEEPEST valley — flanked by
    // zero-provision 'x' (or an edge) on both sides, e.g. "it IS an" — is
    // promoted too (three offbeats in a row are what duple rhythm forbids).
    // 'x' itself never carries a beat.
    if (c === 'n') {
      const lo = i === 0 || letters[i - 1] === 'x' || letters[i - 1] === 'w';
      const hi = i === letters.length - 1 || letters[i + 1] === 'x' || letters[i + 1] === 'w';
      if (lo && hi) positions.push(i);
    } else if (c === 'w') {
      const lo = i === 0 || letters[i - 1] === 'x';
      const hi = i === letters.length - 1 || letters[i + 1] === 'x';
      if (lo && hi) positions.push(i);
    }
  }
  const intervals: number[] = [];
  for (let i = 1; i < positions.length; i++) intervals.push(positions[i] - positions[i - 1] - 1);
  return {
    syllables: letters.length,
    ictuses: positions.length,
    intervals,
    anacrusis: positions.length > 0 ? positions[0] : letters.length,
  };
}

/** Classify pooled inter-ictus intervals into the dolnik/taktovik/accentual family. */
function intervalFamily(intervals: number[]): 'duple' | 'ternary' | 'dolnik' | 'taktovik' | 'accentual' | null {
  if (intervals.length === 0) return null;
  const within = (lo: number, hi: number) =>
    intervals.filter(v => v >= lo && v <= hi).length / intervals.length;
  if (within(1, 1) === 1) return 'duple';
  if (within(2, 2) === 1) return 'ternary';
  // ≥90% tolerance: an isolated clash (0) or long dip does not bump the family.
  if (within(1, 2) >= 0.9) return 'dolnik';
  if (within(1, 3) >= 0.9) return 'taktovik';
  return 'accentual';
}

const ICTUS_NAMES = ['', '1-ictus', '2-ictus', '3-ictus', '4-ictus', '5-ictus', '6-ictus'];
const ictusName = (k: number) => ICTUS_NAMES[k] || `${k}-ictus`;

/**
 * Stanza-level rhythm classification.  Fires only when:
 *   (a) syllable counts VARY across the stanza (range ≥ 2) — a steady-count
 *       stanza is accentual-syllabic territory and is left to the classical
 *       machinery (this is what keeps loose iambics like Frost untouched); and
 *   (b) no classical meter dominates confidently (≥60% of lines under one
 *       meter at mean certainty ≥70).
 * Then: alternating 4·3 ictuses → ballad; constant ictus count + interval
 * family → dolnik / taktovik / accentual.  Single lines (or 2-line stanzas)
 * get only the per-line free-verse refinement below.
 */
export function applyRhythmLayer(details: PhonologicalScansionDetail[]): void {
  const lines = details.filter(d => d.scansion && d.scansion.length > 0);
  for (const d of lines) d.rhythmNote = undefined;  // idempotent
  const profiles = lines.map(d => ictusProfile(d.scansion));

  if (lines.length >= 3) {
    const syls = profiles.map(p => p.syllables);
    const sylRange = Math.max(...syls) - Math.min(...syls);
    const counts = profiles.map(p => p.ictuses);

    if (sylRange >= 2) {
      // Classical-dominance guard.  Ternary SIBLINGS (anapest/amphibrach/
      // dactyl) are grouped as ONE family here: their grids coincide modulo
      // anacrusis, so a stanza reading amphi 7 / dact 3 / anap 2 (Nabokov's
      // "Exile", whose tetrameter·tetrameter·trimeter design also varies the
      // syllable count) is solidly classical — without the grouping it was
      // stamped "free verse (heterometric)".  A ≥70% family majority counts
      // as classical regardless of certainty; a CONFIDENT half-majority
      // (≥50% at mean certainty ≥70) does too — heterometric STANZA DESIGN
      // (tetrameter·tetrameter·trimeter) is classical verse, not free verse.
      // Genuine accentual verse scatters across families (Wyatt's best
      // single family covers 0.43) and passes under both bars.
      const byMeter = new Map<string, number[]>();
      lines.forEach((d) => {
        if (d.meterName === 'free verse') return;
        const family = TERNARY_METERS.has(d.meterName as MetreName) ? 'ternary' : d.meterName;
        if (!byMeter.has(family)) byMeter.set(family, []);
        byMeter.get(family)!.push(d.certainty);
      });
      let classical = false;
      for (const [, certs] of byMeter) {
        const coverage = certs.length / lines.length;
        const meanCert = certs.reduce((a, b) => a + b, 0) / certs.length;
        if (coverage >= 0.7 || (coverage >= 0.5 && meanCert >= 70)) { classical = true; break; }
      }

      if (!classical) {
        let note: string | undefined;

        // Alternating ictus counts (canonically 4·3): reported as a RHYTHM
        // fact only — whether it is a ballad stanza is a question of FORM
        // (quatrains + rhyme scheme), answered by the form layer, not here.
        const evens = counts.filter((_, i) => i % 2 === 0);
        const odds = counts.filter((_, i) => i % 2 === 1);
        const allEq = (a: number[], v: number) => a.length > 0 && a.every(x => x === v);
        if (counts.length >= 4 && allEq(evens, evens[0]) && allEq(odds, odds[0]) && evens[0] !== odds[0]) {
          const pooled = profiles.flatMap(p => p.intervals);
          const family = intervalFamily(pooled);
          const flavour = family === 'dolnik' ? 'dolnik' : 'accentual';
          // "4/3 ♪beat accentual" — no "alternating" (too long), "/" not "·" (so
          // "4·3" is not misread as 12), ♪ marks that these are beat counts.
          note = `${evens[0]}/${odds[0]} ♪beat ${flavour}`;
        } else {
          // Constant ictus count (mode covering ≥70% of lines, total spread ≤1).
          const mode = [...new Set(counts)].map(v => [v, counts.filter(c => c === v).length] as const)
            .sort((a, b) => b[1] - a[1])[0];
          const spread = Math.max(...counts) - Math.min(...counts);
          if (mode && mode[1] / counts.length >= 0.7 && spread <= 1) {
            const pooled = profiles.flatMap(p => p.intervals);
            const family = intervalFamily(pooled);
            if (family === 'dolnik') note = `${ictusName(mode[0])} dolnik`;
            else if (family === 'taktovik') note = `${ictusName(mode[0])} taktovik`;
            else if (family === 'accentual') note = `${mode[0]}-beat accentual`;
            // duple/ternary pooled intervals with varying syllable counts =
            // anacrusis/clausula variation only — classical machinery's domain.
          }
          // NB: a high-spread stanza with NO constant beat count is NOT stamped
          // here.  Forcing a "heterometric" rhythmNote onto every line both
          // polluted the per-line display and (because the continuity pass is
          // gated by rhythmNote) blocked the stanza-continuity rename.  Lines
          // instead keep their own meter and get a per-line dolnik/accentual
          // reading below; the whole-poem heterometric observation is reported
          // by the synopsis (summarizePoem), outside the per-line section.
        }
        if (note) for (const d of lines) d.rhythmNote = note;
      }
    }
  }

  // Per-line refinement: give a free-verse line its interval reading.
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i];
    if (d.rhythmNote || d.meterName !== 'free verse') continue;
    const p = profiles[i];
    if (p.ictuses < 2) continue;
    const family = intervalFamily(p.intervals);
    if (family === 'dolnik') d.rhythmNote = `${ictusName(p.ictuses)} dolnik line`;
    else if (family === 'taktovik') d.rhythmNote = `${ictusName(p.ictuses)} taktovik line`;
    else if (family === 'accentual') d.rhythmNote = `${p.ictuses}-beat accentual line`;
  }
}

/**
 * Stanza-level consensus (McAleese A2.1 §5b, "where there is a tie, use
 * surrounding patterns").  Each line keeps its own standalone scansion/meter;
 * but when a line's top meter merely *edges out* the stanza's dominant meter (a
 * near-tie, within `tie` of its own best fit), we annotate it with the dominant
 * meter via `consensusMeter` — making the divergence EXPLICIT rather than
 * silently homogenising it.  Confident lines (whose own meter clearly beats the
 * dominant) are left untouched, so genuine metrical variation stays visible.
 *
 * Mutates the passed details in place.  No-op for <2 lines or a stanza with no
 * unique dominant meter.
 */
export function applyStanzaConsensus(
  details: PhonologicalScansionDetail[],
  tie: number = 0.975,
): void {
  if (details.length < 2) return;
  const counts = new Map<string, number>();
  for (const d of details) {
    if (d.meterName === 'free verse') continue;
    counts.set(d.meterName, (counts.get(d.meterName) ?? 0) + 1);
  }
  // Dominant meter = the strict plurality (≥2 lines).  A TIED plurality is broken
  // by each tied family's total ranking-score mass across the stanza (2026-07-02):
  // catalectic lines make sibling readings trade wins line-by-line (The Raven's
  // 15-syllable lines flip trochaic-octameter ↔ "iambic heptameter", tying the
  // count 3–3), but the family the stanza actually commits to carries more total
  // fit mass — so the tie is evidence-weighted, never a coin toss or a give-up.
  let dominant = '';
  let max = 0;
  const atMax: string[] = [];
  for (const [m, c] of counts) {
    if (c > max) { max = c; atMax.length = 0; atMax.push(m); }
    else if (c === max) atMax.push(m);
  }
  if (max < 2) return;
  if (atMax.length === 1) {
    dominant = atMax[0];
  } else {
    const mass = (name: string) => details.reduce((s, d) =>
      s + (d.ranking?.find(r => r.meter === name)?.score ?? 0), 0);
    dominant = atMax.reduce((a, b) => (mass(b) > mass(a) ? b : a));
  }
  if (!dominant) return;

  // Ternary ANACRUSIS ANCHOR (Gasparov): when the stanza's dominant meter is
  // ternary, the family is fixed by the stanza's anacrusis profile, not by the
  // per-line name race — a Russian ternary keeps a CONSTANT anacrusis (0 →
  // dactyl, 1 → amphibrach, 2 → anapest), while English anapestic verse mixes
  // full (2) and acephalous (1) openings.  So: constant 1 → amphibrachic
  // (Nabokov's "Exile"); any 2s present alongside 1s → anapestic (Cowper);
  // constant 0 → dactylic.  Overrides the plurality name for the ANNOTATION
  // target only; every line's standalone reading is preserved.
  if (TERNARY_METERS.has(dominant as MetreName)) {
    const anacs: number[] = [];
    for (const d of details) {
      if (!TERNARY_METERS.has(d.meterName as MetreName)) continue;
      const p = ictusProfile(d.scansion);
      if (p.ictuses < 2) continue;
      let anac = p.anacrusis;
      if (RISING_METERS.has(d.meterName as MetreName)) {
        // For a RISING line the raw profile's Attridge promotions pollute the
        // anacrusis: a promoted 'w'/'n' upbeat at position 0 ("'TWAS the night
        // before…") reads as anacrusis 0 and vetoes the anapest call.  The
        // family anchor wants the SCHEME's first beat, so measure to the first
        // STRONG (m/s) ictus instead.  Falling lines keep the raw profile —
        // their genuine first beat is often a light 'n' ("HALF a league").
        const letters = d.scansion.replace(/[^xwnms]/g, '');
        const firstStrong = [...letters].findIndex(c => c === 's' || c === 'm');
        if (firstStrong >= 0) anac = firstStrong;
        // Over-stressed anacrusis (Gasparov): an extra stress on the upbeat
        // does NOT change the meter — a rising line whose first strong sits at
        // position 0 ("NOT a creature was stirring…") has a stressed upbeat,
        // not a dactylic opening; drop it from the anchor vote entirely.
        if (anac === 0) continue;
      }
      if (anac <= 2) anacs.push(anac);
    }
    if (anacs.length >= 2) {
      const has = (v: number) => anacs.includes(v);
      let family: MetreName | null = null;
      if (has(2) && !has(0)) family = 'anapestic';
      else if (has(0) && !has(2)) family = anacs.every(a => a === 0) ? 'dactylic' : null;
      else if (anacs.every(a => a === 1)) family = 'amphibrachic';
      if (family && family !== dominant) dominant = family;
    }
  }

  for (const d of details) {
    d.consensusMeter = undefined; // idempotent: clear any prior annotation
    if (d.meterName === 'free verse' || d.meterName === dominant) continue;
    const own = d.ranking?.[0]?.score ?? 0;
    const dom = d.ranking?.find(r => r.meter === dominant)?.score ?? 0;
    // Ternary SIBLINGS (anapest/amphibrach/dactyl) share their slack/beat
    // alternation, so a 5% composite gap between them is naming noise — e.g. a
    // spondaic anacrusis ("big BOOKS that are HURting…") lets the dactylic fit
    // edge out the stanza's amphibrachs by seizing the clash syllable as an
    // extra beat (Gasparov: an over-stressed anacrusis does NOT change the
    // meter).  The DUPLE pair (iamb/trochee) are siblings in exactly the same
    // sense (2026-07-02): a catalectic trochaic line IS an "iambic" grid plus
    // an offset — The Raven's 15-syllable lines read trochaic-octameter or
    // iambic-heptameter on the same beats — so a stanza committed to one duple
    // family pulls near-tie sibling readings in at the same relaxed window.
    // Non-sibling divergence keeps the stricter 0.975 near-tie.
    const siblings = (TERNARY_METERS.has(d.meterName as MetreName)
        && TERNARY_METERS.has(dominant as MetreName))
      || (DUPLE_METERS.has(d.meterName as MetreName)
        && DUPLE_METERS.has(dominant as MetreName));
    const threshold = siblings ? 0.95 : tie;
    if (own > 0 && dom >= own * threshold) {
      const lengthWord = d.meter.split(' ')[1] ?? '';
      d.consensusMeter = (dominant + (lengthWord ? ' ' + lengthWord : '')).trim();
    }
  }
}

```

## semantics.ts

```typescript
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

```

## stress.ts

```typescript
// stress.ts — Lexical, compound, nuclear stress assignment using nounsing-pro
// (augmented CMU dictionary with 52+ columns), then conversion to McAleese's
// 4‑level relative system.

import * as nounsing from 'nounsing-pro';
import { ClsWord, Syllable, StressLevel, IntonationalUnit, PhonologicalPhrase } from './types.js';
import { isPunctuation } from './parser.js';
import { collectPPTokens, syllabifyWord } from './phonological.js';
import { isStrandedPreposition, isContrastivePossessive, isVocative, isDeicticLocative } from './semantics.js';

// ─── CONSTANTS & CLASSIFICATIONS ──────────────────────────────────

/**
 * Content‑word POS tags (nouns, adjectives, lexical verbs, adverbs).
 * Excludes:
 *   - determiners (including demonstratives)  – function words
 *   - possessive pronouns (PRP$)               – function words
 *   - Wh‑words (WDT, WP, WP$, WRB)            – function words
 *   - prepositions, conjunctions, particles, etc.
 */
const CONTENT_POS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS',   // nouns
  'JJ', 'JJR', 'JJS',           // adjectives
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ',  // lexical verbs (excludes modals MD)
  'RB', 'RBR', 'RBS',           // adverbs
  'CD',                         // cardinal numbers (content-like)
  'PDT',                        // predeterminers / quantifiers ("all", "both", "half") — carry quantificational stress
  'RP',                         // phrasal-verb particles ("coming IN", "take OFF") — they bear the phrasal stress
]);

/**
 * Spatial words that act as phrasal-verb PARTICLES (stress-bearing: "coming IN",
 * "moving ON", "give UP") as opposed to prepositions ("in the house" → reduced).
 * The parser usually tags a true particle `RP` (handled by CONTENT_POS above),
 * but often mis-tags it `IN`/`RB` with an adverbial/particle dependency on the
 * verb — `isPhrasalParticle` recovers those.  A genuine preposition keeps a
 * `prep`/`pobj` dependency on a NOUN and is (correctly) left as a function word.
 */
const PARTICLE_LEMMAS = new Set([
  'in', 'on', 'out', 'off', 'up', 'down', 'over', 'away', 'back',
  'along', 'around', 'about', 'through', 'apart', 'aside', 'forth', 'together',
]);

/** A phrasal-verb particle the parser tagged IN/RB (not RP): stress-bearing. */
function isPhrasalParticle(word: ClsWord): boolean {
  if (word.lexicalClass === 'RP') return true;
  const dep = word.dependency?.dependentType;
  return PARTICLE_LEMMAS.has(word.word.toLowerCase())
    && (dep === 'prt' || dep === 'advmod');
}

/** Demonstratives that, used pronominally (not determining a following noun),
 *  are a stressed focus: "What's THAT?", "Give me THIS." */
const DEMONSTRATIVE_LEMMAS = new Set(['that', 'this', 'these', 'those']);

/**
 * A demonstrative used as a *pronoun* (the clause-final focus), rather than as a
 * determiner of a following noun.  The parser often tags focus "that" as `IN`
 * (complementizer) and it then reduces to `x` — but "What's THAT?" puts the
 * sentence's prominence on it.  Detected as a demonstrative lemma that is the
 * last non-punctuation word of the line (so "Is THAT grass" — a determiner — is
 * untouched).
 */
function isFocusDemonstrative(words: ClsWord[], wi: number): boolean {
  if (!DEMONSTRATIVE_LEMMAS.has(words[wi].word.toLowerCase())) return false;
  for (let k = wi + 1; k < words.length; k++) {
    if (!isPunctuation(words[k].lexicalClass)) return false; // a word follows → determiner use
  }
  return true;
}

/**
 * Clitic POS categories: function words that are *proclitic* — prepositions /
 * subordinators (IN), infinitival "to" (TO), possessive determiners (PRP$) and
 * wh-determiners/possessives/adverbs (WDT/WP$/WRB).  A
 * *monosyllabic* word in one of these classes is reduced in running speech
 * (Selkirk's clitic; McAleese's "beginnings free") and should floor at 'w'
 * (overt-weak, *promotable*), never 'n'.  Leaving a CMU-primary monosyllable
 * like "on"/"my"/"where"/"from" at 'n' produced flat function-word runs (Pound's
 * "So on my" = n·n·n, "where strange" = n·n).
 *
 * Deliberately EXCLUDES:
 *   - modals (MD: "shall"/"might") and personal pronouns (PRP: "I"/"thee"/"you")
 *     — they carry real stress (the clause-final beat in "…fast as you MIGHT").
 *   - determiners (DT) entirely.  The quantificational / negative / demonstrative
 *     ones ("no one", "all verse", "this", "each") carry stress (cf. the
 *     maintainer's PDT-as-content rule); and flooring even the pure articles
 *     a/an tips Tarlinskaja's razor-thin iambic↔anapestic line ("…else a
 *     laugher's license", margin 0.009) into a wrong meter.  "the" already reads
 *     'x' via its CMU-0 stress, so determiners need no extra handling here.
 *   - coordinators (CC: and/but/or).  "and" already reads 'x' (CMU-0); flooring
 *     "but"→w fires earlier than its baseline path and ripples to suppress an
 *     adjacent pronoun's clash-promotion, tipping Tarlinskaja's razor-thin
 *     iambic↔anapestic line — and coordinators bear no part of the n-run problem.
 * Polysyllabic function words are also untouched, so their internal contour is
 * preserved (be·NEATH = x·n, un·der·NEATH = x·x·n).
 */
// NB: deliberately NOT including DT/PRP/MD/WP here.  Monosyllabic pronouns,
// determiners, and modals at 'n' are PROMOTABLE into metrical beats — which
// real iambic verse exploits constantly ("but HE gave NO one ELSE",
// "fast as you MIGHT").  Flooring them to 'w' was tried (2026-06-12) and
// flipped the Mandelstam anapest and the Tarlinskaja iambic: reverted.
const CLITIC_POS = new Set(['IN', 'TO', 'PRP$', 'WDT', 'WP$', 'WRB']);

/** A reducible monosyllabic proclitic (see CLITIC_POS). */
function isMonosyllabicClitic(word: ClsWord): boolean {
  return !word.isContent
    && word.syllables.length === 1
    && CLITIC_POS.has(word.lexicalClass);
}

/**
 * Temporal, locative, and discourse adverbs that behave as function words
 * in verse — they typically occupy weak metrical positions and should not
 * receive the primary-stress treatment of content adverbs.
 */
const FUNCTION_ADVERBS = new Set([
  'then', 'so', 'here', 'there', 'where', 'when', 'why', 'how',
  'thus', 'hence', 'thence', 'whence',
  'now', 'ago', 'afterwards', 'afterward', 'beforehand',
  'meanwhile', 'nevertheless', 'nonetheless', 'however',
  'therefore', 'furthermore', 'moreover',
  'besides', 'instead', 'rather',
  'quite', 'almost', 'nearly', 'just', 'only',
  'even', 'also', 'too', 'very', 'indeed',
  'already', 'yet', 'still', 'again', 'ever', 'never',
  'always', 'often', 'sometimes', 'usually',
  'today', 'tomorrow', 'yesterday', 'tonight',
]);

/**
 * Rising (iambic) disyllabic function words — prepositions, conjunctions, and
 * deictic adverbs that stress the SECOND syllable (be·CAUSE, a·BOUT, be·TWEEN).
 * A handful are recorded fully-reduced ("00") in the augmented dictionary; for
 * those the all-zero re-stamp must fix the FINAL syllable, NOT take the
 * disyllabic forestress default (which mis-read be·CAUSE as BE·cause).  The
 * re-stamp only fires on a genuine all-zero entry, so listing a word that
 * already carries a peak is harmless.  Trochaic IN·to / UN·to / ON·to are
 * deliberately excluded — they correctly keep forestress.
 */
const RISING_FUNCTION_WORDS = new Set([
  'because', 'about', 'above', 'around', 'across', 'along', 'among', 'amongst',
  'against', 'amid', 'amidst', 'apart', 'ahead', 'aside', 'away', 'aloft',
  'alone', 'aloud', 'anew', 'awhile', 'ago',
  'before', 'behind', 'below', 'beneath', 'beside', 'besides', 'between',
  'beyond', 'within', 'without',
]);

/**
 * Oblique (object/dative) pronouns.  In clause-final position these are
 * canonically unstressed and do NOT attract the beat ("…and beHIND me", not
 * "…and behind ME"), unlike a clause-final modal or content word.  Used to keep
 * the "endings strict" upbeat rule from promoting a final object pronoun.
 */
const OBLIQUE_PRONOUNS = new Set([
  'me', 'him', 'her', 'us', 'them', 'thee', 'ye',
]);

/**
 * Subject-pronoun contractions (pronoun + auxiliary).  These are a known data
 * anomaly: FinNLP mis-tags the line-initial "I"-forms as FW, and nounsing records
 * "i'm" with stress 0 while its sibling "i'll" gets 1 — so "I'm" sank to 'x'
 * (Zero-Provision) whereas "I'll" read 'n'.  A contracted subject pronoun is an
 * overt syllable, never a maximally-reduced clitic, so a dictionary-zero one is
 * restamped to its siblings' weak stress (below).  This is a TARGETED fix for that
 * specific inconsistency — it does NOT change how clitics, prepositions, articles,
 * or bare pronouns floor (those keep their broad 'x'/contour behaviour).
 */
const PRONOUN_SUBJECT_CONTRACTIONS = new Set([
  "i'm", "i'll", "i've", "i'd",
  "you're", "you'll", "you've", "you'd",
  "he'll", "he'd", "she'll", "she'd", "it'll",
  "we're", "we'll", "we've", "we'd",
  "they're", "they'll", "they've", "they'd",
]);

/**
 * Poetic aphaeresis / clipping forms (apostrophe-stripped, lowercased) of
 * function words — prepositions and adverbs.  These are OOV, so without special
 * handling they default to a *stressed content* reading (the parser tags
 * "'neath" as NNP → primary stress!).  Only applied when an apostrophe is
 * actually present (so a literal "mid"/"side"/"cross" is left alone).
 */
const APHAERESIS_CLITICS = new Set([
  'neath',  // beneath
  'gainst', // against
  'twixt',  // betwixt
  'mid',    // amid
  'midst',  // amidst
  'mongst', // amongst
  'tween',  // between
  'pon',    // upon
  'oer',    // o'er  = over
  'neer',   // ne'er = never
  'eer',    // e'er  = ever
  'tis',    // 'tis  = it is   (apostrophe-guarded, so a literal "tis" is untouched)
  'twas',   // 'twas = it was
  'twere',  // 'twere = it were
  'twill',  // 'twill = it will (guard protects the fabric "twill")
]);

/**
 * Augmented-CMU data anomalies: for a couple of very common monosyllables the
 * dictionary's ONLY profile is the letter-name spelling pronunciation of an
 * abbreviation homograph — "am" → "EY1 EH1 M" (= A.M.), "us" → "Y UW1 EH1 S"
 * (= U.S.) — inflating the syllable count of any line containing them.  We
 * restore the ordinary CMU citation form (AE1 M / AH1 S: one heavy syllable,
 * citation stress 1) before the dictionary is consulted.
 */
const ANOMALOUS_MONOSYLLABLES: Record<string, { syllab: string; stress?: number; weight?: 'H' | 'L' }> = {
  am: { syllab: '(AE m)' },
  us: { syllab: '(AH s)' },
  // "a" = letter-name "EY1" in the augmented dictionary; the article is the
  // canonical Zero-Provision clitic (schwa, open syllable) → stress 0, light.
  a: { syllab: '(AH)', stress: 0, weight: 'L' },
};

/**
 * Copula, auxiliary, aspectual, and light verbs that act as function words
 * in verse — they do not carry the main semantic or prosodic weight of a phrase
 * and should not be treated as content words for stress rules.
 */
const FUNCTION_VERBS = new Set([
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'done', 'doing',
  'get', 'gets', 'got', 'getting', 'gotten',
  'start', 'starts', 'started', 'starting',
  'begin', 'begins', 'began', 'beginning', 'begun',
  'keep', 'keeps', 'kept', 'keeping',
  'stop', 'stops', 'stopped', 'stopping',
  'continue', 'continues', 'continued', 'continuing',
  'let', 'lets', "let's"
]);

/** The copula / auxiliary forms of BE — they reduce in connected speech whether
 *  used as copula ("she IS fair" → reduced) or auxiliary ("is going"). */
const BE_FORMS = new Set(['be', 'am', 'is', 'are', 'was', 'were', 'being']);

/**
 * Exclamatory / vocative interjections.  These are emphatic, expressive elements —
 * never zero-provision clitics — yet FinNLP routinely mis-tags vocative "O" as a
 * preposition (IN) and "Lo" as a proper noun (NNP), which would otherwise floor
 * them to 'x'.  Keyed off the lemma (not the unreliable tag), they are raised to at
 * least 'n'; an exclaimed one ("O!", "Oh!") is lifted a further tier by the
 * interjection-emphasis pass at the end of assignRelativeStresses.  Apostrophe
 * forms (o'er = over, e'er = ever) are NOT here — they are aphaeresis clitics.
 */
const EXCLAM_INTERJECTIONS = new Set([
  'o', 'oh', 'ah', 'ay', 'aye', 'lo', 'alas', 'alack', 'hark', 'fie', 'woe',
  'ho', 'oho', 'aha', 'ahoy', 'hurrah', 'huzza',
]);

/**
 * Honest baseline relative prominence for a FUNCTION word (McAleese step 1b:
 * "w=weak, n=some stress, m=subordinate strong, s=strong").  A monosyllabic
 * function word bears no lexical *some-stress*; the dictionary's citation stress
 * (which marks "and"/"in"/"my"/"could" as primary) is a CITATION artefact, not
 * connected-speech prominence.  We floor it to its true reading prominence — the
 * meter layer still PROMOTES it to a beat where the metre calls for it (McAleese's
 * Appendix-A Test 2: stressless "than"/"in" stay weak in the contour; the metre
 * lifts only "from", which carries latent stress).  Returns the tier to floor to,
 * or null to leave the word untouched.
 *
 *   'x' (zero-provision) — pure schwa-proclitics that fully reduce: coordinators
 *       (CC: and/or/but/nor), monosyllabic prepositions & subordinators (IN), the
 *       infinitival/prepositional "to" (TO), possessive determiners (PRP$/WP$:
 *       my/your/his/her/its/our/their/whose).
 *   'w' (overt-weak, still meter-promotable) — full-vowel function words: personal
 *       pronouns (PRP), modals (MD), existential "there" (EX), the copula/auxiliary
 *       BE forms, the AUXILIARY uses of have/do (by dependency role — a main-verb
 *       "have"/"did" keeps its beat), and reduced deictic/discourse adverbs.
 *
 * Content words and the internal contour of POLYSYLLABIC function words
 * (be·NEATH = x·n, with·OUT) are returned null (untouched).
 */
function relativeFloorFor(word: ClsWord): StressLevel | null {
  if (word.isContent) return null;
  if (word.syllables.length !== 1) return null; // keep polysyllabic function contour
  const pos = word.lexicalClass;
  const lemma = word.word.toLowerCase().replace(/['’]/g, '');

  // Pure schwa-proclitics → zero-provision 'x'.
  if (pos === 'CC' || pos === 'PRP$' || pos === 'WP$' || pos === 'TO') return 'x';
  if (pos === 'IN') return 'x'; // prepositions / subordinators cliticise

  // Full-vowel weak function words → overt-weak 'w' (meter-promotable).
  if (pos === 'PRP' || pos === 'MD' || pos === 'EX') return 'w';
  if (BE_FORMS.has(lemma)) return 'w'; // copula & auxiliary BE both reduce
  // NB: have/do are deliberately NOT floored — unlike BE they routinely bear a
  // beat (main-verb "have"/"do", emphatic "DID"), and even as auxiliaries they
  // carry an iambic beat often enough ("what HAD I given") that flooring them
  // mis-reads such lines.  Their level is left to the clash filter + meter layer.
  if (FUNCTION_ADVERBS.has(lemma)) return 'w'; // so/then/here/there/when/just…
  return null;
}

/** Left‑stressed compound categories with example first‑word lists. */
const LEFT_STRESS_MATERIAL = new Set([
  'metal', 'wood', 'silk', 'cotton', 'glass', 'stone', 'iron', 'steel',
  'paper', 'plastic', 'gold', 'silver'
]);
const LEFT_STRESS_TIME = new Set([
  'morning', 'evening', 'summer', 'winter', 'spring', 'autumn',
  'christmas', 'easter', 'night', 'day'
]);
const LEFT_STRESS_MEASURE = new Set(['pint', 'dollar', 'foot', 'mile']);
const LEFT_STRESS_LOCATION = new Set([
  'city', 'mountain', 'river', 'street', 'valley', 'island',
  'town', 'village', 'country'
]);
const LEFT_STRESS_SELF = new Set(['self']);

// "Discard / ruin / spectral" noun-modifiers (N1) that reliably forestress as
// compounds: WASTE·land, SCRAP·yard, JUNK·yard, GHOST·town, DEAD·line,
// DUST·bowl, GRAVE·yard, BONE·yard, DEATH·bed.  (Eliot's "WASTE shore".)
const LEFT_STRESS_DISCARD = new Set([
  'waste', 'scrap', 'junk', 'ghost', 'dead', 'dust', 'grave', 'bone',
  'death', 'trash', 'garbage', 'ash', 'blood', 'rust', 'wreck',
]);
// Elemental / landscape noun-modifiers (N1) that reliably forestress:
// SEA·shore, MOON·light, STORM·cloud, WIND·mill, FIRE·place, SALT·marsh,
// FROST·bite, SAND·bar, SNOW·flake, TIDE·water, SHADOW·land.
const LEFT_STRESS_ELEMENTAL = new Set([
  'sea', 'moon', 'sun', 'star', 'storm', 'wind', 'fire', 'rain', 'snow',
  'ice', 'tide', 'wave', 'frost', 'mist', 'fog', 'mud', 'sand', 'salt',
  'earth', 'sky', 'dawn', 'dusk', 'shadow', 'flame', 'ember', 'smoke',
  'cloud', 'water', 'dew', 'hail', 'marsh', 'moor', 'flood', 'foam',
]);
// Fire / light-source N1 modifiers that forestress like the elemental set:
// TORCH·light, CANDLE·light, LAMP·light, LANTERN·light, BEACON·fire,
// HEARTH·stone, COAL·fire, GAS·light — and Pound's hyphenated TORCH·flames
// (parallel to WASTE·shore; "flames" is the head, "torch" the modifier).
const LEFT_STRESS_FIRELIGHT = new Set([
  'torch', 'candle', 'lamp', 'lantern', 'beacon', 'hearth', 'coal', 'gas',
]);
// Vehicle / conveyance N1 modifiers that forestress: SLEIGH·bells/blades,
// CART·wheel, WAGON·train, CAR·door, TRAIN·station, BOAT·house, TROLLEY·tickets.
// (Endocentric N+N where N1 is the conveyance the N2 belongs to / is part of.)
const LEFT_STRESS_VEHICLE = new Set([
  'sleigh', 'sled', 'cart', 'wagon', 'carriage', 'coach', 'train', 'tram',
  'trolley', 'car', 'boat', 'ship', 'plane', 'truck', 'bus', 'bike', 'bicycle',
]);
// Head nouns (N2) that keep phrasal/right stress even after a forestress
// modifier — chiefly food "made of N1" and a few lexical exceptions:
// apple PIE, summer DAY, Fifth AVenue.  These carve-outs keep the rule honest
// (a wrong forestress would mis-teach learners), so they OVERRIDE the N1 sets.
const RIGHT_STRESS_HEADS = new Set([
  'pie', 'cake', 'tart', 'pudding', 'mousse', 'soup', 'salad', 'sauce',
  'juice', 'avenue', 'day',
]);

/** Check if a pair of words forms a left‑stressed compound. */
export function isLeftStressedPair(w1: string, w2: string): boolean {
  const first = w1.toLowerCase();
  const second = w2.toLowerCase().replace(/'s$/, '');
  // A right-stressing head overrides any forestress modifier (apple PIE).
  if (RIGHT_STRESS_HEADS.has(second)) return false;
  if (LEFT_STRESS_MATERIAL.has(first)) return true;
  if (LEFT_STRESS_TIME.has(first)) return true;
  if (LEFT_STRESS_MEASURE.has(first)) return true;
  if (LEFT_STRESS_LOCATION.has(first)) return true;
  if (LEFT_STRESS_SELF.has(first)) return true;
  if (LEFT_STRESS_DISCARD.has(first)) return true;
  if (LEFT_STRESS_ELEMENTAL.has(first)) return true;
  if (LEFT_STRESS_FIRELIGHT.has(first)) return true;
  if (LEFT_STRESS_VEHICLE.has(first)) return true;
  return false;
}

/** True if `w2` is a head noun that keeps phrasal/right stress against an N1
 *  modifier (apple PIE, summer DAY, Fifth AVenue) — the marked right-stress
 *  exceptions to the otherwise fore-stressing Compound Stress Rule. */
export function isRightStressedHead(w2: string): boolean {
  return RIGHT_STRESS_HEADS.has(w2.toLowerCase().replace(/'s$/, ''));
}

/**
 * Direction of primary stress for an adjacent two-word modification structure,
 * the SINGLE source of truth shared by the lexical compound pass
 * (`applyCompoundStress`) and the Phrase-Stress phase (`computePhraseStress`),
 * so the two layers cannot disagree.
 *
 *   'left'  = fore-stress, primary on w1 — the Compound Stress Rule default for
 *             an N+N compound (Chomsky–Halle; McAleese's worked example marks
 *             ICE cream with primary on "ice", not "cream"): KITCHen table,
 *             WINdow frame, BEDroom door, plus the curated LEFT_STRESS_* sets.
 *   'right' = end-stress, primary on w2 — the marked exceptions: food/temporal
 *             "made of N1" heads (apple PIE, summer DAY), Adj+N which is phrasal
 *             not compound (sweet CREAM, red CAR), and proper-name sequences
 *             which carry their own right-headed prosody (New YORK, John SMITH).
 *   null    = not a compound/modification pair at all.
 *
 * The fore-stress default is restricted to COMMON-noun N+N: proper-noun pairs
 * (NNP/NNPS) are excluded because place- and personal-name sequences are not
 * reliably fore-stressed, and flipping them would mis-teach New YORK / John SMITH.
 */
export function compoundStressSide(
  w1: string, pos1: string, w2: string, pos2: string,
): 'left' | 'right' | null {
  const isNN = pos1.startsWith('N') && pos2.startsWith('N');
  const isAdjN = pos1.startsWith('J') && pos2.startsWith('N');
  if (!isNN && !isAdjN) return null;
  if (isLeftStressedPair(w1, w2)) return 'left';   // curated fore-stress modifier
  if (isRightStressedHead(w2)) return 'right';     // apple PIE, Fifth AVenue
  const proper = (p: string) => p === 'NNP' || p === 'NNPS';
  if (isNN && !proper(pos1) && !proper(pos2)) return 'left'; // common-N+N compound default
  return 'right';                                  // Adj+N phrasal / proper-name pair
}

/**
 * Lexicalised forestress COLLOCATIONS — fixed two-word phrases that stress the
 * LEFT element, even though the second word is not a noun (so the N+N/J+N
 * Compound Stress Rule does not reach them).  "GOOD old days/friend";
 * "the be-all and END-all".  Each entry's optional guard suppresses spurious
 * firing (e.g. "End ALL the wars" — the *verb* "end" + quantifier "all the
 * wars" — must NOT forestress; there "all" is a predeterminer PDT).
 */
const LEFT_STRESS_COLLOCATIONS: { w1: string; w2: string; ok?: (b: ClsWord) => boolean }[] = [
  { w1: 'good', w2: 'old' },                                    // GOOD old days
  { w1: 'end', w2: 'all', ok: w => w.lexicalClass !== 'PDT' },  // END-all (idiom), not "end ALL the wars"
  { w1: 'old', w2: 'days' },                                    // the OLD days (fixed expression: "days" is semantically light)
];

/** True if (w1,w2) is a lexicalised forestress collocation in this context. */
function isLeftStressedCollocation(w1: ClsWord, w2: ClsWord): boolean {
  const b1 = w1.word.toLowerCase().replace(/[^a-z]/g, '');
  const b2 = w2.word.toLowerCase().replace(/[^a-z]/g, '');
  for (const c of LEFT_STRESS_COLLOCATIONS) {
    if (b1 === c.w1 && b2 === c.w2 && (!c.ok || c.ok(w2))) return true;
  }
  return false;
}

// ─── LEXICAL STRESS (pronouncingjs) ───────────────────────────────

const VOWEL_CHARS = new Set('aeiouyAEIOUY');

/** Archaic/locative pronominal compounds whose first element ends in a MEDIAL
 *  silent 'e' ("where·fore", "there·in"): the plain vowel-group count reads the
 *  'e' as a nucleus and over-counts.  Count the parts instead. */
const SILENT_E_COMPOUND_RE = /^(where|there|here)(fore|in|by|of|on|upon|at|to|with|out|after|under|unto|abouts?|soever)$/;

function countVowelGroups(word: string, keepDisyllabicFinalE = false): number {
  {
    const m = word.toLowerCase().replace(/[^a-z]/g, '').match(SILENT_E_COMPOUND_RE);
    // Closed-class second elements; counted directly ("fore" would otherwise
    // read 2 — the small-word guard blocks the final-silent-e deduction).
    if (m) return 1 + (m[2] === 'soever' ? 3
      : /^(upon|after|under|unto|about)/.test(m[2]) ? 2 : 1);
  }
  const lower = word.toLowerCase().replace(/-/g, '').replace(/'s/g, '').replace(/'/g, '');
  const n = lower.length;
  let groups = 0;
  let inVowel = false;
  const vowelPositions: number[] = [];
  for (let i = 0; i < n; i++) {
    if (VOWEL_CHARS.has(lower[i])) {
      if (!inVowel) { groups++; vowelPositions.push(i); inVowel = true; }
    } else {
      inVowel = false;
    }
  }
  // Final orthographic silent-e ("magic e"): a word-final 'e' that opens its own
  // vowel group is silent in the default modern reading.  Original rule fired only
  // at 3+ groups; extended (2026-07-02) to DISYLLABIC shapes — archaic verse
  // spellings ("seke", "fote", "nowe", "raunge", "chaunge") read as their modern
  // monosyllables (seek, foot, now, range, change), which restored Wyatt's 4-beat
  // accentual profile.  Exclusions for the disyllabic case only:
  //   • -Cle/-Cre codas (obstruent+liquid+e): the liquid is syllabic and the 'e'
  //     is its written nucleus (table, sabre) — no deduction;
  //   • proper nouns (keepDisyllabicFinalE): foreign names pronounce it (Dante).
  if (groups >= 2 && n > 2 && lower[n - 1] === 'e' && VOWEL_CHARS.has(lower[n - 1])) {
    const lastVowelStart = vowelPositions[vowelPositions.length - 1];
    const syllabicLiquid = /[^aeiouy][lr]e$/.test(lower);
    const allow = groups >= 3 || (!syllabicLiquid && !keepDisyllabicFinalE);
    if (lastVowelStart === n - 1 && allow) {
      groups--;
    }
  }
  return groups;
}

// ─── OUT-OF-VOCABULARY STRESS (two-tier fallback) ─────────────────
//
// When a word is absent from the augmented CMU dictionary, the old fallback
// blindly forestressed it (primary on syllable 0).  That mis-stresses the most
// common OOV case — *inflected/derived forms of common words* whose base IS in
// the lexicon ("voyaging" OOV, "voyage" present) — and many true OOV words too
// ("anfractuous" → AN·fractuous rather than an·FRAC·tuous).  We replace it with:
//   (1) MORPHOLOGICAL decomposition — strip a stress-neutral productive suffix,
//       reconstruct the stem's orthography, look it up, and reuse the stem's
//       *real* lexical stress (the suffix syllables are unstressed).
//   (2) the English Stress Rule (quantity-sensitive) for the genuine residual
//       (names, neologisms) with no recognisable stem.
// Both run ONLY in the OOV branch, so in-vocabulary scansion is untouched.

/** Strip one trailing doubled consonant (run·ning → run, stop·ped → stop). */
function deDouble(b: string): string {
  const m = b.match(/([^aeiou])\1$/i);
  return m ? b.slice(0, -1) : b;
}

/** True if a stem ends in a sibilant/affricate, so a following -s/-es is its own
 *  syllable (kiss·es, box·es, voy·a·ges) rather than a bare coda (cats). */
function isSibilantEnd(s: string): boolean {
  return /(s|z|x|sh|ch|ce|ge|se|ze|dge|tch)$/i.test(s);
}

/**
 * Stress-neutral productive suffixes (Hayes: these do not shift the stem's
 * stress).  `stems(base)` lists candidate stem spellings to try (order = most
 * likely first); `added(stem)` is how many *syllables* the suffix contributes.
 * Stress-SHIFTING suffixes (-ion/-ity/-ic/-ial/-ious/-ify…) are deliberately
 * omitted — treating them as neutral would mis-place the peak; they fall through
 * to the English Stress Rule (and are common enough to usually be in-lexicon).
 */
const SUFFIX_RULES: { suffix: string; stems: (b: string) => string[]; added: (stem: string) => number }[] = [
  { suffix: 'iness', stems: b => [b + 'y'],                 added: () => 1 }, // happi·ness ← happy
  { suffix: 'ily',   stems: b => [b + 'y'],                 added: () => 1 }, // happi·ly ← happy
  { suffix: 'ies',   stems: b => [b + 'y'],                 added: () => 0 }, // car·ries ← carry
  { suffix: 'ied',   stems: b => [b + 'y'],                 added: () => 0 }, // car·ried ← carry
  { suffix: 'ness',  stems: b => [b],                       added: () => 1 },
  { suffix: 'ment',  stems: b => [b],                       added: () => 1 },
  { suffix: 'less',  stems: b => [b],                       added: () => 1 },
  { suffix: 'ful',   stems: b => [b],                       added: () => 1 },
  { suffix: 'ings',  stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ing',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 }, // voy·a·ging ← voyage
  { suffix: 'est',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ed',    stems: b => [b + 'e', b, deDouble(b)], added: stem => /[td]$/.test(stem) ? 1 : 0 },
  { suffix: 'eth',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 }, // archaic 3sg: go·eth, fall·eth, mak·eth
  { suffix: 'ith',   stems: b => [b + 'y', b + 'e', b], added: () => 1 },     // archaic 3sg of -y verbs: sa·ith ← say
  { suffix: 'er',    stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ly',    stems: b => [b],                       added: () => 1 }, // soft·ly ← soft
  { suffix: 'es',    stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
  { suffix: 's',     stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
];

/**
 * Tier 1 — derive an OOV word's numeric stress (2=primary, 1=secondary, 0=none)
 * by stripping a stress-neutral suffix and reusing the in-lexicon stem's stress.
 * Returns null if no productive suffix yields a known stem.
 */
function morphologicalStress(w: string): { pattern: number[]; suffix: string; prefix?: string } | null {
  for (const rule of SUFFIX_RULES) {
    if (!w.endsWith(rule.suffix)) continue;
    const base = w.slice(0, w.length - rule.suffix.length);
    if (base.length < 2) continue; // guard tiny stems (sing → s+ing)
    for (const stem of rule.stems(base)) {
      if (stem.length < 2) continue;
      const data = nounsing.all(stem);
      const raw = data && data.length ? (data[0].stress?.stressTrans || '') : '';
      if (!raw) continue;
      const stemNumeric = [...raw].map(c => mapCMUStress(parseInt(c, 10)));
      if (stemNumeric.length === 0) continue;
      const added = rule.added(stem);
      return { pattern: [...stemNumeric, ...new Array(added).fill(0)], suffix: added >= 1 ? rule.suffix : '' };
    }
  }
  // Tier 1b: PREFIX decomposition (Wagner §6.5.2 — a prefix forms its OWN prosodic
  // domain; the STEM keeps its primary stress).  Only fires on a genuinely OOV word
  // (no suffix decomposition found and the bare word isn't in the lexicon — checked
  // by the caller), and only when the prefix-stripped remainder IS a known stem, so
  // it can only EXTEND coverage, never alter an in-lexicon word.  Heavy separable
  // prefixes (over-/under-/out-/anti-…) bear secondary stress; light ones
  // (un-/re-/dis-…) are unstressed before the stem's primary.
  const pre = prefixStress(w);
  if (pre) return pre;
  return null;
}

/** Productive prefixes: syllable count + whether the prefix's first syllable bears
 *  a SECONDARY stress (separable/heavy) or is unstressed (light Latinate). */
const PREFIX_RULES: { prefix: string; sylls: number; sec: boolean }[] = [
  { prefix: 'counter', sylls: 2, sec: true },
  { prefix: 'over', sylls: 2, sec: true }, { prefix: 'under', sylls: 2, sec: true },
  { prefix: 'inter', sylls: 2, sec: true }, { prefix: 'super', sylls: 2, sec: true },
  { prefix: 'anti', sylls: 2, sec: true }, { prefix: 'semi', sylls: 2, sec: true },
  { prefix: 'multi', sylls: 2, sec: true }, { prefix: 'ultra', sylls: 2, sec: true },
  { prefix: 'fore', sylls: 1, sec: true }, { prefix: 'out', sylls: 1, sec: true },
  { prefix: 'non', sylls: 1, sec: true }, { prefix: 'self', sylls: 1, sec: true },
  { prefix: 'un', sylls: 1, sec: false }, { prefix: 're', sylls: 1, sec: false },
  { prefix: 'pre', sylls: 1, sec: false }, { prefix: 'dis', sylls: 1, sec: false },
  { prefix: 'mis', sylls: 1, sec: false }, { prefix: 'de', sylls: 1, sec: false },
];

function prefixStress(w: string): { pattern: number[]; suffix: string; prefix?: string } | null {
  // longest prefix first (counter- before -); guard against tiny stems.
  for (const rule of [...PREFIX_RULES].sort((a, b) => b.prefix.length - a.prefix.length)) {
    if (!w.startsWith(rule.prefix)) continue;
    const stem = w.slice(rule.prefix.length);
    if (stem.length < 3) continue;                 // need a real stem (re+do too short)
    const data = nounsing.all(stem);
    const raw = data && data.length ? (data[0].stress?.stressTrans || '') : '';
    if (!raw) continue;
    const stemNumeric = [...raw].map(c => mapCMUStress(parseInt(c, 10)));
    if (stemNumeric.length === 0 || !stemNumeric.some(n => n >= 2)) continue;  // stem must carry a primary
    const head = rule.sec ? 1 : 0;
    const preNumeric = [head, ...new Array(Math.max(0, rule.sylls - 1)).fill(0)];
    return { pattern: [...preNumeric, ...stemNumeric], suffix: '', prefix: rule.prefix };
  }
  return null;
}

/** Display-only prefix detection for ALL words (in-vocab AND OOV).
 *
 *  The OOV-only `morphologicalStress` prefix path (Tier 1b) only fires when no
 *  suffix decomposition is found — so "disillusions" (OOV, suffix "-s" → stem
 *  "disillusion" IN-VOCAB) returns before the prefix path runs, and
 *  "uneducated" (IN-VOCAB) never hits the OOV branch at all.  Neither gets
 *  `morphPrefix` set, and the display syllabifier's Maximal Onset principle
 *  pulls the prefix's final consonant into the next syllable (di·sil·lu·sions,
 *  u·ne·du·ca·ted).
 *
 *  This pass runs AFTER `assignLexicalStress` for every word: if it starts with
 *  a known productive prefix (from `PREFIX_RULES`) and the stripped stem is in
 *  the nounsing-pro dictionary, set `word.morphPrefix`.  The syllabifier then
 *  peels the prefix as the first syllable(s) and syllabifies the stem
 *  separately, respecting the morpheme boundary (dis·il·lu·sions,
 *  un·ed·u·ca·ted).  DISPLAY-ONLY — never changes stress or meter.
 *
 *  Guards: the stem must carry a primary stress (so we don't peel a prefix off
 *  a function word like "into"), and the prefix must be at least 2 characters
 *  (to avoid false positives on short words). */
export function detectDisplayPrefixes(words: ClsWord[]): void {
  for (const word of words) {
    if (word.morphPrefix) continue;                    // already set by OOV path
    if (word.syllables.length < 2) continue;            // monosyllables: no boundary to place
    const clean = word.word.toLowerCase().replace(/-/g, '').replace(/[''']/g, '');
    if (clean.length < 5) continue;                     // too short to have prefix + real stem
    for (const rule of [...PREFIX_RULES].sort((a, b) => b.prefix.length - a.prefix.length)) {
      if (!clean.startsWith(rule.prefix)) continue;
      const stem = clean.slice(rule.prefix.length);
      if (stem.length < 3) continue;                    // need a real stem
      const data = nounsing.all(stem);
      if (!data || data.length === 0) continue;
      const raw = data[0].stress?.stressTrans || '';
      if (!raw || !raw.split('').some(c => c === '1' || c === '2')) continue; // stem must carry stress
      word.morphPrefix = rule.prefix;
      break;
    }
  }
}

/**
 * Stress Shift — swap primary↔secondary when Nounsing-Pro confirms the word
 * CAN shift (`suffixShiftPotential` returns `shiftLikely: true`) and the
 * phonological context motivates it.  This is NOT a global rule — it is
 * grounded in the dictionary's own shift-likelihood assessment plus a
 * syntactic/phonological context gate.
 *
 * Conditions (ALL must hold):
 *  1. `suffixShiftPotential(word)` returns `shiftLikely: true`
 *  2. The word's `stressTrans` has both `1` (primary) and `2` (secondary)
 *  3. The LAST digit of `stressTrans` is `2` — secondary is on the final
 *     syllable, so swapping 1↔2 moves primary TO the final
 *  4. Context gate (either):
 *     a. The word is a VB at the start of a phonological phrase (imperative
 *        at phrase start — "REcognize" → "recogNIZE")
 *     b. Rhythm Rule clash: a stressed syllable follows within 2 syllables
 *        (the shift avoids a clash with the following stress)
 *
 * Words like "realize" (shiftLikely=false) are correctly EXCLUDED —
 * Nounsing-Pro says they cannot shift, and the code respects that.
 *
 * Effect: swap the `lexicalStress` values of the primary (2) and secondary (1)
 * syllables, so `peakSyllable` and all downstream computation see the shifted
 * peak.  The syllables' `stress` (raw CMU) values are also swapped for
 * consistency.
 */
export function applyStressShift(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Build a set of words that are at the start of a phonological phrase
  const ppInitials = new Set<ClsWord>();
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const toks = collectPPTokens(pp)
        .filter(w => w.syllables.length > 0)
        .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
      if (toks.length > 0) ppInitials.add(toks[0]);
    }
  }

  const stressed = words.filter(w => w.syllables.length > 0 && !isPunctuation(w.lexicalClass));
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of [...stressed].sort((a, b) => a.absoluteIndex - b.absoluteIndex))
    for (const s of w.syllables) flat.push({ word: w, syl: s });

  for (const word of stressed) {
    if (word.syllables.length < 3) continue;             // need 3+ syllables for a meaningful shift
    const data = nounsing.all(word.word.toLowerCase().replace(/[''']/g, ''));
    if (!data || data.length === 0) continue;
    const st = data[0].stress?.stressTrans ?? '';
    if (!st) continue;

    // Condition 2: has both primary (1) and secondary (2)
    if (!st.includes('1') || !st.includes('2')) continue;
    // Condition 3: the secondary (2) is at a HIGHER index than the primary
    // (1) in the stressTrans string — the swap moves primary RIGHTWARD (toward
    // the end of the word).  This covers both "recognize" (102: 1→0, 2→2) and
    // "dictating" (120: 1→0, 2→1).  Words like "understand" (201: primary
    // already on final) are correctly excluded — the swap would move primary
    // leftward, which is wrong.
    const idx1 = st.indexOf('1');
    const idx2 = st.indexOf('2');
    if (idx2 <= idx1) continue;

    // Condition 1: shiftLikely from Nounsing-Pro
    let shiftLikely = false;
    try {
      const shift = nounsing.suffixShiftPotential(word.word.toLowerCase().replace(/[''']/g, ''));
      if (shift && shift.length > 0) shiftLikely = !!shift[0].shiftLikely;
    } catch { /* graceful no-op */ }
    if (!shiftLikely) continue;

    // Condition 4: context gate — any verb form (VB*).  The stress shift is a
    // well-known phonological process for English verbs (Rhythm Rule, imperative
    // emphasis, compound stress).  Nounsing-Pro's shiftLikely already encodes
    // the phonological possibility; restricting to verb forms excludes nouns
    // like "potato" (NN, shiftLikely=true) that should NOT shift.  No PP-initial
    // requirement — the shift applies to verb forms in any position, matching
    // how English speakers actually shift stress in running speech.
    if (!/^VB/.test(word.lexicalClass)) continue;

    // Execute the shift: swap lexicalStress (and stress) of the primary(2→1)
    // and secondary(1→2) syllables.  In our internal mapping:
    //   CMU/nounsing 1=primary → lexicalStress 2
    //   CMU/nounsing 2=secondary → lexicalStress 1
    //   CMU/nounsing 0=unstressed → lexicalStress 0
    // So we swap the syllable with lexicalStress===2 and the one with ===1.
    let primarySyl: Syllable | null = null;
    let secondarySyl: Syllable | null = null;
    for (const s of word.syllables) {
      if ((s.lexicalStress ?? s.stress) === 2) primarySyl = s;
      if ((s.lexicalStress ?? s.stress) === 1) secondarySyl = s;
    }
    if (!primarySyl || !secondarySyl) continue;
    // Swap lexicalStress
    const tmpLex = primarySyl.lexicalStress;
    primarySyl.lexicalStress = secondarySyl.lexicalStress;
    secondarySyl.lexicalStress = tmpLex;
    // Swap raw stress too (for consistency with downstream that reads s.stress)
    const tmpStress = primarySyl.stress;
    primarySyl.stress = secondarySyl.stress;
    secondarySyl.stress = tmpStress;
  }
}

/** Archaic verbal suffixes whose orthographic peel cleanly separates a silent-
 *  consonant stem from the suffix for DISPLAY (know·est not kno·west).  Other
 *  suffixes keep the default orthographic syllabifier (it handles them well). */
const DISPLAY_PEEL_SUFFIXES = new Set(['est', 'eth', 'ith']);

/** Heavy syllable (orthographic estimate): long vowel (digraph/VCe) or closed
 *  by a coda consonant.  Light = open with a single short vowel. */
function syllableIsHeavy(syl: string): boolean {
  const s = syl.toLowerCase();
  if (/[aeiouy]{2}/.test(s)) return true;        // vowel digraph / diphthong → long
  if (/[aeiou][^aeiouy]e$/.test(s)) return true; // V·C·e → long ("ate", "ime")
  if (/[^aeiouy]$/.test(s)) return true;         // closed syllable (coda present)
  return false;
}

/**
 * Pre-stressing derivational suffixes (Hayes' "pre-stress 1/2"): they fix the
 * primary on a syllable counted from the word's end (`offset` = syllables back,
 * so primary index = n − offset).  -ic/-tion fix the penult (offset 2),
 * -ity/-graphy/-ical fix the antepenult (offset 3).  Longest-match-first
 * (enforced by the length sort below).
 *
 * The 2026-06-10 batch was DERIVED from the augmented CMU data itself
 * (nounsing's `suffixType` shift classes cross-checked against the `mainStress`
 * column over 3+-syllable words; every adopted ending ≥ 0.90 purity, most ≥ 0.96,
 * N ≥ 60).  This includes onomastic endings (-ski/-sky/-son/-berg/-gton …) that
 * matter for OOV proper names — frequent in translation work.  `-ary` is
 * preantepenult and only fires on 4+-syllable words (the n ≥ offset guard),
 * so BI-na-ry / ca-NA-ry style 3-syllable words fall through safely.
 * NOTE: vowel-hiatus suffixes (-ion/-ial/-ious) can be undercounted by the
 * orthographic syllable counter, so those stay approximate (documented limit).
 */
const PRESTRESS_SUFFIXES: { suffix: string; offset: number }[] = [
  // hand-curated originals (Hayes)
  { suffix: 'graphy', offset: 3 }, { suffix: 'ically', offset: 4 },
  { suffix: 'ation', offset: 2 }, { suffix: 'ition', offset: 2 },
  { suffix: 'itude', offset: 3 }, { suffix: 'ical', offset: 3 },
  { suffix: 'logy', offset: 3 }, { suffix: 'nomy', offset: 3 },
  { suffix: 'cracy', offset: 3 }, { suffix: 'pathy', offset: 3 },
  { suffix: 'meter', offset: 3 }, { suffix: 'tion', offset: 2 },
  { suffix: 'sion', offset: 2 }, { suffix: 'ity', offset: 3 },
  { suffix: 'ety', offset: 3 }, { suffix: 'ify', offset: 3 },
  { suffix: 'ics', offset: 2 }, { suffix: 'ic', offset: 2 },
  // data-derived 2026-06-10: final-stressing (ultShift)
  { suffix: 'ette', offset: 1 }, { suffix: 'ese', offset: 1 },
  { suffix: 'eer', offset: 1 }, { suffix: 'ique', offset: 1 },
  // -oon is a reliable final-stresser (bal·LOON, car·TOON, co·COON, after·NOON);
  // OOV-only.  -ee/-ade are deliberately NOT added: they are impure (COF·fee,
  // com·RADE, DEC·ade) and would mis-stress more than they fix.
  { suffix: 'oon', offset: 1 },
  // data-derived: penult-stressing
  { suffix: 'ion', offset: 2 }, { suffix: 'sive', offset: 2 },
  { suffix: 'lla', offset: 2 }, { suffix: 'llo', offset: 2 },
  { suffix: 'lli', offset: 2 }, { suffix: 'tti', offset: 2 },
  { suffix: 'ina', offset: 2 }, { suffix: 'ino', offset: 2 },
  { suffix: 'ano', offset: 2 }, { suffix: 'ana', offset: 2 },
  { suffix: 'ini', offset: 2 },
  { suffix: 'ski', offset: 2 }, { suffix: 'sky', offset: 2 },
  // data-derived: antepenult-stressing
  { suffix: 'ate', offset: 3 }, { suffix: 'cal', offset: 3 },
  { suffix: 'onal', offset: 3 }, { suffix: 'nger', offset: 3 },
  { suffix: 'son', offset: 3 }, { suffix: 'man', offset: 3 },
  { suffix: 'berg', offset: 3 }, { suffix: 'gton', offset: 3 },
  // data-derived: preantepenult-stressing (4+ syllables only via the guard)
  { suffix: 'ary', offset: 4 },
].sort((a, b) => b.suffix.length - a.suffix.length);

/**
 * Tier 2 — the English Stress Rule for genuine OOV (no recognisable stem).
 * First honours a pre-stressing derivational suffix (terRIF·ic, ac·TIV·i·ty,
 * pho·TOG·ra·phy).  Otherwise it is quantity-sensitive with final-syllable
 * extrametricality: monosyllables take primary; disyllables keep the English
 * forestress default; for 3+ syllables the final is extrametrical and stress
 * falls on a heavy penult, else the antepenult (Hayes 1982).  This fixes e.g.
 * an·FRAC·tuous / e·NIG·ma where blind forestress erred.
 */
function englishStressRule(w: string, isContent: boolean, properNoun = false): number[] {
  const n = countVowelGroups(w, properNoun);
  const primary = isContent ? 2 : 1;
  if (n <= 1) return [primary];
  for (const { suffix, offset } of PRESTRESS_SUFFIXES) {
    if (w.endsWith(suffix) && n >= offset) {
      const pattern = new Array(n).fill(0);
      pattern[n - offset] = primary;
      return pattern;
    }
  }
  if (n === 2) return [primary, 0]; // English disyllabic default (trochaic)
  const sylls = syllabifyWord(w, n);
  const pattern = new Array(n).fill(0);
  const penult = n - 2;                 // final (n-1) is extrametrical
  const heavyPenult = sylls[penult] ? syllableIsHeavy(sylls[penult]) : true;
  pattern[heavyPenult ? penult : Math.max(0, n - 3)] = primary;
  // A CONTENT polysyllable does not stay flat after its one primary — give it the
  // rhythmic secondaries English requires (so an OOV 4+-syllable word reads with a
  // real 'n'-tier beat, not a long unstressed tail).
  if (isContent) {
    const heavy = sylls.map(s => (s ? syllableIsHeavy(s) : false));
    addSecondaryStresses(pattern, heavy);
  }
  return pattern;
}

/** Hayes-style rhythmic SECONDARY stresses for an OOV content polysyllable that the
 *  English Stress Rule has given a single primary (2).  English does not leave a long
 *  word with one stress and a flat reduced tail: PRETONIC syllables alternating
 *  leftward from the primary bear a secondary (1) — the metrical grid's lower beats —
 *  e.g. Mìs·sis·SÌp·pi, à·pa·là·CHI·an.  Only the PRETONIC pattern is added: English
 *  pre-stress secondaries are robust, whereas POST-tonic ones are weak and reduce, and
 *  adding them nudged the meter-fitter on a handful of corpus lines for no qualitative
 *  gain.  Deliberately conservative — a secondary is placed only ≥ 2 syllables from the
 *  primary (so it can never clash with the primary or another secondary), so it can
 *  only ADD the 'n'-tier differentiation the contour was missing, never a competing
 *  beat. */
function addSecondaryStresses(pattern: number[], _heavy: boolean[]): void {
  const p = pattern.indexOf(2);
  if (p < 2) return;                          // need a primary with ≥ 2 pretonic syllables
  for (let i = p - 2; i >= 0; i -= 2) {       // pretonic alternation only
    if (pattern[i] === 0) pattern[i] = 1;
  }
}

/**
 * Per-syllable heaviness from nounsing's `syllStruct` CV transcription
 * ("L.CL.CLC": C = consonant, L = lax/short nucleus, T = tense/long nucleus).
 * Heavy = tense nucleus OR closed syllable (a coda consonant after the nucleus).
 * Returns undefined when the segment count doesn't match the syllable count, so
 * callers fall back to the orthographic estimate.
 */
function heavyFromSyllStruct(syllStruct: string | undefined, n: number): boolean[] | undefined {
  if (!syllStruct) return undefined;
  const segs = syllStruct.split('.');
  if (segs.length !== n) return undefined;
  return segs.map(seg => {
    const vi = seg.search(/[LT]/);
    if (vi < 0) return false;
    return seg[vi] === 'T' || vi < seg.length - 1;
  });
}

/**
 * The syllable index that should bear the default stress of a polysyllabic word
 * whose dictionary entry records NO stress at all (an all-zero pattern — the
 * maximally-reduced citation form of a few function words, chiefly "into"=00).
 * Every lexical word bears at least one stress, so we restore it: a pre-stressing
 * suffix fixes the count-from-end syllable; otherwise the English forestress
 * default for disyllables (IN-to, ON-to), and the quantity-sensitive penult/
 * antepenult (Hayes) for longer words.  Mirrors englishStressRule's placement.
 * `heavyFlags` (real per-syllable quantity from nounsing's syllStruct) replaces
 * the orthographic heaviness guess when the word is in-vocabulary.
 */
function defaultStressIndex(word: string, n: number, heavyFlags?: boolean[]): number {
  for (const { suffix, offset } of PRESTRESS_SUFFIXES) {
    if (word.endsWith(suffix) && n >= offset) return n - offset;
  }
  if (n <= 2) return 0;                 // English disyllabic forestress default
  const penult = n - 2;                 // final (n-1) extrametrical
  const heavyPenult = heavyFlags
    ? heavyFlags[penult]
    : (() => { const sylls = syllabifyWord(word, n); return sylls[penult] ? syllableIsHeavy(sylls[penult]) : true; })();
  return heavyPenult ? penult : Math.max(0, n - 3);
}

/**
 * Map CMU stress (0=unstressed, 1=primary, 2=secondary) to
 * McAleese's numeric scale: 0=unstressed, 1=secondary, 2=primary.
 */
function mapCMUStress(cmuStress: number): number {
  if (cmuStress === 1) return 2;   // primary → 2
  if (cmuStress === 2) return 1;   // secondary → 1
  return 0;                        // unstressed → 0
}

/**
 * Assign per‑syllable lexical stress to each word in a sentence.
 *
 * Uses the first CMU pronunciation.  Function words have their
 * primary stress downgraded to secondary (2 → 1).
 */
export function assignLexicalStress(words: ClsWord[]): void {
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    if (isPunctuation(word.lexicalClass)) {
      word.syllables = [];
      continue;
    }

    // Explicitly assign 0 syllables to possessive/contraction clitic "'s"
    if (word.word === "'s") {
      word.syllables = [];
      continue;
    }

    // Poetic aphaeresis clipping ('neath, o'er, 'gainst…) → treat as the reduced
    // function word it stands for, instead of the OOV default (NNP → stressed).
    // Guard on an actual apostrophe (split off as the prior token, or internal),
    // so a literal "mid"/"side"/"cross" is untouched.
    {
      const bare = word.word.toLowerCase().replace(/['’]/g, '');
      const hasApostrophe = /['’]/.test(word.word)
        || (wi > 0 && (words[wi - 1].word === "'" || words[wi - 1].word === '’'));
      if (hasApostrophe && APHAERESIS_CLITICS.has(bare)) {
        word.isContent = false;
        // One weak monosyllable; lexical 0 + function ⇒ maps to 'x' (reduced clitic).
        word.syllables = [{ text: word.word, phones: '', stress: 0, lexicalStress: 0 }];
        continue;
      }
    }

    let lookupWord = word.word.toLowerCase();

    // Letter-name dictionary anomalies ("am" = A.M., "us" = U.S.): stamp the
    // ordinary citation monosyllable directly (see ANOMALOUS_MONOSYLLABLES).
    {
      const fix = ANOMALOUS_MONOSYLLABLES[lookupWord];
      if (fix) {
        const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
        word.isContent = isContent;
        const numeric = fix.stress ?? (isContent ? 2 : 1);   // citation primary; function words reduce to secondary
        word.syllables = [{ text: word.word, phones: fix.syllab, weight: fix.weight ?? 'H', stress: numeric, lexicalStress: numeric }];
        continue;
      }
    }

    // Elided article fused to its host (th'expense, th'inconstant): "th'" is
    // non-syllabic, so the HOST word's dictionary entry is the right source for
    // stress and syllable count — otherwise the fused token goes OOV and takes
    // the disyllabic forestress default (TH'EX-pense instead of th'ex-PENSE).
    {
      const m = lookupWord.match(/^th['’](.+)$/);
      if (m && m[1].length >= 2) lookupWord = m[1];
    }

    let allData = nounsing.all(lookupWord);
    if (!allData && lookupWord.includes('-')) {
      const noHyphen = lookupWord.replace(/-/g, '');
      allData = nounsing.all(noHyphen);
    }
    if ((!allData || allData.length === 0) && lookupWord.includes('-')) {
      const parts = lookupWord.split('-');
      const partStresses: string[] = [];
      const partWeights: string[] = [];
      for (const part of parts) {
        const partData = nounsing.all(part);
        if (partData && partData.length > 0) {
          partStresses.push(partData[0].stress.stressTrans || '');
          partWeights.push(partData[0].weightPattern || '');
        }
      }
      if (partStresses.length === parts.length && partStresses.every(s => s.length > 0)) {
        const combinedStress = partStresses.join('');
        const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
        word.isContent = isContent;
        const syls: Syllable[] = [];
        for (let i = 0; i < combinedStress.length; i++) {
          const cmu = parseInt(combinedStress[i], 10);
          let numeric = mapCMUStress(cmu);
          if (!isContent && numeric === 2) numeric = 1;
          syls.push({ text: word.word, phones: '', stress: numeric, lexicalStress: numeric });
        }
        word.syllables = syls;
        continue;
      }
    }
    if (!allData || allData.length === 0) {
      const cleanWord = word.word.toLowerCase().replace(/-/g, '').replace(/['’]/g, '');
      const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
      word.isContent = isContent;
      // Tier 1: morphological stem (reuse real lexical stress); Tier 2: ESR.
      const morph = morphologicalStress(cleanWord);
      const pattern = morph ? morph.pattern
        : englishStressRule(cleanWord, isContent, /^NNPS?$/.test(word.lexicalClass));
      // Record an archaic verbal suffix so the display splits know·est, not kno·west.
      if (morph && DISPLAY_PEEL_SUFFIXES.has(morph.suffix)) word.morphSuffix = morph.suffix;
      // Record a productive prefix so the display splits dis·il·lu·sions, not
      // di·sil·lu·sions (the Maximal Onset principle would otherwise pull the
      // prefix's final consonant into the next syllable).
      if (morph && morph.prefix) word.morphPrefix = morph.prefix;
      const syls: Syllable[] = pattern.map(numeric => {
        // Mirror the in-vocab function-word reduction (primary → secondary).
        const n = (!isContent && numeric === 2) ? 1 : numeric;
        return { text: word.word, phones: '', stress: n, lexicalStress: n };
      });
      word.syllables = syls;
      continue;
    }

    // For nouns with multiple pronunciations, prefer front‑stressed (noun form).
    let profile = allData[0];
    if (allData.length > 1 && word.lexicalClass.startsWith('N')) {
      for (const p of allData) {
        const stressStr = p.stress.stressTrans;
        if (stressStr && stressStr.length > 0 && (stressStr[0] === '1' || stressStr[0] === '2')) {
          profile = p;
          break;
        }
      }
    }

    let rawStress = profile.stress.stressTrans || '';   // e.g., "010"

    // The CMU syllabification is authoritative for the syllable count.  The
    // orthographic vowel-group count UNDER-counts vowel-hiatus / glide words
    // (goo·ey, play·ers, be·ing each read as a single vowel run), so it must NOT
    // truncate the dictionary's count — doing so collapsed those to one syllable.
    // Only clamp when stressTrans is genuinely LONGER than the CMU
    // syllabification (a rare data inconsistency).
    const syllsMatch = (profile.phonology.syllabification || '').match(/\([^)]+\)/g) || [];
    if (syllsMatch.length > 0 && rawStress.length > syllsMatch.length) {
      rawStress = rawStress.slice(0, syllsMatch.length);
    }

    // Synaeresis (verse vowel-gliding): an UNSTRESSED open syllable ending in a
    // high-front vowel (IY/IH), followed by an UNSTRESSED vowel-initial syllable,
    // glides into one syllable in verse — As·syr·i·an → as·syr·yan, var·i·ous →
    // var·yous, glor·i·ous → glor·yous.  It does NOT fire on a stressed nucleus
    // (be·ing, i·DE·a) or before a stressed vowel (cre·ATE), so those keep their
    // full count.  Distinct from the (removed) orthographic truncation: it merges
    // only genuine glide pairs, leaving goo·ey / play·ers / po·et intact.
    if (syllsMatch.length === rawStress.length && rawStress.length >= 2) {
      const tokensOf = (s: string) => s.replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean);
      const mStress: string[] = [];
      const mSylls: string[] = [];
      for (let i = 0; i < rawStress.length; i++) {
        const cur = tokensOf(syllsMatch[i]);
        const last = cur[cur.length - 1] ?? '';
        const next = i + 1 < rawStress.length ? tokensOf(syllsMatch[i + 1]) : [];
        if (i + 1 < rawStress.length
            && rawStress[i] === '0' && rawStress[i + 1] === '0'
            && (last === 'IY' || last === 'IH')
            && /^[AEIOU]/.test(next[0] ?? '')) {
          mStress.push('0');
          mSylls.push('(' + cur.concat(next).join(' ') + ')');
          i++; // absorb the glided syllable
        } else {
          mStress.push(rawStress[i]);
          mSylls.push(syllsMatch[i]);
        }
      }
      rawStress = mStress.join('');
      syllsMatch.splice(0, syllsMatch.length, ...mSylls);
    }

    // All-zero CMU pattern on a polysyllabic word: restore the default stress.
    // A handful of reduced function words (chiefly "into"=00) are recorded with
    // NO stress at all, which left every syllable at 'x' (in·to = x·x) — both
    // unlike careful usage (IN-to) and metrically inert.  Every lexical word
    // bears a stress, so we re-stamp a CMU primary on the default-stress syllable
    // (forestress for disyllables); function-word demotion downstream turns this
    // into a secondary, giving the natural IN-to contour.  Only fires on the
    // genuine all-zero artifact, so words that already carry a peak are untouched.
    if (rawStress.length >= 2 && /^0+$/.test(rawStress)) {
      const cw = word.word.toLowerCase().replace(/-/g, '').replace(/['’]/g, '');
      const heavy = heavyFromSyllStruct(profile.phonology.syllStruct, rawStress.length);
      // Rising/iambic function words (be·CAUSE, a·BOUT) recorded fully-reduced
      // take FINAL-syllable stress; everything else keeps the forestress default
      // (IN·to, and polysyllabic content artifacts).
      const idx = RISING_FUNCTION_WORDS.has(cw)
        ? rawStress.length - 1
        : defaultStressIndex(cw, rawStress.length, heavy);
      rawStress = rawStress.split('').map((c, i) => (i === idx ? '1' : '0')).join('');
    }

    // Targeted fix for the "I'm" anomaly: a subject-pronoun contraction the
    // dictionary records as fully unstressed ("i'm"=0, while "i'll"=1) is restamped
    // to a weak (function) stress, so it reads like its siblings ('n') rather than
    // sinking to Zero-Provision 'x'.  Narrow by construction — only fires on a
    // monosyllabic, genuinely all-zero pronoun contraction; everything else is
    // left exactly as it was.
    if (rawStress === '0' && PRONOUN_SUBJECT_CONTRACTIONS.has(lookupWord)) {
      rawStress = '1';
    }

    const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
    word.isContent = isContent;

    const syllables: Syllable[] = [];
    const weightsArray = (profile.weightPattern || '').split(' ').filter(x => x === 'H' || x === 'L');

    // Determine extrametricality classification for the final syllable.
    // Uses Hayes (1980) constraints: only Light edge syllables, only noun final syllables,
    // morphological s/z (plural/tense) markers, and derivational suffixes in adjectives.
    const sClassifier = profile.S ?? '';
    // Extrametricality is a property of nouns / derived adjectives.  Key it off
    // the word's actual sentence POS (from the parser), NOT nounsing's lexical
    // pos — otherwise function words like the preposition "underneath" (which the
    // CMU data may tag nominally) wrongly lose the stress on their final syllable.
    const isNoun = word.lexicalClass.startsWith('N');
    const isAdj = word.lexicalClass.startsWith('JJ');
    const finalWeight = profile.weight.find(w => w.syllable === 'final')?.heaviness ?? '';
    const nsylls = rawStress.length;

    let extrametricalType: Syllable['extrametrical'] = undefined;
    if (nsylls >= 2) {
      if ((sClassifier === 'S' || sClassifier === 'SCluster') && isNoun) {
        extrametricalType = 'morphological';
      } else if (isNoun && finalWeight === 'L' && nsylls >= 3) {
        extrametricalType = 'light_noun';
      } else if (isAdj && profile.morphology.suffix === 'suffix') {
        extrametricalType = 'derivational';
      }
    }

    const phonesTokens = profile.phonology.phones.split(' ');
    let phoneIdx = 0;

    for (let i = 0; i < rawStress.length; i++) {
      const ch = rawStress[i];
      const cmu = parseInt(ch, 10);
      let numeric = mapCMUStress(cmu);
      // Function words are reduced in running speech, but their INTERNAL stress
      // contour must be preserved: demote the primary syllable to secondary AND
      // the secondary syllables to none, so the lexical peak stays the peak.
      // (Flattening primary→secondary alone would tie "un" and "neath" in
      //  "underneath", letting a later clash invert it to ÚN-der-neath.)
      if (!isContent) {
        if (numeric === 2) numeric = 1;
        else if (numeric === 1) numeric = 0;
      }

      const wPatLen = weightsArray.length;
      const rLen = rawStress.length;
      const wIdx = wPatLen - (rLen - i);
      const weight = wIdx >= 0 && wIdx < wPatLen ? weightsArray[wIdx] as 'H' | 'L' : 'L';

      const sylTextMatch = syllsMatch[i];
      const sylText = sylTextMatch ? sylTextMatch.replace(/[()]/g, '') : word.word;

      const sylPhonesMatch = syllsMatch[i] || '';
      const isLastSyl = i === rawStress.length - 1;

      syllables.push({
        text: sylText,
        phones: sylPhonesMatch,
        weight,
        stress: numeric,
        lexicalStress: numeric,
        relativeStress: undefined,
        extrametrical: isLastSyl ? extrametricalType : undefined,
      });
    }

    if (extrametricalType) {
        word.lexicalDetails = `extrametrical_${extrametricalType}`;
    }

    // A focus demonstrative ("What's THAT?", "Give me THIS.") carries PRIMARY
    // stress; CMU lists the weak/reduced (complementizer) form, which would leave
    // it merely 'n' after the nuclear boost.  Force its peak to primary so the
    // sentence's prominence lands on it.
    if (isFocusDemonstrative(words, wi) && syllables.length > 0) {
      const pk = syllables.reduce((a, b) => (b.stress >= a.stress ? b : a));
      pk.stress = 2;
      pk.lexicalStress = 2;
    }

    word.syllables = syllables;
  }
}

// ─── COMPOUND STRESS RULE ─────────────────────────────────────────

/**
 * Adjust stresses for nominal compounds.
 *
 * Fore-stressed by default: an N+N compound puts primary (2) on the first
 * element, secondary (1) on the second — the Compound Stress Rule (Chomsky–
 * Halle; McAleese marks ICE cream with primary on "ice", KITCHen table,
 * WINdow frame).  The marked right-stress exceptions — food/temporal "made of"
 * heads (apple PIE), Adj+N phrases (sweet CREAM), and proper-name sequences
 * (New YORK) — reverse it.  All of this lives in `compoundStressSide`.
 */
export function applyCompoundStress(ius: IntonationalUnit[]): void {
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const words = collectPPTokens(pp);
      // We don't want compound stress applied between arbitrary words across a phrase!
      // Only apply to ADJACENT content words!
      const contentWords = words.filter(w => w.isContent);
      for (let i = 0; i < contentWords.length - 1; i++) {
        const w1 = contentWords[i];
        const w2 = contentWords[i + 1];

        // Wait, they must be adjacent in the sentence!
        if (Math.abs(w1.absoluteIndex - w2.absoluteIndex) !== 1) continue;

        const side = compoundStressSide(w1.word, w1.lexicalClass, w2.word, w2.lexicalClass);
        if (side === null) continue;

        if (side === 'left') {
          setPrimaryStress(w1, 2);
          setPrimaryStress(w2, 1);
        } else {
          setPrimaryStress(w1, 1);
          setPrimaryStress(w2, 2);
        }
      }
    }
  }
}

/** Locate the syllable with the highest stress and set it to `value`. */
export function setPrimaryStress(word: ClsWord, value: number): void {
  let maxIdx = -1;
  let maxVal = -1;
  for (let i = 0; i < word.syllables.length; i++) {
    if (word.syllables[i].stress > maxVal) {
      maxVal = word.syllables[i].stress;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) {
    word.syllables[maxIdx].stress = value;
  }
}

// ─── NUCLEAR STRESS RULE ──────────────────────────────────────────

/**
 * Recursively assign higher stress to content words from right to left.
 * Only the rightmost content word receives a boost (+1 above lexical primary).
 * All other content words keep their lexical stress.
 * This preserves lexical stress for meter detection while still indicating
 * the nuclear accent for phonological phrasing.
 */
export function applyNuclearStress(ius: IntonationalUnit[]): void {
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const words = collectPPTokens(pp).sort((a, b) => a.index - b.index);
      // The nuclear accent normally lands on the rightmost CONTENT word.
      let target: ClsWord | null = null;
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i].isContent) { target = words[i]; break; }
      }
      // But a content-less phrase ending in a non-oblique personal pronoun puts
      // the nuclear accent on that final pronoun (NSR: the accent falls on the
      // last accentable item; a clause-final addressee/focus pronoun bears it —
      // "…to YOU").  Only when there is no content word to carry it, so "I KNOW
      // you" is untouched; oblique objects (me/him/them) stay deaccented.
      if (!target) {
        let lastIdx = -1;
        for (let i = words.length - 1; i >= 0; i--) {
          if (!isPunctuation(words[i].lexicalClass)) { lastIdx = i; break; }
        }
        if (lastIdx >= 0) {
          const w = words[lastIdx];
          if (w.lexicalClass === 'PRP'
              && !OBLIQUE_PRONOUNS.has(w.word.toLowerCase().replace(/['’]/g, ''))) {
            target = w;
          }
        }
      }
      if (target) {
        let maxIdx = -1;
        let maxVal = -1;
        for (let j = 0; j < target.syllables.length; j++) {
          if (target.syllables[j].stress > maxVal) {
            maxVal = target.syllables[j].stress;
            maxIdx = j;
          }
        }
        if (maxIdx >= 0) target.syllables[maxIdx].stress += 1;
      }
    }
  }
}

// ─── RELATIVE STRESS ASSIGNMENT (4‑LEVEL) ─────────────────────────

/**
 * Phrase-edge sets used for the "endings strict / beginnings loose" floor gate.
 * McAleese (after Hayes & Kaun): metrical and lexical stress coincide at the
 * ENDS of phonological units (clitic phrase 90% / phonological phrase 97% /
 * intonational unit 99%); Selkirk notes a function word is not reduced at the
 * end of a clitic phrase ("of" never → "o'" there).  So a function word at the
 * right edge of a PP or IU — or the phrase-stress PEAK (nucleus) of its PP —
 * resists the citation-floor reduction, while interior / left-edge function
 * words reduce as before.  Reads the Phrase-Stress phase (word.phraseStress).
 */
function phraseEdgeSets(ius: IntonationalUnit[]): {
  ppFinal: Set<ClsWord>; iuFinal: Set<ClsWord>; ppPeak: Set<ClsWord>;
} {
  const ppFinal = new Set<ClsWord>();
  const iuFinal = new Set<ClsWord>();
  const ppPeak = new Set<ClsWord>();
  for (const iu of ius) {
    let iuLast: ClsWord | null = null;
    for (const pp of iu.phonologicalPhrases) {
      const toks = collectPPTokens(pp)
        .filter(w => !isPunctuation(w.lexicalClass))
        .sort((a, b) => a.index - b.index);
      if (toks.length === 0) continue;
      const last = toks[toks.length - 1];
      ppFinal.add(last);
      iuLast = last;
      let peak = toks[0];
      let peakVal = peak.phraseStress ?? 0;
      for (const t of toks) {
        const v = t.phraseStress ?? 0;
        if (v > peakVal) { peak = t; peakVal = v; }
      }
      // Only protect a genuine nuclear ramp peak (phraseStress ≥ 2): an all-floor
      // PP (all function words, or the Phase-Stress phase not run) has no nucleus
      // to protect, so we must not spuriously shield its first token.
      if (peakVal >= 2) ppPeak.add(peak);
    }
    if (iuLast) iuFinal.add(iuLast);
  }
  return { ppFinal, iuFinal, ppPeak };
}

/**
 * Convert numeric per‑syllable stress to McAleese’s symbolic levels
 * (w, n, m, s) and resolve adjacent identical stresses using dependency
 * information.
 */
export function assignRelativeStresses(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Phrase-edge sets for the endings-strict floor gate (read from Phase-Stress).
  const edges = phraseEdgeSets(ius);
  // Syllables raised by dependency-mined prominence (stranded preposition,
  // contrastive possessive, vocative): protected from the per-PP trailing-run
  // flatten so the recovered beat survives.
  const prominenceProtected = new Set<Syllable>();

  // First pass: numeric → symbolic (0→w, 1→n, 2→m, 3+→s)
  // Use lexicalStress (pre-nuclear) so nuclear stress doesn't corrupt meter detection.
  for (const word of words) {
    for (const syl of word.syllables) {
      const val = syl.lexicalStress ?? syl.stress;
      if (val === 0) {
        // Zero-Provision (`x`) for a maximally-reduced clitic: a stressless
        // syllable of a function word reads *below* a stressless content
        // syllable (the/a/of/and… vs. the weak syllable of a content word).
        // EXCEPTION: an aphaeresis clipping ('neath/o'er/'gainst…) is the
        // *lexically-stressed* syllable of its base word surviving the clip — an
        // overt syllable carrying real stress, merely reduced in context.  `x`
        // means extrametrical (Hayes' zero-provision), which it is NOT; so it
        // floors at `w` (overt weak), promotable like any weak syllable.
        const bare = word.word.toLowerCase().replace(/['’]/g, '');
        // Function VERBS (copula/aux/aspectual: be/is/keeps/began…) and
        // function ADVERBS (deictic/scalar: just/now/then/here/there…) floor
        // at 'w', not 'x': both classes carry full, unreducible vowels —
        // 'x' is for schwa-able clitics (the/a/of/and).  At 'w' they remain
        // Attridge-promotable, recovering e.g. the dactylic opening beat of
        // "JUST for a riband to STICK in his coat" (Browning).
        if (word.isContent || APHAERESIS_CLITICS.has(bare)
            || FUNCTION_VERBS.has(bare) || FUNCTION_ADVERBS.has(bare)) {
          syl.relativeStress = 'w';
        } else {
          syl.relativeStress = 'x';
        }
      } else if (val === 1) {
        syl.relativeStress = 'n';
      } else if (val === 2) {
        syl.relativeStress = 'm';
      } else {
        syl.relativeStress = 's';
      }
      // Monosyllabic function clitic → floor at 'w' (overt-weak, promotable),
      // never 'n'.  A CMU-primary monosyllabic preposition/determiner/possessive/
      // wh-word/coordinator is reduced in running speech; flooring it at 'n' is
      // what produced the flat function-word runs ("So on my", "where strange").
      // (Pure clitics the/a/of already read 'x' via the val===0 branch.)
      if (syl.relativeStress === 'n'
          && (isMonosyllabicClitic(word) || word.word.toLowerCase() === 'am')) {
        // "am" (1sg copula) is reliably reduced — far more so than beat-bearing
        // is/are/was/were — so it floors at 'w' (still Attridge-promotable) rather
        // than surfacing at 'm' as a spurious beat in "As I am BLOOD…".  Kept to
        // this one form: flooring all be-verbs regressed Wyatt's accentual + corpus.
        syl.relativeStress = 'w';
      }
      // Downgrade extrametrical syllables by one level.  We do NOT push a weak
      // syllable to 'x' here: 'x' (zero-provision) is reserved for maximally-
      // reduced *clitics*, whereas a weak *content* syllable (e.g. the feminine
      // ending "li·cense") stays 'w' per the maintainer's tier semantics.
      if (syl.extrametrical === 'morphological') {
        if (syl.relativeStress === 'n') syl.relativeStress = 'w';
        else if (syl.relativeStress === 'm') syl.relativeStress = 'n';
        else if (syl.relativeStress === 's') syl.relativeStress = 'm';
      }
    }

    // Honest baseline prominence: floor a monosyllabic function word to its true
    // reading prominence ('x' schwa-clitic / 'w' overt-weak), never raising it.
    // The dictionary's citation stress on "and"/"in"/"my"/"could" is an artefact;
    // the meter layer re-promotes these where the metre needs a beat.
    //
    // ENDINGS STRICT / BEGINNINGS LOOSE (McAleese; Selkirk): withhold the floor
    // for a function word at the right edge of a PP or IU, or one that is its
    // PP's phrase-stress peak — it resists reduction there (a stranded/clause-
    // final "to"/"you"/"of" is not crushed to a clitic).  Oblique object
    // pronouns (me/him/thee…) are excepted: they stay default-deaccented even
    // phrase-finally ("I gave it to HIM" only under focus, handled later).
    const lemma = word.word.toLowerCase().replace(/['’]/g, '');
    const edgeProtected =
      (edges.iuFinal.has(word) || edges.ppFinal.has(word) || edges.ppPeak.has(word))
      && !OBLIQUE_PRONOUNS.has(lemma);
    const floor = relativeFloorFor(word);
    if (floor && !edgeProtected) {
      const fr = STRESS_RANK[floor];
      for (const syl of word.syllables) {
        if (STRESS_RANK[syl.relativeStress ?? 'w'] > fr) syl.relativeStress = floor;
      }
    }

    // Dependency-mined prominence (the parse IS the semantic layer): recover the
    // beat a flat POS floor would crush.  A STRANDED preposition ("waiting FOR",
    // "stare AT") and a CONTRASTIVE possessive ("THY choice, not mine") bear
    // real stress → raise the peak to at least 'n' (promotable); a VOCATIVE
    // address ("Sing, O GODDESS") to at least 'm'.  Raise-only; the raised peak
    // is protected from the per-PP trailing-run flatten below.
    let promoteTo: StressLevel | null = null;
    if (isVocative(word, words) || isDeicticLocative(word, words)) promoteTo = 'm';
    else if (isStrandedPreposition(word, words) || isContrastivePossessive(word, words)) promoteTo = 'n';
    if (promoteTo) {
      const pk = wordPeak(word);
      if (pk && STRESS_RANK[pk.relativeStress ?? 'w'] < STRESS_RANK[promoteTo]) {
        pk.relativeStress = promoteTo;
      }
      if (pk) prominenceProtected.add(pk);
    }

    // Exclamatory interjection ("O", "Oh", "Ah", "Lo", "Alas"): emphatic, never
    // reduced — raise its peak to at least 'n' (corrects the mis-tag that floored
    // vocative "O"→IN→'x').  Raise-only; an exclaimed one is lifted further below.
    if (EXCLAM_INTERJECTIONS.has(word.word.toLowerCase())) {
      const pk = wordPeak(word);
      if (pk && STRESS_RANK[pk.relativeStress ?? 'w'] < STRESS_RANK.n) pk.relativeStress = 'n';
    }
  }

  // Apply nuclear stress boosts to relative stress.
  // `syl.stress` may be higher than `syl.lexicalStress` after applyNuclearStress
  // boosted the rightmost content word. Each level of increase promotes the
  // relative stress by one tier: w→n, n→m, m→s.
  for (const word of words) {
    for (const syl of word.syllables) {
      const base = syl.lexicalStress ?? 0;
      const boost = syl.stress - base;
      if (boost > 0) {
        let current = syl.relativeStress ?? 'w';
        for (let i = 0; i < boost; i++) {
          if (current === 'x') current = 'w';
          else if (current === 'w') current = 'n';
          else if (current === 'n') current = 'm';
          else if (current === 'm') current = 's';
        }
        syl.relativeStress = current;
      }
    }
  }

  // Second pass: resolve adjacent identical stresses within each phonological phrase
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const ppWords = collectPPTokens(pp);
      resolveAdjacentClashes(ppWords, prominenceProtected);
    }
  }

  // Third pass: resolve clashes across prosodic boundaries (PP and IU).
  // McAleese: when two adjacent syllables at a prosodic boundary have equal stress
  // and one is a function word, demote the function word (beginnings-free principle).
  resolveCrossBoundaryClashes(words, ius);

  // Compound forestress (linear surface order): a left-stressed compound's
  // prominence sits on its LEFT element (WASTE·shore, SEA·shore, GHOST·town).
  // The phrasal compound/nuclear rules run in hierarchy order, which a mis-
  // grouped parse can split (e.g. "a cavernous waste shore" separating
  // waste/shore), so we re-assert forestress here on true surface adjacency,
  // after the clash passes, so it survives the rightmost-content nuclear boost.
  resolveCompoundForestress(words);
  resolveCollocationForestress(words);
  resolveHyphenCompounds(words);

  // Fourth pass: resolve clashes on the LINEAR SURFACE order.  A stress clash is
  // a property of *contiguous pronounced* syllables (Hayes' "two contiguous
  // syllables"), i.e. surface order — but the phrasal passes above run in
  // hierarchy order, which a mis-grouped parse can scramble (e.g. "a cavernous
  // waste shore" leaving "waste"/"shore" non-adjacent in the tree though
  // contiguous in speech).  Catch any residual cardinal s–s clash here.
  resolveLinearClashes(words);

  // Exclaimed interjection: an interjection immediately followed by "!" (Oh!, Ah!,
  // O!, Lo!) is an emphatic peak — raise it one tier so it stands out from a flat
  // run of neighbouring function words ("But—Oh! ye lords…" was a monotone n·n·n,
  // with the interjection no louder than the conjunction beside it).  Narrow by
  // construction: only an UH whose very next token is "!".
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    if (w.lexicalClass !== 'UH' || w.syllables.length === 0) continue;
    if (words[i + 1].word !== '!') continue;
    const pk = wordPeak(w);
    if (!pk) continue;
    const r = STRESS_RANK[pk.relativeStress ?? 'w'];
    if (r < STRESS_RANK.s) pk.relativeStress = STRESS_LEVELS[r + 1];
  }

}

/**
 * Surface-order post-processing passes that re-assert forestress and resolve
 * residual clashes AFTER the main relativisation.  These run in the Clio engine
 * inside `assignRelativeStresses`; the Calliope engine calls this separately
 * after `computeRelativeStress` so the same repairs reach both pipelines.
 *
 * The passes are:
 *   1. resolveCompoundForestress — re-assert left-stress on surface-adjacent
 *      N+N/J+N compounds the tagger mislabels (WASTE·shore, SEA·shore).
 *   2. resolveCollocationForestress — forestress lexicalised collocations
 *      (GOOD old, END-all, OLD days).
 *   3. resolveHyphenCompounds — resolve dual-strong clashes at hyphen seams
 *      (torch-flames, blood-red).
 *   4. resolveLinearClashes — catch residual s-s / m-m / n-n surface clashes
 *      with the full 7-level demotion cascade (lexical integrity → prominence →
 *      syntactic headedness → content/function → weight → Rhythm Rule → default).
 *   5. Exclaimed interjection raise — an interjection immediately followed by
 *      "!" is lifted one tier ("But—Oh! ye lords…").
 *
 * All passes are DEMOTE-ONLY (or forestress re-assertions that raise the LEFT
 * element of a known compound); none inflate the contour beyond what the lexicon
 * and phrase-stress rules already established.
 */
export function applySurfacePostProcessing(words: ClsWord[]): void {
  resolveCompoundForestress(words);
  resolveCollocationForestress(words);
  resolveHyphenCompounds(words);
  resolveLinearClashes(words);
  resolvePhrasalVerbParticle(words);
  raiseInterrogativePronounFocus(words);

  // Exclaimed interjection: an interjection immediately followed by "!" (Oh!, Ah!,
  // O!, Lo!) is an emphatic peak — raise it one tier so it stands out from a flat
  // run of neighbouring function words.  Only an UH whose very next token is "!".
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    if (w.lexicalClass !== 'UH' || w.syllables.length === 0) continue;
    if (words[i + 1].word !== '!') continue;
    const pk = wordPeak(w);
    if (!pk) continue;
    const r = STRESS_RANK[pk.relativeStress ?? 'w'];
    if (r < STRESS_RANK.s) pk.relativeStress = STRESS_LEVELS[r + 1];
  }
}

/** Interrogative copula pronoun focus: in "Is it YOU?", "Was it HIM?", the
 *  pronoun is the FOCUSED element — the question asks about identity, so the
 *  complement pronoun carries the focus stress.  UDPipe mis-tags this as
 *  NSUBJ (it parses "it" as ROOT, "you" as nsubj of "it"), but the real
 *  structure is: "it" is the dummy subject, the pronoun is the predicate
 *  complement.
 *
 *  Detection (very narrow, will NOT fire on the counter-examples):
 *    1. A PRP (personal pronoun, NOT PRP$ possessive) tagged NSUBJ
 *    2. Its governor is "it" (PRP, ROOT)
 *    3. "it" has an AUX dependent that is a be-form (is/are/was/were/be/been)
 *    4. The be-form is the first word of the sentence
 *
 *  Counter-examples that are correctly EXCLUDED:
 *    - "I'm asleep" → "I" is NSUBJ of "asleep" (not of "it") → not matched
 *    - "his mouth" → "his" is PRP$ (not PRP) → not matched
 *    - "our youth" → "our" is PRP$ → not matched
 *    - "we're awake" → "we" governor is "awake" (not "it") → not matched
 *    - "I would give you" → "you" is DOBJ (not NSUBJ) of "give" → not matched */
function raiseInterrogativePronounFocus(words: ClsWord[]): void {
  const BE_FORMS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being',
    "'s", "'re"]);
  const real = words.filter(w => w.syllables.length > 0 && !isPunctuation(w.lexicalClass));
  if (real.length === 0) return;

  for (const w of real) {
    if (w.lexicalClass !== 'PRP') continue;
    if ((w.canonicalRel ?? '') !== 'NSUBJ') continue;
    const gov = w.dependency?.governor;
    if (!gov || gov === w) continue;
    if (gov.word.toLowerCase() !== 'it' || gov.lexicalClass !== 'PRP') continue;
    if ((gov.canonicalRel ?? '') !== 'ROOT') continue;

    // Find the be-form AUX dependent of "it" that is the first word
    const aux = real.find(x =>
      (x.canonicalRel ?? '') === 'AUX' &&
      x.dependency?.governor === gov &&
      BE_FORMS.has(x.word.toLowerCase()));
    if (!aux) continue;

    // The be-form must be the first real word of the sentence (interrogative
    // verb-subject inversion)
    const firstWord = real.sort((a, b) => a.absoluteIndex - b.absoluteIndex)[0];
    if (aux !== firstWord) continue;

    // Found the interrogative copula construction: "Is it YOU?".
    // 1. Raise the focused pronoun to 'm' — it is the information-seeking
    //    element, the strongest stress in the question.
    const pk = wordPeak(w);
    if (pk) {
      const r = STRESS_RANK[pk.relativeStress ?? 'w'];
      if (r < STRESS_RANK.m) pk.relativeStress = 'm';
    }
    // 2. Lower the dummy subject "it" to 'w' — it is an expletive, not a real
    //    content word, and must not sit at 'n' creating a flat n-n-n chain with
    //    the pronoun and the following adverb.
    const itPk = wordPeak(gov);
    if (itPk) {
      const r = STRESS_RANK[itPk.relativeStress ?? 'w'];
      if (r > STRESS_RANK.w) itPk.relativeStress = 'w';
    }
  }
}

/** Phrasal-verb particle stress: in a VB+RP pair ("come ON", "take OFF", "give
 *  UP"), the PARTICLE bears the stress — English phonology places the phrasal
 *  accent on the particle, not the verb.  UDPipe confirms the relation via the
 *  `compound:prt` dependency (canonicalRel='VPRT') or the RP POS tag.  When the
 *  verb currently outranks the particle, swap their peaks: demote the verb one
 *  rung, promote the particle to the verb's former level.  Only fires when they
 *  are surface-adjacent (the particle immediately follows the verb). */
function resolvePhrasalVerbParticle(words: ClsWord[]): void {
  const content = words.filter(w => w.syllables.length > 0 && !isPunctuation(w.lexicalClass));
  for (let i = 0; i < content.length - 1; i++) {
    const verb = content[i];
    const particle = content[i + 1];
    if (Math.abs(verb.absoluteIndex - particle.absoluteIndex) !== 1) continue;
    if (!/^VB/.test(verb.lexicalClass)) continue;
    // The partner must be a phrasal-verb particle: RP POS, or has a prt/VPRT
    // dependency on the verb, or is recovered by isPhrasalParticle.
    const isParticle =
      particle.lexicalClass === 'RP' ||
      (particle.canonicalRel ?? '') === 'VPRT' ||
      particle.dependency?.dependentType === 'compound:prt' ||
      (PARTICLE_LEMMAS.has(particle.word.toLowerCase()) &&
       (particle.dependency?.dependentType === 'prt' ||
        particle.dependency?.dependentType === 'advmod'));
    if (!isParticle) continue;
    const vPeak = wordPeak(verb);
    const pPeak = wordPeak(particle);
    if (!vPeak || !pPeak) continue;
    const rv = STRESS_RANK[vPeak.relativeStress ?? 'w'];
    const rp = STRESS_RANK[pPeak.relativeStress ?? 'w'];
    if (rv <= rp) continue;                        // particle already ≥ verb → nothing to do
    // Swap: particle gets the verb's level, verb drops one rung
    pPeak.relativeStress = STRESS_LEVELS[rv];
    vPeak.relativeStress = STRESS_LEVELS[Math.max(0, rv - 1)];
  }
}

/** Ascending rank of the 5 relative-stress tiers, for level arithmetic. */
const STRESS_RANK: Record<StressLevel, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const STRESS_LEVELS: StressLevel[] = ['x', 'w', 'n', 'm', 's'];

/**
 * Re-assert left-stress on forestressed compounds over the LINEAR surface
 * sequence (e.g. WASTE·shore, SEA·shore, GHOST·town, STORM·cloud).  For each
 * pair of truly-adjacent content words (by absoluteIndex) that the Compound
 * Stress Rule marks left-stressed, the left element's peak is raised to the
 * pair's maximum prominence and the right element's peak is demoted one rung
 * below it — never raising the subordinate.  Runs on surface order so it works
 * even when the parse mis-groups the two into different phrases.
 */
function resolveCompoundForestress(words: ClsWord[]): void {
  const content = words.filter(w => w.isContent && !isPunctuation(w.lexicalClass));
  for (let i = 0; i < content.length - 1; i++) {
    const w1 = content[i];
    const w2 = content[i + 1];
    if (Math.abs(w1.absoluteIndex - w2.absoluteIndex) !== 1) continue; // truly adjacent
    const pos1 = w1.lexicalClass, pos2 = w2.lexicalClass;
    if (!(pos2.startsWith('N') && (pos1.startsWith('N') || pos1.startsWith('J')))) continue;
    if (!isLeftStressedPair(w1.word, w2.word)) continue;

    const s1 = wordPeak(w1);
    const s2 = wordPeak(w2);
    if (!s1 || !s2) continue;
    const r1 = STRESS_RANK[s1.relativeStress ?? 'w'];
    const r2 = STRESS_RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = STRESS_LEVELS[hi];                         // head ≥ both
    s2.relativeStress = STRESS_LEVELS[Math.min(r2, Math.max(0, hi - 1))]; // demote-only
  }
}

/**
 * Forestress lexicalised collocations (GOOD old, END-all) over the LINEAR
 * surface sequence.  Unlike `resolveCompoundForestress` this iterates ALL words
 * (not just content), because a collocation's second element may be a function
 * word ("end ALL" — "all" is a determiner): raise the left element's peak to the
 * pair maximum and demote the right one rung (demote-only, never raises the
 * subordinate).
 */
function resolveCollocationForestress(words: ClsWord[]): void {
  const seq = words
    .filter(w => !isPunctuation(w.lexicalClass) && w.syllables.length > 0)
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  // Track words demoted as the RIGHT element of a collocation — a word just
  // demoted (e.g. "old" in "GOOD old") must NOT be re-forestressed as the LEFT
  // element of a following collocation ("old days"), or it would be raised back
  // up and "days" would be wrongly demoted, destroying "GOOD old DAYS".
  const demoted = new Set<ClsWord>();
  for (let i = 0; i < seq.length - 1; i++) {
    const w1 = seq[i];
    const w2 = seq[i + 1];
    if (w2.absoluteIndex - w1.absoluteIndex !== 1) continue; // truly adjacent
    if (!isLeftStressedCollocation(w1, w2)) continue;
    if (demoted.has(w1)) continue;                 // w1 was a prior collocation's right element — don't re-forestress

    const s1 = wordPeak(w1);
    const s2 = wordPeak(w2);
    if (!s1 || !s2) continue;
    const r1 = STRESS_RANK[s1.relativeStress ?? 'w'];
    const r2 = STRESS_RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = STRESS_LEVELS[hi];                         // left element ≥ both
    s2.relativeStress = STRESS_LEVELS[Math.min(r2, Math.max(0, hi - 1))]; // demote-only
    demoted.add(w2);
  }
}

/**
 * Resolve the dual-strong clash at a hyphen seam inside a compound word
 * ("torch-flames", "blood-red").  The parser keeps a hyphenated compound as a
 * single token, so the word-level compound and clash passes never see its two
 * halves — left alone, both keep primary stress (s·s).  For a hyphenated content
 * word whose hyphen parts align 1:1 with its syllables, an adjacent s·s seam is
 * resolved with the same logic as a two-word compound: forestress the left if it
 * is a known forestress modifier, otherwise retract the left (the nuclear /
 * right-stress default, e.g. torch-FLAMES).
 */
function resolveHyphenCompounds(words: ClsWord[]): void {
  for (const w of words) {
    if (!w.isContent || !w.word.includes('-')) continue;
    const parts = w.word.split('-').filter(p => p.length > 0);
    if (parts.length < 2 || parts.length !== w.syllables.length) continue;
    for (let i = 0; i < w.syllables.length - 1; i++) {
      const a = w.syllables[i];
      const b = w.syllables[i + 1];
      // An equal-strong seam (s·s or m·m) is the unresolved compound clash.
      const equalStrong = a.relativeStress === b.relativeStress
        && (a.relativeStress === 's' || a.relativeStress === 'm');
      if (equalStrong) {
        if (isLeftStressedPair(parts[i], parts[i + 1])) demoteOneLevel(b); // BLOOD-red
        else demoteOneLevel(a);                                            // torch-FLAMES
      }
    }
  }
}

/**
 * THE CLASH FILTER — an absolute surface well-formedness constraint.
 *
 * On the STRESSED tier {n, m, s} no two *contiguous* syllables may carry the SAME
 * level: that is a stress clash (two equal prominences with no gradation between
 * them), which English categorically disallows.  Gradient pairs (sm/ms/sn/ns/mn/nm)
 * are fine — there is still a step down — as are runs of the unstressed tiers
 * {w, x} (an unstressed sequence is tolerated, if not ideal).  This generalises
 * McAleese's Appendix-A step 3d-ii ("stress clashes (ss, ms) > s-s") and Liberman
 * & Prince's (1977) grid alternation to every level of the strong tier.
 *
 * Resolution is DEMOTE-ONLY (never promote — promotion is the meter layer's job,
 * McAleese Test 2), so the contour is never inflated to break a clash; we iterate
 * to a fixed point (each change strictly lowers total stress mass, so it
 * terminates).  Which member yields is decided by `demoteRightOfClash` (grid-based
 * relative prominence).  Runs on the LINEAR surface order because a clash is a
 * property of contiguous *pronounced* syllables (Hayes), which a mis-grouped
 * dependency parse can scatter across phrases.
 */
export function resolveLinearClashes(words: ClsWord[]): void {
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of words) for (const s of w.syllables) flat.push({ word: w, syl: s });

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 24) {
    changed = false;
    for (let i = 0; i < flat.length - 1; i++) {
      const a = flat[i];
      const b = flat[i + 1];
      const lvl = a.syl.relativeStress;
      if (lvl !== b.syl.relativeStress) continue;
      if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue; // only the stressed tier clashes
      // Intra-word clashes are NOT skipped: a hyphenated-compound seam
      // (deep·voiced, snow·storm, gate·bolts) or any word with two adjacent equal
      // stresses is still a clash, and must be made gradient like any other.

      if (demoteRightOfClash(flat, i)) demoteOneLevel(b.syl);
      else demoteOneLevel(a.syl);
      changed = true;
    }
  }
}

/**
 * Decide which member of an equal-stress clash at (i, i+1) yields.  Rather than a
 * blunt leftward retraction, a layered cascade consults — in descending
 * authority — lexical, syntactic, and phonological context, so the demotion is
 * theory-grounded and the arbitrary default fires only as a last resort.  Returns
 * true to demote the RIGHT member (i+1), false to demote the LEFT (i).
 *
 *   1. Lexical integrity (Kiparsky): never demote a polysyllable's own stress
 *      peak for an adjacent monosyllable — the monosyllable yields.
 *   2. Inherent lexical prominence: a primary-stressed syllable outranks a
 *      secondary one — the lower-lexical-stress member yields.
 *   3. Syntactic headedness (Nuclear Stress Rule; Liberman & Prince 1977; Cinque
 *      1993): when the two words stand in a direct head–dependent relation, the
 *      DEPENDENT yields to its governor (the phrasal head is the more prominent).
 *   4. Content/function asymmetry — a coarse proxy for headedness when no direct
 *      dependency links the pair: the function word yields.
 *   5. Phonological weight: a light (open, short-vowel) syllable reduces more
 *      readily than a heavy (closed / long-vowel) one — the lighter member yields.
 *   6. Rhythm Rule (Liberman & Prince 1977; Hayes 1984): the clash member abutting
 *      the stronger OUTER beat is that beat's off-beat, so it retracts — "wet
 *      CHURCH" retracts wet (church is nuclear), "LATE last NIGHT" retracts last
 *      onto late (night is the following beat).
 *   7. Default (Hayes): retract the LEFT stress.
 */
function demoteRightOfClash(
  flat: { word: ClsWord; syl: Syllable }[],
  i: number
): boolean {
  const a = flat[i];
  const b = flat[i + 1];

  // (1) lexical integrity
  const aPeak = a.word.syllables.length > 1 && a.syl === wordPeak(a.word);
  const bPeak = b.word.syllables.length > 1 && b.syl === wordPeak(b.word);
  if (aPeak && !bPeak && b.word.syllables.length === 1) return true;
  if (bPeak && !aPeak && a.word.syllables.length === 1) return false;

  // (2) inherent lexical prominence
  const la = a.syl.lexicalStress ?? a.syl.stress ?? 0;
  const lb = b.syl.lexicalStress ?? b.syl.stress ?? 0;
  if (la !== lb) return la > lb;

  // (3) syntactic headedness — the dependent yields to its governor
  if (a.word !== b.word) {
    const gov = getGovernor(a.word, b.word);
    if (gov === a.word) return true;   // a heads b → demote b
    if (gov === b.word) return false;  // b heads a → demote a
  }

  // (4) content/function asymmetry — the function word yields
  if (a.word.isContent !== b.word.isContent) return a.word.isContent;

  // (5) phonological weight — the lighter syllable yields
  if (a.syl.weight && b.syl.weight && a.syl.weight !== b.syl.weight) {
    return a.syl.weight === 'H'; // a heavy → demote the lighter b
  }

  // (6) Rhythm Rule — yield to the stronger adjacent (outer) beat
  const outerA = i - 1 >= 0 ? STRESS_RANK[flat[i - 1].syl.relativeStress ?? 'w'] : -1;
  const outerB = i + 2 < flat.length ? STRESS_RANK[flat[i + 2].syl.relativeStress ?? 'w'] : -1;
  if (outerA !== outerB) return outerB > outerA;

  // (7) default: retract the left
  return false;
}

/**
 * Scan across the linear sequence of syllables and adjust any adjacent
 * identical relative stress levels using syntactic governance.
 */
function resolveAdjacentClashes(words: ClsWord[], protect?: Set<Syllable>): void {
  // "Endings strict": when a phrase ends in a run of two or more bare function
  // words (e.g. "…fast as you MIGHT"), the metrical beat gravitates to one of
  // them; the others are upbeat.  Demote the others so a leftward governance
  // clash can't promote a medial off-beat ("you") over the phrase-final beat.
  // Phrases ending in a content word are untouched.
  {
    let runStart = words.length;
    while (runStart > 0 && !words[runStart - 1].isContent) runStart--;
    if (words.length - runStart >= 2) {
      // The beat is normally the run's last word, UNLESS that is a clause-final
      // oblique pronoun (me/him/them…), which is canonically unstressed — then
      // the beat falls on the preceding member ("and beHIND me", not "behind ME").
      let beatIdx = words.length - 1;
      if (OBLIQUE_PRONOUNS.has(words[beatIdx].word.toLowerCase()) && beatIdx > runStart) {
        beatIdx--;
      }
      for (let wi = runStart; wi < words.length; wi++) {
        if (wi === beatIdx) continue;
        const w = words[wi];
        const peak = wordPeak(w);
        for (const s of w.syllables) {
          // Protect a polysyllabic word's own lexical peak: never flatten a real
          // internal stress (be·HIND) to 'w' just because the word is functional.
          if (w.syllables.length > 1 && s === peak && (s.lexicalStress ?? s.stress) >= 1) continue;
          // Protect a dependency-mined prominence (stranded preposition etc.).
          if (protect && protect.has(s)) continue;
          s.relativeStress = 'w';
        }
      }
    }
  }

  // Flatten all syllables with reference to their owning word.
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of words) {
    for (const s of w.syllables) {
      flat.push({ word: w, syl: s });
    }
  }

  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    if (a.syl.relativeStress !== b.syl.relativeStress) continue;
    // Only the stressed tier {n,m,s} clashes; {w,x} may repeat (maintainer's rule:
    // an unstressed run is tolerated, never "resolved" by demoting a clitic to 'x').
    const lvl = a.syl.relativeStress;
    if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue;

    // Within-word strictness (Kiparsky): a polysyllabic word's own stress peak
    // must not be demoted below its word-mates by a clash with an adjacent
    // monosyllable.  Protect the peak; demote the monosyllable instead.
    const aPeak = a.word.syllables.length > 1 && a.syl === wordPeak(a.word);
    const bPeak = b.word.syllables.length > 1 && b.syl === wordPeak(b.word);
    if (aPeak && b.word.syllables.length === 1) {
      adjustAdjacent(a.syl, b.syl, governorDependentDirection);
      continue;
    }
    if (bPeak && a.word.syllables.length === 1) {
      adjustAdjacent(b.syl, a.syl, governorDependentDirection);
      continue;
    }

    // Otherwise use the syntactic governor relationship.
    const governor = getGovernor(a.word, b.word);
    if (governor === a.word) {
      // a governs b → a stronger, b weaker
      adjustAdjacent(a.syl, b.syl, governorDependentDirection);
    } else if (governor === b.word) {
      // b governs a → b stronger, a weaker
      adjustAdjacent(b.syl, a.syl, governorDependentDirection);
    }
    // If no relationship, leave untouched.
  }
}

/** The syllable bearing a word's lexical stress peak (used for within-word protection). */
function wordPeak(word: ClsWord): Syllable | undefined {
  let best: Syllable | undefined;
  let bestVal = -Infinity;
  for (const s of word.syllables) {
    const v = s.lexicalStress ?? s.stress;
    if (v > bestVal) { bestVal = v; best = s; }
  }
  return best;
}

/** Return the governor word if one directly governs the other, else null. */
function getGovernor(w1: ClsWord, w2: ClsWord): ClsWord | null {
  const dep1 = w1.dependency;
  const dep2 = w2.dependency;
  if (!dep1 || !dep2) return null;

  // Check if w2 is a dependent of w1.
  if (dep2.governor === w1) return w1;
  // Check if w1 is a dependent of w2.
  if (dep1.governor === w2) return w2;
  return null;
}

/** Adjustment direction: governor stronger (promote), dependent weaker (demote). */
function governorDependentDirection(gov: Syllable, dep: Syllable): void {
  const govStress = gov.relativeStress!;
  const depStress = dep.relativeStress!;

  // Promote governor (if possible)
  if (govStress === 'n') gov.relativeStress = 'm';
  else if (govStress === 'm') gov.relativeStress = 's';
  // 'w' or 's' stay the same (can't promote 's', can't easily promote 'w' to 'n' without risking equal)

  // Demote dependent (if possible)
  if (depStress === 's') dep.relativeStress = 'm';
  else if (depStress === 'm') dep.relativeStress = 'n';
  else if (depStress === 'n') dep.relativeStress = 'w';
  else if (depStress === 'w') dep.relativeStress = 'x';
}

/** Simple adjustment for two adjacent syllables. */
function adjustAdjacent(
  stronger: Syllable,
  weaker: Syllable,
  direction: (s: Syllable, w: Syllable) => void
): void {
  direction(stronger, weaker);
}

/** Demote a syllable's relative stress by one level: s→m, m→n, n→w, w→x, x stays x. */
function demoteOneLevel(syl: Syllable): void {
  const cur = syl.relativeStress;
  if (cur === 's') syl.relativeStress = 'm';
  else if (cur === 'm') syl.relativeStress = 'n';
  else if (cur === 'n') syl.relativeStress = 'w';
  else if (cur === 'w') syl.relativeStress = 'x';
}

/**
 * Resolve stress clashes across prosodic boundaries (PP and IU).
 * When adjacent syllables at a boundary have equal stress:
 *   - If one word is function and the other content, demote the function word
 *     (per "beginnings free": the start of a new unit can be weakened)
 *   - If both are same type, use dependency relationship
 *   - If no relationship exists, leave untouched
 */
function resolveCrossBoundaryClashes(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Build flat array with prosodic position tracking
  const flat: { word: ClsWord; syl: Syllable; ppKey: string }[] = [];
  for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
    const iu = ius[iuIdx];
    for (let ppIdx = 0; ppIdx < iu.phonologicalPhrases.length; ppIdx++) {
      const pp = iu.phonologicalPhrases[ppIdx];
      const ppWords = collectPPTokens(pp);
      for (const w of ppWords) {
        for (const s of w.syllables) {
          flat.push({ word: w, syl: s, ppKey: `${iuIdx}:${ppIdx}` });
        }
      }
    }
  }

  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    if (a.syl.relativeStress !== b.syl.relativeStress) continue;
    // Only the stressed tier {n,m,s} clashes; {w,x} may repeat (maintainer's rule).
    const lvl = a.syl.relativeStress;
    if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue;

    // Only adjust if they span a prosodic boundary
    if (a.ppKey === b.ppKey) continue;

    const aContent = a.word.isContent;
    const bContent = b.word.isContent;

    if (aContent && !bContent) {
      demoteOneLevel(b.syl);
    } else if (!aContent && bContent) {
      demoteOneLevel(a.syl);
    } else {
      // Both same content/function type — try dependency relationship.
      // (A blanket Selkirk "demote the PP-initial" was tried and regressed
      // litlab/prosodic: the linear-clash cascade's nuanced resolution — weight,
      // Rhythm Rule, governance — captures "beginnings loose" better than a flat
      // directional rule, so a clash with no governance is left for it.)
      const governor = getGovernor(a.word, b.word);
      if (governor === a.word) {
        adjustAdjacent(a.syl, b.syl, governorDependentDirection);
      } else if (governor === b.word) {
        adjustAdjacent(b.syl, a.syl, governorDependentDirection);
      }
    }
  }
}

/** Check whether a POS tag belongs to a content word category. */
function isContentWord(tag: string, word?: string): boolean {
  if (CONTENT_POS.has(tag)) {
    if (word) {
      const lower = word.toLowerCase();
      if (FUNCTION_ADVERBS.has(lower)) return false;
      if (FUNCTION_VERBS.has(lower)) return false;
    }
    return true;
  }
  return false;
}
```

## tagfix.ts

```typescript
// tagfix.ts — Pre-parse POS-tag correction layer.
//
// FinNLP's en-pos tagger is structurally sound but carries a small tail of
// SYSTEMATIC tag errors that matter enormously for verse analysis, because a
// wrong tag flips a word's content/function status (→ its stress tier) and
// derails the en-parse dependency tree built from the tags.  This pass runs
// BETWEEN en-pos and en-parse (see parseDocument in parser.ts), so corrected
// tags repair both the tagging AND the resulting dependency structure — a
// post-hoc fix of the parse could never do that.
//
// Every rule below targets an error class actually observed in this repo's
// trials; rules are deliberately narrow (anti-gaming: each must be justified
// by the error it fixes, not by benchmark deltas).

/** Zero-derived irregular past participles that en-pos tags NN/VBP after a
 *  have-auxiliary ("had quit", "has put", "have read").  Only forms whose
 *  participle is identical to the base/noun spelling — the -en/-ed forms tag
 *  fine on their own. */
const ZERO_PARTICIPLES = new Set([
  'quit', 'put', 'set', 'cut', 'hit', 'let', 'shut', 'cast', 'cost', 'hurt',
  'burst', 'split', 'spread', 'bet', 'wed', 'read', 'rid', 'shed', 'thrust',
  'slit', 'bid', 'broadcast', 'upset', 'sunburst',
]);

const HAVE_FORMS = new Set(['have', 'has', 'had', 'having', "'ve", "'d"]);

/** Archaic / Early-Modern-English forms en-pos has no lexicon entries for —
 *  ubiquitous in the verse this toolkit exists to scan. */
const ARCHAIC_TAGS: Record<string, string> = {
  thou: 'PRP', thee: 'PRP', ye: 'PRP',
  thy: 'PRP$', thine: 'PRP$',
  art: 'VBP', wert: 'VBD', wast: 'VBD',
  doth: 'VBZ', hath: 'VBZ', dost: 'VBZ', hast: 'VBZ', saith: 'VBZ',
  didst: 'VBD', hadst: 'VBD', wouldst: 'MD', couldst: 'MD', shouldst: 'MD',
  shalt: 'MD', wilt: 'MD', canst: 'MD', mayst: 'MD', 'mightst': 'MD',
  wherefore: 'WRB', whither: 'WRB', whence: 'WRB',
  hither: 'RB', thither: 'RB', yon: 'JJ', yonder: 'RB',
  ere: 'IN', oft: 'RB', anon: 'RB',
};

/**
 * Correct a sentence's tags in place-safe fashion (returns a new array).
 * `tokens` and `tags` are the en-pos outputs, index-aligned.
 */
export function correctTags(tokens: string[], tags: string[]): string[] {
  const out = tags.slice();
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase();

    // 1. The pronoun "I".  en-norm lowercases sentence-initial "I" → "i",
    //    which en-pos then reads as a foreign word / letter name (FW).
    if (w === 'i' && out[i] === 'FW') out[i] = 'PRP';

    // 2. Archaic forms (thou/thy/doth/shalt/wherefore…): en-pos guesses
    //    NN/JJ/FW for these, wrecking both stress class and the parse.
    //    Guard "art": only when a pronoun precedes ("thou art"), since the
    //    noun reading ("the art of…") is the modern default.
    const archaic = ARCHAIC_TAGS[w];
    if (archaic && !/^(NNP|NNPS)$/.test(out[i])) {
      if (w === 'art') {
        const prev = i > 0 ? tokens[i - 1].toLowerCase() : '';
        if (prev === 'thou' || prev === 'ye' || prev === 'you') out[i] = 'VBP';
      } else {
        out[i] = archaic;
      }
    }

    // 3. Perfect-tense zero participles: have-form + ("quit"/"put"/"read"…)
    //    tagged as NN/VBP/VBD → VBN, so en-parse builds the verb chain
    //    instead of treating the participle as a direct-object noun
    //    ("I had quit the programming paradigm").  An intervening adverb
    //    ("had just quit") is allowed.
    if (ZERO_PARTICIPLES.has(w) && /^(NN|NNS|VBP|VBD|VB)$/.test(out[i])) {
      const prev1 = i > 0 ? tokens[i - 1].toLowerCase() : '';
      const prev2 = i > 1 ? tokens[i - 2].toLowerCase() : '';
      const prev1IsAdv = i > 0 && /^RB/.test(out[i - 1]);
      if (HAVE_FORMS.has(prev1) || (prev1IsAdv && HAVE_FORMS.has(prev2))) {
        out[i] = 'VBN';
      }
    }

    // 4. Impossible gerunds: a VBG tag on a token that does not end in
    //    -ing/-in' cannot be a gerund/present participle — it is an en-pos
    //    lexicon glitch.  The right tag depends on context: before a noun it
    //    is a noun modifier ("wisdom"/VBG teeth → NN); after a subject
    //    pronoun it is a finite verb ("as they bicycle/VBG through" → VBP,
    //    which keeps "through" a phrasal particle in the parse).  With no
    //    deciding context, leave the tag alone (en-parse treats VBG
    //    verb-ishly, the safer default).
    if (out[i] === 'VBG' && !/in[g'’]?$/.test(w)) {
      const prevTag = i > 0 ? out[i - 1] : '';
      const nextTag = i + 1 < tokens.length ? out[i + 1] : '';
      if (/^NNS?$/.test(nextTag)) out[i] = 'NN';
      else if (prevTag === 'PRP') out[i] = 'VBP';
    }

    // 5. Vocative "O" ("O wild West Wind"): en-pos gives NNP/JJ; it is an
    //    interjection (and must not become a content word with a beat by
    //    default).  Only the bare capital O — "o'er" etc. are handled by the
    //    aphaeresis lexicon in stress.ts.
    if (tokens[i] === 'O' && i + 1 < tokens.length && out[i] !== 'UH') out[i] = 'UH';
  }
  return out;
}

```

## types.ts

```typescript
// types.ts — Complete type declarations for Calliope_TS pipeline
// Reflects McAleese’s class diagrams (Figure 14) and additional phonological /
// metrical types required by stress, phonological hierarchy, scansion, and Scandroid modules.

/**
 * Stress levels in McAleese’s relative system, in ascending order
 * `x < w < n < m < s`.  `x` is the "Zero Provision" tier (Hayes; Lerdahl &
 * Jackendoff 1983): a level *weaker than a stressless overt syllable*, borne by
 * maximally-reduced clitics (the/a/of/and…) and unfilled positions.
 */
export type StressLevel = 'x' | 'w' | 'n' | 'm' | 's';

/** A single syllable within a word, with phonetic and stress information */
export interface Syllable {
  text: string;                       // the orthographic syllable (or entire word if unsplit)
  phones: string;                     // CMU phonetic transcription (per-syllable ARPAbet)
  weight?: 'H' | 'L';                 // syllable weight (Heavy/Light)
  stress: number;                     // numeric stress from CMU; modified by compound + nuclear rules
  lexicalStress?: number;             // stress before nuclear rule; used for relative mapping / meter detection
  relativeStress?: StressLevel;       // assigned after phrase‑stress rules and relative adjustment
  extrametrical?: 'morphological' | 'light_noun' | 'derivational';  // extrametricality classification
}

/** Represents a word in the dependency‑parse graph */
export interface ClsWord {
  index: number;                      // 1‑based index in the sentence (matching Antelope’s XML)
  lexicalClass: string;               // POS tag, e.g., 'VBD', 'NN', 'PRP'
  lexicalDetails: string;             // additional morphological info (empty if none)
  lexicalPlural: boolean;             // true if plural
  position: string;                   // textual position (not always used)
  word: string;                       // the surface form of the word (case-normalised for lookups:
                                      //   a sentence-initial capital is lowered unless proper noun)
  displayWord?: string;               // the ORIGINAL surface form when it differs from `word`
                                      //   (set by the parser's de-capitalisation) — what reports
                                      //   and the phonopoetics show to the reader
  absoluteIndex: number;              // 0‑based index among all words in the text
  isContent: boolean;
  // extended properties
  syllables: Syllable[];              // array of syllables for the word
  morphSuffix?: string;               // productive suffix split off for OOV stress (e.g. 'est'); guides display syllabification
  morphPrefix?: string;               // productive prefix split off for OOV stress (e.g. 'dis'); guides display syllabification
  phraseStress: number;               // numeric phrase‑level stress after Nuclear Stress Rule
  dependency?: ClsDependency;         // back‑reference to dependency edge (if any)
  node?: ClsNode;                     // back‑reference to the constituent node (if any)
  // ─── Calliope engine substrate (additive; ignored by the legacy/Clio path) ───
  canonicalRel?: string;              // normalised Scenario relation (NOMD/AMOD/VPRT/DOBJ/IOBJ/OBL/…)
  isPersonName?: boolean;             // token is in the `humannames` list (proper noun = person)
  isPlaceName?: boolean;              // token is in the `cities-list` list (proper name = place)
  // ─── Wagner/Krifka substrate (additive; 2026-06-29) ───
  featsMap?: Record<string, string>; // UD morphological FEATS parsed from lexicalDetails
                                      // (VerbForm/Voice/PronType/Number/Definite/Degree/Tense/…)
  discourseGiven?: boolean;          // a content word repeated from an earlier line of the same
                                      // stanza — set only by the optional stanza-givenness pass
                                      // (analyzeStanzas / analyzeReadingDocument), never single-line
  coordinateGiven?: boolean;         // a content word whose lemma is repeated as the HEAD of a
                                      // coordinate structure within the same line ("young blood and
                                      // high blood" → the second "blood" is anaphorically given;
                                      // contrastive focus falls on the modifier "high"). Set by the
                                      // relativiser's coordinate-givenness pre-pass.
}

/** A typed dependency edge between two words (as in Antelope’s XML) */
export interface ClsDependency {
  index: number;                      // 1‑based dependency index
  governorIndex: number;              // word index of the governor (head)
  dependentIndex: number;             // word index of the dependent
  dependentType: string;             // type label: 'aux','nsubj','dobj','prep','det','poss','possessive','pobj',…
  governorName: string;              // surface form of the governor
  dependentName: string;             // surface form of the dependent
  governor: ClsWord;                 // reference to the governor word object
  dependent: ClsWord;                // reference to the dependent word object
}

/** A constituent node in the parse tree (mirrors Figure 14) */
export interface ClsNode {
  index: string;                      // node identifier, e.g., '1', '1.2'
  nodeName: string;                   // label (e.g., 'SQ', 'NP', 'VP', 'PP', or a word index)
  parent: ClsNode | null;             // parent node, null for root
  contains: (ClsNode | ClsWord)[];   // children: either sub‑nodes or words
}

/** A single parsed sentence */
export interface ClsSentence {
  index: number;                      // sentence number (1‑based)
  nodes: ClsNode | null;             // root node of the parse tree
  dependencies: ClsDependency[];     // all dependency edges in this sentence
  words: ClsWord[];                  // word objects in order
  xml: string;                        // serialised XML representation (optional)
}

/** Top‑level document containing parsed sentences */
export interface ClsDocument {
  sentences: ClsSentence[];          // list of parsed sentences
  xml: string;                        // full XML document (optional)
}

// ─── Phonological Hierarchy (CP, PP, IU) ────────────────────────────

/** A clitic group: one content word plus its attached function words */
export interface CliticGroup {
  tokens: ClsWord[];
}

/** A phonological phrase: one or more clitic groups related syntactically */
export interface PhonologicalPhrase {
  cliticGroups: CliticGroup[];
}

/** An intonational unit: one or more phonological phrases bounded by punctuation/line‑end */
export interface IntonationalUnit {
  phonologicalPhrases: PhonologicalPhrase[];
}

// ─── Metre‑ and scansion‑related types ─────────────────────────────

/** Recognised metre names */
export type MetreName =
  | 'iambic'
  | 'trochaic'
  | 'spondaic'
  | 'pyrrhic'
  | 'anapestic'
  | 'dactylic'
  | 'amphibrachic'
  | 'bacchic';

/** Definition of a metre candidate: its foot shape and syllable count per foot */
export interface MetreCandidate {
  name: MetreName;
  foot: string;          // e.g., 'ws', 'sw', 'wws'
  syllableCount: number; // number of syllables in one foot (2 or 3)
}

/** A key‑stress pattern extracted from one unit of the phonological hierarchy */
export interface KeyStress {
  unitType: 'PW' | 'CP' | 'PP' | 'IU';  // type of prosodic unit
  pattern: string;                       // stress pattern, e.g., 'ws', 'sw', 'wsw'
  weight: number;                        // importance weight (1–3) as per McAleese’s scoring
  positions: number[];        // global syllable indices involved in this key stress

}

/** Result of scansion for a single line */
export interface ScansionResult {
  meter: MetreName | 'free verse';       // identified metre, or free verse if below threshold
  scansion: string;                      // the foot‑delimited scansion string, e.g., "ws|ws|ws|ws|ws"
  certainty: number;                     // percentage of maximum possible weighted score
  weightScore: number;                   // actual accumulated weight
  maxPossibleWeight: number;             // theoretical maximum weight for the line
  algorithm?: string;                    // optional, to distinguish Phonological vs Scandroid results
}

/** One candidate meter's overall fit score (internal composite, not a probability) */
export interface MeterScore {
  meter: MetreName | 'free verse';
  score: number;       // scoreMeters' finalScore — a relative fit score, higher = better
}

/** Detailed phonological scansion for a single line */
export interface PhonologicalScansionDetail {
  all: string;          // hierarchical string, e.g. "<{[nm/ws\n]}mn/sw\]m]}>"
  keyStresses: string;  // key‑stress string, e.g. "<{[xx/ws\n]}xx/sw\]m]}>"
  meter: string;        // e.g. "iambic pentameter"
  meterName: MetreName | 'free verse'; // enum value for tests
  footCount: number;    // e.g. 5
  summary: string;      // e.g. "IU=1 PP=1 PW=1" counts per metre direction
  scansion: string;     // foot‑separated, e.g. "xx/ws|nx/xs/wm"
  certainty: number;    // 0‑100
  weightScore: number;
  maxPossibleWeight: number;
  ranking?: MeterScore[]; // candidate meters ranked by fit score (best first); optional
  consensusMeter?: string; // set by applyStanzaConsensus when this line's standalone meter
                           // diverges from, yet closely fits, the stanza's dominant meter.
                           // The continuity-rename pass (index.ts) then normally CONVERTS
                           // this annotation: the line adopts the dominant meter as its BASE
                           // reading (meter/scansion/footCount/certainty re-fitted under it),
                           // consensusMeter is cleared, and standaloneMeter records the
                           // numerically-best standalone reading.  consensusMeter survives
                           // only when the forced re-fit fails.
  standaloneMeter?: string; // the line's numerically best standalone meter (e.g. "dactylic
                           // tetrameter"), kept when stanza/poem continuity renamed the base
                           // reading to the dominant meter.
  rhythmNote?: string;     // non-classical rhythm classification (Russian-metrics taxonomy):
                           // "4-ictus dolnik", "3-ictus taktovik", "4-beat accentual",
                           // "alternating 4·3-ictus accentual" — set at stanza level when
                           // beat counts are regular but syllable counts vary and no
                           // classical meter dominates; or per-line to refine a free-verse
                           // reading.  NOT a form verdict: "ballad" etc. belong to the
                           // rhyme-aware form layer (rhyme.ts).
  metricalityNote?: string; // advisory prose-likeness hedge (scansion.ts), set when
                           // a long, non-committal, weak-fit line reads as plausible
                           // prose: "No consistent metered rhythm(s) discerned. …".
                           // Display-only — never alters meter/scansion/certainty.
  rhyme?: {                // rhyme annotation (rhyme.ts), LYRICAL-compatible typology.
                           // Letters are assigned POEM-WIDE (a rhyme sound keeps its
                           // letter across stanza breaks), in reading order.
    endWord: string;
    letter: string;        // END-rhyme scheme letter 'A'/'B'/…, or '·' when unrhymed
    type?: string;         // perfect/rich/family/assonant/consonant/augmented/
                           // diminished/wrenched/eye/identical
    matchedLine?: number;  // 0-based poem line index this end-rhyme first binds to
    internal?: {           // pre-caesural INTERNAL rhymes on this line (strong-tier
                           // only), in left-to-right order; share the poem-wide
                           // letter space with the end rhymes.
      word: string;
      letter: string;
      type?: string;
    }[];
    notation?: string;     // assembled scheme cell: internal letters parenthesised
                           // then the end letter — e.g. "(A)B", "(C)C", "A", "·".
  };
  formNote?: string;       // stanza/poem FORM verdict (rhyme-aware): "ballad stanza
                           // (ABCB, 4·3)", "blank verse", "Shakespearean Sonnet",
                           // "terza rima (ABA BCB CDC…)", "limerick"…
}

/** Complete per‑line result from the pipeline */
export interface LineResult {
  sentence: ClsSentence;                 // parsed sentence with words, dependencies, nodes
  phonologicalHierarchy: IntonationalUnit[]; // CP/PP/IU structure
  keyStresses: KeyStress[];              // extracted key patterns with weights
  phonologicalScansion: PhonologicalScansionDetail;  // scansion via phonological scoring
  scandroidCorral?: ScansionResult;      // optional, scansion via Scandroid's 'Corral the Weird'
  scandroidMaximise?: ScansionResult;    // optional, scansion via Scandroid's 'Maximise the Normal'
}

// ─── Display formatting types ──────────────────────────────────────

/** Per-syllable information for display rendering */
export interface SyllableDisplayEntry {
  wordText: string;
  sylText: string;             // orthographic text of this syllable
  sylIndex: number;           // 0‑based index within the word
  sylCount: number;           // total syllables in the word
  relativeStress: StressLevel;
  globalIndex: number;
  wordIndex: number;          // 0‑based index among non-punctuation words
}

/** A single foot in the display, mapping scansion pattern to its syllables */
export interface FootDisplayEntry {
  footIndex: number;
  footPattern: string;        // raw foot pattern from scansion, e.g., 'ws', '-ms'
  syllables: SyllableDisplayEntry[];
}

/** All formatted display representations for a single line */
export interface FormattedDisplay {
  originalText: string;
  diacriticText: string;
  uppercaseText: string;
  ansiText: string;
  sylColoredText: string;
  footAligned: string;
  syllableBreakdown: string;
}

/** Options controlling display formatting */
export interface DisplayOptions {
  ansi: boolean;
  diacritics: boolean;
  footAligned: boolean;
  verbose: boolean;
  phrasal: boolean;
}
```
