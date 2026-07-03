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