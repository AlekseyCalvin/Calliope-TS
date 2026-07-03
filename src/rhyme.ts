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
