// calliope/deps.ts — canonical dependency normalisation for the Calliope engine.
//
// en-parse emits a hybrid Stanford/UD label set, partly unreliable.  This pass
// writes a normalised Scenario relation onto `word.canonicalRel`, the label space
// the Match-Theory prosodic builder (Stage 2) and the Scenario A–O stress rules
// (Stage 3) read.  It is ADDITIVE — it never mutates the raw `dependency`, so the
// legacy/Clio passes see exactly the same parse as before.
//
// Where en-parse is reliable the mapping is a straight relabel; where it is not —
// the ditransitive DOBJ/IOBJ swap (probed: "gave John a book" → John=dobj,
// book=iobj, reversed), or N+N compounds it labels generic `dep` — POS and surface
// adjacency decide.  (Head-changing repairs — coordinate re-heading, fronted
// adverbial re-root, invocations — are handled where the prosodic builder needs
// them, Stage 2.)

import { ClsSentence, ClsWord } from '../types.js';

const NOUN = /^(NN|NNS|NNP|NNPS)$/;
const PROPER = /^(NNP|NNPS)$/;
const VERB = /^VB/;
const ADJ = /^JJ/;

function rawRel(w: ClsWord): string {
  return (w.dependency?.dependentType ?? '').toLowerCase();
}
function gov(w: ClsWord): ClsWord | undefined {
  return w.dependency?.governor;
}
/** w immediately precedes its head (a pre-head modifier — the N+N / Adj+N frame). */
function preHead(w: ClsWord, head: ClsWord): boolean {
  return w.absoluteIndex + 1 === head.absoluteIndex;
}

/** Populate `canonicalRel` for every word, then apply label-only repairs. */
export function normalizeDeps(sent: ClsSentence): void {
  for (const w of sent.words) w.canonicalRel = canonical(w);
  fixDitransitive(sent.words);
  inferPrenominalModifiers(sent.words);
}

/** Reliable structural relations whose label adjacency must NOT override. */
const STRUCTURAL = new Set([
  'ROOT', 'NSUBJ', 'NSUBJPASS', 'DOBJ', 'IOBJ', 'OBL', 'AUX', 'AUXPASS',
  'CCOMP', 'XCOMP', 'ADVCL', 'ADVMOD', 'AMOD', 'ACL', 'CC', 'CONJ', 'EXPL',
  'INTJ', 'DISCOURSE', 'VPRT', 'COMPMARK', 'ADVMARK', 'EXT',
]);

/**
 * Pre-head modifier inference by SURFACE ADJACENCY — independent of en-parse's
 * (often unreliable) head links.  An attributive adjective immediately before a
 * noun is AMOD; a noun immediately before a noun is a NOMD noun adjunct (or EXT
 * for a proper+proper name span).  This is what lets a POS-corrected adjective
 * (Pale/High/Green, demoted from a spurious NNP by `correctPosWithLexicon`) read
 * as the AMOD it is, rather than collapsing to a bare `dep`.  Only fills a word
 * whose current label is non-structural, so deliberate relations are preserved.
 */
function inferPrenominalModifiers(words: ClsWord[]): void {
  for (let i = 0; i + 1 < words.length; i++) {
    const w = words[i];
    const h = words[i + 1];
    if (w.absoluteIndex + 1 !== h.absoluteIndex) continue;   // surface-adjacent
    if (!NOUN.test(h.lexicalClass)) continue;                 // head is a noun
    if (STRUCTURAL.has(w.canonicalRel ?? '')) continue;       // keep real relations
    if (ADJ.test(w.lexicalClass)) {
      w.canonicalRel = 'AMOD';
    } else if (NOUN.test(w.lexicalClass)) {
      w.canonicalRel = PROPER.test(w.lexicalClass) && PROPER.test(h.lexicalClass) ? 'EXT' : 'NOMD';
    }
  }
}

function canonical(w: ClsWord): string {
  const rel = rawRel(w);
  const pos = w.lexicalClass;
  const g = gov(w);
  const gpos = g?.lexicalClass ?? '';

  switch (rel) {
    case 'root': return 'ROOT';
    case 'nsubj': return 'NSUBJ';
    case 'nsubjpass': case 'nsubj:pass': return 'NSUBJPASS';
    case 'csubj': return 'NSUBJ';
    case 'csubjpass': case 'csubj:pass': return 'NSUBJPASS';
    case 'dobj': case 'obj': return 'DOBJ';
    case 'iobj': return 'IOBJ';
    case 'aux': return 'AUX';
    case 'auxpass': case 'aux:pass': return 'AUXPASS';
    // UD oblique nominal (UDPipe emits `obl`; the old path used Stanford `pobj`).
    case 'obl': case 'obl:npmod': case 'obl:tmod': case 'obl:arg': return 'OBL';
    case 'cop': return 'AUX';                 // copula behaves prosodically like an auxiliary
    case 'ccomp': return 'CCOMP';
    case 'xcomp': return 'XCOMP';
    case 'advcl': return 'ADVCL';
    case 'advmod': return 'ADVMOD';
    case 'amod': return 'AMOD';
    case 'acl': case 'relcl': case 'acl:relcl': return 'ACL';
    case 'det': case 'predet': return 'DET';
    case 'nummod': return 'NUMMOD';
    case 'cc': return 'CC';
    case 'conj': return 'CONJ';
    case 'expl': return 'EXPL';
    case 'intj': return 'INTJ';
    case 'discourse': return 'DISCOURSE';
    case 'prt': case 'compound:prt': return 'VPRT';
    case 'case': return 'CASE';
    case 'poss': case 'possessive': case 'nmod:poss': return 'CASE';
    case 'prep': return 'CASE';               // the preposition itself cliticises
    case 'pobj': return 'OBL';                // object of a preposition → oblique
    case 'mark': return markType(w);          // complementiser vs adverbial subordinator
    case 'nmod':
      if (NOUN.test(pos) && g && NOUN.test(gpos) && preHead(w, g)) return 'NOMD';
      return 'OBL';
    case 'compound':
      return 'NOMD';
    case 'flat': case 'flat:name': case 'name':
      return 'EXT';
  }

  // Generic `dep` / unknown: infer from POS + adjacency.
  if (NOUN.test(pos) && g && NOUN.test(gpos) && preHead(w, g)) {
    // A proper-name span (both proper, adjacent) reads as an EXT extension; a
    // common-noun pre-modifier is a NOMD noun adjunct.
    return PROPER.test(pos) && PROPER.test(gpos) ? 'EXT' : 'NOMD';
  }
  if (ADJ.test(pos) && g && NOUN.test(gpos)) return 'AMOD';
  if (pos === 'RP') return 'VPRT';
  if (pos === 'CC') return 'CC';
  if (pos === 'DT' || pos === 'PDT') return 'DET';
  if (pos === 'CD') return 'NUMMOD';
  if (pos === 'IN' || pos === 'TO') return 'CASE';
  return rel ? rel.toUpperCase() : 'DEP';
}

/** A `mark` heads a complement clause (COMPMARK: to/that) or an adverbial clause
 *  (ADVMARK: as/when/because).  Decide by the governed clause's own relation. */
function markType(w: ClsWord): string {
  const clauseVerb = gov(w);
  const crel = clauseVerb ? rawRel(clauseVerb) : '';
  return crel === 'advcl' ? 'ADVMARK' : 'COMPMARK';
}

/** Ditransitive correction: a verb governing two bare objects N1 (precedes) N2 is
 *  often labelled N1=DOBJ N2=IOBJ — reversed.  The first post-verbal object is the
 *  recipient (IOBJ), the second the theme (DOBJ). */
function fixDitransitive(words: ClsWord[]): void {
  const byGov = new Map<ClsWord, ClsWord[]>();
  for (const w of words) {
    if (w.canonicalRel !== 'DOBJ' && w.canonicalRel !== 'IOBJ') continue;
    const g = gov(w);
    if (!g || !VERB.test(g.lexicalClass)) continue;
    const list = byGov.get(g);
    if (list) list.push(w); else byGov.set(g, [w]);
  }
  for (const objs of byGov.values()) {
    if (objs.length !== 2) continue;
    objs.sort((a, b) => a.absoluteIndex - b.absoluteIndex);
    objs[0].canonicalRel = 'IOBJ';
    objs[1].canonicalRel = 'DOBJ';
  }
}
