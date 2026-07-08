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
import {
  isTransitiveFunctionWord, isPronoun, isInherentlyGiven,
  focusAssociateOf, isMarginalModalUse, isCapitalizedFocalPronoun,
  isPostposedPreposition, isInvertedOperatorAux, isSemiModalHaveTo,
} from './syntax.js';

const RANK: Record<StressLevel, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const LEVELS: StressLevel[] = ['x', 'w', 'n', 'm', 's'];

const CONTENT = /^(NN|NNS|NNP|NNPS|JJ|JJR|JJS|VB|VBD|VBG|VBN|VBP|VBZ|RB|RBR|RBS|CD|UH)$/;

const ARTICLES = new Set(['a', 'an', 'the']);
const QUANTIFIERS = new Set([
  'all', 'both', 'each', 'every', 'some', 'any', 'many', 'much', 'few', 'no',
  'most', 'half', 'several', 'either', 'neither', 'enough',
]);
// "such" joins the demonstratives for its ATTRIBUTIVE use ("no such roses",
// "such a night") — a determiner-class weak monosyllable (Quirk's
// predeterminer; Fabb 2001 on weak monosyllables in iambic verse), whatever
// the tagger labels it.  Its anchor exclusion is gated separately on the
// attributive relation (see isAttributiveSuch in relativisePP), so the
// predicative/pronominal use ("such is life") is untouched.
const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those', 'such']);
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
// Archaic interrogative wh-adverbs — a closed grammatical class the tagger
// routinely mislabels (Coleridge's "wherefore" comes back IN): they carry the
// wh n-tier like their modern counterparts (why/where/whence…).
const WH_ADV_LEMMAS = new Set([
  'wherefore', 'whence', 'whither', 'whereby', 'wherein', 'whereof',
  'whereto', 'whereat', 'whereupon',
]);

function bare(w: ClsWord): string {
  return w.word.toLowerCase().replace(/['’]/g, '');
}
function isAphaeresis(w: ClsWord): boolean { return APHAERESIS.has(bare(w)); }
function isContent(w: ClsWord): boolean {
  return CONTENT.test(w.lexicalClass) && !isAphaeresis(w);
}
function isReducedVerb(w: ClsWord, words?: ClsWord[]): boolean {
  if (isAphaeresis(w)) return true;
  // Marginal-modal dare/need with a BARE infinitive ("dare he aspire", "dare
  // seize the fire") — the auxiliary usage (it is what licenses the inversion):
  // reduces like a modal; the beat belongs to the infinitive it governs.
  if (words && isMarginalModalUse(w, words)) return true;
  // Semi-modal "have to" (necessity — "do I have to bless", "we had to
  // laugh"): the reduced ("hafta") functor use; the beat belongs to its
  // infinitive.  Lexical "have" (possession, causative, existential) never
  // matches — the gate is the complement's shape, not the lemma.
  if (words && isSemiModalHaveTo(w, words)) return true;
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
  // RHYME-FELLOW positive override (set by the stanza pass in index.ts): a
  // line-final function MONOSYLLABLE that strong-rhymes with a content
  // line-final elsewhere in the stanza carries the rhyme's beat — "Now
  // WHEREfore STOPP'ST thou ME?" (me ~ three).  'n', not 's': a real beat,
  // still graded below the clause's content anchors.
  if (w.rhymeFocal && w.syllables.length === 1) return 'n';
  // wh-words FIRST — even in the determiner slot ("WHAT immortal hand or eye"):
  // Krifka (13), wh-words and quantifiers as arguments take accents like content
  // words ("Éverybody has escáped"); an interrogative determiner is the focus
  // exponent of its question and never floors to the article tier.  The archaic
  // wh-adverbs ("Now WHEREfore stopp'st thou me?") are routinely mis-tagged IN,
  // so the closed lemma class backs the POS test up.
  if (/^(WDT|WP|WP\$|WRB)$/.test(pos) || WH_ADV_LEMMAS.has(lemma)) {
    // …but a wh-word immediately followed by its POSTPOSED preposition ("what
    // for", "who with", "where from") defers to the preposition's strong form
    // — the orphaned functor is the accent exponent of the inverted PP ("what
    // FOR is this form").  Keeping both at 'n' would only feed the n-n clash
    // rule, whose lexical-stress tiebreak would demote the preposition back.
    const nxt = words.find(x => x.absoluteIndex === w.absoluteIndex + 1 && x.syllables.length > 0);
    if (nxt && isPostposedPreposition(nxt, words)) return 'w';
    return 'n';
  }
  // A quantifier / demonstrative in an ATTRIBUTIVE determiner slot ("each street",
  // "this cat", "that day") is a reduced determiner (x), NOT a standalone n-tier
  // quantifier.  Only the determiner USE reduces — a predeterminer ("ALL the",
  // PDT/det:predet) and a standalone quantifier/demonstrative ("EACH of them",
  // "THIS is…", rel ≠ det) keep their 'n'.  This is what lets a ϕ-initial
  // preposition's beat ("through", "in") outrank an interior "each".
  if (rel === 'DET' && pos !== 'PDT' && !NEGATORS.has(lemma)) return 'x';
  // n — quantifiers, demonstratives, negators (carry real stress) — but NOT
  // when the token is a subordinating MARK: "that" in "that I were clay" and
  // "so" in "so that I seem" are complementisers (functors with clausal
  // complements, Wagner §6.5.5), not demonstratives, and floor with the other
  // complementisers below.
  if (rel !== 'COMPMARK' && rel !== 'ADVMARK' &&
      (pos === 'PDT' || QUANTIFIERS.has(lemma) || DEMONSTRATIVES.has(lemma) ||
       NEGATORS.has(lemma))) return 'n';
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
  // A POSTPOSED preposition — orphaned from its complement, which stands
  // immediately to its LEFT as a wh-word ("what FOR is this form" = "for
  // what"; "who WITH?", "where FROM?") — cannot procliticize rightward and
  // takes its STRONG form (Selkirk 1996: function words are weak only where
  // they can cliticize onto a following host).  Accent-capable 'n', so the
  // meter realises the beat; a preposition with a genuine rightward
  // complement never matches ("who for the WORLD…" stays reduced below).
  if (isPostposedPreposition(w, words)) return 'n';
  // A STRANDED / intransitive preposition ("what are you waiting FOR", "she walked
  // IN") is NOT the reducible proclitic of "in the house" — Wagner §6.5.5: only
  // transitive functors have the weak allomorph.  It keeps an overt beat ('w'), so
  // the metrical fitter can promote it; a TRANSITIVE preposition floors at 'x'.
  // POSSESSIVE pronouns and the clitic 's also carry the CASE relation but are
  // not prepositions — they take the pronoun tier below, not the clitic floor
  // (the CASE catch-all had crushed "For His Civility"'s His to 'x').
  if (pos === 'IN' || pos === 'TO' ||
      (rel === 'CASE' && pos !== 'PRP$' && pos !== 'PRP' && pos !== 'POS')) {
    return isTransitiveFunctionWord(w, words) ? 'x' : 'w';
  }
  // x — pure clitics: articles, coordinators, complementisers, adverbial marks
  // (wh-adverb marks — "when", "where" — keep the overt 'w' tier below: they
  // carry framing content and verse freely promotes them)
  if (ARTICLES.has(lemma) || pos === 'CC' || rel === 'CC' || rel === 'COMPMARK' ||
      (rel === 'ADVMARK' && !/^(WDT|WP|WP\$|WRB)$/.test(pos))) return 'x';
  // A CAPITALIZED mid-sentence pronoun ("For His Civility", "but just
  // Ourselves") is the poet's typographic focus mark — narrow focus per
  // Krifka (78): it carries real (promotable) stress, not the given-pronoun w.
  if (isCapitalizedFocalPronoun(w, words)) return 'n';
  // w — possessives, pronouns, auxiliaries, modals, leftover determiners
  return 'w';
}

/** The peak (highest lexical-stress) syllable of a word.
 *
 *  TIES (the lexicon's double-stressed entries — "outside" 1·1) resolve by the
 *  English diatone: the nominal/adjectival member of such a pair is LEFT-stressed
 *  (the OUTside of the house) while the prepositional/adverbial/particle member is
 *  RIGHT-stressed (she waited outSIDE; outSIDE the swallows roundelay) — so a tie
 *  takes the LAST tied syllable when the word is tagged as an adposition/particle,
 *  or is a preposition-built adverb (out·side, with·in, through·out, be·yond…).
 *  The compound indefinites (SOMEwhere, ANYthing) are left-stressed and do not
 *  match the particle-prefix test, so they keep the default first-syllable tie. */
const PREP_PREFIX = /^(out|in|up|down|with|through|be|a(?=bove|bout|round|cross|long|mid|gainst))/;
function peakSyllable(w: ClsWord): Syllable | null {
  const rightwardTies =
    /^(IN|TO|RP)$/.test(w.lexicalClass) ||
    (/^RB/.test(w.lexicalClass) && PREP_PREFIX.test(w.word.toLowerCase()));
  let best: Syllable | null = null;
  let bestV = -1;
  for (const s of w.syllables) {
    const v = s.lexicalStress ?? s.stress;
    if (v > bestV || (rightwardTies && v === bestV)) { bestV = v; best = s; }
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
  // The line's FINAL syllable-bearing word: the RHYME position.  Verse-final
  // position is focal by construction (the rhyme is the form's own contrast
  // device — Krifka: focus overrides givenness deaccenting), so givenness
  // demotion never applies there: Shakespeare's "…more red than her lips'
  // RED" keeps its rhyme-carrying beat even though "red" is discourse-given.
  // Deaccented rhymes remain possible — as the marked, wrenched case the
  // meter layer prices — but the RELATIVISER does not impose them.
  const lineFinal = [...words]
    .filter(x => x.syllables.length > 0)
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex)
    .pop() ?? null;
  const ps = (w: ClsWord) => {
    const base = w.phraseStress || Infinity;
    if (w === lineFinal) return base;                    // rhyme position: never given-demoted
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
    // ≤ 2, not === 1: the utterance-Newman pass (bracketing.ts) demotes an
    // EARLIER co-equal of the utterance nuclear by one — a subject pronoun that
    // matched a branching VP ("I have no right" — I co-equal with "right")
    // lands at 2 yet is still the syntactically prominent pronoun this
    // inversion test wants.
    if (w.phraseStress > 2) return false;
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

  // Subordinating marks are functors regardless of POS (the RB-tagged "so" of
  // "so that I seem" must not anchor a beat over its clause's verb).
  const isMark = (w: ClsWord) => {
    const r = w.canonicalRel ?? '';
    return r === 'COMPMARK' || r === 'ADVMARK';
  };
  // A pure negator ("not") is a functor over its predicate (negation takes the
  // VP as complement); it keeps its n-tier stress — real, promotable — but must
  // not claim a beat-anchor away from the verb it negates ("could not STOP for
  // DEATH", not "could NOT stop").  Restored below if the φ has nothing else.
  const isNegatorTok = (w: ClsWord) => NEGATORS.has(bare(w));
  // Association with Focus (Krifka §4.4.6): a premodifying "just/only/even"
  // F-marks its associate — the PARTICLE reduces (functor) and a PRONOUN
  // associate is promoted to anchor status ("held but just OURSELVES": the
  // exclusive reading accents the pronoun, never the particle).
  const isFocusParticleTok = (w: ClsWord) => focusAssociateOf(w, words) !== null;
  // A clause-initial temporal deictic directly introducing a wh-word ("Now
  // wherefore stopp'st thou me?", "Now, what shall we do?") is a DISCOURSE
  // MARKER, not a time adverb — Krifka §4.5.4 groups situational deictics with
  // the non-accentable expressions in exactly this transitional use.  It cedes
  // its beat to the wh-focus it introduces (kept at 'n': real, promotable).
  // The genuinely temporal use ("Now sleeps the crimson petal") is untouched —
  // the gate is the following wh-word, not the lemma.
  const isDiscourseDeictic = (w: ClsWord) => {
    if (!/^(now|then)$/.test(bare(w)) || !/^RB/.test(w.lexicalClass)) return false;
    if (toks.indexOf(w) !== 0) return false;
    const nxt = words.find(x => x.absoluteIndex === w.absoluteIndex + 1 && x.syllables.length > 0);
    return !!nxt && (/^(WDT|WP|WP\$|WRB)$/.test(nxt.lexicalClass) || WH_ADV_LEMMAS.has(bare(nxt)));
  };
  // A sentence-initial INFERENTIAL CONNECTIVE set off by a comma ("So, may
  // then each moment…", "Well, I declare", "Now, where was I?") is the
  // discourse-marker use (Schiffrin) — transitional, prosodically reduced,
  // never the φ anchor.  The gate is the FULL configuration: first word of
  // the sentence + immediately followed by a comma/dash + the closed
  // inferential class.  The accent-taking clause-initial adverbs stay out:
  // spatial presentationals ("Here, take this"), concessives ("Still, she
  // persisted"), narrative-temporal "Then," (freely stressed) are not listed;
  // degree/manner "so" ("so much my own") fails the comma test.
  const CONNECTIVES = new Set(['so', 'now', 'well', 'why', 'anyway']);
  const isDiscourseConnective = (w: ClsWord) => {
    if (!CONNECTIVES.has(bare(w)) || !/^(RB|UH|IN)/.test(w.lexicalClass)) return false;
    const firstAlpha = words
      .filter(x => /[A-Za-z]/.test(x.word))
      .sort((a, b) => a.absoluteIndex - b.absoluteIndex)[0];
    if (firstAlpha !== w) return false;
    const nxt = words.find(x => x.absoluteIndex === w.absoluteIndex + 1);
    return !!nxt && nxt.syllables.length === 0 && /^[,—–-]+$/.test(nxt.word);
  };
  // "then/now" wedged between an INVERTED operator auxiliary and its delayed
  // subject ("So, may then each moment drip off" — "may(beat) then(weak)") is
  // the inferential use: the aux-to-subject gap of an inversion is a proclitic
  // zone, and the operator aux, not the deictic, carries the inversion's
  // accent.  Normal-order "I would then go" (subject already passed) and
  // clause-initial narrative "Then," are untouched.
  const isPostOperatorDeictic = (w: ClsWord) => {
    if (!/^(now|then)$/.test(bare(w)) || !/^RB/.test(w.lexicalClass)) return false;
    const prev = words
      .filter(x => x.syllables.length > 0 && x.absoluteIndex < w.absoluteIndex)
      .sort((a, b) => b.absoluteIndex - a.absoluteIndex)[0];
    if (!prev || prev.absoluteIndex !== w.absoluteIndex - 1) return false;
    return isInvertedOperatorAux(prev, words);
  };
  // Attributive "such" ("no such roses see I…") is determiner-class and must
  // not out-anchor the noun it modifies — which cross-line givenness demotion
  // would otherwise let it do (L5's "roses" made L6's "roses" given, handing
  // the φ nuclear to "such" and wrecking the iambic grid).  The gate is the
  // attributive relation to a FOLLOWING governor; predicative/pronominal
  // "such" ("such is life") never matches and keeps content status.
  const isAttributiveSuch = (w: ClsWord) => {
    if (bare(w) !== 'such') return false;
    const rel = w.canonicalRel ?? '';
    if (rel !== 'AMOD' && rel !== 'DET') return false;
    const gov = w.dependency?.governor;
    return !!gov && gov.absoluteIndex > w.absoluteIndex;
  };
  const focusAssociates = new Set<ClsWord>();
  for (const t of toks) {
    const a = focusAssociateOf(t, words);
    if (a) focusAssociates.add(a);
  }
  // A pronoun made FOCAL — by a focus particle, or by the poet's mid-sentence
  // capital ("Ourselves", "His") — sheds its inherent givenness (Wagner §7.2.3
  // is a default, not a sentence): it anchors like content.
  const isFocalPronoun = (w: ClsWord) =>
    isPronoun(w) && w.syllables.length > 0 &&
    (focusAssociates.has(w) || isCapitalizedFocalPronoun(w, words));

  // The set the gradient is measured against: content words (non-reduced) first;
  // for a content-less φ fall back to its prominent function words ("for THAT",
  // "to YOU"), then to any content, then to anything — so every φ has an anchor.
  // An inverted operator aux ("So, MAY then each moment…", "HAD I known") is a
  // positive anchor — the operator carries the inversion's accent even though
  // it is neither content nor a promoted pronoun.
  let anchors = toks.filter(w => promotePronoun(w) || isFocalPronoun(w) ||
    isInvertedOperatorAux(w, words) ||
    (isContent(w) && !isReducedVerb(w, words) && !isMark(w) &&
     !isNegatorTok(w) && !isFocusParticleTok(w) && !isDiscourseDeictic(w) &&
     !isDiscourseConnective(w) && !isPostOperatorDeictic(w) &&
     !isAttributiveSuch(w)));
  if (anchors.length === 0) {
    anchors = toks.filter(w => isContent(w) && !isReducedVerb(w, words) && !isMark(w));
  }
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
        // EXISTENTIAL be ("There WAS an Old Man with a beard"): after the
        // expletive THERE (EX tag) the be-form is the verb of EXISTENCE — the
        // assertion itself — not a copula linking a subject to a predicate.
        // It keeps the overt-weak tier (promotable to the beat verse wants),
        // never the clitic floor.  Deictic-locative "THERE was…" is tagged RB
        // and takes a different path entirely, so it is untouched.
        if (prev && prev.lexicalClass === 'EX') return 'w';
        const followingContent = toks.slice(i + 1).find(x => isContent(x));
        if (prev && !isContent(prev) && followingContent &&
            /^(JJ|NN)/.test(followingContent.lexicalClass))
          return 'x';
      }
      return 'w';
    }
    // A premodifying focus particle ("just/only/even" = exclusives) carries
    // real-but-subordinate stress: 'n' — its associate holds the beat.  The
    // user-facing reading: "held but just(n) OURSELVES(s)".
    if (isFocusParticleTok(w)) return 'n';
    // Discourse-marker "now/then" before a wh-word: real-but-subordinate 'n'.
    if (isDiscourseDeictic(w)) return 'n';
    // Inferential connective ("So, …") and the deictic wedged inside an
    // inversion ("may then each moment"): overt-weak — the beat belongs to
    // the operator / the clause it introduces.
    if (isDiscourseConnective(w) || isPostOperatorDeictic(w)) return 'w';
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

  // Interrogative focus fronting (Krifka §4.6: focus introduces the phrase
  // boundary and its accent).  A φ-initial preposition heading a wh-containing
  // PP is the left edge of a FRONTED FOCUS and carries a genuine light beat:
  // "IN what distant deeps", "ON what wings".  The licence is either an overt
  // question mark closing the clause, or the pied-piped wh-PP standing at the
  // very START of the utterance — wh-fronting is itself the interrogative /
  // exclamative construction, and a verse line often carries the "?" on a later
  // line.  (A mid-sentence relative "…the house in which he lived" is φ-initial
  // but not utterance-initial, so it stays reduced.)  The interrogative
  // DETERMINER just after the preposition defers to the noun it determines
  // ("on WHAT wings" ↛ ; "ON what WINGS" ✓), while a free-standing wh
  // ("WHAT the hand") keeps its own 'n'.
  {
    const lastIdx = toks[toks.length - 1].absoluteIndex;
    const isQuestionClause = (() => {
      const after = words
        .filter(w => w.absoluteIndex > lastIdx)
        .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
      for (const w of after) {
        if (w.word === '?') return true;
        if (/^[.!;:]+$/.test(w.word) || w.word === '…') return false;
      }
      return false;
    })();
    const firstAlpha = words
      .filter(w => /[A-Za-z]/.test(w.word))
      .sort((a, b) => a.absoluteIndex - b.absoluteIndex)[0];
    const isUtteranceInitial = !!firstAlpha && toks[0] === firstAlpha;
    const isWh = (x: ClsWord) => /^(WDT|WP|WP\$|WRB)$/.test(x.lexicalClass);
    if ((isQuestionClause || isUtteranceInitial) && toks.length >= 2) {
      const p = toks[0];
      if ((p.lexicalClass === 'IN' || p.lexicalClass === 'TO') && p !== nuclear &&
          (isWh(toks[1]) || (toks.length > 2 && isWh(toks[2])))) {
        levels[0] = 'n';
        // wh functioning as a determiner (a nominal follows it in the φ) defers
        if (isWh(toks[1]) && toks.length > 2 && /^(JJ|NN)/.test(toks[2].lexicalClass)) {
          levels[1] = 'w';
        }
      }
    }
  }

  // Left-edge beat for a φ-INITIAL DISYLLABIC subordinator ("BeCAUSE I could
  // not stop for Death", "BeCAUSE at least the past were passed away").  The
  // subordinator opens its own clause-φ; its stressable syllable carries the
  // light φ-initial beat ("beginnings free") exactly as a φ-initial preposition
  // does — promotable by the fitter, never a forced ictus.  The raise lands on
  // the lexically stressed syllable; for a zero-contour entry ("because" 0·0)
  // English subordinators of this shape are end-stressed (be·CAUSE, un·TIL,
  // al·THOUGH), so the tie falls to the FINAL syllable.  Monosyllabic marks
  // ("if", "since") and mid-φ subordinators are untouched.
  if (toks.length >= 2) {
    const first = toks[0];
    const rel0 = first.canonicalRel ?? '';
    if ((rel0 === 'COMPMARK' || rel0 === 'ADVMARK') && first !== nuclear &&
        first.syllables.length === 2 &&
        (levels[0] === 'x' || levels[0] === 'w')) {
      const [s1, s2] = first.syllables;
      const l1 = s1.lexicalStress ?? s1.stress ?? 0;
      const l2 = s2.lexicalStress ?? s2.stress ?? 0;
      // Paint explicitly (the zero contour would misplace paintWord's peak).
      if (l1 > l2) { s1.relativeStress = 'n'; s2.relativeStress = 'x'; }
      else { s1.relativeStress = 'x'; s2.relativeStress = 'n'; }
      levels[0] = '__painted__' as StressLevel;   // sentinel: skip paintWord below
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

  toks.forEach((w, i) => {
    if ((levels[i] as string) === '__painted__') return;   // subordinator raise painted directly
    paintWord(w, levels[i]);
  });
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
  // A POSSESSIVE noun (nmod:poss → canonical CASE: "love's sway") is a phrasal
  // modifier, NOT a compound member — the NSR right-stresses it (love's SWAY).
  // Without this the N+N adjacency fallback fore-stressed possessives.
  if ((a.canonicalRel ?? '') === 'CASE' || (b.canonicalRel ?? '') === 'CASE') return false;
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
  // An OVERT punctuation boundary (comma, dash, IU stop) between two words is a
  // genuine prosodic pause: beats on opposite sides keep BEAT status (never
  // crushed below 'm' — the old cross-comma cascade stripped "blood" two
  // tiers), but they still GRADE — two nuclear strengths cannot abut even
  // across a pause, and a comma list thins its medial members to subordinate
  // beats ("BLOOD, bone(m), MARrow…").  Quotes/brackets are
  // phrasing-transparent and do not block.
  const boundaryAfter = new Set<number>();     // syllable index i: boundary between i and i+1
  for (const w of [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex)) {
    if (w.syllables.length === 0) {
      if (/^[,;:.!?…()—–-]+$/.test(w.word) && syls.length > 0) boundaryAfter.add(syls.length - 1);
      continue;
    }
    for (const s of w.syllables) syls.push(s);
  }

  // Alternation over a CLASH RUN (beat deletion at the weak/medial position):
  // three or more consecutive beat-level syllables (≥ m) resolve by demoting
  // the MEDIAL members and keeping both edges — "my young soul sick" →
  // young(m) soul(n) sick(s), where the old pairwise-left cascade stripped the
  // first two beats in sequence.  A run may now CROSS overt boundaries: a
  // medial that abuts a comma/dash stays a real (subordinate) beat — demoted
  // only to 'm', so "As I am BLOOD, bone, MARrow…" grades s·m·s instead of
  // holding three co-equal nuclei — while a boundary-free medial thins to 'n'
  // as before.  Pairs (exactly two) fall through to the pairwise logic below,
  // which knows about compounds, phrase stress, and boundaries.
  {
    let i = 0;
    while (i < syls.length) {
      if (RANK[syls[i].relativeStress ?? 'w'] < RANK.m) { i++; continue; }
      let j = i;
      while (j + 1 < syls.length &&
             RANK[syls[j + 1].relativeStress ?? 'w'] >= RANK.m) j++;
      if (j - i >= 2) {
        for (let k = i + 1; k < j; k++) {
          const bounded = boundaryAfter.has(k - 1) || boundaryAfter.has(k);
          syls[k].relativeStress = bounded ? 'm' : 'n';
        }
      }
      i = j + 1;
    }
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
      if (boundaryAfter.has(i)) {
        // Across a comma/dash the pause separates the beats, so subordinate
        // combinations (m·s, s·m, m·m) stand — but two NUCLEAR strengths still
        // cannot abut even across the pause: the less prominent (higher
        // phrase-stress) of an s·s pair grades to 'm' (still a beat), a tie
        // resolving rightward toward the nuclear (Newman).
        if (ra === RANK.s && rb === RANK.s) {
          const wa = sylWord.get(a), wb = sylWord.get(b);
          const pa = wa?.phraseStress || Infinity;
          const pb = wb?.phraseStress || Infinity;
          if (pa < pb) b.relativeStress = 'm';
          else a.relativeStress = 'm';
          changed = true;
        }
        continue;
      }
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
  // A flank counts as weak when it is 'w' OR 'x' — a clitic flank is weaker
  // still, and refusing it silenced real troughs ("And(x) I(w) had(w) put" —
  // "I" is the alternation's natural light beat; "Be(x)cause(w) I(w)…" — the
  // subordinator's stressed syllable likewise).  The CANDIDATE must still be an
  // overt 'w' (a clitic itself never promotes), and the polysyllable-toneless
  // exclusion below still applies.
  const isWeakFlank = (i: number) =>
    i >= 0 && i < syls.length &&
    (syls[i].relativeStress === 'w' || syls[i].relativeStress === 'x');
  const isLexicallyToneless = (i: number) => {
    const s = syls[i];
    if ((s.lexicalStress ?? s.stress) !== 0) return false;   // carries some real stress
    const w = sylWord.get(s);
    return !!w && w.syllables.length > 1;                    // interior of a polysyllable
  };
  let lastProm = -2;
  for (let i = 1; i < syls.length - 1; i++) {
    if (!isW(i) || !isWeakFlank(i - 1) || !isWeakFlank(i + 1)) continue; // 'w' amid weakness
    if (isLexicallyToneless(i)) continue;                   // no fabricated secondaries
    if (i - 1 === lastProm) continue;                       // keep promotions non-adjacent
    // Argument over functor at the alternation level (Wagner §6.2.2): when a
    // REDUCED VERB (auxiliary / semi-modal — a functor) and a PRONOUN (an
    // argument) are both eligible neighbours in the same trough, the
    // left-greedy scan must not hand the beat to the functor — "do I have to
    // bless" wants do(w) I(n) have(w), not do(n) I(w) have(n).  The reduced
    // verb yields to an immediately-following eligible pronoun.
    if (i + 2 < syls.length) {
      const wHere = sylWord.get(syls[i]);
      const wNext = sylWord.get(syls[i + 1]);
      if (wHere && wNext && wHere !== wNext &&
          isReducedVerb(wHere, words) && isPronoun(wNext) &&
          isW(i + 1) && !isLexicallyToneless(i + 1) && isWeakFlank(i + 2)) {
        continue;                                           // the pronoun promotes instead
      }
    }
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
