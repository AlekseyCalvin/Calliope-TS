// calliope/prosodic.ts — the Match-Theory prosodic hierarchy for Calliope.
//
// Builds the κ (clitic group) / ϕ (phonological phrase) / ι (intonational unit)
// structure from the canonical dependency relations and the REAL utterance
// boundaries — replacing the legacy builder (phonological.ts), which split an IU
// at every comma and grouped phrases off the constituent tree.  The corrections,
// per McAleese A1/A2 and the maintainer's critique:
//
//   ι  only at genuine intonational breaks: terminal punctuation (. ? !), colon,
//      semicolon, and parentheticals.  A plain COMMA is NOT an ι — it is a minor
//      ϕ break.  (This is the "utterance boundaries, not line breaks / not every
//      comma" fix.)
//   ϕ  at: a comma; the head of an oblique PP (a preposition opens a new phrase —
//      "…compare thee | to a summer's day"); each coordinate conjunct; a clause
//      complement (CCOMP/XCOMP/ADVCL); and the junction between a full nominal
//      SUBJECT and its predicate verb.
//   κ  a content head plus its function words by DIRECTION: determiners, case
//      markers/prepositions, auxiliaries, coordinators, complementisers, numerals,
//      possessives and (sub/obj) pronouns procliticise rightward onto the following
//      head; the possessive 's and verb particles encliticise leftward.  A trailing
//      proclitic with no head to its right attaches to the preceding group (so
//      "…compare thee" keeps the object pronoun in the verb's group).
//
// Output is the shared IntonationalUnit[] shape, so display/scansion are unchanged.
// It reads only POS + canonicalRel + surface order; it never mutates the parse.

import {
  ClsSentence, ClsWord, CliticGroup, PhonologicalPhrase, IntonationalUnit,
} from '../types.js';
import { computePhiDomains } from './bracketing.js';

// ─── punctuation → break kind ──────────────────────────────────────
const IU_PUNCT_TAGS = new Set(['.', '!', '?', ':', ';', '-LRB-', '-RRB-', '(', ')']);
const IU_PUNCT_WORDS = new Set(['.', '!', '?', '…', ':', ';', '(', ')']);

type BreakKind = 'iu' | 'phi' | null;
function breakKind(w: ClsWord): BreakKind {
  if (IU_PUNCT_TAGS.has(w.lexicalClass) || IU_PUNCT_WORDS.has(w.word)) return 'iu';
  if (w.lexicalClass === ',' || w.word === ',') return 'phi';
  return null; // other punctuation (quotes, etc.) — transparent to phrasing
}
function isAnyPunct(w: ClsWord): boolean {
  return /^[^A-Za-z0-9]+$/.test(w.lexicalClass) ||
    w.lexicalClass === '-LRB-' || w.lexicalClass === '-RRB-';
}

// ─── κ: directional cliticisation ──────────────────────────────────
const PROCLITIC_REL = new Set([
  'DET', 'CASE', 'AUX', 'AUXPASS', 'CC', 'COMPMARK', 'ADVMARK', 'NUMMOD', 'EXPL',
]);
const PROCLITIC_POS = /^(DT|PDT|IN|TO|CC|MD|WDT|WP|WP\$|EX|PRP\$|PRP)$/;

const OBJECT_REL = new Set(['DOBJ', 'IOBJ', 'OBL', 'OBJ']);

/** A clitic that leans LEFTWARD onto the preceding head (possessive 's, particle,
 *  OBJECT pronoun).  An object pronoun encliticises to its verb ("compare thee",
 *  "give me") — so it must NOT be pulled rightward into the next phrase, which is
 *  what buried the preposition in "…compare thee | to a summer's day". */
function isEnclitic(w: ClsWord): boolean {
  if (w.lexicalClass === 'POS' || w.lexicalClass === 'RP' || w.canonicalRel === 'VPRT') return true;
  if (w.lexicalClass === 'PRP' && OBJECT_REL.has(w.canonicalRel ?? '')) return true;
  return false;
}
/** A function word that leans RIGHTWARD onto the following content head. */
function isProclitic(w: ClsWord): boolean {
  if (w.isContent) return false;             // a promoted particle/demonstrative is a head
  if (isEnclitic(w)) return false;
  if (PROCLITIC_REL.has(w.canonicalRel ?? '')) return true;
  return PROCLITIC_POS.test(w.lexicalClass);
}

/** Build clitic groups over one IU segment's content/function words (no punct). */
function buildCliticGroups(words: ClsWord[]): CliticGroup[] {
  const groups: CliticGroup[] = [];
  let pending: ClsWord[] = [];               // proclitics awaiting their head
  for (const w of words) {
    if (isEnclitic(w) && groups.length > 0 && pending.length === 0) {
      groups[groups.length - 1].tokens.push(w);
      continue;
    }
    if (isProclitic(w)) { pending.push(w); continue; }
    // content head (or any non-clitic): open a CP with its pending proclitics.
    groups.push({ tokens: [...pending, w] });
    pending = [];
  }
  if (pending.length) {
    if (groups.length) groups[groups.length - 1].tokens.push(...pending);
    else groups.push({ tokens: pending });
  }
  return groups;
}

// ─── ϕ: phrase grouping (by dependency ϕ-domain) ───────────────────
// A ϕ boundary opens between two clitic groups when they fall in DIFFERENT
// ϕ-domains of the dependency tree (computePhiDomains, bracketing.ts) — the
// SAME constituent structure the cyclic stress rules use — replacing the old
// POS-keyed opensPhrase heuristic.  So a stranded particle no longer opens a
// spurious oblique ϕ ("thought of" stays together), a branching object NP gets
// its own ϕ (reading | the latest biography), and a clause does not flatten
// when its head is mis-tagged (the relations, not the POS, decide).

function rightmostContent(cg: CliticGroup): ClsWord | undefined {
  for (let i = cg.tokens.length - 1; i >= 0; i--) if (cg.tokens[i].isContent) return cg.tokens[i];
  return cg.tokens[cg.tokens.length - 1];
}

/** The ϕ-domain id a clitic group sits in: the domain of its head (rightmost
 *  content word, else last token); a function-only group falls back to any of
 *  its tokens' domains (its proclitics share the domain of the head they lean
 *  onto).  A new ϕ opens whenever this id changes between adjacent groups. */
function domainOf(cg: CliticGroup, dom: Map<ClsWord, number>): number {
  const head = rightmostContent(cg) ?? cg.tokens[cg.tokens.length - 1];
  const d = dom.get(head);
  if (d !== undefined) return d;
  for (const t of cg.tokens) { const dd = dom.get(t); if (dd !== undefined) return dd; }
  return -1;
}

/** Two PARSE-ROBUST ϕ-boundary markers from McAleese's Table-1 that the
 *  dependency-domain core cannot see when en-parse mis-attaches:
 *
 *   • a COORDINATOR (CC "and / or / but") — each coordinate conjunct is its own
 *     ϕ; en-parse often flattens "old and gray and full" into a list of AMODs,
 *     so the conj relation is gone, but the CC token survives reliably.
 *   • a RELATIVE PRONOUN (WDT/WP "that / which / who") — it opens the relative
 *     clause's ϕ; en-parse routinely fails to build the ACL ("…the cat that
 *     caught the rat" flattened into one clause), but the relativiser is tagged.
 *
 *  These are the two Table-1 triggers that survive attachment errors, so they
 *  supplement the dependency domains rather than re-introducing POS guesswork. */
function startsCoordOrRelative(cg: CliticGroup): boolean {
  const t = cg.tokens[0];
  if (!t) return false;
  if (t.lexicalClass === 'CC' || t.canonicalRel === 'CC') return true;
  return /^(WDT|WP|WP\$)$/.test(t.lexicalClass);
}

// A φ needs a stress-bearing ANCHOR to stand on its own.  A content word is the
// usual one, but the 'n'-tier function words — demonstratives, quantifiers, and
// wh-words (relstress.functionLevel → 'n') — also carry a real beat, so a phrase
// built around one ("for THAT", "to EACH", "by WHICH") is a genuine φ with a
// nuclear and must NOT be dissolved into a neighbour the way a pure article /
// preposition / pronoun run ("around it") is.  (Lemma/POS list mirrors relstress'
// 'n' category; kept local so the hierarchy layer does not depend on the stress one.)
const ANCHOR_LEMMAS = new Set([
  'this', 'that', 'these', 'those',
  'all', 'both', 'each', 'every', 'some', 'any', 'many', 'much', 'few', 'most',
  'half', 'several', 'either', 'neither', 'enough', 'none',
]);
const ANCHOR_POS = /^(PDT|WDT|WP|WP\$|WRB)$/;
function canAnchorBeat(pp: PhonologicalPhrase): boolean {
  return pp.cliticGroups.some(cg => cg.tokens.some(t =>
    t.isContent ||
    /^VB/.test(t.lexicalClass) ||        // a verb group ("has been") is a real ϕ even
                                          // when its tokens are non-content auxiliaries —
                                          // it must not fold back into the subject NP
    ANCHOR_LEMMAS.has(t.word.toLowerCase().replace(/['’]/g, '')) ||
    ANCHOR_POS.test(t.lexicalClass)));
}

function groupIntoPhrases(
  cgs: CliticGroup[], commaBeforeCG: Set<CliticGroup>, dom: Map<ClsWord, number>
): PhonologicalPhrase[] {
  const phrases: { cgs: CliticGroup[]; commaPreceded: boolean }[] = [];
  let current: CliticGroup[] = [];
  let prev: CliticGroup | null = null;
  let currentCommaPreceded = false;
  for (const cg of cgs) {
    const brk = current.length > 0 && prev !== null &&
      (commaBeforeCG.has(cg) || startsCoordOrRelative(cg) ||
       domainOf(cg, dom) !== domainOf(prev, dom));
    if (brk) {
      phrases.push({ cgs: current, commaPreceded: currentCommaPreceded });
      current = [];
      currentCommaPreceded = commaBeforeCG.has(cg);
    }
    current.push(cg);
    prev = cg;
  }
  if (current.length) phrases.push({ cgs: current, commaPreceded: currentCommaPreceded });

  // A ϕ must have a beat-anchor: a phrase of only un-anchored function words (a
  // stranded preposition + pronoun like "around it", an orphan determiner) has no
  // nuclear to carry a beat, so it MERGES into its neighbour — into the previous
  // phrase when there is one (it leans back onto the head it modifies), else the
  // next.  A phrase anchored by a demonstrative/quantifier/wh ("for THAT") is NOT
  // merged — it is a genuine φ.
  //
  // BUT: a phrase preceded by a COMMA is NEVER merged, even if it lacks a
  // beat-anchor.  A comma is an OVERT prosodic boundary the poet placed; merging
  // across it destroys the boundary and flattens the post-comma material into the
  // pre-comma phrase ("among them" after "And of the best," → xww instead of xnw).
  // A function-word-only post-comma phrase keeps its separate ϕ so the
  // relativiser can apply the phrase-initial beat and the givenness escape.
  const merged: PhonologicalPhrase[] = [];
  for (const p of phrases) {
    const pp: PhonologicalPhrase = { cliticGroups: p.cgs };
    if (!canAnchorBeat(pp) && merged.length > 0 && !p.commaPreceded) {
      merged[merged.length - 1].cliticGroups.push(...p.cgs);
    } else {
      merged.push(pp);
    }
  }
  // A leading un-anchored phrase folds forward into the next — but NOT if it was
  // comma-preceded (a comma before the first phrase would be line-initial, which
  // doesn't happen; this guard is for safety).
  if (merged.length >= 2 && !canAnchorBeat(merged[0]) && !phrases[0].commaPreceded) {
    merged[1].cliticGroups.unshift(...merged[0].cliticGroups);
    merged.shift();
  }
  return merged;
}

// ─── top level ─────────────────────────────────────────────────────
export function buildProsodicHierarchy(sent: ClsSentence): IntonationalUnit[] {
  // ϕ-domains over the dependency tree (the same constituent structure the
  // cyclic stress rules use) — the grouping signal for phonological phrases.
  const dom = computePhiDomains(sent);

  const ius: IntonationalUnit[] = [];
  let segWords: ClsWord[] = [];
  let commaAfterPos = new Set<number>();      // positions in segWords with a comma after

  const flush = () => {
    if (segWords.length === 0) { commaAfterPos = new Set(); return; }
    // A φ-break (comma) is a HARD boundary for clitic-group formation: a proclitic
    // must not lean across a comma onto a head in the next phrase.  (Letting it do
    // so silently glued "for that ," onto the following "a specialized branch" — both
    // "for" and "that" procliticise rightward onto "specialized" — so the comma fell
    // INSIDE one clitic group and the φ-break was lost.)  So we split the IU segment
    // into RUNS at the comma positions, build clitic groups WITHIN each run, and mark
    // the first CG of every run after the first as φ-preceded.
    const runs: ClsWord[][] = [];
    let run: ClsWord[] = [];
    segWords.forEach((w, i) => {
      run.push(w);
      if (commaAfterPos.has(i)) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);

    const cgs: CliticGroup[] = [];
    const commaBeforeCG = new Set<CliticGroup>();
    runs.forEach((r, ri) => {
      const rcgs = buildCliticGroups(r);
      if (ri > 0 && rcgs.length > 0) commaBeforeCG.add(rcgs[0]);
      cgs.push(...rcgs);
    });
    ius.push({ phonologicalPhrases: groupIntoPhrases(cgs, commaBeforeCG, dom) });
    segWords = [];
    commaAfterPos = new Set();
  };

  for (const w of sent.words) {
    const kind = breakKind(w);
    if (kind === 'iu') { flush(); continue; }
    if (kind === 'phi') { if (segWords.length) commaAfterPos.add(segWords.length - 1); continue; }
    if (isAnyPunct(w)) continue;              // transparent punctuation
    segWords.push(w);
  }
  flush();
  return ius;
}
