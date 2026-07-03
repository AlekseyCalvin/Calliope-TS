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
