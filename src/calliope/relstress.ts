// calliope/relstress.ts — per-phonological-phrase relative stress for Calliope.
//
// This is the corrected relativisation McAleese A2 step 1b prescribes —
// "determine the relative stresses in EACH PP (w / n / m / s)" — and the direct
// answer to the maintainer's critique of the old pipeline (everything defaulting
// high, per-word boosts stacking linearly into adjacent reds, function words
// flattened into long w-runs).
//
// Principles:
//   • Default is LOW.  Each word's prominence is RAISED only with motivation.
//   • Within a PP there is ONE nuclear peak (s) — the φ's MOST PROMINENT word per the
//     genuine phrase stress (lowest `phraseStress`, the Compound + Nuclear Stress
//     Rules computed in bracketing.ts).  Other content words are subordinate (m); the
//     rest ramp DOWN — nothing is boosted past the peak.
//   • FUNCTION words take a category gradient, never a flat run:
//        preposition / article / coordinator / complementiser  → x  (zero-provision)
//        possessive / personal pronoun / auxiliary / modal      → w  (overt weak)
//        quantifier / demonstrative / wh-word / negator          → n  (some stress)
//     so "of all my days" reads x · n · w · s  (of < my < all < days).
//   • Compound fore-stress (SLATE roof, ICE cream) needs NO special case here: the
//     Compound Stress Rule already gave the compound's LEFT element the lower
//     phraseStress, so it wins the φ nuclear automatically.
//   • The clash invariant is preserved: no two adjacent syllables share n / m / s
//     (w and x may repeat); the less-prominent of a clashing pair is demoted.
//
// This stage DERIVES the symbolic contour FROM the integer phrase stress, per φ — but
// the two remain SEPARATE material signals: the integer ranking is global (one
// utterance nuclear), the symbolic contour is local (one beat per φ) and then
// modified (clash resolution), so they legitimately diverge — never forced equal.

import { ClsWord, IntonationalUnit, StressLevel, Syllable } from '../types.js';
import { collectPPTokens } from '../phonological.js';
import { isTransitiveFunctionWord, isPronoun, isInherentlyGiven } from './syntax.js';

const RANK: Record<StressLevel, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const LEVELS: StressLevel[] = ['x', 'w', 'n', 'm', 's'];

const CONTENT = /^(NN|NNS|NNP|NNPS|JJ|JJR|JJS|VB|VBD|VBG|VBN|VBP|VBZ|RB|RBR|RBS|CD|UH)$/;

const ARTICLES = new Set(['a', 'an', 'the']);
const QUANTIFIERS = new Set([
  'all', 'both', 'each', 'every', 'some', 'any', 'many', 'much', 'few', 'no',
  'most', 'half', 'several', 'either', 'neither', 'enough',
]);
const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those']);
// "no" is a NEGATOR, not a reducible determiner: "made with NO loss of time" keeps
// a beat on "no".  Listed here (ahead of the rel==='DET' → x floor in functionLevel)
// so the negative determiner is never flattened to the clitic tier.
const NEGATORS = new Set(['not', 'never', "n't", 'nor', 'no']);
// "be" reduces in the contour even as a copula ("the sky is BLUE").  "have"/"do"
// reduce only as AUXILIARIES — as main verbs ("the woods HAVE it", "DO your
// work") they are full content, so they are gated on the AUX relation below.
const BE_FORMS = new Set(['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being']);
// Aphaeresis clitics: "'tis"/"'twas" = it+is / it+was, weak pronoun+copula clipped
// to a single proclitic syllable — never a stressed content peak (en-pos mis-tags
// the capitalised "'Tis" as NNP).  Apostrophes already stripped by bare().
const APHAERESIS = new Set(['tis', 'twas', 'twere', 'twill', 'twould', 'tisnt']);

function bare(w: ClsWord): string {
  return w.word.toLowerCase().replace(/['’]/g, '');
}
function isAphaeresis(w: ClsWord): boolean { return APHAERESIS.has(bare(w)); }
function isContent(w: ClsWord): boolean {
  return CONTENT.test(w.lexicalClass) && !isAphaeresis(w);
}
function isReducedVerb(w: ClsWord, words?: ClsWord[]): boolean {
  if (isAphaeresis(w)) return true;
  const rel = w.canonicalRel ?? '';
  // "to be" (infinitive main verb) and ROOT be-forms ("Where WAS I?",
  // "I have BEEN") carry a beat — NOT reduced.  Must check BEFORE the AUX
  // gate because UD maps cop→AUX, so "to be" has canonicalRel='AUX'.
  if (BE_FORMS.has(bare(w)) && /^(VB|VBD|VBG|VBN|VBP|VBZ)$/.test(w.lexicalClass)) {
    if (words) {
      const prev = words
        .filter(x => x.syllables.length > 0 && x.absoluteIndex < w.absoluteIndex)
        .sort((a, b) => b.absoluteIndex - a.absoluteIndex)[0];
      if (prev && (prev.canonicalRel === 'COMPMARK' || prev.lexicalClass === 'TO'))
        return false;
    }
    if (rel === 'ROOT') return false;
  }
  if (rel === 'AUX' || rel === 'AUXPASS') return true;   // true auxiliary reduces
  // copular "be" after a function word with a predicate reduces; "have"/"do" as
  // MAIN verbs do not
  return BE_FORMS.has(bare(w)) && /^(VB|VBD|VBG|VBN|VBP|VBZ)$/.test(w.lexicalClass);
}

/** Intrinsic prominence of a FUNCTION word — the category gradient.  `words` (the
 *  whole line) lets the transitivity test (Wagner §6.5.5) see a preposition's
 *  complement: only a COMPLEMENT-TAKING (transitive) preposition has the reduced
 *  'x' allomorph; a STRANDED or adverbial-particle preposition keeps a beat. */
function functionLevel(w: ClsWord, words: ClsWord[]): StressLevel {
  const lemma = bare(w);
  const pos = w.lexicalClass;
  const rel = w.canonicalRel ?? '';
  // A quantifier / demonstrative in an ATTRIBUTIVE determiner slot ("each street",
  // "this cat", "that day") is a reduced determiner (x), NOT a standalone n-tier
  // quantifier.  Only the determiner USE reduces — a predeterminer ("ALL the",
  // PDT/det:predet) and a standalone quantifier/demonstrative ("EACH of them",
  // "THIS is…", rel ≠ det) keep their 'n'.  This is what lets a ϕ-initial
  // preposition's beat ("through", "in") outrank an interior "each".
  if (rel === 'DET' && pos !== 'PDT' && !NEGATORS.has(lemma)) return 'x';
  // n — quantifiers, demonstratives, wh-words, negators (carry real stress)
  if (pos === 'PDT' || QUANTIFIERS.has(lemma) || DEMONSTRATIVES.has(lemma) ||
      NEGATORS.has(lemma) || /^(WDT|WP|WP\$|WRB)$/.test(pos)) return 'n';
  // "out of" is a compound preposition with fixed stress on "out" (OUT of, not
  // out OF).  "out" carries the directional content; "of" is the grammatical
  // linker that floors to 'x'.  Raise "out" to 'n' so it outranks a preceding
  // unstressed syllable (the "-ter" of "laughter") and differentiates the contour
  // ("laughter OUT of" → s w n x, not flat s w w x).  Only fires when "of"
  // immediately follows — a stranded/particle "out" ("coming OUT") is handled by
  // the transitivity check below and keeps its own beat.
  if (lemma === 'out') {
    const next = words.find(x => x.absoluteIndex === w.absoluteIndex + 1);
    if (next && bare(next) === 'of') return 'n';
  }
  // A STRANDED / intransitive preposition ("what are you waiting FOR", "she walked
  // IN") is NOT the reducible proclitic of "in the house" — Wagner §6.5.5: only
  // transitive functors have the weak allomorph.  It keeps an overt beat ('w'), so
  // the metrical fitter can promote it; a TRANSITIVE preposition floors at 'x'.
  if (pos === 'IN' || pos === 'TO' || rel === 'CASE') {
    return isTransitiveFunctionWord(w, words) ? 'x' : 'w';
  }
  // x — pure clitics: articles, coordinators, complementisers
  if (ARTICLES.has(lemma) || pos === 'CC' || rel === 'CC' || rel === 'COMPMARK') return 'x';
  // w — possessives, pronouns, auxiliaries, modals, leftover determiners
  return 'w';
}

/** The peak (highest lexical-stress) syllable of a word. */
function peakSyllable(w: ClsWord): Syllable | null {
  let best: Syllable | null = null;
  let bestV = -1;
  for (const s of w.syllables) {
    const v = s.lexicalStress ?? s.stress;
    if (v > bestV) { bestV = v; best = s; }
  }
  return best;
}

/** Paint every syllable of a word given the level assigned to its peak.
 *
 *  The within-word contour preserves the LEXICAL gradient primary > secondary >
 *  unstressed (Nounsing's CMU stress → lexicalStress 2 = primary, 1 = secondary,
 *  0 = unstressed).  Crucially a SECONDARY stress is a REAL stress and must land
 *  STRICTLY ABOVE this word's own unstressed floor — never collapsed flat onto it.
 *  Hayes' stress-maximum theory: a polysyllable's internal contour (which syllables
 *  bear primary, secondary, or no stress) is a fixed lexical fact, not a position to
 *  be overwritten — "ac·CEL·er·AT·ed" must keep its EY2 secondary distinct from the
 *  truly toneless syllables around it, in a non-nuclear word (peak = m) exactly as
 *  much as in a nuclear one.
 *  peak → level; a co-primary (another lexicalStress-2 syllable) sits just below the
 *  peak; a secondary (lexicalStress 1) sits ONE TIER ABOVE this word's floor — 'n' if
 *  the floor is 'w' (a content word: ti in for·TI·tude is 'w', so tude's secondary
 *  clears it at 'n'), or 'w' if the floor is 'x' (a reduced function word: der in
 *  UNDER·neath is 'x', so un's secondary clears it at 'w', not flattened to 'x') —
 *  capped below the peak and at 'n' (the canonical non-peak ceiling); unstressed
 *  syllables sit AT the floor. */
function paintWord(w: ClsWord, level: StressLevel): void {
  const peak = peakSyllable(w);
  const peakRank = RANK[level];
  const floorRank = w.isContent ? RANK.w : RANK.x;   // unstressed floor for this word
  for (const s of w.syllables) {
    if (s === peak) { s.relativeStress = level; continue; }
    const lv = s.lexicalStress ?? s.stress;
    let r: number;
    if (lv >= 2) {
      r = peakRank - 1;                              // co-primary: just below the peak
    } else if (lv === 1) {
      // SECONDARY stress → one tier ABOVE this word's floor (never flattened onto
      // it), never reaching the peak, never exceeding 'n'.
      r = Math.min(floorRank + 1, peakRank - 1, RANK.n);
    } else {
      r = Math.min(floorRank, peakRank);             // unstressed (≤ peak for reduced words)
    }
    s.relativeStress = LEVELS[Math.max(0, Math.min(r, peakRank))];
  }
}

/** Relativise one phonological phrase by READING the genuine phrase stress.
 *
 *  The cyclic Compound + Nuclear Stress Rules (bracketing.ts) already ranked every
 *  word with an integer (1 = strongest).  Within a φ:
 *    • the lowest-ranked content word is the NUCLEAR (s) — and because the Compound
 *      Stress Rule fore-stressed a compound's LEFT element (lower integer), the
 *      compound peak falls out here for free (SLATE roof, ICE cream);
 *    • every other content word is a SECONDARY BEAT (m) — kept flat, NOT ramped to a
 *      trough, so the alternating beats that metrical verse needs stay visible (a
 *      ramp here flattened Hiawatha's "shores"/"Gitche" into non-beats → mis-meter);
 *    • the FINE gradient the maintainer asked for (ICE > cream, not a flat tie) is
 *      produced where content ABUTS, by clash resolution that breaks the tie with the
 *      phrase-stress integer — the less-prominent (higher-integer) member of two
 *      adjacent beats is the one demoted (so ICE ps2 keeps the beat, cream ps3 drops).
 *
 *  Two anchored beats per φ, per Kiparsky's "beginnings free, endings strict"
 *  (McAleese pp.34–35, Hayes & Kaun 1996 — the procedure reads the stresses at the
 *  END of each unit, but the LEFT edge carries a lighter beat too):
 *    • ENDING (strict): the rightmost lowest-ranked content word → the nuclear s.
 *    • BEGINNING (free, light): a φ-initial PREPOSITION rises x→w — the subtle
 *      left-edge beat the maintainer hears on "…working | IN the house" and that lets
 *      "…through | each…" read through(w) > each(x).  Articles, pronouns, auxiliaries
 *      and coordinators do not rise. */
function relativisePP(toks: ClsWord[], words: ClsWord[]): void {
  if (toks.length === 0) return;
  // A DISCOURSE-GIVEN content word (repeated from an earlier line of the stanza) is
  // subordinated relative to its sister (Wagner Ch.7) — but only as an ANCHOR
  // demotion, and never when it would empty the φ of content.  A word given a higher
  // (worse) effective phrase-stress is less likely to win the φ nuclear.
  const ps = (w: ClsWord) => {
    const base = w.phraseStress || Infinity;
    // A given content word — discourse-given (repeated from an earlier line), an
    // inherently-given indefinite pronoun ("something", Wagner §7.2.3), or
    // anaphorically given via a shared-head coordinate structure ("young blood
    // and high blood" → the second "blood") — is less likely to win the φ
    // nuclear, so a heavier sister in the SAME φ takes the beat.
    const given = isContent(w) && (w.discourseGiven || isInherentlyGiven(w) || w.coordinateGiven);
    return given ? base + 2 : base;
  };

  // Pronoun promotion (Nuclear Stress Rule + trochaic inversion): a simple personal
  // pronoun (PRP with no apostrophe) at the start of the φ gets promoted to an
  // anchor if it is syntactically prominent (phraseStress === 1) and its following
  // verb in the φ is a function/light verb (have, has, had, do, etc.) with weaker
  // phraseStress (phraseStress > 1).  This captures the trochaic inversion in
  // "I have no right" (I=1, have=3 → I wins the beat, have reduces) while
  // sparing contractions ("I'll", "I'm") and pronouns preceding lexical content
  // verbs ("I would give" → give is lexical, so I does NOT promote).
  const promotePronoun = (w: ClsWord) => {
    if (w.lexicalClass !== 'PRP' || w.word.includes("'") || w.word.includes("’")) return false;
    if (w.phraseStress !== 1) return false;
    const idx = toks.indexOf(w);
    if (idx !== 0) return false;
    const nextVerb = toks.slice(1).find(x => /^VB/.test(x.lexicalClass));
    if (!nextVerb) return false;
    const FUNCTION_VERBS_SHORT = new Set(['have', 'has', 'had', 'do', 'does', 'did', 'get', 'got']);
    if (!FUNCTION_VERBS_SHORT.has(nextVerb.word.toLowerCase())) return false;
    // Only the MAIN-verb use of have/do ("I HAVE no right" — possession) licenses
    // the inversion.  As an AUXILIARY ("i have SENE them") the beat belongs to the
    // lexical verb further right; promoting the pronoun here handed it the φ
    // nuclear over the participle ("I"(s) have sene(m) — the Wyatt L3 bug).
    if ((nextVerb.canonicalRel ?? '') === 'AUX' || (nextVerb.canonicalRel ?? '') === 'AUXPASS') return false;
    if ((nextVerb.phraseStress || 0) > 1) return true;
    return false;
  };

  // The set the gradient is measured against: content words (non-reduced) first;
  // for a content-less φ fall back to its prominent function words ("for THAT",
  // "to YOU"), then to any content, then to anything — so every φ has an anchor.
  let anchors = toks.filter(w => promotePronoun(w) || (isContent(w) && !isReducedVerb(w, words)));
  if (anchors.length === 0) anchors = toks.filter(w => !isReducedVerb(w, words) && functionLevel(w, words) !== 'x');
  if (anchors.length === 0) anchors = toks.filter(isContent);
  if (anchors.length === 0) anchors = toks.slice();
  const anchorSet = new Set(anchors);

  // Nuclear strength = the lowest phrase-stress integer among the anchors; the
  // nuclear WORD is the RIGHTMOST anchor at that value (English resolves rightward
  // toward the nuclear).  Because the Compound Stress Rule already fore-stressed a
  // compound's LEFT element (lower integer), the compound peak falls out here for
  // free — SLATE roof, ICE cream — with no special case.
  const localMin = Math.min(...anchors.map(ps));
  let nuclear: ClsWord | null = null;
  for (const w of anchors) if (ps(w) === localMin) nuclear = w;   // last = rightmost

  // Base level per token.
  const levels: StressLevel[] = toks.map((w) => {
    if (w === nuclear) return 's';                              // φ nuclear (right edge)
    if (anchorSet.has(w)) return 'm';                           // secondary beat (flat — the
    //                                  gradient among abutting beats is set by clash resolution)
    // BE-FORM flooring — only fires for true AUX copulas now (isReducedVerb
    // already excludes "to be" and ROOT be-forms, which are anchors with beats).
    // 'x' reserved for the clearest copula+predicate case: be-form after a
    // function word directly followed by an adjective/noun predicate.
    // Everything else → 'w' (promotable).
    if (isReducedVerb(w, words)) {
      if (BE_FORMS.has(bare(w))) {
        const i = toks.indexOf(w);
        const prev = i > 0 ? toks[i - 1] : null;
        const followingContent = toks.slice(i + 1).find(x => isContent(x));
        if (prev && !isContent(prev) && followingContent &&
            /^(JJ|NN)/.test(followingContent.lexicalClass))
          return 'x';
      }
      return 'w';
    }
    // Function word → its category gradient; a POLYSYLLABIC one floors its peak at
    // 'w' so its stressed syllable outranks the reduced one (be·CAUSE, u·PON).
    let tier = functionLevel(w, words);
    if (w.syllables.length > 1 && tier === 'x') tier = 'w';
    // A polysyllabic function word whose lexicon entry records a genuine PRIMARY
    // stress ("O·ver", "AF·ter", "UN·der", "u·PON") is not a reduced clitic — its
    // stressed syllable is a real (if light) beat that metrical verse freely uses
    // ("O·ver many a quaint and curious volume…" opens The Raven's trochee chain).
    // Raise the peak one tier to 'n' — still below every content beat, still
    // promotable/demotable by the fitter — leaving true reduced polysyllables
    // ("be·cause" 00, "where·fore" secondary-only) at 'w'.
    if (w.syllables.length > 1 && tier === 'w' &&
        w.syllables.some(s => (s.lexicalStress ?? s.stress) === 2)) {
      tier = 'n';
    }
    return tier;
  });

  // Phrase-initial beat ("beginnings free" — a light left-edge beat): a φ-initial
  // PREPOSITION rises x→w (the subtle beat on "IN the house"; lets "through" outrank
  // an interior "each"), unless it is itself the nuclear.  Also fires for the first
  // IN/TO AFTER a coordinator at the φ's start ("And of the best" — "And" is toks[0]
  // at 'x', "of" is toks[1]; "of" gets the raise so it reads 'w', not flat 'x').
  const raiseFirstPrep = (idx: number) => {
    if (idx < 0 || idx >= toks.length) return;
    const w = toks[idx];
    if (w === nuclear) return;
    if ((w.lexicalClass === 'IN' || w.lexicalClass === 'TO') && levels[idx] === 'x') {
      levels[idx] = 'w';
    }
  };
  raiseFirstPrep(0);
  // If toks[0] is a coordinator (CC), the first IN/TO after it also gets the raise
  // — it is κ-initial (the start of the prepositional phrase after "and"), even if
  // not ϕ-initial.  "And of the best" → "of" rises to 'w'.
  if (toks.length > 1 && (toks[0].lexicalClass === 'CC' || (toks[0].canonicalRel ?? '') === 'CC')) {
    for (let i = 1; i < toks.length; i++) {
      if (toks[i].lexicalClass === 'IN' || toks[i].lexicalClass === 'TO') {
        raiseFirstPrep(i);
        break;
      }
      // Skip over articles/determiners to find the first IN/TO
      if (toks[i].isContent) break;               // hit content before any prep
    }
  }

  // Givenness escape (Wagner §6.1.3, maintainer's no-flat-run-on directive): when a
  // φ's nuclear is an inherently-given PRONOUN immediately preceded by a transitive
  // PREPOSITION ("of HIM", "to THEE"), do NOT leave them on a par or stress the
  // pronoun — subordinate the given pronoun and give the preposition the beat
  // ("OF him"), the differentiated reading.  The metrical fitter may re-promote the
  // pronoun if the line demands it.
  if (nuclear && isPronoun(nuclear)) {
    const ni = toks.indexOf(nuclear);
    const prep = ni > 0 ? toks[ni - 1] : null;
    if (prep && (prep.lexicalClass === 'IN' || prep.lexicalClass === 'TO' ||
                 (prep.canonicalRel ?? '') === 'CASE')) {
      const pi = toks.indexOf(prep);
      levels[ni] = 'w';          // given pronoun subordinated
      levels[pi] = 'n';          // preposition takes the differentiating beat
    }
  }

  toks.forEach((w, i) => paintWord(w, levels[i]));
  // NOTE: the clash invariant (no adjacent equal n/m/s) is enforced once, globally,
  // by resolveStressClashes over TRUE adjacent syllables in computeRelativeStress —
  // not here.  A per-word peak comparison would wrongly treat two polysyllables'
  // stressed syllables as adjacent ("TY·ger TY·ger", peaks two syllables apart) and
  // spuriously flatten every falling trochaic/dactylic foot.
}

const CLASH_NOUN = /^(NN|NNS|NNP|NNPS)$/;
/** Two clashing words form a COMPOUND whose LEFT element fore-stresses (Compound
 *  Stress Rule): a NOMD modifier + its head, or two adjacent nouns (the N+N compound
 *  the tagger routinely mislabels).  Only for such a pair does the clash keep the
 *  lower-phraseStress (fore-stressed) member; every OTHER clash uses the default
 *  rightward resolution.  This is the narrow place the Compound Stress Rule needs to
 *  reach the contour when neither element is the φ nuclear (e.g. "ice cream" buried
 *  under a wrong root) — without disturbing ordinary verse, where forcing the
 *  lower-phraseStress member to win moved beats onto odd positions and mis-metered. */
function isCompoundPair(a: ClsWord, b: ClsWord): boolean {
  if (a === b) return false;
  if ((a.canonicalRel ?? '') === 'NOMD' && a.dependency?.governor === b) return true;
  if ((b.canonicalRel ?? '') === 'NOMD' && b.dependency?.governor === a) return true;
  return CLASH_NOUN.test(a.lexicalClass) && CLASH_NOUN.test(b.lexicalClass) &&
    Math.abs(a.absoluteIndex - b.absoluteIndex) === 1;
}

/**
 * Stress-clash resolution over the TRUE surface syllable sequence (McAleese A2
 * step 3d.ii: "stress clashes (ss, ms) > s-s").  A BEAT is one per foot (at most
 * one per phonological phrase) — so two ADJACENT strong syllables (both ≥ m, in
 * any order: ss, ms, sm, mm) are a clash, NOT two beats.  One member drops to 'n'
 * (below the beat threshold), leaving a single beat with a demoted neighbour;
 * adjacent equal 'n' likewise demotes one member to 'w'.
 *
 * WHICH member drops:
 *   • a COMPOUND pair (isCompoundPair) keeps the fore-stressed (lower-phraseStress)
 *     element and demotes the other — the Compound Stress Rule, "ICE cream";
 *   • an n-n tie is broken by LEXICAL stress (Hayes' stress-maximum principle):
 *     the syllable with the higher lexicalStress value (2=primary > 1=secondary
 *     > 0=unstressed) is protected; the lower yields to 'w'.  This preserves a
 *     polysyllable's internal contour — a PRIMARY (lexicalStress 2) that was
 *     demoted to 'n' by a prior m/s clash still outranks a SECONDARY
 *     (lexicalStress 1), which in turn outranks an artifact 'n' (lexicalStress
 *     0, reached via the function-word gradient or a prior demotion).  Without
 *     this, a cascade can crush real lexical data — e.g. "before" (be=1, fore=2):
 *     "fore" loses an m/s clash (demoted to 'n'), then ties "be"(n) and was
 *     wrongly sacrificed (the old code only protected ===1 secondaries, treating
 *     the primary 2 as "not grounded"), corrupting "wn" into "nw".  Equal-
 *     lexical-stress ties (both primary, both secondary, both unstressed) default
 *     left (Rhythm Rule);
 *   • every other clash demotes the lower symbolic level, ties to the LEFT (the
 *     Rhythm Rule / Iambic Reversal — an earlier stress backs off ahead of one that
 *     follows closely, not a general "endings are strict" license).
 *
 * Because it compares adjacent SYLLABLES (not word peaks), a falling foot whose
 * stresses are separated by a weak syllable ("TY·ger TY·ger", "HARB·our") is left
 * intact — only genuinely abutting beats collapse.
 */
function resolveStressClashes(words: ClsWord[], sylWord: Map<Syllable, ClsWord>): void {
  const syls: Syllable[] = [];
  for (const w of [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex)) {
    for (const s of w.syllables) syls.push(s);
  }
  // Lexical stress value of a syllable (2=primary, 1=secondary, 0=unstressed).
  // Used to break n-n ties: a syllable with HIGHER lexical stress has greater
  // phonological integrity (Hayes' stress-maximum principle) and is protected
  // against demotion by a syllable with lower lexical stress.  The prior code
  // checked only ===1 (secondary), which inverted the hierarchy — a primary
  // (lexicalStress===2) was treated as "not grounded" and sacrificed to a
  // secondary, corrupting words like "before" (be=1/secondary, fore=2/primary)
  // into "nw" instead of "wn".
  const lexVal = (s: Syllable) => s.lexicalStress ?? s.stress ?? 0;
  let changed = true;
  for (let guard = 0; changed && guard < 8; guard++) {
    changed = false;
    for (let i = 0; i + 1 < syls.length; i++) {
      const a = syls[i], b = syls[i + 1];
      const ra = RANK[a.relativeStress ?? 'w'];
      const rb = RANK[b.relativeStress ?? 'w'];
      if (ra >= RANK.m && rb >= RANK.m) {
        const wa = sylWord.get(a), wb = sylWord.get(b);
        let demoteA: boolean;
        if (wa && wb && wa !== wb && isCompoundPair(wa, wb)) {
          // compound fore-stress: demote the LESS prominent (higher phrase stress)
          demoteA = (wa.phraseStress || Infinity) >= (wb.phraseStress || Infinity);
        } else {
          demoteA = ra <= rb;                          // default: lower level, tie → left
        }
        if (demoteA) a.relativeStress = 'n'; else b.relativeStress = 'n';
        changed = true;
      } else if (ra === RANK.n && rb === RANK.n) {
        // Break the tie by LEXICAL stress: the syllable with higher lexical
        // stress (primary > secondary > unstressed) is protected; the lower
        // yields.  This preserves a polysyllable's internal contour (the
        // primary survives even if a prior clash demoted it to n) while still
        // letting genuine secondaries (lexicalStress 1) beat artifact n's
        // (lexicalStress 0, reached via function-word gradient or prior
        // demotion).  Equal-lexical-stress ties default left (Rhythm Rule).
        const la = lexVal(a), lb = lexVal(b);
        if (la > lb) b.relativeStress = 'w';
        else if (lb > la) a.relativeStress = 'w';
        else a.relativeStress = 'w';                  // tie → default left
        changed = true;
      }
    }
  }
}

/** Inherent-givenness nuclear demotion (Wagner §7.2.3).  After each φ has been
 *  relativised, an inherently-given indefinite pronoun that won its OWN φ's nuclear
 *  (e.g. a lone "Something" set off as its own ϕ) should still YIELD the utterance
 *  peak to a heavier element later in the same intonational unit — so when a LATER
 *  word in the IU also reaches 's', the given pronoun's peak is demoted s→m.  It
 *  keeps a beat (its lexical contour is untouched below the peak) but no longer
 *  claims the main prominence: "Something(m) for the modern STAGE(s)".
 *
 *  Guards keep it from crushing a FOCAL pronoun: it never fires when the given word
 *  is the IU's only nuclear (a lone "Something."), and skips a lemma repeated in the
 *  IU (focal anaphora). */
function demoteGivenNuclei(iuWords: ClsWord[]): void {
  const ordered = iuWords.filter(w => w.syllables.length > 0)
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  const peak = (w: ClsWord) => Math.max(0, ...w.syllables.map(s => RANK[s.relativeStress ?? 'w']));
  for (let i = 0; i < ordered.length; i++) {
    const w = ordered[i];
    if (!isInherentlyGiven(w) || peak(w) !== RANK.s) continue;
    const lemma = bare(w);
    if (ordered.filter(x => bare(x) === lemma).length > 1) continue;   // focal repetition
    if (!ordered.slice(i + 1).some(x => peak(x) === RANK.s)) continue;  // no heavier later nuclear
    for (const s of w.syllables) if ((s.relativeStress ?? 'w') === 's') s.relativeStress = 'm';
  }
}

/** Alternation promotion (Attridge 1982), gated by Hayes' stress-maximum
 *  monosyllable/polysyllable asymmetry (McAleese pp.49-57; Halle-Keyser, Kiparsky
 *  1975): English does not sustain a trough of three-or-more weak syllables — its
 *  medial syllable is promoted to a light beat, McAleese's 'n' ("some stress"). This
 *  is the SAME promotion the meter-fitter applies internally (`scansion.ts`: a 'w'
 *  flanked by weakness realises a beat); writing it into the displayed contour
 *  breaks the long w-troughs the maintainer flagged.
 *
 *  NOTE on grounding: "beginnings free, endings strict" (Kiparsky 1968) is a loose
 *  statistical tendency about WHERE stress clashes resolve in the line, not a
 *  license to promote by position alone — it says nothing about whether a given
 *  syllable is phonologically eligible to carry stress at all.  The actual gate
 *  here is Hayes' stress-maximum asymmetry: a STRESSED MONOSYLLABLE is positionally
 *  free (it has no internal contour to violate, so context can promote it — "error
 *  AND upon", "not TO advance"), but an UNSTRESSED syllable inside a POLYSYLLABLE
 *  is not free — the lexicon's verdict that it carries no stress (lexicalStress
 *  === 0) is a fixed phonological fact, and promoting it fabricates a secondary
 *  stress Nounsing-Pro never recorded (e.g. promoting "mariner"'s toneless "-ner"
 *  just because it sits between two other weak syllables, one of which belongs to
 *  the unrelated following word).  So:
 *   • only an overt-weak 'w' promotes; a reduced clitic 'x' (the/a/of) stays the
 *     genuine trough — a clitic is never a beat;
 *   • a candidate that is the toneless (lexicalStress === 0) syllable of a word with
 *     MORE THAN ONE syllable is excluded — its own word's lexical contour already
 *     settled the question, and position cannot overrule it; a true monosyllable, or
 *     a syllable that itself carries some lexical stress (primary or secondary) but
 *     is sitting low because its WHOLE WORD only earned a low φ-level, remains
 *     eligible;
 *   • it must sit between two weak (w/x) syllables — the interior of a real trough;
 *   • the LINE EDGES do not count as weak, so a line-initial/final weak is never
 *     promoted (the off-beat before the first beat, and the final cadence, are left);
 *   • promotions never abut (a promoted 'n' breaks the run), so the result alternates
 *     w·n·w and the clash invariant (no adjacent equal n) is preserved. */
function promoteWeakTroughs(words: ClsWord[]): void {
  const syls: Syllable[] = [];
  const sylWord = new Map<Syllable, ClsWord>();
  for (const w of [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex)) {
    for (const s of w.syllables) { syls.push(s); sylWord.set(s, w); }
  }
  const isW = (i: number) =>
    i >= 0 && i < syls.length && syls[i].relativeStress === 'w';
  const isLexicallyToneless = (i: number) => {
    const s = syls[i];
    if ((s.lexicalStress ?? s.stress) !== 0) return false;   // carries some real stress
    const w = sylWord.get(s);
    return !!w && w.syllables.length > 1;                    // interior of a polysyllable
  };
  let lastProm = -2;
  for (let i = 1; i < syls.length - 1; i++) {
    if (!isW(i) || !isW(i - 1) || !isW(i + 1)) continue;   // medial of a ≥3 literal-w run
    if (isLexicallyToneless(i)) continue;                   // no fabricated secondaries
    if (i - 1 === lastProm) continue;                       // keep promotions non-adjacent
    syls[i].relativeStress = 'n';
    lastProm = i;
  }
}

/** Lower a polysyllabic word's final 'w' syllable to 'x' when another 'w'
 *  immediately follows it in surface order.  The unstressed ending of a longer
 *  word (even a stress-bearing word) carries fainter emphasis than even a weakly-
 *  stressed syllable or word immediately following it — so a w-w seam at a word
 *  boundary is differentiated by dropping the word-internal one to the clitic tier.
 *
 *  Narrowly scoped: only fires on the FINAL syllable of a polysyllabic word (2+
 *  syllables) that is 'w' (not 'n', 'm', 's', or 'x'), AND only when the very next
 *  syllable in surface order is also 'w'.  Does NOT affect any other syllable of
 *  the word, does NOT fire when the next syllable is 'x', 'n', 'm', or 's'. */
function demotePolysyllabicFinalTrough(words: ClsWord[]): void {
  const syls: Syllable[] = [];
  const sylWord = new Map<Syllable, ClsWord>();
  for (const w of [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex)) {
    for (const s of w.syllables) { syls.push(s); sylWord.set(s, w); }
  }
  for (let i = 0; i < syls.length - 1; i++) {
    const s = syls[i];
    const next = syls[i + 1];
    if (s.relativeStress !== 'w') continue;
    if (next.relativeStress !== 'w') continue;
    const w = sylWord.get(s);
    if (!w || w.syllables.length < 2) continue;          // polysyllabic only
    if (s !== w.syllables[w.syllables.length - 1]) continue;  // final syllable only
    s.relativeStress = 'x';
  }
}

/** Anaphoric givenness in coordinate structures (Krifka §4, Wagner §7.2).
 *  In a coordinate structure "X blood and Y blood" the HEAD lemma ("blood") is
 *  repeated across conjuncts.  Both occurrences are the shared contrastive
 *  background — the CATEGORY "blood" is what stays constant, and the modifiers
 *  ("Young", "high") carry the contrastive focus.  So BOTH heads are demoted
 *  (`coordinateGiven`), letting the modifier win the φ nuclear in EACH conjunct
 *  ("YOUNG blood and HIGH blood").  This is distinct from a refrain (identical
 *  phrase repeated for emphasis = focal) and from cross-line discourse
 *  givenness (repetition across lines of a stanza).
 *
 *  Detection: a content word whose `canonicalRel` is CONJ and whose governor
 *  shares the same lemma.  BOTH the conjunct (second occurrence) AND its
 *  governor (first occurrence) are marked `coordinateGiven`.  The relativiser's
 *  `ps()` then demotes both, so the modifier in each φ wins the beat.
 *
 *  Guard: only fires when the conjuncts' modifiers DIFFER — if the entire phrase
 *  is identical ("nevermore and nevermore") it's a refrain, not a shared-head
 *  coordinate, and both occurrences stay focal. */
function markCoordinateGivenness(words: ClsWord[]): void {
  for (const w of words) {
    if (!isContent(w) || (w.canonicalRel ?? '') !== 'CONJ') continue;
    const gov = w.dependency?.governor;
    if (!gov || gov === w) continue;
    // Same lemma (head repeated across conjuncts)?
    if (bare(w) !== bare(gov)) continue;
    // Guard against a refrain: check that the conjuncts have DIFFERENT
    // pre-head modifiers.  Compare the AMOD/ADVMOD lemmas immediately before
    // each head.  If both heads have the same modifier (or neither has one),
    // leave both focal — it's either a refrain or a plain coordination.
    const modBefore = (head: ClsWord): string => {
      const idx = words.indexOf(head);
      if (idx <= 0) return '';
      const prev = words[idx - 1];
      if ((prev.canonicalRel ?? '') === 'AMOD' || (prev.canonicalRel ?? '') === 'ADVMOD')
        return bare(prev);
      return '';
    };
    if (modBefore(w) === modBefore(gov)) continue;
    // Mark BOTH heads as coordinate-given: the shared head is the contrastive
    // background in both conjuncts, so contrastive focus falls on BOTH modifiers.
    w.coordinateGiven = true;
    gov.coordinateGiven = true;
  }
}

/** Assign relative stress for the whole sentence, one PP at a time. */
export function computeRelativeStress(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Mark anaphorically-given heads in coordinate structures before relativisation,
  // so the relativiser's `ps()` can demote them and let the modifier win the beat.
  markCoordinateGivenness(words);

  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const toks = collectPPTokens(pp)
        .filter(w => w.syllables.length > 0)
        .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
      relativisePP(toks, words);
    }
  }
  // Enforce the clash rule over the whole line's surface syllables (catches the
  // cross-PP abutments the per-PP painting cannot see).  Carry each syllable's word
  // so the clash can recognise a compound pair and apply the Compound Stress Rule.
  const sylWord = new Map<Syllable, ClsWord>();
  for (const w of words) for (const s of w.syllables) sylWord.set(s, w);
  resolveStressClashes(words, sylWord);

  // Per-IU: an inherently-given indefinite pronoun yields its φ-nuclear to a heavier
  // later element in the same IU (after clash resolution, so the demotion is final).
  for (const iu of ius) {
    const iuWords = iu.phonologicalPhrases.flatMap(pp => collectPPTokens(pp));
    demoteGivenNuclei(iuWords);
  }

  // Final readability pass: promote the medial weak of a ≥3-weak trough to 'n'
  // (Attridge alternation), breaking long w-runs and filling promotable beats.
  promoteWeakTroughs(words);

  // Differentiate w-w seams at polysyllabic word boundaries: lower a
  // polysyllabic word's final 'w' to 'x' when another 'w' immediately follows.
  demotePolysyllabicFinalTrough(words);
}
