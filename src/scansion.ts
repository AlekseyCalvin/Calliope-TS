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
