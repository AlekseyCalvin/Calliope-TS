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
