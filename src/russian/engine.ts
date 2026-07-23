// engine.ts — Russian poetry scansion engine.
// Faithful port of the Russian Poetry Scansion Tool's core algorithm:
//   1. Parse with UDPipe (Russian SynTagRus)
//   2. Build PoetryWord objects with accentuations from dictionary + neural MLP
//   3. Generate stress variants per word (stressed, unstressed, shifted)
//   4. Map each line's stress variants against meter signatures
//   5. Find the best (meter, stress-assignment) combination across all lines
//   6. Detect rhymes from the aligned clausulas
//   7. Compute technicality score from penalties

import { parseRussianText, isRuPunctuation } from './parser.js';
import { splitWord, countVowels } from './syllabifier.js';
import { getAccent, getAccents, yoficate, getAccentsData, loadJson } from './accentuator.js';
import { extractClausula, pronounce } from './rhyme.js';
// Bijective base-26 scheme-key sequence ('A'..'Z','AA','AB',…) shared with the
// English engine, used ONLY to re-letter the poem-global rhyme display below
// (detection stays per-stanza/per-block — see rhymeKey's doc in ../rhyme.ts).
import { rhymeKey } from '../rhyme.js';
import { buildFabbHalleGridsForPoem } from '../fabbhalle.js';
import { getCompoundSecondaryStress, applyVerbPrefixDerivation } from './compounds.js';
import { checkCollocation } from './collocations.js';
import { ensureRussianData } from './download.js';
import type {
  RuToken, RuWord, RuSyllable, RuLine, RuStanza, RuDep,
  RuScansionResult, RuMeterResult, RuRhymeEntry, RuTier,
} from './types.js';
import { CONTENT_UPOS, PUNCT_UPOS, RU_VOWELS, METER_NAMES_RU } from './types.js';

// ── Constants from the original ──────────────────────────────────────

const COEFF: Record<string, number> = {
  '@68': 0.95, '@68_2': 0.98, '@71': 1.0, '@75': 0.98,
  '@77': 1.0, '@77_2': 1.0, '@79': 1.0, '@126': 0.98,
  '@225': 0.95, '@143': 0.9,
};

const METERS: [string, number[]][] = [
  ['ямб',        [0, 1]],
  ['хорей',      [1, 0]],
  ['дактиль',    [1, 0, 0]],
  ['амфибрахий', [0, 1, 0]],
  ['анапест',    [0, 0, 1]],
];

const METER_CANONIC: Record<string, string> = {
  'ямб': 'iambic', 'хорей': 'trochaic', 'дактиль': 'dactylic',
  'амфибрахий': 'amphibrachic', 'анапест': 'anapestic',
  'dolnik': 'dolnik', 'free': 'free',
};

const EARLY_STOPPING = 0.7;
const MAX_WORDS_PER_LINE = 14;

// ── Lexical-stress helpers shared by the display-tier overlay and the
//    Fabb–Halle second opinion ────────────────────────────────────────

/** Monosyllables of these classes are clitics with no lexical stress. */
const CLITIC_UPOS = new Set(['ADP', 'PART', 'CCONJ', 'SCONJ', 'AUX', 'INTJ']);

/** Full-vowel function monosyllables: overt-weak, not clitic-reduced. */
const WEAK_FULL_UPOS = new Set(['PRON', 'DET']);

const uppercaseStressPos = (form: string): number => {
  let n = 0;
  for (const c of form) {
    if ('уеыаоэёяию'.includes(c.toLowerCase())) n++;
    if ('АЕЁИОУЫЭЮЯ'.includes(c)) return n;
  }
  return -1;
};

/** Dictionary stress with homograph licensing: for words the lexicon itself
 *  lists with MULTIPLE licensed stress readings (голубо́м/голу́бом, краю́/кра́ю),
 *  admit the alignment's choice among the LICENSED readings only — the classic
 *  philological use of meter as an accentological source (Gasparov).
 *  Unambiguous words keep their dictionary stress untouched. */
const effectiveLexStress = (w: RuWord, accData: ReturnType<typeof getAccentsData>): number => {
  const lower = w.form.toLowerCase();
  const licensed = new Set<number>();
  const amb = accData.ambiguousAccents[lower];
  if (amb) {
    for (const f of Object.keys(amb)) {
      const p = uppercaseStressPos(f);
      if (p > 0) licensed.add(p);
    }
  }
  for (const p of accData.ambiguousAccents2[lower] ?? []) licensed.add(p);
  if (licensed.size > 1 && w.stressPos > 0 && licensed.has(w.stressPos)) {
    return w.stressPos;
  }
  return w.lexStressPos;
};

/**
 * Display-tier overlay (x/w/n/m/s, the English pipeline's relative alphabet).
 * Mutates each vowel syllable's `tier` and returns the per-line tier string.
 * The key differential over the binary S/U pattern: a syllable that carries
 * DICTIONARY stress but fell off the metrical beat keeps a mild `n` tier
 * instead of collapsing into plain unstressed — polysyllables always
 * (Taranovsky: every polysyllable bears its lexical stress), monosyllables by
 * class (content words `n`; PRON/DET `w`; clitics `x`).  Purely
 * presentational: computed after all scoring, reading only fields the scorer
 * already produced (stressed/secondaryStressed/lexStressPos/upos) — the
 * technicality score is untouched by construction.
 */
function assignTiers(words: RuWord[], accData: ReturnType<typeof getAccentsData>): string {
  let pattern = '';
  for (const w of words) {
    const poly = w.syllables.filter(s => s.vowel).length > 1;
    const lexPos = effectiveLexStress(w, accData);
    let vi = 0;
    for (const syl of w.syllables) {
      if (!syl.vowel) continue;   // consonant-only chunks carry no tier
      vi++;
      let tier: RuTier;
      if (syl.stressed) {
        tier = 's';
      } else if (syl.secondaryStressed) {
        tier = 'm';
      } else if (!poly && CLITIC_UPOS.has(w.upos)) {
        tier = 'x';
      } else if (lexPos === vi && (poly || !WEAK_FULL_UPOS.has(w.upos))) {
        tier = 'n';
      } else {
        tier = 'w';
      }
      syl.tier = tier;
      pattern += tier;
    }
  }
  return pattern;
}

// ── Word-level types ─────────────────────────────────────────────────

interface WordAccentuation {
  stressPos: number;           // 1-based vowel position
  secondaryStress: number[] | null;
}

interface PoetryWord {
  lemma: string;
  form: string;
  upos: string;
  tags: string[];              // e.g. ['Case=Nom', 'Gender=Masc']
  feats: Record<string, string>;
  deprel: string;
  head: number;                // head token id within the sentence (0 = root)
  id: number;                  // token id within its sentence
  sent: number;                // sentence index within the line's parse
  accentuations: WordAccentuation[];
  stressPos: number;           // primary stress (first accentuation)
  isRhymingWord: boolean;
  nVowels: number;
  leadingConsonants: number;
  trailingConsonants: number;
}

interface WordStressVariant {
  poetryWord: PoetryWord;
  newStressPos: number;        // -1 = unstressed
  score: number;
  stressSignature: number[];   // per-vowel: 0=unstressed, 1=primary, 2=secondary
  stressedForm: string;
  isCyrillic: boolean;
}

// ── Word construction ────────────────────────────────────────────────

function buildPoetryWord(token: RuToken): PoetryWord {
  // Apply ёфикация first — this may change 'е' to 'ё' which affects dictionary lookup
  const form = yoficate(token.form, token.feats, token.upos);
  const lower = form.toLowerCase();
  const upos = token.upos;
  const tags = Object.entries(token.feats).map(([k, v]) => `${k}=${v}`);

  // Get accentuations
  const accentuations: WordAccentuation[] = [];

  const secondaryStress = getCompoundSecondaryStress(lower);

  // Check with getAccents (which now handles ё, single-vowel, dict, verb prefix, and multiple forms)
  const accents = getAccents(lower, token.feats, token.upos);
  for (const acc of accents) {
    if (acc.stressPos > 0 || acc.stressPos === -1) {
      accentuations.push({ stressPos: acc.stressPos, secondaryStress });
    }
  }

  // Count vowels and consonants
  let nVowels = 0, leadingConsonants = 0, trailingConsonants = 0;
  for (const c of form) {
    const cl = c.toLowerCase();
    if ('уеыаоэёяию'.includes(cl)) {
      trailingConsonants = 0;
      nVowels++;
    } else if ('бвгджзклмнпрстфхцчшщ'.includes(cl)) {
      if (nVowels === 0) leadingConsonants++;
      else trailingConsonants++;
    }
  }

  return {
    lemma: token.lemma,
    form,
    upos,
    tags,
    feats: token.feats,
    deprel: token.deprel,
    head: token.head,
    id: token.id,
    sent: token.sent,
    accentuations,
    stressPos: accentuations[0]?.stressPos ?? -1,
    isRhymingWord: false,
    nVowels,
    leadingConsonants,
    trailingConsonants,
  };
}

function locateStressPos(form: string): number {
  let nVowels = 0;
  for (const c of form) {
    if ('уеыаоэёяию'.includes(c.toLowerCase())) nVowels++;
    if ('АЕЁИОУЫЭЮЯ'.includes(c)) return nVowels;
  }
  return -1;
}

// ── Stress variant generation ────────────────────────────────────────

function makeSet(s: string): Record<string, true> {
  const out: Record<string, true> = {};
  for (const c of s) out[c] = true;
  return out;
}

const CYRILLIC_SET = makeSet('абвгдеёжзийклмнопрстфхцчшщъыьэюя');

function buildStressVariant(pw: PoetryWord, newStressPos: number, score: number): WordStressVariant {
  const secondaryStress = pw.accentuations[0]?.secondaryStress ?? null;
  const stressSignature: number[] = [];
  const output: string[] = [];
  let nVowels = 0;

  for (const c of pw.form) {
    output.push(c);
    if ('уеыаоэёяию'.includes(c.toLowerCase())) {
      nVowels++;
      if (nVowels === newStressPos) {
        output.push('\u0301');
        stressSignature.push(1);
      } else if (secondaryStress && secondaryStress[nVowels - 1] === 2) {
        output.push('\u0300');
        stressSignature.push(2);
      } else {
        stressSignature.push(0);
      }
    }
  }

  return {
    poetryWord: pw,
    newStressPos,
    score,
    stressSignature,
    stressedForm: output.join(''),
    isCyrillic: !!CYRILLIC_SET[pw.form[0]?.toLowerCase()],
  };
}

/** Get all stress variants for a word — the core of the alignment algorithm. */
function getStressVariants(pw: PoetryWord, allowStressShift: boolean, allowUnstress12: boolean): WordStressVariant[] {
  const variants: WordStressVariant[] = [];
  const nvowels = pw.nVowels;
  const uform = pw.form.toLowerCase();
  const data = getAccentsData();

  if (nvowels === 0) {
    // No vowels — always unstressed
    variants.push(buildStressVariant(pw, -1, 1.0));
    return variants;
  }

  // Function words: ADP, CCONJ, SCONJ, PART, INTJ, AUX
  if (pw.upos === 'ADP' || pw.upos === 'CCONJ' || pw.upos === 'SCONJ' || pw.upos === 'PART' || pw.upos === 'INTJ' || pw.upos === 'AUX') {
    if (uform === 'не') {
      variants.push(buildStressVariant(pw, -1, 1.0));
      if (pw.isRhymingWord) variants.push(buildStressVariant(pw, pw.stressPos, 0.95));
      else variants.push(buildStressVariant(pw, pw.stressPos, 0.20));
    } else if (['бы', 'ли', 'же', 'ни', 'ка'].includes(uform)) {
      variants.push(buildStressVariant(pw, -1, 1.0));
      if (pw.isRhymingWord) variants.push(buildStressVariant(pw, pw.stressPos, COEFF['@68']));
    } else if (['а', 'и', 'или', 'но'].includes(uform)) {
      variants.push(buildStressVariant(pw, -1, 1.0));
      if (pw.isRhymingWord) variants.push(buildStressVariant(pw, pw.stressPos, 0.70));
      else variants.push(buildStressVariant(pw, pw.stressPos, 0.20));
    } else if (['о', 'у', 'из', 'от', 'под', 'подо', 'за', 'при', 'до', 'про', 'для', 'ко', 'со', 'во', 'на', 'по', 'об', 'обо', 'без', 'над', 'пред'].includes(uform) && pw.upos === 'ADP') {
      // These prepositions are never stressed
      variants.push(buildStressVariant(pw, -1, 1.0));
      if (pw.isRhymingWord) variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
      else variants.push(buildStressVariant(pw, pw.stressPos, 0.5));
    } else if (['нибудь'].includes(uform)) {
      variants.push(buildStressVariant(pw, -1, 1.0));
      if (pw.isRhymingWord) variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
      else variants.push(buildStressVariant(pw, pw.stressPos, 0.5));
    } else if (['нет'].includes(uform)) {
      variants.push(buildStressVariant(pw, pw.stressPos, COEFF['@68_2']));
      variants.push(buildStressVariant(pw, -1, COEFF['@71']));
    } else if (countVowels(uform) < 3) {
      // Short function words — prefer unstressed
      variants.push(buildStressVariant(pw, -1, COEFF['@71']));
      if (['лишь', 'вроде', 'если', 'чтобы', 'когда', 'просто', 'мимо', 'даже', 'всё', 'хотя', 'едва', 'нет', 'пока'].includes(uform)) {
        variants.push(buildStressVariant(pw, pw.stressPos, COEFF['@68_2']));
      } else if (['был', 'будь', 'будем'].includes(uform)) {
        variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
      } else {
        variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
      }
    } else {
      // Long function words (3+ vowels) — usually stressed
      if (pw.stressPos > 0) variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
      else variants.push(buildStressVariant(pw, -1, 1.0));
    }
  } else if (pw.upos === 'PRON' || pw.upos === 'ADV' || pw.upos === 'DET') {
    if (uform !== 'что') {
      if (nvowels === 1) {
        variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
        variants.push(buildStressVariant(pw, -1, 1.0));
      } else {
        if (pw.stressPos > 0) variants.push(buildStressVariant(pw, pw.stressPos, COEFF['@79']));
        const unstressable = ['эти', 'эта', 'этот', 'эту', 'это', 'мои', 'твои', 'моих', 'твоих', 'моим', 'твоим', 'моей', 'твоей', 'мою', 'твою', 'его', 'ему', 'нему', 'ее', 'её', 'себе', 'меня', 'тебя', 'свою', 'свои', 'своим', 'они', 'она', 'уже', 'этом', 'тебе'];
        if (unstressable.includes(uform)) {
          variants.push(buildStressVariant(pw, -1, COEFF['@77_2']));
        } else if (nvowels === 2 && allowUnstress12) {
          variants.push(buildStressVariant(pw, -1, 0.8));
        }
      }
    } else {
      // "что" — treated as content word, allows unstress with allow_unstress12
      if (pw.stressPos > 0) {
        variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
        if (nvowels === 1 && allowUnstress12) {
          variants.push(buildStressVariant(pw, -1, 0.8));
        } else if (nvowels === 2 && allowUnstress12) {
          variants.push(buildStressVariant(pw, -1, 0.8));
        }
      } else {
        variants.push(buildStressVariant(pw, -1, 1.0));
      }
    }
  } else {
    // Content words (NOUN, VERB, ADJ, etc.)
    if (pw.accentuations.length > 1) {
      // Multiple accentuations — try all
      for (const acc of pw.accentuations) {
        variants.push(buildStressVariant(pw, acc.stressPos, 1.0));
      }
    } else if (pw.accentuations.length === 1) {
      variants.push(buildStressVariant(pw, pw.accentuations[0].stressPos, 1.0));

      // Add unstressed variant for short words
      if (['есть', 'раз', 'быть', 'будь', 'был'].includes(uform)) {
        variants.push(buildStressVariant(pw, -1, COEFF['@143']));
      } else if (nvowels === 1 && (pw.upos === 'NOUN' || pw.upos === 'NUM' || pw.upos === 'ADJ' || pw.upos === 'VERB') && allowUnstress12) {
        variants.push(buildStressVariant(pw, -1, 0.7));
      } else if (nvowels === 2 && allowUnstress12) {
        variants.push(buildStressVariant(pw, -1, 0.8));
      }
    } else {
      // No accentuations — OOV
      if (pw.stressPos > 0) {
        variants.push(buildStressVariant(pw, pw.stressPos, 1.0));
      } else {
        // Try neural prediction
        const accent = getAccent(uform, pw.feats, pw.upos);
        if (accent.stressPos > 0) {
          variants.push(buildStressVariant(pw, accent.stressPos, 1.0));
        }
        // For OOV with multiple vowels, try all positions
        if (nvowels > 1) {
          let vc = 0;
          for (let i = 0; i < uform.length; i++) {
            if ('уеыаоэёяию'.includes(uform[i])) {
              vc++;
              let proba = 0.90;
              if (countVowels(uform.slice(0, i)) > 2 || countVowels(uform.slice(i + 1)) > 2) proba *= 0.5;
              variants.push(buildStressVariant(pw, vc, proba));
            }
          }
        }
      }
    }
  }

  // Stress shift: try alternative stress positions from ambiguous_accents
  if (allowStressShift && countVowels(uform) > 1 && data.ambiguousAccents[uform] && !data.ambiguousAccents2[uform]) {
    for (const stressedForm of Object.keys(data.ambiguousAccents[uform])) {
      const sp = locateStressPos(stressedForm);
      if (sp > 0 && !variants.some(v => v.newStressPos === sp)) {
        variants.push(buildStressVariant(pw, sp, 0.99));
      }
    }
  }

  return variants;
}

// ── Meter mapping (the recursive tree search) ────────────────────────

interface WordMappingResult {
  word: WordStressVariant;
  TP: number; FP: number; TN: number; FN: number;
  syllabicMapping: string[];
  stressShift: boolean;
  metreScore: number;
  totalScore: number;
}

interface MetreMappingResult {
  prefix: number;
  metreSignature: number[];
  score: number;
  wordMappings: WordMappingResult[];
  stressShiftCount: number;
  cursor: number;
}

function buildWordMapping(word: WordStressVariant, metreSigns: number[], startCursor: number, prevLastStressed: boolean, prefix: number): { mapping: WordMappingResult; newCursor: number } {
  let TP = 0, FP = 0, TN = 0, FN = 0;
  const syllabicMapping: string[] = [];
  let cursor = startCursor;
  const sigLen = metreSigns.length;

  for (const wordSign of word.stressSignature) {
    let metreSign = 0;
    if (prefix > 0) {
      if (cursor < prefix) metreSign = 0;
      else metreSign = metreSigns[(cursor - prefix) % sigLen];
    } else {
      metreSign = metreSigns[cursor % sigLen];
    }

    if (metreSign === 1) {
      if (wordSign === 1) { TP++; syllabicMapping.push('TP'); }
      else if (wordSign === 2) { TP += 0.5; syllabicMapping.push('TP'); }
      else { FN++; syllabicMapping.push('FN'); }
    } else {
      if (wordSign === 1) { FP++; syllabicMapping.push('FP'); }
      else if (wordSign === 2) { TN++; syllabicMapping.push('TN'); }
      else { TN++; syllabicMapping.push('TN'); }
    }
    cursor++;
  }

  // Penalty for two stressed syllables in a row
  let additionalScoreFactor = 1.0;
  if (word.stressSignature.length > 0 && prevLastStressed && word.stressSignature[0] === 1) {
    additionalScoreFactor = 0.1;
  }

  const metreScore = Math.pow(0.1, FP) * Math.pow(0.95, FN) * additionalScoreFactor;
  const totalScore = metreScore * word.score;

  return {
    mapping: { word, TP, FP, TN, FN, syllabicMapping, stressShift: false, metreScore, totalScore },
    newCursor: cursor,
  };
}

function finalizeMapping(mm: MetreMappingResult): void {
  // Penalize chains of 4+ unstressed syllables
  const sig: number[] = [];
  for (const wm of mm.wordMappings) {
    for (const s of wm.word.stressSignature) sig.push(s);
  }
  const s = sig.map(String).join('');
  const re = /0{4,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const len = m[0].length;
    const idx = m.index;
    let factor = 0.1;
    if (len <= 5 && s.slice(0, idx).includes('1') && s.slice(idx + len).includes('1')) {
      factor = len === 4 ? 0.80 : 0.50;
    } else {
      factor = len === 4 ? 0.30 : 0.20;
    }
    mm.score *= factor;
  }
}

function getMappingScore(mm: MetreMappingResult): number {
  const shiftFactor = mm.stressShiftCount < 2 ? 1.0 : Math.pow(0.5, mm.stressShiftCount);
  return mm.score * shiftFactor;
}

/** Recursively map stress variants against a meter signature. */
function mapChain(
  wordIndex: number,
  pwords: PoetryWord[],
  prevResults: MetreMappingResult[],
  metreSignature: number[],
  prefix: number,
  allResults: MetreMappingResult[],
): void {
  if (wordIndex >= pwords.length) {
    for (const r of prevResults) {
      finalizeMapping(r);
      allResults.push(r);
    }
    return;
  }

  const variants = getStressVariants(pwords[wordIndex], true, true);
  const newResults: MetreMappingResult[] = [];

  for (const prevResult of prevResults) {
    const prevLastStressed = prevResult.wordMappings.length > 0 &&
      prevResult.wordMappings[prevResult.wordMappings.length - 1].word.stressSignature.length > 0 &&
      prevResult.wordMappings[prevResult.wordMappings.length - 1].word.stressSignature[
        prevResult.wordMappings[prevResult.wordMappings.length - 1].word.stressSignature.length - 1
      ] === 1;

    for (const variant of variants) {
      const { mapping, newCursor } = buildWordMapping(
        variant, metreSignature, prevResult.cursor, prevLastStressed, prefix
      );

      // Prevent long chains of unstressed syllables
      if (mapping.word.newStressPos === -1) {
        const n = countPrevUnstressed(prevResult);
        if (mapping.word.poetryWord.nVowels + n >= 6) continue;
      }

      const newMapping: MetreMappingResult = {
        prefix,
        metreSignature,
        score: prevResult.score * mapping.totalScore,
        wordMappings: [...prevResult.wordMappings, mapping],
        stressShiftCount: prevResult.stressShiftCount + (mapping.stressShift ? 1 : 0),
        cursor: newCursor,
      };
      newResults.push(newMapping);
    }
  }

  // Sort by score descending and keep top N to prevent combinatorial explosion
  newResults.sort((a, b) => getMappingScore(b) - getMappingScore(a));
  const MAX_RESULTS = 30;
  const topResults = newResults.slice(0, MAX_RESULTS);

  mapChain(wordIndex + 1, pwords, topResults, metreSignature, prefix, allResults);
}

function countPrevUnstressed(mm: MetreMappingResult): number {
  let n = 0;
  for (let i = mm.wordMappings.length - 1; i >= 0; i--) {
    if (mm.wordMappings[i].word.newStressPos === -1) {
      n += mm.wordMappings[i].word.stressSignature.length;
    } else {
      break;
    }
  }
  return n;
}

/** Map all stress variants for a line against a meter signature + prefix. */
function mapLine(pwords: PoetryWord[], metreSignature: number[], prefix: number): MetreMappingResult[] {
  const allResults: MetreMappingResult[] = [];
  const startResult: MetreMappingResult = {
    prefix,
    metreSignature,
    score: 1.0,
    wordMappings: [],
    stressShiftCount: 0,
    cursor: 0,
  };
  mapChain(0, pwords, [startResult], metreSignature, prefix, allResults);
  allResults.sort((a, b) => getMappingScore(b) - getMappingScore(a));
  return allResults;
}

// ── Rhyming tail ─────────────────────────────────────────────────────

interface RhymingTail {
  stressedWord: WordStressVariant | null;
  unstressedTail: string;
  prefix: string;
  ok: boolean;
}

function getRhymingTail(stressedWords: WordStressVariant[]): RhymingTail {
  let stressedWord: WordStressVariant | null = null;
  let unstressedPrefix = '';
  const postfixWords: WordStressVariant[] = [];

  for (let i = stressedWords.length - 1; i >= 0; i--) {
    const sw = stressedWords[i];
    if (sw.newStressPos !== -1) {
      stressedWord = sw;

      // Special case: single-vowel word
      if (/^[аеёиоуыэюя]$/i.test(sw.poetryWord.form) && i > 0) {
        const prev = stressedWords[i - 1].poetryWord.form;
        const m = prev.match(/([абвгдеёжзийклмнопрстфхцчшщыэюя][ьъ]?)$/i);
        if (m) unstressedPrefix = m[1].toLowerCase();
      }

      for (let i2 = i + 1; i2 < stressedWords.length; i2++) {
        if (stressedWords[i2].poetryWord.upos !== 'PUNCT') {
          postfixWords.push(stressedWords[i2]);
        }
      }
      break;
    }
  }

  const unstressedTail = postfixWords.map(w => w.poetryWord.form).join('');
  let ok = false;
  if (stressedWord && stressedWord.newStressPos !== -1) {
    ok = true;
    if (stressedWord.stressSignature.length - stressedWord.newStressPos >= 3) {
      ok = false;
    }
  }

  return { stressedWord, unstressedTail, prefix: unstressedPrefix, ok };
}

// ── Rhyme detection ──────────────────────────────────────────────────

function checkRhyming(tail1: RhymingTail, tail2: RhymingTail): boolean {
  if (!tail1.ok || !tail2.ok) return false;
  if (!tail1.stressedWord || !tail2.stressedWord) return false;

  const data = getAccentsData();
  const form1 = tail1.stressedWord.poetryWord.form.toLowerCase();
  const form2 = tail2.stressedWord.poetryWord.form.toLowerCase();

  // Check explicit rhymed words
  if (data.rhymedWords.has([form1, form2] as [string, string]) ||
      data.rhymedWords.has([form2, form1] as [string, string])) {
    return true;
  }

  // Compare clausulas
  const stress1 = tail1.stressedWord.newStressPos;
  const stress2 = tail2.stressedWord.newStressPos;
  const vowels1 = countVowels(form1) + countVowels(tail1.unstressedTail);
  const vowels2 = countVowels(form2) + countVowels(tail2.unstressedTail);
  const pos1 = vowels1 - stress1 + countVowels(tail1.unstressedTail);
  const pos2 = vowels2 - stress2 + countVowels(tail2.unstressedTail);

  if (pos1 !== pos2) return false;

  // Compare spelling endings
  const ending1 = getSpellingEnding(form1, stress1, tail1.unstressedTail);
  const ending2 = getSpellingEnding(form2, stress2, tail2.unstressedTail);
  if (ending1 === ending2) return true;

  // Compare phonetic clausulas
  const claus1 = extractClausula(form1, stress1, tail1.unstressedTail);
  const claus2 = extractClausula(form2, stress2, tail2.unstressedTail);
  if (arePhoneticallyEqual(claus1, claus2)) return true;

  // Allow phonetic fuzzy rhymes like -ать / -а and -ять / -я (умирать / номера)
  if ((claus1 === 'ать' && claus2 === 'а') || (claus1 === 'а' && claus2 === 'ать')) return true;
  if ((claus1 === 'ять' && claus2 === 'я') || (claus1 === 'я' && claus2 === 'ять')) return true;
  if (claus1.endsWith('ть') && claus2.endsWith('т') && claus1.slice(0, -2) === claus2.slice(0, -1)) return true;
  if (claus2.endsWith('ть') && claus1.endsWith('т') && claus2.slice(0, -2) === claus1.slice(0, -1)) return true;

  // Check fuzzy rhyming dictionary
  const lemma1 = tail1.stressedWord.poetryWord.lemma.toLowerCase();
  const lemma2 = tail2.stressedWord.poetryWord.lemma.toLowerCase();
  if (data.rhymingDict[lemma1]?.includes(lemma2) || data.rhymingDict[lemma2]?.includes(lemma1)) {
    return true;
  }

  // 04-08-2022: Депрессяшки - однобуквенная разница или сдвиг
  // Actually, we can add more robust fuzzy matching here later, 
  // but let's check basic substring matching for verbs with different postfixes
  if (tail1.stressedWord.poetryWord.upos === 'VERB' && tail2.stressedWord.poetryWord.upos === 'VERB') {
    if (form1.endsWith(form2) || form2.endsWith(form1)) return true;
  }

  return false;
}

function getSpellingEnding(word: string, stressPos: number, tail: string): string {
  let vc = 0;
  for (let i = 0; i < word.length; i++) {
    if ('уеыаоэёяию'.includes(word[i].toLowerCase())) {
      vc++;
      if (vc === stressPos) return word.slice(i) + tail.toLowerCase();
    }
  }
  return word + tail.toLowerCase();
}

function arePhoneticallyEqual(s1: string, s2: string): boolean {
  if (s1 === s2) return true;
  if (Math.abs(s1.length - s2.length) > 1) return false;
  const minLen = Math.min(s1.length, s2.length);
  let mismatches = 0;
  for (let i = 0; i < minLen; i++) {
    if (s1[i] !== s2[i]) {
      mismatches++;
      if (RU_VOWELS.includes(s1[i]) && RU_VOWELS.includes(s2[i])) continue;
      const DEVOICING: Record<string, string> = { 'б': 'п', 'в': 'ф', 'г': 'к', 'д': 'т', 'ж': 'ш', 'з': 'с' };
      if (DEVOICING[s1[i]] === s2[i] || DEVOICING[s2[i]] === s1[i]) continue;
      if ((s1[i] === 'ь' || s1[i] === 'ъ') && (s2[i] === 'ь' || s2[i] === 'ъ')) continue;
    }
  }
  return mismatches <= 1;
}

/** Detect rhyme scheme for 4 lines. */
function detectRhyming(tails: RhymingTail[]): { scheme: string; score: number; graph: (number | null)[] } {
  const n = tails.length;
  const rx: Record<string, boolean> = {};
  const graph: (number | null)[] = [];

  for (let i = 0; i < n - 1; i++) {
    let iRhyming: number | null = null;
    for (let j = i + 1; j < n; j++) {
      const r = checkRhyming(tails[i], tails[j]);
      rx[`${i},${j}`] = r;
      if (r && iRhyming === null) {
        iRhyming = j - i;
      }
    }
    graph.push(iRhyming);
  }
  graph.push(null);

  let scheme = '-'.repeat(n);
  const graphStr = graph.map(g => g === null ? 0 : g).join(' ');

  if (n === 4) {
    if (graphStr === '2 0 1 0') scheme = 'A-AA';
    else if (graphStr === '0 1 1 0') scheme = '-AAA';
    else {
      const r01 = rx['0,1'], r02 = rx['0,2'], r03 = rx['0,3'];
      const r12 = rx['1,2'], r13 = rx['1,3'], r23 = rx['2,3'];
      if (r01 && r12 && r23) scheme = 'AAAA';
      else if (r02 && r13) scheme = 'ABAB';
      else if (r03 && r12) scheme = 'ABBA';
      else if (r01 && r23) scheme = 'AABB';
      else if (r01 && r03 && !r02) scheme = 'AABA';
      else if (r01 && r02 && r12 && !r13) scheme = 'AAAB';
      else if (r02 && !r13) scheme = 'A-A-';
      else if (!r02 && r13) scheme = '-A-A';
      else if (r12 && !r01 && !r23) scheme = '-AA-';
      else if (r03 && !r12) scheme = 'A--A';
      else if (!r01 && r23) scheme = '--AA';
      else if (r01 && !r23) scheme = 'AA--';
    }
  } else if (n === 2) {
    if (rx['0,1']) { scheme = 'AA'; return { scheme, score: 1.0, graph: [1, null] }; }
    else { scheme = '--'; return { scheme, score: 0.75, graph: [null, null] }; }
  } else if (n === 1) {
    scheme = '-';
  } else {
    // For n != 4, use the generic rhyme graph → scheme conversion
    scheme = convertRhymeGraphToScheme(graph);
  }

  // Calculate rhyme score matching original Python logic
  const edges = graph.map(g => g === null ? 0 : g);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e > 0 && edges[i + e] === 0) {
      edges[i + e] = -e;
    }
  }

  const numRhymedLines = edges.filter(e => e !== 0).length;
  let rhymeScore: number;

  if (n === 3) {
    if (numRhymedLines < 2) rhymeScore = 1.0 - 1.0 / 6.0;
    else rhymeScore = 1.0;
  } else {
    const rhymePenalty1 = 1.0 / (2 * n);
    const rhymePenalty = edges.reduce((sum, e) => sum + (e === 0 ? rhymePenalty1 : 0.0), 0);
    rhymeScore = 1.0 - rhymePenalty;
  }

  return { scheme, score: rhymeScore, graph };
}

function convertRhymeGraphToScheme(graph: (number | null)[]): string {
  const n = graph.length;
  const letters: string[] = new Array(n).fill('-');
  let curChar = 65; // 'A'

  for (let i = 0; i < n; i++) {
    const offset = graph[i];
    if (offset !== null && offset > 0) {
      const j = i + offset;
      if (letters[i] === '-') {
        if (curChar > 90) break;
        letters[i] = String.fromCharCode(curChar);
        letters[j] = String.fromCharCode(curChar);
        curChar++;
      } else {
        letters[j] = letters[i];
      }
    }
  }

  return letters.join('');
}

// ── Line-level scoring ───────────────────────────────────────────────

interface LineStressVariant {
  stressedWords: WordStressVariant[];
  stressSignature: number[];
  stressSignatureStr: string;
  rhymingTail: RhymingTail;
  totalScore: number;
  penalties: string[];
}

function buildLineStressVariant(stressedWords: WordStressVariant[]): LineStressVariant {
  const stressSignature: number[] = [];
  for (const sw of stressedWords) {
    stressSignature.push(...sw.stressSignature);
  }
  const stressSignatureStr = stressSignature.map(String).join('');
  const rhymingTail = getRhymingTail(stressedWords);

  // Calculate total score
  let totalScore = 1.0;
  for (const sw of stressedWords) totalScore *= sw.score;
  const penalties: string[] = [];

  // Penalty: unstressed pronoun after unstressed preposition with vowel
  if (stressedWords.length >= 2) {
    const last = stressedWords[stressedWords.length - 1];
    const prev = stressedWords[stressedWords.length - 2];
    if (last.newStressPos === -1 && prev.newStressPos === -1 &&
        prev.poetryWord.upos === 'ADP' && countVowels(prev.poetryWord.form) > 0 &&
        last.poetryWord.upos === 'PRON') {
      totalScore *= 0.5;
      penalties.push('@545');
    }
  }

  // Penalty: bad clausula
  if (!rhymingTail.ok) {
    totalScore *= 0.1;
    penalties.push('@550');
  }

  // Penalty: no stresses at all
  if (stressedWords.every(w => w.newStressPos === -1)) {
    totalScore *= 0.01;
    penalties.push('@555');
  }

  // Penalty: stressed "и" at line start
  if (stressedWords[0]?.newStressPos === 1 && stressedWords[0]?.poetryWord.form.toLowerCase() === 'и') {
    totalScore *= 0.1;
    penalties.push('@573');
  }

  // Penalty: consonant clusters across word boundaries
  for (let i = 0; i < stressedWords.length - 1; i++) {
    const w1 = stressedWords[i], w2 = stressedWords[i + 1];
    const nAdj = w1.poetryWord.trailingConsonants + w2.poetryWord.leadingConsonants;
    if (nAdj > 5) {
      totalScore *= 0.5;
      penalties.push('@309');
    }
    // Penalty: stressed preposition before stressed noun
    if (w1.poetryWord.upos === 'ADP' && w1.newStressPos > 0 &&
        (w2.poetryWord.upos === 'NOUN' || w2.poetryWord.upos === 'PROPN') && w2.newStressPos > 0) {
      totalScore *= 0.5;
      penalties.push('@317');
    }
  }

  // Penalty: only one stressed syllable in a long line
  const stressSum = stressSignature.reduce((a, b) => a + b, 0);
  if (stressSum === 1 && stressedWords.length > 2) {
    const totalVowels = stressedWords.reduce((s, w) => s + w.poetryWord.nVowels, 0);
    if (totalVowels > 2) {
      totalScore *= 0.1;
      penalties.push('@335');
    }
  }

  // Penalty: three unstressed syllables at end
  if (stressSignatureStr.endsWith('000')) {
    totalScore *= 0.1;
    penalties.push('@626');
  }

  return { stressedWords, stressSignature, stressSignatureStr, rhymingTail, totalScore, penalties };
}

function detectPoorPoetry(tails: RhymingTail[], rhymeScheme: string): boolean {
  const lastWords = tails.map(t => t.stressedWord?.poetryWord.form.toLowerCase() || '');

  // Check trivial repetition
  for (let i1 = 0; i1 < lastWords.length - 1; i1++) {
    const word1 = lastWords[i1];
    for (let i2 = i1 + 1; i2 < Math.min(lastWords.length, i1 + 6); i2++) {
      const word2 = lastWords[i2];
      if (word1 && word2) {
        const form1 = word1.replace(/ё/g, 'е');
        const form2 = word2.replace(/ё/g, 'е');
        if (form1 === form2) return true;
        if ('не' + form1 === form2 || 'не' + form2 === form1) return true;
      }
    }
  }

  // Check bad rhymes based on scheme
  const rhymePairs: [RhymingTail, RhymingTail][] = [];
  if (rhymeScheme === 'ABAB' || rhymeScheme === 'A-A-' || rhymeScheme === '-A-A') {
    if (tails[0] && tails[2]) rhymePairs.push([tails[0], tails[2]]);
    if (tails[1] && tails[3]) rhymePairs.push([tails[1], tails[3]]);
  } else if (rhymeScheme === 'ABBA') {
    if (tails[0] && tails[3]) rhymePairs.push([tails[0], tails[3]]);
    if (tails[1] && tails[2]) rhymePairs.push([tails[1], tails[2]]);
  } else if (rhymeScheme === 'AABA') {
    if (tails[0] && tails[1]) rhymePairs.push([tails[0], tails[1]]);
    if (tails[0] && tails[3]) rhymePairs.push([tails[0], tails[3]]);
  } else if (rhymeScheme === 'AABB') {
    if (tails[0] && tails[1]) rhymePairs.push([tails[0], tails[1]]);
    if (tails[2] && tails[3]) rhymePairs.push([tails[2], tails[3]]);
  } else if (rhymeScheme === 'AAAA' || rhymeScheme === '----') {
    if (tails[0] && tails[1]) rhymePairs.push([tails[0], tails[1]]);
    if (tails[1] && tails[2]) rhymePairs.push([tails[1], tails[2]]);
    if (tails[2] && tails[3]) rhymePairs.push([tails[2], tails[3]]);
  }

  const badGroups = [
    ['твой', 'мой', 'свой'],
    ['тебе', 'мне', 'себе'],
    ['него', 'его'],
    ['твои', 'свои'],
    ['наши', 'ваши'],
    ['меня', 'тебя', 'себя'],
    ['мной', 'тобой', 'собой'],
    ['мною', 'тобою', 'собою'],
    ['нее', 'ее', 'неё', 'её'],
    ['шел', 'шёл'], // simplified
    ['твоем', 'твоём', 'своем', 'своём', 'моем', 'моём'],
    ['когда', 'никогда', 'навсегда', 'кое-когда'],
    ['кто', 'никто', 'кое-кто'],
    ['где', 'нигде', 'везде'],
    ['каких', 'никаких', 'таких', 'сяких'],
    ['какого', 'никакого', 'такого', 'сякого']
  ];

  for (const [tail1, tail2] of rhymePairs) {
    if (!tail1.ok || !tail2.ok || !tail1.stressedWord || !tail2.stressedWord) continue;

    const word1 = tail1.stressedWord.poetryWord;
    const word2 = tail2.stressedWord.poetryWord;
    const form1 = word1.form.toLowerCase();
    const form2 = word2.form.toLowerCase();

    if (word1.upos === 'VERB' && word2.upos === 'VERB') {
      const data = getAccentsData();
      if (data.rhymedWords.has([form1, form2] as [string, string]) || data.rhymedWords.has([form2, form1] as [string, string])) continue;

      const badVerbsEndings = ['ли', 'ла', 'ло', 'л', 'тся', 'те', 'лись', 'лась', 'лось', 'лся', 'тся', 'ться', 'шись'];
      if (badVerbsEndings.some(e => form1.endsWith(e) && form2.endsWith(e))) return true;
      if (form1.endsWith(form2) || form2.endsWith(form1)) return true;
      if (word1.lemma === word2.lemma) return true;
    }

    if ((word1.upos === 'NOUN' || word1.upos === 'PROPN' || word1.upos === 'ADJ') && word1.upos === word2.upos) {
      if (word1.lemma === word2.lemma) return true;
    }

    for (const group of badGroups) {
      const g = new Set(group);
      if (g.has(form1.replace(/ё/g, 'е')) && g.has(form2.replace(/ё/g, 'е'))) return true;
    }

    if (word1.upos === 'ADJ' && word2.upos === 'ADJ') {
      if (form1.endsWith('ому') && form2.endsWith('ому')) return true;
      if (form1.endsWith('ему') && form2.endsWith('ему')) return true;
    }
  }

  return false;
}

// ── The main alignment function ──────────────────────────────────────

interface AlignmentResult {
  stressedLines: LineStressVariant[];
  metreMappings: MetreMappingResult[];
  score: number;
  meter: string;
  rhymeScheme: string;
  rhymeGraph: (number | null)[];
}

function getPrefixesForMeter(metreSignature: number[]): number[] {
  return metreSignature.length === 2 ? [0] : [0, 1];
}

function getCanonicMeter(metreName: string, prefix: number): string {
  if (metreName === 'ямб') return prefix === 0 ? 'ямб' : 'хорей';
  if (metreName === 'хорей') return prefix === 0 ? 'хорей' : 'ямб';
  
  // For ternary meters, prefix=1 shifts the meter signature right by 1
  if (metreName === 'дактиль' || metreName === 'амфибрахий' || metreName === 'анапест') {
    let m: [number, number, number];
    if (metreName === 'дактиль') m = [1, 0, 0];
    else if (metreName === 'амфибрахий') m = [0, 1, 0];
    else m = [0, 0, 1];
    
    if (prefix === 1) {
      m = [m[2], m[0], m[1]];
    }
    
    if (m[0] === 1) return 'дактиль';
    if (m[1] === 1) return 'амфибрахий';
    if (m[2] === 1) return 'анапест';
  }
  
  if (metreName === 'dolnik') return 'dolnik';
  return metreName;
}

function alignLines(lines: string[]): AlignmentResult {
  // Parse all lines
  const pwordsPerLine: PoetryWord[][] = [];
  for (const line of lines) {
    const sentences = parseRussianText(line);
    const tokens = sentences.flat();
    const pwords: PoetryWord[] = [];
    for (const token of tokens) {
      if (isRuPunctuation(token.upos)) continue;
      pwords.push(buildPoetryWord(token));   // ёфикация happens inside
    }
    // Mark last non-punct word as rhyming word
    for (let i = pwords.length - 1; i >= 0; i--) {
      if (!PUNCT_UPOS.has(pwords[i].upos)) {
        pwords[i].isRhymingWord = true;
        break;
      }
    }
    pwordsPerLine.push(pwords);
  }

  // Check for too-long lines
  for (const pwords of pwordsPerLine) {
    if (pwords.filter(w => w.nVowels >= 1).length >= MAX_WORDS_PER_LINE) {
      // Fall back to first-variant only
      const stressedLines = pwordsPerLine.map(pws =>
        buildLineStressVariant(pws.map(pw => getStressVariants(pw, false, false)[0]).filter(v => v))
      );
      return {
        stressedLines,
        metreMappings: [],
        score: 0.0,
        meter: 'free',
        rhymeScheme: '-'.repeat(lines.length),
        rhymeGraph: lines.map(() => null),
      };
    }
  }

  let bestScore = 0.0;
  let bestMeter = '';
  let bestRhymeScheme = '----';
  let bestVariant: [MetreMappingResult, LineStressVariant][] | null = null;
  let bestRhymeGraph: (number | null)[] = lines.map(() => null);
  const rhymeCache: Record<string, [string, number, (number | null)[]]> = {};

  // Try each meter
  for (const [metreName, metreSignature] of METERS) {
    if (bestScore > EARLY_STOPPING) break;

    const prefixes = getPrefixesForMeter(metreSignature);

    // For each line, find best stress variants for each prefix
    const bestPerLine: [MetreMappingResult, LineStressVariant][][] = [];

    for (let iLine = 0; iLine < pwordsPerLine.length; iLine++) {
      const pwords = pwordsPerLine[iLine];
      const lineBests: Record<string, [MetreMappingResult, LineStressVariant]> = {};

      for (const prefix of prefixes) {
        const mappings = mapLine(pwords, metreSignature, prefix);
        // Take top results
        for (const mm of mappings.slice(0, 5)) {
          const stressedWords = mm.wordMappings.map(wm => wm.word);
          const lsv = buildLineStressVariant(stressedWords);
          if (lsv.rhymingTail.ok) {
            const tailStr = lsv.rhymingTail.stressedWord?.stressedForm ?? '';
            const score = getMappingScore(mm);
            if (!lineBests[tailStr] || score > getMappingScore(lineBests[tailStr][0])) {
              lineBests[tailStr] = [mm, lsv];
            }
          }
        }
      }
      bestPerLine.push(Object.values(lineBests));
    }

    // Check for empty lines
    if (bestPerLine.some(b => b.length === 0)) continue;

    // Try combinations (limit to prevent explosion)
    const MAX_COMBOS = 500;
    let combos: [MetreMappingResult, LineStressVariant][][] = [[]];
    for (const lineOptions of bestPerLine) {
      const newCombos: [MetreMappingResult, LineStressVariant][][] = [];
      for (const combo of combos) {
        for (const opt of lineOptions.slice(0, 3)) {
          newCombos.push([...combo, opt]);
        }
      }
      combos = newCombos.slice(0, MAX_COMBOS);
    }

    for (const plinev of combos) {
      // Meter defects scoring
      let metreDefectsScore = 1.0;
      const prefixCounts: Record<number, number> = {};
      for (const [mm] of plinev) {
        prefixCounts[mm.prefix] = (prefixCounts[mm.prefix] ?? 0) + 1;
      }
      // Only penalize if exactly one line has a different prefix
      const prefixValues = Object.values(prefixCounts);
      if (prefixValues.includes(1) && plinev.length > 2) {
        metreDefectsScore *= 0.1;
      }

      // Syllable count variation penalty
      const sylCounts = plinev.map(([, lsv]) => lsv.stressSignature.length);
      const uniqueSyls = new Set(sylCounts);
      if (uniqueSyls.size > 2) {
        metreDefectsScore *= 0.1;
      }

      // Detect rhyming
      const tails = plinev.map(([, lsv]) => lsv.rhymingTail);
      const cacheKey = tails.map(t => t.stressedWord?.stressedForm ?? '').join('|');
      let rhymeResult: [string, number, (number | null)[]];
      if (rhymeCache[cacheKey]) {
        rhymeResult = rhymeCache[cacheKey];
      } else {
        const r = detectRhyming(tails);
        rhymeResult = [r.scheme, r.score, r.graph];
        rhymeCache[cacheKey] = rhymeResult;
      }
      const [rhymeScheme, rhymeScore, rhymeGraph] = rhymeResult;

      // Recalculate line scores with rhyme graph
      const lineTScores = plinev.map(([mm]) => getMappingScore(mm));
      for (let i1 = 0; i1 < rhymeGraph.length; i1++) {
        const edge = rhymeGraph[i1];
        if (edge !== null) {
          const i2 = i1 + edge;
          if (plinev[i1][1].stressSignatureStr === plinev[i2][1].stressSignatureStr) {
            for (const j of [i1, i2]) {
              lineTScores[j] += (1.0 - lineTScores[j]) * 0.10;
            }
          }
        }
      }

      let totalScore = metreDefectsScore * rhymeScore * lineTScores.reduce((a, b) => a * b, 1);

      if (detectPoorPoetry(tails, rhymeScheme)) {
        totalScore *= 0.1;
      }

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestMeter = getCanonicMeter(metreName, plinev[0][0].prefix);
        bestRhymeScheme = rhymeScheme;
        bestVariant = plinev;
        bestRhymeGraph = rhymeGraph;
      }
    }
  }

  // Try dolnik if no good match found
  if (bestScore <= EARLY_STOPPING) {
    const numSyllables = pwordsPerLine.map(pws => pws.reduce((s, pw) => s + pw.nVowels, 0));
    const dolnikPatterns = getDolnikPatterns(numSyllables);

    for (const pattern of dolnikPatterns) {
      const newStressLines: [MetreMappingResult, LineStressVariant][] = [];
      let ok = true;

      for (let iLine = 0; iLine < pwordsPerLine.length; iLine++) {
        const pwords = pwordsPerLine[iLine];
        const sig = pattern[iLine % pattern.length];
        const mappings = mapLine(pwords, sig, 0);

        let bestMapping: MetreMappingResult | null = null;
        let bestLSV: LineStressVariant | null = null;
        let maxScore = 0.0;

        for (const mm of mappings) {
          if (getMappingScore(mm) > maxScore) {
            const stressedWords = mm.wordMappings.map(wm => wm.word);
            const lsv = buildLineStressVariant(stressedWords);
            if (lsv.rhymingTail.ok) {
              maxScore = getMappingScore(mm);
              bestMapping = mm;
              bestLSV = lsv;
            }
          }
        }

        if (bestMapping && bestLSV) {
          newStressLines.push([bestMapping, bestLSV]);
        } else {
          ok = false;
          break;
        }
      }

        if (ok) {
          const tails = newStressLines.map(([, lsv]) => lsv.rhymingTail);
          const r = detectRhyming(tails);
          const lineTScores = newStressLines.map(([mm]) => getMappingScore(mm));
          let totalScore = r.score * lineTScores.reduce((a, b) => a * b, 1);

          if (detectPoorPoetry(tails, r.scheme)) {
            totalScore *= 0.1;
          }

          if (totalScore > bestScore) {
          bestScore = totalScore;
          bestMeter = 'dolnik';
          bestRhymeScheme = r.scheme;
          bestVariant = newStressLines;
          bestRhymeGraph = r.graph;
        }
      }
    }
  }

  if (!bestVariant) {
    // No good alignment found — return default
    const stressedLines = pwordsPerLine.map(pws => {
      const sws = pws.map(pw => getStressVariants(pw, false, false)[0]).filter(v => v);
      return buildLineStressVariant(sws);
    });
    return {
      stressedLines,
      metreMappings: [],
      score: 0.0,
      meter: 'free',
      rhymeScheme: '-'.repeat(lines.length),
      rhymeGraph: lines.map(() => null),
    };
  }

  return {
    stressedLines: bestVariant.map(([, lsv]) => lsv),
    metreMappings: bestVariant.map(([mm]) => mm),
    score: bestScore,
    meter: bestMeter,
    rhymeScheme: bestRhymeScheme,
    rhymeGraph: bestRhymeGraph,
  };
}

function getDolnikPatterns(numSyllables: number[]): number[][][] {
  const maxSyl = Math.max(...numSyllables);
  const minSyl = Math.min(...numSyllables);
  const patterns: number[][][] = [];

  // Typical Dolniks (3-ictus and 4-ictus)
  
  if (minSyl >= 8 && maxSyl <= 12) {
    // 3-ictus dolnik (e.g. 0 0 1 0 0 1 0 1 0)
    patterns.push([
      [0, 0, 1, 0, 0, 1, 0, 1, 0],
      [0, 0, 1, 0, 0, 1, 0, 1]
    ]);
    patterns.push([
      [0, 1, 0, 0, 1, 0, 0, 1, 0],
      [0, 1, 0, 0, 1, 0, 0, 1]
    ]);
    patterns.push([
      [1, 0, 0, 1, 0, 0, 1, 0],
      [1, 0, 0, 1, 0, 0, 1]
    ]);
    patterns.push([
      [1, 0, 1, 0, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 0, 1, 0, 1]
    ]);
    patterns.push([
      [1, 0, 1, 0, 1, 0, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 0, 1]
    ]);
    patterns.push([[0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]]);
  }
  
  if (minSyl >= 12 && maxSyl <= 16) {
    patterns.push([[0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]]);
    patterns.push([
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    ]);
  }
  
  if (minSyl >= 5 && maxSyl <= 8) {
    patterns.push([[0, 0, 1, 0, 0, 1, 0, 0]]);
  }

  return patterns;
}

// ── Public API ───────────────────────────────────────────────────────

/** Analyze a Russian poem and return the full scansion result. */
export async function analyzeRussianPoem(text: string): Promise<RuScansionResult> {
  await ensureRussianData();
  // Split into stanzas (blank lines separate stanzas)
  const stanzaTexts = text.split(/\n\s*\n/).filter(s => s.trim());

  const stanzas: RuStanza[] = [];
  const allResults: AlignmentResult[] = [];
  let totalScore = 1.0;

  for (const stanzaText of stanzaTexts) {
    const lines = stanzaText.split('\n').filter(l => l.trim());

    // Auto-segment long unstructured text into 4-line blocks
    let blocks: string[][];
    if (lines.length > 7) {
      blocks = [];
      for (let i = 0; i < lines.length; i += 4) {
        blocks.push(lines.slice(i, Math.min(i + 4, lines.length)));
      }
    } else {
      // Leave blocks of <= 7 lines intact, just like the original Python
      blocks = [lines];
    }

    const stanzaLines: RuLine[] = [];
    let stanzaScore = 1.0;

    for (const block of blocks) {
      const result = alignLines(block);
      allResults.push(result);
      stanzaScore = Math.min(stanzaScore, result.score);

      // Build RuLine from result
      for (let i = 0; i < block.length; i++) {
        const lsv = result.stressedLines[i];
        const raw = block[i];
        const words: RuWord[] = [];

        for (const sw of lsv.stressedWords) {
          const pw = sw.poetryWord;
          const sylTexts = splitWord(pw.form);
          const syllables: RuSyllable[] = [];
          let vIdx = 0;
          for (const sylText of sylTexts) {
            vIdx++;
            const stressed = sw.newStressPos === vIdx;
            const secondaryStressed = sw.stressSignature[vIdx - 1] === 2;
            let vowel = '';
            for (const c of sylText) {
              if (RU_VOWELS.includes(c.toLowerCase())) { vowel = c; break; }
            }
            syllables.push({ text: sylText, vowel, vowelIndex: vIdx, stressed, secondaryStressed });
          }

          words.push({
            form: pw.form,
            lemma: pw.lemma,
            upos: pw.upos,
            feats: pw.feats,
            deprel: pw.deprel,
            head: pw.head,
            isContent: CONTENT_UPOS.has(pw.upos),
            syllables,
            stressPos: sw.newStressPos,
            lexStressPos: pw.stressPos,
            secondaryStress: sw.stressSignature.map(s => s === 2 ? 2 : 0),
          });
        }

        const syllableCount = words.reduce((s, w) => s + w.syllables.filter(syl => syl.vowel).length, 0);
        const stressPattern = lsv.stressSignature.map(s => s >= 1 ? 'S' : 'U').join('');
        const tierPattern = assignTiers(words, getAccentsData());

        // Dependency edges between the line's words (UDPipe heads remapped
        // from per-sentence token ids to indices into `words`; edges whose
        // governor is punctuation — not present in `words` — are dropped).
        const tokenIndex = new Map<string, number>();
        lsv.stressedWords.forEach((sw2, wi) =>
          tokenIndex.set(`${sw2.poetryWord.sent}:${sw2.poetryWord.id}`, wi));
        const deps: RuDep[] = [];
        lsv.stressedWords.forEach((sw2, wi) => {
          const pw2 = sw2.poetryWord;
          if (!pw2.deprel) return;
          if (pw2.head === 0 || pw2.deprel === 'root') {
            deps.push({ from: wi, to: -1, rel: 'root' });
            return;
          }
          const to = tokenIndex.get(`${pw2.sent}:${pw2.head}`);
          if (to !== undefined && to !== wi) deps.push({ from: wi, to, rel: pw2.deprel });
        });

        stanzaLines.push({ raw, words, syllableCount, stressPattern, tierPattern, deps });
      }
    }

    stanzas.push({ lines: stanzaLines });
    totalScore = Math.min(totalScore, stanzaScore);
  }

  // Determine overall meter
  const mainResult = allResults[0];
  const meter: RuMeterResult = {
    meter: METER_CANONIC[mainResult?.meter ?? 'free'] || 'free',
    meterRu: mainResult?.meter ?? 'вольный',
    score: totalScore,
    footCount: 0,
    scansion: '',
  };

  // Calculate foot count
  if (mainResult && stanzas[0]?.lines[0]) {
    const avgSyls = stanzas[0].lines.reduce((s, l) => s + l.syllableCount, 0) / stanzas[0].lines.length;
    const footLens: Record<string, number> = {
      'iambic': 2, 'trochaic': 2, 'dactylic': 3, 'amphibrachic': 3, 'anapestic': 3,
      'dolnik': 3,
    };
    meter.footCount = Math.round(avgSyls / (footLens[meter.meter] || 2));
    meter.scansion = stanzas[0].lines.map(l => l.stressPattern).join('|');
  }

  // Build rhyme entries.  detectRhyming (above, per stanza/block) is Koziev's
  // alignment algorithm and is untouched by this block — its per-block letters
  // restart at 'A' every time and its rhymeGraph offsets are block-local, which
  // is correct for scoring but wrong once flattened into the poem-wide display
  // arrays below: two unrelated rhymes in different stanzas would both show as
  // 'A', and matchedLine would point at the wrong line once stanzas 2+ start.
  // Fix both here, display-only, after scoring: re-letter every block's local
  // letters through the same bijective base-26 sequence the English engine
  // uses (rhymeKey), and add a running poem-global line offset so matchedLine
  // indexes into the flat per-line arrays the same way the frontend does
  // (webapp/public/app.js's countLinesBeforeStanza + poemLineNo: 0-based,
  // cumulative across all stanzas in reading order).
  const allRhymes: RuRhymeEntry[] = [];
  let rhymeSchemeStr = '';
  let lineOffset = 0;
  let nextGlobalKey = 0;
  for (const result of allResults) {
    const localToGlobal = new Map<string, string>();
    const globalLetters: string[] = [];
    for (const ch of result.rhymeScheme) {
      if (ch === '-') { globalLetters.push('-'); continue; }
      if (!localToGlobal.has(ch)) localToGlobal.set(ch, rhymeKey(nextGlobalKey++));
      globalLetters.push(localToGlobal.get(ch)!);
    }
    rhymeSchemeStr += globalLetters.join('') + ' ';
    for (let i = 0; i < result.rhymeGraph.length; i++) {
      const lsv = result.stressedLines[i];
      if (!lsv) continue;
      const tail = lsv.rhymingTail;
      allRhymes.push({
        endWord: tail.stressedWord?.poetryWord.form ?? '',
        letter: globalLetters[i] ?? '-',
        rhymeType: null,
        matchedLine: result.rhymeGraph[i] !== null ? lineOffset + i + (result.rhymeGraph[i] as number) : null,
      });
    }
    lineOffset += result.rhymeGraph.length;
  }
  rhymeSchemeStr = rhymeSchemeStr.trim();

  // Generate stressed lines
  const stressedLines: string[] = [];
  for (const result of allResults) {
    for (const lsv of result.stressedLines) {
      const line = lsv.stressedWords.map(sw => {
        if (sw.newStressPos === -1) {
          return sw.poetryWord.form;
        }
        // Render with stress mark
        const output: string[] = [];
        let vc = 0;
        for (const c of sw.poetryWord.form) {
          output.push(c);
          if ('уеыаоэёяию'.includes(c.toLowerCase())) {
            vc++;
            if (vc === sw.newStressPos) output.push('\u0301');
            else if (sw.stressSignature[vc - 1] === 2) output.push('\u0300');
          }
        }
        return output.join('');
      }).join(' ');
      stressedLines.push(line);
    }
    stressedLines.push('');
  }

  // Fabb–Halle bracketed grid — a fully independent second opinion.  The
  // rule set is DISCOVERED by F&H's own poem-level procedure (try each rule
  // set of the parametric family over every line; the one under which the
  // lines construct well-formed grids with the maxima condition holding is
  // the poem's meter) — the aligner's verdict is never consulted.  Two
  // further independence requirements:
  //   (1) the syllables' `lex` comes from the DICTIONARY accentuation
  //       (lexStressPos), never from the alignment's chosen stress — the
  //       alignment may unstress words to fit the meter, and feeding that
  //       back in would make the "second opinion" circular (sole exception:
  //       lexically LICENSED homograph readings, disambiguated below);
  //   (2) monosyllabic function words are clitics with no lexical stress.
  // Maxima use the flanking-free Russian definition (Taranovsky's law):
  // any polysyllable primary stress must land on an ictus.
  let fabbHalleMeter: string | null = null;
  {
    // Homograph disambiguation lives in the shared effectiveLexStress helper
    // (module scope, also feeding the display-tier overlay): the tagger's
    // morphology pick is unreliable in inverted poetic word order, so among
    // lexicon-LICENSED readings only, the alignment's choice is admitted.
    const accData = getAccentsData();
    const allLines: RuLine[] = stanzas.flatMap(st => st.lines);
    const allFhSyls = allLines.map(line => {
      const fhSyls: { text: string; lex: number; poly: boolean }[] = [];
      for (const w of line.words) {
        const vowelSyls = w.syllables.filter(s => s.vowel);
        const poly = vowelSyls.length > 1;
        const cliticMono = !poly && CLITIC_UPOS.has(w.upos);
        const lexPos = effectiveLexStress(w, accData);
        let vi = 0;
        for (const syl of w.syllables) {
          if (!syl.vowel) continue; // consonant-only chunks project nothing
          vi++;
          let lex = 0;
          if (!cliticMono) {
            if (lexPos > 0 && vi === lexPos) lex = 2;
            else if (w.secondaryStress && w.secondaryStress[vi - 1] === 2) lex = 1;
          }
          fhSyls.push({ text: syl.text, lex, poly });
        }
      }
      return fhSyls;
    });
    const poem = buildFabbHalleGridsForPoem(allFhSyls, { maximaMode: 'polysyllabic' });
    if (poem) {
      fabbHalleMeter = poem.schema;
      const alignerMeter = METER_CANONIC[mainResult?.meter ?? 'free'] || 'free';
      const agrees = poem.schema === alignerMeter
        || (poem.schema === 'loose' && (alignerMeter === 'dolnik' || alignerMeter === 'free'));
      const note = agrees
        ? ` · poem-discovered by grid construction, agreeing with the aligner`
        : ` · poem-discovered by grid construction (the aligner read ${alignerMeter})`;
      allLines.forEach((line, i) => {
        const g = poem.grids[i];
        line.fabbHalle = g ? { ...g, ruleLabel: g.ruleLabel + note } : null;
      });
    } else {
      for (const line of allLines) line.fabbHalle = null;
    }
  }

  return {
    stanzas,
    meter,
    rhymeScheme: rhymeSchemeStr,
    rhymes: allRhymes,
    score: totalScore,
    stressedLines,
    fabbHalleMeter,
  };
}

/** Quick check: is this text Russian? */
export function isRussian(text: string): boolean {
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return cyrillic > latin && cyrillic > 0;
}
