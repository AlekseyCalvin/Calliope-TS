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
  | 'grammatical' | 'mosaic'
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

// Memoised: the scheme search is poem-wide (every line against every earlier
// line, plus mosaic tail attempts), so an 80-line poem re-asks for the same
// few hundred words thousands of times.
const phonesCache = new Map<string, string[] | null>();
function phonesOf(word: string): string[] | null {
  const clean = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!clean) return null;
  const hit = phonesCache.get(clean);
  if (hit !== undefined) return hit;
  let out: string[] | null = null;
  try {
    const ph = nounsing.firstPhonesForWord(clean);
    if (typeof ph === 'string' && ph.length > 0) out = ph.split(' ');
  } catch { /* OOV */ }
  // A hyphenated compound rhymes by its FINAL element ("altar-place" rhymes
  // as "place") — without this the whole token goes OOV and falls to the
  // orthographic eye-rhyme guess.
  if (!out && word.includes('-')) {
    const last = word.split('-').pop() ?? '';
    if (last && last !== word) out = phonesOf(last);
  }
  phonesCache.set(clean, out);
  return out;
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
    // The segments must ALSO be the same length overall — the coda test
    // filters vowels out, so without the length gate an extra tail syllable
    // vanishes and fun/funny reads "family" (it is grammatical, below).
    if (na.length === nb.length && codaA.length === codaB.length && codaA.length > 0
        && codaA.every((p, i) => p === codaB[i] || sameFamily(p, codaB[i]))) {
      return { type: 'family', structure };
    }
    // AUGMENTED / DIMINISHED (poemshape's Dickinson taxonomy): the rhyme is
    // "extended by a consonant" — ONE extra TERMINAL consonant on one side,
    // compared over the FULL rhyme segments, vowels included (bray/brave,
    // grow/sown, stained/rain; manner/manners feminine).  The previous
    // coda-only comparison filtered the tail's unstressed VOWELS away before
    // comparing, so a whole extension syllable could masquerade as a terminal
    // consonant (pun/running "augmented", floating/float "diminished") — the
    // same corruption the maintainer traced in Nounsing's search lineage.
    const extraTerminalConsonant = (shorter: string[], longer: string[]) =>
      longer.length === shorter.length + 1 &&
      shorter.every((p, i) => p === longer[i]) &&
      !isVowelPhone(longer[longer.length - 1]);
    if (extraTerminalConsonant(na, nb)) return { type: 'augmented', structure };
    if (extraTerminalConsonant(nb, na)) return { type: 'diminished', structure };
    // GRAMMATICAL rhyme: matching stressed vowel at the roots, distinct
    // INFLECTIONAL tails (pun/running, fun/funny, float/floating).  One full
    // segment is a proper prefix of the other, the excess is SYLLABIC
    // (contains a vowel — a bare terminal consonant was aug/dim above), and
    // the longer word's spelling ends in a closed inflectional suffix.
    const shorterFirst = na.length <= nb.length;
    const segS = shorterFirst ? na : nb;
    const segL = shorterFirst ? nb : na;
    const wordL = shorterFirst ? wb : wa;
    if (segL.length > segS.length && segS.every((p, i) => p === segL[i])) {
      const excess = segL.slice(segS.length);
      // The matched spelling tail must plausibly ACCOUNT for the phone excess
      // (|excess| ≤ |tail|+1): "running"'s [IH NG] is "ing", "funny"'s [IY] is
      // "y" — but "lifeless"'s [F L AH S] is not the inflection "-s", it is
      // most of another word, and sky/lifeless is no grammatical rhyme.
      const tail = GRAMMATICAL_TAILS.find(t => wordL.endsWith(t));
      if (excess.some(p => isVowelPhone(p)) && tail && excess.length <= tail.length + 1) {
        return { type: 'grammatical', structure };
      }
    }
    return { type: 'assonant', structure };
  }
  if (codaEq && codaA.length > 0) return { type: 'consonant', structure };
  const t = orthographicTier(a, b, pa, pb);
  return t ? { type: t } : null;
}

/** Closed inflectional/light-derivational tails for the GRAMMATICAL rhyme
 *  test (spelling-level; the phone-level prefix condition does the real work). */
const GRAMMATICAL_TAILS = [
  'ings', 'ing', "in'", 'ied', 'ies', 'ed', 'es', 'ers', 'er', 'est', 'eth',
  'ly', 'y', 's', "'d", "'st",
];

/** A BEAT-BEARING end-rhyme between two line-end words — the bar the stanza
 *  rhyme-fellow pass (index.ts markRhymeFellows) requires before a weak
 *  line-final monosyllable may inherit a beat from its rhyme partner.  Beyond
 *  the STRONG tier (perfect/rich/family) it admits AUGMENTED and DIMINISHED
 *  pairs: their stressed vowel is identical and they differ by ONE terminal
 *  consonant, so the correspondence is still carried audibly by the final
 *  beat ("me"/"dream", "sea"/"seed").  Identical repetition is excluded
 *  (epistrophe, not a prominence template), as are the looser slant tiers
 *  (assonant/consonant/grammatical/wrenched/eye) — a hunch is not a beat. */
export function isBeatTransferRhyme(a: string, b: string): boolean {
  const r = classifyRhymePair(a, b);
  if (!r || r.type === 'identical') return false;
  return STRONG.has(r.type) || r.type === 'augmented' || r.type === 'diminished';
}

/**
 * MOSAIC (multi-word) end-rhyme — Byron's "intellectual / hen-pecked you all";
 * the maintainer's "TENderly / SLENder — SEE?".  One line's POLYSYLLABIC rhyme
 * part (its final word's last stressed vowel + everything after, ≥2 syllables)
 * is covered by a SEQUENCE of words at the other line's end, the rhyme domain
 * re-segmented across the word boundary.  Detection is nucleus-aligned:
 *   • the covering span opens on a STRESSED vowel exactly n syllables from the
 *     line end (n = the anchor's rhyme-part syllable count) and must CROSS a
 *     word boundary (a one-word cover is ordinary rhyme, handled elsewhere);
 *   • every nucleus must match its opposite number;
 *   • the consonant runs between nuclei must match, except AT MOST ONE run may
 *     differ (by substitution or one phone of length) — the re-segmentation
 *     fudge that makes tender-LY ~ slender-SEE (L→S) and ~ slender-BE (L→B)
 *     ring true, while "tenderly / slender seed" (two differing runs) fails.
 * This is inherently beyond a one-word-at-a-time rhyme dictionary (Nounsing);
 * only the line-holding layer can see it.
 */
export function classifyMosaicPair(tailA: string[], tailB: string[]): RhymePair | null {
  return mosaicDirected(tailA, tailB) ?? mosaicDirected(tailB, tailA);
}

function mosaicDirected(anchorTail: string[], coverTail: string[]): RhymePair | null {
  if (anchorTail.length === 0 || coverTail.length < 2) return null;
  const anchorWord = anchorTail[anchorTail.length - 1];
  const pa = phonesOf(anchorWord);
  if (!pa) return null;
  const ia = lastStressedIdx(pa);
  if (ia < 0) return null;
  const ra = pa.slice(ia);
  const nA = ra.filter(p => isVowelPhone(p)).length;
  if (nA < 2) return null;                              // needs a feminine/dactylic anchor
  const perWord: string[][] = [];
  for (const w of coverTail) {
    const p = phonesOf(w);
    if (!p) return null;
    perWord.push(p);
  }
  const combined = perWord.flat();
  const lastWordStart = combined.length - perWord[perWord.length - 1].length;
  // The covering span opens at the vowel sitting nA nuclei from the line end.
  let seen = 0;
  let p0 = -1;
  for (let i = combined.length - 1; i >= 0; i--) {
    if (isVowelPhone(combined[i])) {
      seen++;
      if (seen === nA) { p0 = i; break; }
    }
  }
  if (p0 < 0) return null;
  if (!/[12]$/.test(combined[p0])) return null;         // span opens on a stressed vowel
  if (p0 >= lastWordStart) return null;                 // must cross a word boundary
  const rb = combined.slice(p0);
  // Nucleus-by-nucleus alignment with the one-run fudge.
  const decompose = (seg: string[]) => {
    const nuclei: string[] = [];
    const runs: string[][] = [];
    let cur: string[] = [];
    for (const p of seg) {
      if (isVowelPhone(p)) {
        if (nuclei.length) runs.push(cur);
        cur = [];
        nuclei.push(base(p));
      } else {
        cur.push(base(p));
      }
    }
    runs.push(cur);                                     // final coda
    return { nuclei, runs };
  };
  const A = decompose(ra);
  const B = decompose(rb);
  if (A.nuclei.length !== B.nuclei.length) return null;
  if (A.nuclei.some((v, i) => v !== B.nuclei[i])) return null;
  let fudged = 0;
  for (let i = 0; i < A.runs.length; i++) {
    const x = A.runs[i];
    const y = B.runs[i];
    if (x.length === y.length && x.every((p, k) => p === y[k])) continue;
    if (Math.abs(x.length - y.length) <= 1) { fudged++; continue; }
    return null;
  }
  if (fudged > 1) return null;
  return { type: 'mosaic', structure: nA === 2 ? 'feminine' : 'dactylic' };
}

// Strength tiers for scheme detection.
const STRONG: Set<RhymeTypeName> = new Set(['identical', 'rich', 'perfect', 'family']);
const SLANT: Set<RhymeTypeName> = new Set(['assonant', 'consonant', 'augmented', 'diminished', 'grammatical', 'mosaic', 'wrenched', 'eye']);
// Full rhyme only — the stricter bar a pre-caesural INTERNAL rhyme must clear.
const STRICT_INTERNAL: Set<RhymeTypeName> = new Set(['identical', 'rich', 'perfect']);

export interface LineRhyme {
  endWord: string;
  letter: string;          // scheme letter ('A', 'B', …; '·' = unrhymed)
  type?: RhymeTypeName;    // relation to the matched earlier line
  matchedLine?: number;    // 0-based index within the stanza
}

/** Scheme letters: A…Z then a…z; past 52 recurring groups the overflow reads
 *  unrhymed rather than COLLIDING — a modulo-26 counter used to fold unrelated
 *  groups onto one letter in long poems, chaining "dead → food" under a shared
 *  letter and printing types that belonged to other pairs entirely. */
const schemeLetter = (k: number): string =>
  k < 26 ? String.fromCharCode(65 + k) : k < 52 ? String.fromCharCode(97 + (k - 26)) : '·';

// Binding strength: the BEST-SOUNDING partner wins, however far back it sits —
// Byron's Darkness rhymes "space … face" at 12 lines, "day … bay" at 43, and
// the whole poem-wide net of homophony is the point.  Proximity breaks ties
// WITHIN a tier only, so a neighbouring weak echo can no longer steal a line
// from its true partner ("hearts … apart" binds augmented across 32 lines
// instead of chaining through an accidental assonance next door).
const TIER_RANK: Record<RhymeTypeName, number> = {
  identical: 4, rich: 4, perfect: 4, family: 4,
  augmented: 3, diminished: 3, grammatical: 3, mosaic: 3,
  assonant: 2, consonant: 2,
  wrenched: 1, eye: 1,
};

/** Detect a stanza's rhyme scheme from its line-end words.  Every earlier line
 *  is a candidate (no distance cutoff — long-range echoes are real rhymes);
 *  the highest TIER_RANK wins, nearest first within a tier.  When `endTails`
 *  (each line's last few words) is supplied, a MOSAIC multi-word rhyme is
 *  tried wherever the single-word pair yields nothing strong — the mosaic
 *  verdict outranks a looser single-word slant reading ("tenderly / slender —
 *  see?" is mosaic, not a wrenched hunch on tenderly/see).  Letters are
 *  computed from the CONNECTED COMPONENTS of the match links, so a letter is
 *  shared exactly by lines that actually bind to one another. */
export function detectScheme(endWords: string[], endTails?: string[][]): LineRhyme[] {
  const n = endWords.length;
  const matched: (number | undefined)[] = new Array(n).fill(undefined);
  const types: (RhymeTypeName | undefined)[] = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    let best: { j: number; pair: RhymePair } | null = null;
    let bestRank = 0;
    for (let j = i - 1; j >= 0; j--) {
      let pair = classifyRhymePair(endWords[j], endWords[i]);
      if ((!pair || !STRONG.has(pair.type)) && endTails?.[j]?.length && endTails?.[i]?.length) {
        const m = classifyMosaicPair(endTails[j], endTails[i]);
        if (m && (!pair || TIER_RANK[m.type] > TIER_RANK[pair.type])) pair = m;
      }
      if (!pair) continue;
      const rank = TIER_RANK[pair.type];
      if (rank > bestRank) {
        best = { j, pair };
        bestRank = rank;
        if (rank >= 4) break;                       // nearest full rhyme — no better exists
      }
    }
    if (best) { matched[i] = best.j; types[i] = best.pair.type; }
  }
  // Rebind pass: a STRONG rhyme claims its partner back from an earlier
  // slant-tier binding.  (Sonnet 130: "rare" first slant-binds to the red/head
  // group, then "compare" arrives as its perfect partner — the couplet wins.)
  // Detaching the partner from its old group is enough: the component walk
  // below re-letters everything consistently, so no line is left stranded on
  // a stale letter (the old in-place re-lettering orphaned third parties).
  for (let i = 0; i < n; i++) {
    const j = matched[i];
    if (j === undefined || !types[i] || !STRONG.has(types[i]!)) continue;
    if (matched[j] !== undefined && types[j] && SLANT.has(types[j]!)) {
      matched[j] = undefined;
      types[j] = undefined;
    }
  }
  // Letters from connected components (matched[i] < i, so root-following
  // terminates); singleton components are unrhymed '·'.
  const root = (i: number): number => (matched[i] === undefined ? i : root(matched[i]!));
  const memberCount = new Map<number, number>();
  for (let i = 0; i < n; i++) { const r = root(i); memberCount.set(r, (memberCount.get(r) ?? 0) + 1); }
  const letterOf = new Map<number, string>();
  let k = 0;
  const out: LineRhyme[] = [];
  for (let i = 0; i < n; i++) {
    const r = root(i);
    let letter = '·';
    if ((memberCount.get(r) ?? 0) >= 2) {
      if (!letterOf.has(r)) letterOf.set(r, schemeLetter(k++));
      letter = letterOf.get(r)!;
    }
    out.push({ endWord: endWords[i], letter, type: types[i], matchedLine: matched[i] });
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
  const next = () => schemeLetter(k++);   // A…Z a…z, never a %26 collision
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

  // Unrhymed stanza: blank verse when iambic pentameter dominates.  Not a
  // strict every-line test: long unrhymed poems carry occasional genuine local
  // echoes ("multitude / food" a line apart in Byron's Darkness) without
  // ceasing to be blank verse.
  const unrhymed = rhymes.filter(r => r.letter === '·').length / Math.max(1, n) >= 0.8;
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

/** The line's last few syllable-bearing words — the material a MOSAIC
 *  multi-word rhyme may re-segment across (classifyMosaicPair). */
function lineEndTail(line: LineResult, maxWords = 4): string[] {
  return lineWords(line).slice(-maxWords).map(surfaceOf);
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
  // Bounded A…Z/a…z walk — the old modulo-26 do-while never terminated once
  // every capital was in use.
  const freshLetter = () => {
    let c = '·';
    while (code < 52) {
      c = code < 26 ? String.fromCharCode(65 + code) : String.fromCharCode(97 + (code - 26));
      code++;
      if (!used.has(c)) break;
    }
    used.add(c);
    return c;
  };
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
    const rhymes = detectScheme(lines.map(lineEndWord), lines.map(l => lineEndTail(l)));
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
  const es = detectScheme(endWords, PLs.map(pl => lineEndTail(pl.line)));
  // RAW letters ('·' = unrhymed) — the same letters the arrows and per-line
  // keys carry, so the scheme string and the pair list read as one system.
  const endScheme = schemeStr(es);
  // Fresh letters for caesural-only groups: skip every letter the end scheme
  // already uses (never a running modulo counter — that COLLIDED groups).
  const usedLetters = new Set(es.filter(r => r.letter !== '·').map(r => r.letter));
  let nextCode = 0;
  const freshLetter = (): string => {
    let c = '·';
    while (nextCode < 52) {
      c = nextCode < 26 ? String.fromCharCode(65 + nextCode) : String.fromCharCode(97 + (nextCode - 26));
      nextCode++;
      if (!usedLetters.has(c)) break;
    }
    usedLetters.add(c);
    return c;
  };

  // Each arrow is a line's ACTUAL match link (matchedLine), so the printed
  // type always describes the pair shown — never a letter-chain neighbour.
  const end: RhymeRel[] = [];
  es.forEach((r, i) => {
    if (r.matchedLine === undefined || r.letter === '·') return;
    const j = r.matchedLine;
    end.push({
      fromWord: endWords[j], fromLabel: PLs[j].label,
      toWord: endWords[i], toLabel: PLs[i].label,
      letter: r.letter, type: r.type, kind: 'end',
      topStress: topStressOf(endObj(PLs[i]), endObj(PLs[j])),
    });
  });

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
  const endRhymes = N >= 2 ? detectScheme(lines.map(lineEndWord), lines.map(l => lineEndTail(l))) : [];
  const hasEndRhyme = endRhymes.some(r => r.letter !== '·');
  const forms = [...new Set(details.map(d => d.formNote).filter((x): x is string => !!x))];
  let formVal: string | undefined = forms.length ? forms.join(' · ') : undefined;
  if (N >= 2) {
    // Registry matching wants the CANONICAL scheme (every line lettered);
    // the reader-facing row shows the RAW letters ('·' = unrhymed), the same
    // letters every rhyme arrow and per-line key carries.
    const reg = matchRegistryForm(N, canonicalScheme(endRhymes));
    if (reg && !(formVal && formVal.includes(reg))) {
      formVal = (formVal ? formVal + ' · ' : '') + `aligns with the ${reg} scheme`;
    }
  }
  if (formVal) rows.push({ label: 'Form', value: formVal });

  // ── End-Rhyme Scheme — poem-wide scheme, its own row (only end rhymes are
  // matched against forms; caesural/head live in Phonopoetics). ──
  if (hasEndRhyme) rows.push({ label: 'End-Rhyme Scheme', value: schemeStr(endRhymes) });

  // ── Heterometric advisory — the whole-poem observation that per-line beat
  // counts vary widely (kept OUT of the per-line display, as an advisory here). ──
  const beats = details.map(d => (d.footCount > 0 ? d.footCount : ictusProfile(d.scansion).ictuses));
  const lo = Math.min(...beats), hi = Math.max(...beats);
  if (N >= 3 && hi - lo >= 3) {
    rows.push({ label: 'Note', value: `line lengths vary — ${lo}–${hi} beats per line` });
  }

  return rows;
}
