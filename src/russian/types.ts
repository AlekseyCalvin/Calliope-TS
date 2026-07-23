// types.ts — Russian-specific types for the scansion pipeline.

/** A token from the UDPipe parse, augmented with stress information. */
export interface RuToken {
  form: string;          // surface form
  lemma: string;         // lemma from UDPipe
  upos: string;          // UPOS tag (NOUN, VERB, ADJ, ...)
  feats: Record<string, string>;  // morphological features (Case, Gender, Number, ...)
  deprel: string;        // dependency relation
  head: number;          // head token id within the sentence (0 = root)
  id: number;            // this token's 1-based id within its sentence
  sent: number;          // sentence index within the parsed text
  isContent: boolean;    // content vs function word
}

/** Display tier for a syllable, in the same relative alphabet the English
 *  pipeline uses (`x < w < n < m < s`).  A LEXICAL overlay on the binary
 *  meter alignment: `s` = aligned (ictic) stress, `m` = secondary stress,
 *  `n` = lexically stressed but off the metrical beat (the alignment
 *  suppressed a dictionary stress), `w` = plain unstressed / weak full-vowel
 *  function monosyllable, `x` = monosyllabic clitic (ADP/PART/CCONJ/SCONJ/
 *  AUX/INTJ).  Purely presentational — computed after all technicality
 *  scoring, from fields the scorer already produced. */
export type RuTier = 'x' | 'w' | 'n' | 'm' | 's';

/** A syllable within a word, with stress information. */
export interface RuSyllable {
  text: string;          // the syllable text
  vowel: string;         // the vowel character
  vowelIndex: number;    // 1-based vowel index within the word
  stressed: boolean;     // is this the stressed syllable?
  secondaryStressed: boolean;  // secondary stress?
  /** Display tier (vowel-bearing syllables only; absent on consonant chunks). */
  tier?: RuTier;
}

/** A word with syllables and stress. */
export interface RuWord {
  form: string;          // surface form
  lemma: string;
  upos: string;
  feats: Record<string, string>;
  deprel: string;
  head: number;
  isContent: boolean;
  syllables: RuSyllable[];
  stressPos: number;       // 1-based vowel position of the METER-ALIGNED stress (-1 = none)
  /** 1-based vowel position of the DICTIONARY (lexical) stress, independent
   *  of the meter alignment — what the accentuator says in isolation.  This
   *  is what independent second opinions (Fabb–Halle) must read, never
   *  stressPos, which already embodies the main engine's verdict. */
  lexStressPos: number;
  secondaryStress: number[] | null;  // array of 0/2 per vowel
}

/** One dependency edge for a line, indices into RuLine.words (-1 = root). */
export interface RuDep {
  from: number;
  to: number;
  rel: string;
}

/** A parsed line with words and stress. */
import type { FabbHalleResult } from '../fabbhalle.js';

export interface RuLine {
  raw: string;           // original line text
  words: RuWord[];       // content words only (no punctuation)
  syllableCount: number;
  stressPattern: string; // 'S' for stressed, 'U' for unstressed, per syllable
  /** Per-vowel-syllable display tiers (x/w/n/m/s — see RuTier), same length
   *  as stressPattern.  A lexical overlay: unlike the binary stressPattern it
   *  keeps showing where dictionary stress lives even when the alignment
   *  suppressed it.  Display-only; technicality never reads it. */
  tierPattern: string;
  deps: RuDep[];         // dependency edges between words (punctuation excluded)
  fabbHalle?: FabbHalleResult | null;
}

/** A stanza of the poem. */
export interface RuStanza {
  lines: RuLine[];
}

/** Meter classification result. */
export interface RuMeterResult {
  meter: string;         // 'iambos', 'choreios', 'daktylos', 'amphibrachys', 'anapaistos',
                         // 'dolnik2', 'dolnik3', 'taktovik2', 'taktovik3', or 'free'
  meterRu: string;       // Russian name: 'ямб', 'хорей', 'дактиль', 'амфибрахий', 'анапест', ...
  score: number;         // technicality score 0-1
  footCount: number;     // number of feet
  scansion: string;      // pattern string like 'us|uS|uS|uS'
}

/** Rhyme scheme entry for a line. */
export interface RuRhymeEntry {
  endWord: string;
  letter: string;        // 'A', 'B', ..., or '-' (unrhymed)
  rhymeType: string | null;  // 'perfect', 'fuzzy', 'rich', etc.
  matchedLine: number | null;
}

/** Complete scansion result for a poem. */
export interface RuScansionResult {
  stanzas: RuStanza[];
  meter: RuMeterResult;
  rhymeScheme: string;
  rhymes: RuRhymeEntry[];
  score: number;
  stressedLines: string[];  // lines with stress marks (U+0301)
  /** The meter Fabb–Halle's own poem-level grid construction discovered
   *  ('iambic' … 'loose'), independent of the aligner's verdict. */
  fabbHalleMeter: string | null;
}

/** A content-word POS set for Russian (UPOS-based). */
export const CONTENT_UPOS = new Set([
  'NOUN', 'PROPN',
  'ADJ',
  'VERB', 'AUX',
  'ADV',
  'NUM',
  'DET',
]);

/** Punctuation UPOS tags. */
export const PUNCT_UPOS = new Set(['PUNCT', 'SYM', 'X']);

/** Russian vowel letters (lowercase). */
export const RU_VOWELS = 'аеёиоуыэюя';

/** Russian meter names mapping. */
export const METER_NAMES_RU: Record<string, string> = {
  'iambos': 'ямб',
  'choreios': 'хорей',
  'daktylos': 'дактиль',
  'amphibrachys': 'амфибрахий',
  'anapaistos': 'анапест',
  'dolnik2': 'дольник 2',
  'dolnik3': 'дольник 3',
  'taktovik2': 'тактовик 2',
  'taktovik3': 'тактовик 3',
  'free': 'вольный',
};
