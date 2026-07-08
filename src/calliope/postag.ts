// calliope/postag.ts — Calliope-only POS correction via en-lexicon.
//
// THE BUG THIS FIXES: en-pos tags a capitalised line-initial common word as a
// proper noun ("Pale rain" → Pale/NNP, "High tide" → High/NNP), purely from the
// capital.  That mis-tag flips content class, derails the dependency parse, and —
// once relation-keyed stress is reintroduced — fore-stresses an adjective.
//
// en-lexicon (a CORE FinNLP module, the POS dictionary that en-pos/en-parse are
// built on) carries the true multi-role reading keyed on the LOWERCASE form:
//   lexicon['pale'] = "JJ|VBP|NN|VB"      (adjective first)
//   lexicon['Pale'] = "NNP|RB"            (the capitalised key is the trap)
//   lexicon['high'] = "JJ|NN|RB|RP"
// so consulting the lowercase entry recovers the real word class.
//
// This runs as the FIRST Calliope step — NOT in the shared `tagfix.ts`, because
// that seam feeds BOTH engines and would un-freeze Clio.  It corrects the ClsWord
// POS in place (Calliope's own pre-pass); Clio, invoked via `--clio`, never calls
// it and so keeps its frozen reading.  (It does not re-run en-parse; the κ/ϕ/ι
// builder downstream is built to be robust to residual head-attachment errors,
// and `normalizeDeps` re-derives `canonicalRel` from the corrected POS.)
//
// Discipline (anti-gaming): the demotion is gated so it can ONLY fire where the
// capital is uninformative (sentence/line-initial) and the word is demonstrably a
// common word, never a known or sequenced proper name.

import { createRequire } from 'module';
import { ClsSentence, ClsWord } from '../types.js';

const req = createRequire(import.meta.url);

function loadLexicon(): Record<string, string> {
  try {
    const m = req('en-lexicon');
    return (m && (m.lexicon ?? m)) as Record<string, string>;
  } catch {
    return {};
  }
}
const LEXICON = loadLexicon();

const PRONOUN_SUBJECT_CONTRACTIONS_LOCAL = new Set([
  "i'm", "i'll", "i've", "i'd",
  "you're", "you'll", "you've", "you'd",
  "he'll", "he'd", "he's", "she'll", "she'd", "she's", "it'll",
  "we're", "we'll", "we've", "we'd",
  "they're", "they'll", "they've", "they'd",
]);

const PROPER = /^(NNP|NNPS)$/;
const PUNCT = /^[^A-Za-z0-9]+$/;
// Content POS, matching parser.ts CONTENT_POS (kept local to avoid a cycle).
const CONTENT = new Set([
  'NN', 'NNS', 'NNP', 'NNPS', 'JJ', 'JJR', 'JJS',
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ', 'RB', 'RBR', 'RBS', 'CD',
]);
// Demotion is restricted to the ATTRIBUTIVE/NOMINAL common classes — the exact
// mis-as-proper class (pale→JJ, slate→NN).  A lowercase-primary that is a finite
// VERB (rose→VBD) is genuinely ambiguous sentence-initially, so we leave NNP
// rather than risk a wrong verb tag wrecking the parse.
const DEMOTE_TARGET = /^(JJ|JJR|JJS|NN|NNS)$/;

function bareLower(w: ClsWord): string {
  return w.word.toLowerCase().replace(/[^a-z]/g, '');
}
function isPunctTag(tag: string): boolean {
  return PUNCT.test(tag) || tag === '-LRB-' || tag === '-RRB-';
}

/**
 * Demote spurious proper-noun tags to their true common reading via en-lexicon.
 * Mutates `word.lexicalClass` / `word.isContent` in place for the Calliope engine.
 */
export function correctPosWithLexicon(sent: ClsSentence): void {
  const words = sent.words;

  // Index of the first non-punctuation word — the one whose capital is forced by
  // sentence/line position and therefore carries no proper-noun evidence.
  let firstContentIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (!isPunctTag(words[i].lexicalClass)) { firstContentIdx = i; break; }
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!PROPER.test(w.lexicalClass)) continue;

    // (a) The lowercase lexicon PRIMARY reading must be an attributive/nominal
    //     common word.  This — not name-list membership — is the real signal: the
    //     huge humannames/cities-list flag almost every capitalised common word
    //     ("Pale", "Slate", "Green" are all in them), so membership cannot gate
    //     here.  Genuinely proper words are protected instead: their lowercase
    //     entry is either absent (london, york) or proper-primary (reagan → NNP).
    const entry = LEXICON[bareLower(w)];
    if (!entry) continue;
    const primary = entry.split('|')[0];
    if (!DEMOTE_TARGET.test(primary)) continue;

    // (b) Caps must be uninformative: the token is the sentence/line-initial word,
    //     and it is NOT part of a proper-name sequence (a neighbour tagged NNP).
    if (i !== firstContentIdx) continue;
    const prev = i > 0 ? words[i - 1] : undefined;
    const next = i + 1 < words.length ? words[i + 1] : undefined;
    const adjacentProper =
      (prev && PROPER.test(prev.lexicalClass)) || (next && PROPER.test(next.lexicalClass));
    if (adjacentProper) continue;

    w.lexicalClass = primary;
    w.isContent = CONTENT.has(primary);
  }
}

// ─── UDPipe XPOS correction (the role en-pos + tagfix.ts played pre-UD) ──────
//
// UDPipe is trained on running prose and systematically MIS-TAGS terse,
// decontextualised verse fragments — it has no sentence context to lean on.
// Observed on the test corpus: "hat"→WP, "Woolen"→NNS, "gray"→VBP, "constantly"
// →NN, "slate"/"clay"→JJ, "bicycle"→NN.  The faithful downstream then scans the
// garbage.  en-pos avoided this because it is lexicon-backed; we restore that by
// cross-checking UDPipe's XPOS against en-lexicon's multi-role reading (AGENTS.md:
// "nounsing-pro / lexicon POS to aid FinNLP… cross-check").  HIGH PRECISION — it
// only overrides a tag the lexicon positively contradicts; an unknown word keeps
// UDPipe's tag.

/** Coarse word-class of a Penn tag (N/V/J/R), else the exact tag. */
function coarseClass(tag: string): string {
  if (/^(NN|NNS|NNP|NNPS)$/.test(tag)) return 'N';
  if (/^VB/.test(tag)) return 'V';
  if (/^JJ/.test(tag)) return 'J';
  if (/^RB/.test(tag)) return 'R';
  return tag;
}
const NOUN_TAG = /^(NN|NNS|NNP|NNPS)$/;

function retag(w: ClsWord, tag: string): void {
  w.lexicalClass = tag;
  w.isContent = CONTENT.has(tag);
  w.lexicalPlural = tag === 'NNS' || tag === 'NNPS';
}

/** Is the immediately-preceding non-punctuation word a subject pronoun? */
function prevIsSubjectPronoun(words: ClsWord[], i: number): boolean {
  for (let k = i - 1; k >= 0; k--) {
    if (isPunctTag(words[k].lexicalClass)) continue;
    const rel = (words[k].dependency?.dependentType ?? '').toLowerCase();
    return words[k].lexicalClass === 'PRP' && /nsubj/.test(rel);
  }
  return false;
}

/** Next non-punctuation word, or undefined. */
function nextContentful(words: ClsWord[], i: number): ClsWord | undefined {
  for (let k = i + 1; k < words.length; k++) {
    if (!isPunctTag(words[k].lexicalClass)) return words[k];
  }
  return undefined;
}

export function correctUDPipePos(sent: ClsSentence): void {
  const words = sent.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (isPunctTag(w.lexicalClass)) continue;

    // (0) CONTRACTED SUBJECT PRONOUNS: UDPipe/FinNLP often mis-tags
    //     "I'll", "I've", "I'd", "I'm" as JJ, NNP, or other content classes,
    //     giving them a spurious content beat. Correct them to PRP (personal
    //     pronoun) so they floor to 'w' or 'n' like other pronouns.
    const lowerWord = w.word.toLowerCase().replace(/[’]/g, "'");
    if (PRONOUN_SUBJECT_CONTRACTIONS_LOCAL.has(lowerWord)) {
      retag(w, 'PRP');
      continue;
    }

    // (0) POSSESSIVE clitic mis-tagged as a verb: UDPipe tags the genitive "'s"
    //     in "laugher's licence" as VBZ (confusing it with the copula "he's" = he
    //     is), giving the clitic a spurious content beat.  The genitive 's carries
    //     a `case` relation onto its possessor noun; the copula does not — so that
    //     relation distinguishes them.  Retag POS (0 syllables downstream).
    // (0) POSSESSIVE clitic mis-tagged as a verb: UDPipe sometimes tags the
    //     genitive "'s" (in "laugher's licence") as VBZ — confusing it with the
    //     copula "he's" = he is — giving the clitic a spurious content beat.  The
    //     genitive 's carries a `case` relation onto its possessor noun; the copula
    //     does not — so that relation distinguishes them.  Retag POS.
    if ((w.word === "'s" || w.word === "’s") && /^VB/.test(w.lexicalClass)
        && (w.dependency?.dependentType ?? '').toLowerCase() === 'case') {
      retag(w, 'POS');
      continue;
    }
    // The possessive ending itself is never corrected by the lexicon pass below
    // (en-lexicon has a spurious verb entry for the bare letter "s").
    if (w.lexicalClass === 'POS') continue;

    const lemma = bareLower(w);
    if (lemma.length <= 1) continue;                        // "s"/"a"/"o" → too ambiguous
    const entry = LEXICON[lemma];
    if (!entry) continue;                                   // unknown → trust UDPipe
    const classes = entry.split('|');
    const primary = classes[0];
    const lexCoarse = new Set(classes.map(coarseClass));
    const udCoarse = coarseClass(w.lexicalClass);
    const CONTENT_COARSE = new Set(['N', 'V', 'J', 'R']);

    // (1) PLAUSIBILITY: UDPipe's coarse class is absent from the lexicon entirely
    //     (hat→WP, Woolen→NNS, constantly→NN, clay→JJ) → fall back to the lexicon's
    //     primary reading.  Only fires on a positive contradiction AND only when the
    //     correction is TOWARD a content class (never invents a function tag).
    if (!lexCoarse.has(udCoarse) && CONTENT_COARSE.has(coarseClass(primary))
        && coarseClass(primary) !== udCoarse) {
      retag(w, primary);
      continue;
    }

    // (2) ATTRIBUTIVE NOUN mis-tagged JJ: a lexicon-primary noun UDPipe tagged JJ,
    //     sitting immediately before a noun, is the modifier of an N+N compound
    //     ("SLATE roof", "CLAY jar"), not an adjective.  Retag NN so the compound
    //     fore-stresses (deps.ts NOMD).
    if (/^JJ/.test(w.lexicalClass) && coarseClass(primary) === 'N') {
      const nxt = nextContentful(words, i);
      if (nxt && NOUN_TAG.test(nxt.lexicalClass) && nxt.absoluteIndex === w.absoluteIndex + 1) {
        retag(w, 'NN');
        continue;
      }
    }

    // (3) NOUN that should be a finite VERB: a lexicon-verb-capable common noun
    //     UDPipe tagged NN, immediately preceded by a SUBJECT PRONOUN ("they
    //     BICYCLE through", "we PAPER walls"), is the clause's predicate → VBP.
    if (NOUN_TAG.test(w.lexicalClass) && lexCoarse.has('V') && prevIsSubjectPronoun(words, i)) {
      retag(w, 'VBP');
      continue;
    }

    // (4) TEMPORAL ADVERB mis-tagged IN: "before"/"after"/"since"/"once" tagged IN
    //     but with no nominal complement before the next clause boundary is an
    //     adverb (RB), not a preposition.  Penn treebank: IN takes an NP
    //     complement ("before the storm"); RB does not ("never before", "long
    //     after").  A following verb/pronoun signals a subordinate clause ("before
    //     I go") → leave as IN (subordinating conjunction sense).
    const TEMPORAL_ADVS = new Set(['before', 'after', 'since', 'once']);
    if (w.lexicalClass === 'IN' && TEMPORAL_ADVS.has(lemma)) {
      let hasNoun = false, hasClauseStart = false;
      for (let k = i + 1; k < words.length; k++) {
        if (isPunctTag(words[k].lexicalClass)) break;
        if (NOUN_TAG.test(words[k].lexicalClass)) { hasNoun = true; break; }
        if (/^(VB|VBP|VBD|VBG|VBN|VBZ|PRP)$/.test(words[k].lexicalClass)) hasClauseStart = true;
      }
      if (!hasNoun && !hasClauseStart) {
        retag(w, 'RB');
        continue;
      }
    }
  }
}
