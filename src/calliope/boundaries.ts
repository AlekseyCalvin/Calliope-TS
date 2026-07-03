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
