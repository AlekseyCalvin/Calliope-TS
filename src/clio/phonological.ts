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