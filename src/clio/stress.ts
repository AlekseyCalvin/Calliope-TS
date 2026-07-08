// stress.ts — Lexical, compound, nuclear stress assignment using nounsing-pro
// (augmented CMU dictionary with 52+ columns), then conversion to McAleese's
// 4‑level relative system.

import * as nounsing from 'nounsing-pro';
import { ClsWord, Syllable, StressLevel, IntonationalUnit, PhonologicalPhrase } from '../types.js';
import { isPunctuation } from './parser.js';
import { collectPPTokens, syllabifyWord } from './phonological.js';
import { isStrandedPreposition, isContrastivePossessive, isVocative, isDeicticLocative } from './semantics.js';

// ─── CONSTANTS & CLASSIFICATIONS ──────────────────────────────────

/**
 * Content‑word POS tags (nouns, adjectives, lexical verbs, adverbs).
 * Excludes:
 *   - determiners (including demonstratives)  – function words
 *   - possessive pronouns (PRP$)               – function words
 *   - Wh‑words (WDT, WP, WP$, WRB)            – function words
 *   - prepositions, conjunctions, particles, etc.
 */
const CONTENT_POS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS',   // nouns
  'JJ', 'JJR', 'JJS',           // adjectives
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ',  // lexical verbs (excludes modals MD)
  'RB', 'RBR', 'RBS',           // adverbs
  'CD',                         // cardinal numbers (content-like)
  'PDT',                        // predeterminers / quantifiers ("all", "both", "half") — carry quantificational stress
  'RP',                         // phrasal-verb particles ("coming IN", "take OFF") — they bear the phrasal stress
]);

/**
 * Spatial words that act as phrasal-verb PARTICLES (stress-bearing: "coming IN",
 * "moving ON", "give UP") as opposed to prepositions ("in the house" → reduced).
 * The parser usually tags a true particle `RP` (handled by CONTENT_POS above),
 * but often mis-tags it `IN`/`RB` with an adverbial/particle dependency on the
 * verb — `isPhrasalParticle` recovers those.  A genuine preposition keeps a
 * `prep`/`pobj` dependency on a NOUN and is (correctly) left as a function word.
 */
const PARTICLE_LEMMAS = new Set([
  'in', 'on', 'out', 'off', 'up', 'down', 'over', 'away', 'back',
  'along', 'around', 'about', 'through', 'apart', 'aside', 'forth', 'together',
]);

/** A phrasal-verb particle the parser tagged IN/RB (not RP): stress-bearing. */
function isPhrasalParticle(word: ClsWord): boolean {
  if (word.lexicalClass === 'RP') return true;
  const dep = word.dependency?.dependentType;
  return PARTICLE_LEMMAS.has(word.word.toLowerCase())
    && (dep === 'prt' || dep === 'advmod');
}

/** Demonstratives that, used pronominally (not determining a following noun),
 *  are a stressed focus: "What's THAT?", "Give me THIS." */
const DEMONSTRATIVE_LEMMAS = new Set(['that', 'this', 'these', 'those']);

/**
 * A demonstrative used as a *pronoun* (the clause-final focus), rather than as a
 * determiner of a following noun.  The parser often tags focus "that" as `IN`
 * (complementizer) and it then reduces to `x` — but "What's THAT?" puts the
 * sentence's prominence on it.  Detected as a demonstrative lemma that is the
 * last non-punctuation word of the line (so "Is THAT grass" — a determiner — is
 * untouched).
 */
function isFocusDemonstrative(words: ClsWord[], wi: number): boolean {
  if (!DEMONSTRATIVE_LEMMAS.has(words[wi].word.toLowerCase())) return false;
  for (let k = wi + 1; k < words.length; k++) {
    if (!isPunctuation(words[k].lexicalClass)) return false; // a word follows → determiner use
  }
  return true;
}

/**
 * Clitic POS categories: function words that are *proclitic* — prepositions /
 * subordinators (IN), infinitival "to" (TO), possessive determiners (PRP$) and
 * wh-determiners/possessives/adverbs (WDT/WP$/WRB).  A
 * *monosyllabic* word in one of these classes is reduced in running speech
 * (Selkirk's clitic; McAleese's "beginnings free") and should floor at 'w'
 * (overt-weak, *promotable*), never 'n'.  Leaving a CMU-primary monosyllable
 * like "on"/"my"/"where"/"from" at 'n' produced flat function-word runs (Pound's
 * "So on my" = n·n·n, "where strange" = n·n).
 *
 * Deliberately EXCLUDES:
 *   - modals (MD: "shall"/"might") and personal pronouns (PRP: "I"/"thee"/"you")
 *     — they carry real stress (the clause-final beat in "…fast as you MIGHT").
 *   - determiners (DT) entirely.  The quantificational / negative / demonstrative
 *     ones ("no one", "all verse", "this", "each") carry stress (cf. the
 *     maintainer's PDT-as-content rule); and flooring even the pure articles
 *     a/an tips Tarlinskaja's razor-thin iambic↔anapestic line ("…else a
 *     laugher's license", margin 0.009) into a wrong meter.  "the" already reads
 *     'x' via its CMU-0 stress, so determiners need no extra handling here.
 *   - coordinators (CC: and/but/or).  "and" already reads 'x' (CMU-0); flooring
 *     "but"→w fires earlier than its baseline path and ripples to suppress an
 *     adjacent pronoun's clash-promotion, tipping Tarlinskaja's razor-thin
 *     iambic↔anapestic line — and coordinators bear no part of the n-run problem.
 * Polysyllabic function words are also untouched, so their internal contour is
 * preserved (be·NEATH = x·n, un·der·NEATH = x·x·n).
 */
// NB: deliberately NOT including DT/PRP/MD/WP here.  Monosyllabic pronouns,
// determiners, and modals at 'n' are PROMOTABLE into metrical beats — which
// real iambic verse exploits constantly ("but HE gave NO one ELSE",
// "fast as you MIGHT").  Flooring them to 'w' was tried (2026-06-12) and
// flipped the Mandelstam anapest and the Tarlinskaja iambic: reverted.
const CLITIC_POS = new Set(['IN', 'TO', 'PRP$', 'WDT', 'WP$', 'WRB']);

/** A reducible monosyllabic proclitic (see CLITIC_POS). */
function isMonosyllabicClitic(word: ClsWord): boolean {
  return !word.isContent
    && word.syllables.length === 1
    && CLITIC_POS.has(word.lexicalClass);
}

/**
 * Temporal, locative, and discourse adverbs that behave as function words
 * in verse — they typically occupy weak metrical positions and should not
 * receive the primary-stress treatment of content adverbs.
 */
const FUNCTION_ADVERBS = new Set([
  'then', 'so', 'here', 'there', 'where', 'when', 'why', 'how',
  'thus', 'hence', 'thence', 'whence',
  'now', 'ago', 'afterwards', 'afterward', 'beforehand',
  'meanwhile', 'nevertheless', 'nonetheless', 'however',
  'therefore', 'furthermore', 'moreover',
  'besides', 'instead', 'rather',
  'quite', 'almost', 'nearly', 'just', 'only',
  'even', 'also', 'too', 'very', 'indeed',
  'already', 'yet', 'still', 'again', 'ever', 'never',
  'always', 'often', 'sometimes', 'usually',
  'today', 'tomorrow', 'yesterday', 'tonight',
]);

/**
 * Rising (iambic) disyllabic function words — prepositions, conjunctions, and
 * deictic adverbs that stress the SECOND syllable (be·CAUSE, a·BOUT, be·TWEEN).
 * A handful are recorded fully-reduced ("00") in the augmented dictionary; for
 * those the all-zero re-stamp must fix the FINAL syllable, NOT take the
 * disyllabic forestress default (which mis-read be·CAUSE as BE·cause).  The
 * re-stamp only fires on a genuine all-zero entry, so listing a word that
 * already carries a peak is harmless.  Trochaic IN·to / UN·to / ON·to are
 * deliberately excluded — they correctly keep forestress.
 */
const RISING_FUNCTION_WORDS = new Set([
  'because', 'about', 'above', 'around', 'across', 'along', 'among', 'amongst',
  'against', 'amid', 'amidst', 'apart', 'ahead', 'aside', 'away', 'aloft',
  'alone', 'aloud', 'anew', 'awhile', 'ago',
  'before', 'behind', 'below', 'beneath', 'beside', 'besides', 'between',
  'beyond', 'within', 'without',
]);

/**
 * Oblique (object/dative) pronouns.  In clause-final position these are
 * canonically unstressed and do NOT attract the beat ("…and beHIND me", not
 * "…and behind ME"), unlike a clause-final modal or content word.  Used to keep
 * the "endings strict" upbeat rule from promoting a final object pronoun.
 */
const OBLIQUE_PRONOUNS = new Set([
  'me', 'him', 'her', 'us', 'them', 'thee', 'ye',
]);

/**
 * Subject-pronoun contractions (pronoun + auxiliary).  These are a known data
 * anomaly: FinNLP mis-tags the line-initial "I"-forms as FW, and nounsing records
 * "i'm" with stress 0 while its sibling "i'll" gets 1 — so "I'm" sank to 'x'
 * (Zero-Provision) whereas "I'll" read 'n'.  A contracted subject pronoun is an
 * overt syllable, never a maximally-reduced clitic, so a dictionary-zero one is
 * restamped to its siblings' weak stress (below).  This is a TARGETED fix for that
 * specific inconsistency — it does NOT change how clitics, prepositions, articles,
 * or bare pronouns floor (those keep their broad 'x'/contour behaviour).
 */
const PRONOUN_SUBJECT_CONTRACTIONS = new Set([
  "i'm", "i'll", "i've", "i'd",
  "you're", "you'll", "you've", "you'd",
  "he'll", "he'd", "she'll", "she'd", "it'll",
  "we're", "we'll", "we've", "we'd",
  "they're", "they'll", "they've", "they'd",
]);

/**
 * Poetic aphaeresis / clipping forms (apostrophe-stripped, lowercased) of
 * function words — prepositions and adverbs.  These are OOV, so without special
 * handling they default to a *stressed content* reading (the parser tags
 * "'neath" as NNP → primary stress!).  Only applied when an apostrophe is
 * actually present (so a literal "mid"/"side"/"cross" is left alone).
 */
const APHAERESIS_CLITICS = new Set([
  'neath',  // beneath
  'gainst', // against
  'twixt',  // betwixt
  'mid',    // amid
  'midst',  // amidst
  'mongst', // amongst
  'tween',  // between
  'pon',    // upon
  'oer',    // o'er  = over
  'neer',   // ne'er = never
  'eer',    // e'er  = ever
  'tis',    // 'tis  = it is   (apostrophe-guarded, so a literal "tis" is untouched)
  'twas',   // 'twas = it was
  'twere',  // 'twere = it were
  'twill',  // 'twill = it will (guard protects the fabric "twill")
]);

/**
 * Augmented-CMU data anomalies: for a couple of very common monosyllables the
 * dictionary's ONLY profile is the letter-name spelling pronunciation of an
 * abbreviation homograph — "am" → "EY1 EH1 M" (= A.M.), "us" → "Y UW1 EH1 S"
 * (= U.S.) — inflating the syllable count of any line containing them.  We
 * restore the ordinary CMU citation form (AE1 M / AH1 S: one heavy syllable,
 * citation stress 1) before the dictionary is consulted.
 */
const ANOMALOUS_MONOSYLLABLES: Record<string, { syllab: string; stress?: number; weight?: 'H' | 'L' }> = {
  am: { syllab: '(AE m)' },
  us: { syllab: '(AH s)' },
  // "a" = letter-name "EY1" in the augmented dictionary; the article is the
  // canonical Zero-Provision clitic (schwa, open syllable) → stress 0, light.
  a: { syllab: '(AH)', stress: 0, weight: 'L' },
};

/**
 * Copula, auxiliary, aspectual, and light verbs that act as function words
 * in verse — they do not carry the main semantic or prosodic weight of a phrase
 * and should not be treated as content words for stress rules.
 */
const FUNCTION_VERBS = new Set([
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'done', 'doing',
  'get', 'gets', 'got', 'getting', 'gotten',
  'start', 'starts', 'started', 'starting',
  'begin', 'begins', 'began', 'beginning', 'begun',
  'keep', 'keeps', 'kept', 'keeping',
  'stop', 'stops', 'stopped', 'stopping',
  'continue', 'continues', 'continued', 'continuing',
  'let', 'lets', "let's"
]);

/** The copula / auxiliary forms of BE — they reduce in connected speech whether
 *  used as copula ("she IS fair" → reduced) or auxiliary ("is going"). */
const BE_FORMS = new Set(['be', 'am', 'is', 'are', 'was', 'were', 'being']);

/**
 * Exclamatory / vocative interjections.  These are emphatic, expressive elements —
 * never zero-provision clitics — yet FinNLP routinely mis-tags vocative "O" as a
 * preposition (IN) and "Lo" as a proper noun (NNP), which would otherwise floor
 * them to 'x'.  Keyed off the lemma (not the unreliable tag), they are raised to at
 * least 'n'; an exclaimed one ("O!", "Oh!") is lifted a further tier by the
 * interjection-emphasis pass at the end of assignRelativeStresses.  Apostrophe
 * forms (o'er = over, e'er = ever) are NOT here — they are aphaeresis clitics.
 */
const EXCLAM_INTERJECTIONS = new Set([
  'o', 'oh', 'ah', 'ay', 'aye', 'lo', 'alas', 'alack', 'hark', 'fie', 'woe',
  'ho', 'oho', 'aha', 'ahoy', 'hurrah', 'huzza',
]);

/**
 * Honest baseline relative prominence for a FUNCTION word (McAleese step 1b:
 * "w=weak, n=some stress, m=subordinate strong, s=strong").  A monosyllabic
 * function word bears no lexical *some-stress*; the dictionary's citation stress
 * (which marks "and"/"in"/"my"/"could" as primary) is a CITATION artefact, not
 * connected-speech prominence.  We floor it to its true reading prominence — the
 * meter layer still PROMOTES it to a beat where the metre calls for it (McAleese's
 * Appendix-A Test 2: stressless "than"/"in" stay weak in the contour; the metre
 * lifts only "from", which carries latent stress).  Returns the tier to floor to,
 * or null to leave the word untouched.
 *
 *   'x' (zero-provision) — pure schwa-proclitics that fully reduce: coordinators
 *       (CC: and/or/but/nor), monosyllabic prepositions & subordinators (IN), the
 *       infinitival/prepositional "to" (TO), possessive determiners (PRP$/WP$:
 *       my/your/his/her/its/our/their/whose).
 *   'w' (overt-weak, still meter-promotable) — full-vowel function words: personal
 *       pronouns (PRP), modals (MD), existential "there" (EX), the copula/auxiliary
 *       BE forms, the AUXILIARY uses of have/do (by dependency role — a main-verb
 *       "have"/"did" keeps its beat), and reduced deictic/discourse adverbs.
 *
 * Content words and the internal contour of POLYSYLLABIC function words
 * (be·NEATH = x·n, with·OUT) are returned null (untouched).
 */
function relativeFloorFor(word: ClsWord): StressLevel | null {
  if (word.isContent) return null;
  if (word.syllables.length !== 1) return null; // keep polysyllabic function contour
  const pos = word.lexicalClass;
  const lemma = word.word.toLowerCase().replace(/['’]/g, '');

  // Pure schwa-proclitics → zero-provision 'x'.
  if (pos === 'CC' || pos === 'PRP$' || pos === 'WP$' || pos === 'TO') return 'x';
  if (pos === 'IN') return 'x'; // prepositions / subordinators cliticise

  // Full-vowel weak function words → overt-weak 'w' (meter-promotable).
  if (pos === 'PRP' || pos === 'MD' || pos === 'EX') return 'w';
  if (BE_FORMS.has(lemma)) return 'w'; // copula & auxiliary BE both reduce
  // NB: have/do are deliberately NOT floored — unlike BE they routinely bear a
  // beat (main-verb "have"/"do", emphatic "DID"), and even as auxiliaries they
  // carry an iambic beat often enough ("what HAD I given") that flooring them
  // mis-reads such lines.  Their level is left to the clash filter + meter layer.
  if (FUNCTION_ADVERBS.has(lemma)) return 'w'; // so/then/here/there/when/just…
  return null;
}

/** Left‑stressed compound categories with example first‑word lists. */
const LEFT_STRESS_MATERIAL = new Set([
  'metal', 'wood', 'silk', 'cotton', 'glass', 'stone', 'iron', 'steel',
  'paper', 'plastic', 'gold', 'silver'
]);
const LEFT_STRESS_TIME = new Set([
  'morning', 'evening', 'summer', 'winter', 'spring', 'autumn',
  'christmas', 'easter', 'night', 'day'
]);
const LEFT_STRESS_MEASURE = new Set(['pint', 'dollar', 'foot', 'mile']);
const LEFT_STRESS_LOCATION = new Set([
  'city', 'mountain', 'river', 'street', 'valley', 'island',
  'town', 'village', 'country'
]);
const LEFT_STRESS_SELF = new Set(['self']);

// "Discard / ruin / spectral" noun-modifiers (N1) that reliably forestress as
// compounds: WASTE·land, SCRAP·yard, JUNK·yard, GHOST·town, DEAD·line,
// DUST·bowl, GRAVE·yard, BONE·yard, DEATH·bed.  (Eliot's "WASTE shore".)
const LEFT_STRESS_DISCARD = new Set([
  'waste', 'scrap', 'junk', 'ghost', 'dead', 'dust', 'grave', 'bone',
  'death', 'trash', 'garbage', 'ash', 'blood', 'rust', 'wreck',
]);
// Elemental / landscape noun-modifiers (N1) that reliably forestress:
// SEA·shore, MOON·light, STORM·cloud, WIND·mill, FIRE·place, SALT·marsh,
// FROST·bite, SAND·bar, SNOW·flake, TIDE·water, SHADOW·land.
const LEFT_STRESS_ELEMENTAL = new Set([
  'sea', 'moon', 'sun', 'star', 'storm', 'wind', 'fire', 'rain', 'snow',
  'ice', 'tide', 'wave', 'frost', 'mist', 'fog', 'mud', 'sand', 'salt',
  'earth', 'sky', 'dawn', 'dusk', 'shadow', 'flame', 'ember', 'smoke',
  'cloud', 'water', 'dew', 'hail', 'marsh', 'moor', 'flood', 'foam',
]);
// Fire / light-source N1 modifiers that forestress like the elemental set:
// TORCH·light, CANDLE·light, LAMP·light, LANTERN·light, BEACON·fire,
// HEARTH·stone, COAL·fire, GAS·light — and Pound's hyphenated TORCH·flames
// (parallel to WASTE·shore; "flames" is the head, "torch" the modifier).
const LEFT_STRESS_FIRELIGHT = new Set([
  'torch', 'candle', 'lamp', 'lantern', 'beacon', 'hearth', 'coal', 'gas',
]);
// Vehicle / conveyance N1 modifiers that forestress: SLEIGH·bells/blades,
// CART·wheel, WAGON·train, CAR·door, TRAIN·station, BOAT·house, TROLLEY·tickets.
// (Endocentric N+N where N1 is the conveyance the N2 belongs to / is part of.)
const LEFT_STRESS_VEHICLE = new Set([
  'sleigh', 'sled', 'cart', 'wagon', 'carriage', 'coach', 'train', 'tram',
  'trolley', 'car', 'boat', 'ship', 'plane', 'truck', 'bus', 'bike', 'bicycle',
]);
// Head nouns (N2) that keep phrasal/right stress even after a forestress
// modifier — chiefly food "made of N1" and a few lexical exceptions:
// apple PIE, summer DAY, Fifth AVenue.  These carve-outs keep the rule honest
// (a wrong forestress would mis-teach learners), so they OVERRIDE the N1 sets.
const RIGHT_STRESS_HEADS = new Set([
  'pie', 'cake', 'tart', 'pudding', 'mousse', 'soup', 'salad', 'sauce',
  'juice', 'avenue', 'day',
]);

/** Check if a pair of words forms a left‑stressed compound. */
export function isLeftStressedPair(w1: string, w2: string): boolean {
  const first = w1.toLowerCase();
  const second = w2.toLowerCase().replace(/'s$/, '');
  // A right-stressing head overrides any forestress modifier (apple PIE).
  if (RIGHT_STRESS_HEADS.has(second)) return false;
  if (LEFT_STRESS_MATERIAL.has(first)) return true;
  if (LEFT_STRESS_TIME.has(first)) return true;
  if (LEFT_STRESS_MEASURE.has(first)) return true;
  if (LEFT_STRESS_LOCATION.has(first)) return true;
  if (LEFT_STRESS_SELF.has(first)) return true;
  if (LEFT_STRESS_DISCARD.has(first)) return true;
  if (LEFT_STRESS_ELEMENTAL.has(first)) return true;
  if (LEFT_STRESS_FIRELIGHT.has(first)) return true;
  if (LEFT_STRESS_VEHICLE.has(first)) return true;
  return false;
}

/** True if `w2` is a head noun that keeps phrasal/right stress against an N1
 *  modifier (apple PIE, summer DAY, Fifth AVenue) — the marked right-stress
 *  exceptions to the otherwise fore-stressing Compound Stress Rule. */
export function isRightStressedHead(w2: string): boolean {
  return RIGHT_STRESS_HEADS.has(w2.toLowerCase().replace(/'s$/, ''));
}

/**
 * Direction of primary stress for an adjacent two-word modification structure,
 * the SINGLE source of truth shared by the lexical compound pass
 * (`applyCompoundStress`) and the Phrase-Stress phase (`computePhraseStress`),
 * so the two layers cannot disagree.
 *
 *   'left'  = fore-stress, primary on w1 — the Compound Stress Rule default for
 *             an N+N compound (Chomsky–Halle; McAleese's worked example marks
 *             ICE cream with primary on "ice", not "cream"): KITCHen table,
 *             WINdow frame, BEDroom door, plus the curated LEFT_STRESS_* sets.
 *   'right' = end-stress, primary on w2 — the marked exceptions: food/temporal
 *             "made of N1" heads (apple PIE, summer DAY), Adj+N which is phrasal
 *             not compound (sweet CREAM, red CAR), and proper-name sequences
 *             which carry their own right-headed prosody (New YORK, John SMITH).
 *   null    = not a compound/modification pair at all.
 *
 * The fore-stress default is restricted to COMMON-noun N+N: proper-noun pairs
 * (NNP/NNPS) are excluded because place- and personal-name sequences are not
 * reliably fore-stressed, and flipping them would mis-teach New YORK / John SMITH.
 */
export function compoundStressSide(
  w1: string, pos1: string, w2: string, pos2: string,
): 'left' | 'right' | null {
  const isNN = pos1.startsWith('N') && pos2.startsWith('N');
  const isAdjN = pos1.startsWith('J') && pos2.startsWith('N');
  if (!isNN && !isAdjN) return null;
  if (isLeftStressedPair(w1, w2)) return 'left';   // curated fore-stress modifier
  if (isRightStressedHead(w2)) return 'right';     // apple PIE, Fifth AVenue
  const proper = (p: string) => p === 'NNP' || p === 'NNPS';
  if (isNN && !proper(pos1) && !proper(pos2)) return 'left'; // common-N+N compound default
  return 'right';                                  // Adj+N phrasal / proper-name pair
}

/**
 * Lexicalised forestress COLLOCATIONS — fixed two-word phrases that stress the
 * LEFT element, even though the second word is not a noun (so the N+N/J+N
 * Compound Stress Rule does not reach them).  "GOOD old days/friend";
 * "the be-all and END-all".  Each entry's optional guard suppresses spurious
 * firing (e.g. "End ALL the wars" — the *verb* "end" + quantifier "all the
 * wars" — must NOT forestress; there "all" is a predeterminer PDT).
 */
const LEFT_STRESS_COLLOCATIONS: { w1: string; w2: string; ok?: (b: ClsWord) => boolean }[] = [
  { w1: 'good', w2: 'old' },                                    // GOOD old days
  { w1: 'end', w2: 'all', ok: w => w.lexicalClass !== 'PDT' },  // END-all (idiom), not "end ALL the wars"
];

/** True if (w1,w2) is a lexicalised forestress collocation in this context. */
function isLeftStressedCollocation(w1: ClsWord, w2: ClsWord): boolean {
  const b1 = w1.word.toLowerCase().replace(/[^a-z]/g, '');
  const b2 = w2.word.toLowerCase().replace(/[^a-z]/g, '');
  for (const c of LEFT_STRESS_COLLOCATIONS) {
    if (b1 === c.w1 && b2 === c.w2 && (!c.ok || c.ok(w2))) return true;
  }
  return false;
}

// ─── LEXICAL STRESS (pronouncingjs) ───────────────────────────────

const VOWEL_CHARS = new Set('aeiouyAEIOUY');

/** Archaic/locative pronominal compounds whose first element ends in a MEDIAL
 *  silent 'e' ("where·fore", "there·in"): the plain vowel-group count reads the
 *  'e' as a nucleus and over-counts.  Count the parts instead. */
const SILENT_E_COMPOUND_RE = /^(where|there|here)(fore|in|by|of|on|upon|at|to|with|out|after|under|unto|abouts?|soever)$/;

function countVowelGroups(word: string): number {
  {
    const m = word.toLowerCase().replace(/[^a-z]/g, '').match(SILENT_E_COMPOUND_RE);
    // Closed-class second elements; counted directly ("fore" would otherwise
    // read 2 — the small-word guard blocks the final-silent-e deduction).
    if (m) return 1 + (m[2] === 'soever' ? 3
      : /^(upon|after|under|unto|about)/.test(m[2]) ? 2 : 1);
  }
  const lower = word.toLowerCase().replace(/-/g, '').replace(/'s/g, '').replace(/'/g, '');
  const n = lower.length;
  let groups = 0;
  let inVowel = false;
  const vowelPositions: number[] = [];
  for (let i = 0; i < n; i++) {
    if (VOWEL_CHARS.has(lower[i])) {
      if (!inVowel) { groups++; vowelPositions.push(i); inVowel = true; }
    } else {
      inVowel = false;
    }
  }
  if (groups >= 3 && n > 2 && lower[n - 1] === 'e' && VOWEL_CHARS.has(lower[n - 1])) {
    const lastVowelStart = vowelPositions[vowelPositions.length - 1];
    if (lastVowelStart === n - 1) {
      groups--;
    }
  }
  return groups;
}

// ─── OUT-OF-VOCABULARY STRESS (two-tier fallback) ─────────────────
//
// When a word is absent from the augmented CMU dictionary, the old fallback
// blindly forestressed it (primary on syllable 0).  That mis-stresses the most
// common OOV case — *inflected/derived forms of common words* whose base IS in
// the lexicon ("voyaging" OOV, "voyage" present) — and many true OOV words too
// ("anfractuous" → AN·fractuous rather than an·FRAC·tuous).  We replace it with:
//   (1) MORPHOLOGICAL decomposition — strip a stress-neutral productive suffix,
//       reconstruct the stem's orthography, look it up, and reuse the stem's
//       *real* lexical stress (the suffix syllables are unstressed).
//   (2) the English Stress Rule (quantity-sensitive) for the genuine residual
//       (names, neologisms) with no recognisable stem.
// Both run ONLY in the OOV branch, so in-vocabulary scansion is untouched.

/** Strip one trailing doubled consonant (run·ning → run, stop·ped → stop). */
function deDouble(b: string): string {
  const m = b.match(/([^aeiou])\1$/i);
  return m ? b.slice(0, -1) : b;
}

/** True if a stem ends in a sibilant/affricate, so a following -s/-es is its own
 *  syllable (kiss·es, box·es, voy·a·ges) rather than a bare coda (cats). */
function isSibilantEnd(s: string): boolean {
  return /(s|z|x|sh|ch|ce|ge|se|ze|dge|tch)$/i.test(s);
}

/**
 * Stress-neutral productive suffixes (Hayes: these do not shift the stem's
 * stress).  `stems(base)` lists candidate stem spellings to try (order = most
 * likely first); `added(stem)` is how many *syllables* the suffix contributes.
 * Stress-SHIFTING suffixes (-ion/-ity/-ic/-ial/-ious/-ify…) are deliberately
 * omitted — treating them as neutral would mis-place the peak; they fall through
 * to the English Stress Rule (and are common enough to usually be in-lexicon).
 */
const SUFFIX_RULES: { suffix: string; stems: (b: string) => string[]; added: (stem: string) => number }[] = [
  { suffix: 'iness', stems: b => [b + 'y'],                 added: () => 1 }, // happi·ness ← happy
  { suffix: 'ily',   stems: b => [b + 'y'],                 added: () => 1 }, // happi·ly ← happy
  { suffix: 'ies',   stems: b => [b + 'y'],                 added: () => 0 }, // car·ries ← carry
  { suffix: 'ied',   stems: b => [b + 'y'],                 added: () => 0 }, // car·ried ← carry
  { suffix: 'ness',  stems: b => [b],                       added: () => 1 },
  { suffix: 'ment',  stems: b => [b],                       added: () => 1 },
  { suffix: 'less',  stems: b => [b],                       added: () => 1 },
  { suffix: 'ful',   stems: b => [b],                       added: () => 1 },
  { suffix: 'ings',  stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ing',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 }, // voy·a·ging ← voyage
  { suffix: 'est',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ed',    stems: b => [b + 'e', b, deDouble(b)], added: stem => /[td]$/.test(stem) ? 1 : 0 },
  { suffix: 'eth',   stems: b => [b + 'e', b, deDouble(b)], added: () => 1 }, // archaic 3sg: go·eth, fall·eth, mak·eth
  { suffix: 'ith',   stems: b => [b + 'y', b + 'e', b], added: () => 1 },     // archaic 3sg of -y verbs: sa·ith ← say
  { suffix: 'er',    stems: b => [b + 'e', b, deDouble(b)], added: () => 1 },
  { suffix: 'ly',    stems: b => [b],                       added: () => 1 }, // soft·ly ← soft
  { suffix: 'es',    stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
  { suffix: 's',     stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
];

/**
 * Tier 1 — derive an OOV word's numeric stress (2=primary, 1=secondary, 0=none)
 * by stripping a stress-neutral suffix and reusing the in-lexicon stem's stress.
 * Returns null if no productive suffix yields a known stem.
 */
function morphologicalStress(w: string): { pattern: number[]; suffix: string } | null {
  for (const rule of SUFFIX_RULES) {
    if (!w.endsWith(rule.suffix)) continue;
    const base = w.slice(0, w.length - rule.suffix.length);
    if (base.length < 2) continue; // guard tiny stems (sing → s+ing)
    for (const stem of rule.stems(base)) {
      if (stem.length < 2) continue;
      const data = nounsing.all(stem);
      const raw = data && data.length ? (data[0].stress?.stressTrans || '') : '';
      if (!raw) continue;
      const stemNumeric = [...raw].map(c => mapCMUStress(parseInt(c, 10)));
      if (stemNumeric.length === 0) continue;
      const added = rule.added(stem);
      return { pattern: [...stemNumeric, ...new Array(added).fill(0)], suffix: added >= 1 ? rule.suffix : '' };
    }
  }
  return null;
}

/** Archaic verbal suffixes whose orthographic peel cleanly separates a silent-
 *  consonant stem from the suffix for DISPLAY (know·est not kno·west).  Other
 *  suffixes keep the default orthographic syllabifier (it handles them well). */
const DISPLAY_PEEL_SUFFIXES = new Set(['est', 'eth', 'ith']);

/** Heavy syllable (orthographic estimate): long vowel (digraph/VCe) or closed
 *  by a coda consonant.  Light = open with a single short vowel. */
function syllableIsHeavy(syl: string): boolean {
  const s = syl.toLowerCase();
  if (/[aeiouy]{2}/.test(s)) return true;        // vowel digraph / diphthong → long
  if (/[aeiou][^aeiouy]e$/.test(s)) return true; // V·C·e → long ("ate", "ime")
  if (/[^aeiouy]$/.test(s)) return true;         // closed syllable (coda present)
  return false;
}

/**
 * Pre-stressing derivational suffixes (Hayes' "pre-stress 1/2"): they fix the
 * primary on a syllable counted from the word's end (`offset` = syllables back,
 * so primary index = n − offset).  -ic/-tion fix the penult (offset 2),
 * -ity/-graphy/-ical fix the antepenult (offset 3).  Longest-match-first
 * (enforced by the length sort below).
 *
 * The 2026-06-10 batch was DERIVED from the augmented CMU data itself
 * (nounsing's `suffixType` shift classes cross-checked against the `mainStress`
 * column over 3+-syllable words; every adopted ending ≥ 0.90 purity, most ≥ 0.96,
 * N ≥ 60).  This includes onomastic endings (-ski/-sky/-son/-berg/-gton …) that
 * matter for OOV proper names — frequent in translation work.  `-ary` is
 * preantepenult and only fires on 4+-syllable words (the n ≥ offset guard),
 * so BI-na-ry / ca-NA-ry style 3-syllable words fall through safely.
 * NOTE: vowel-hiatus suffixes (-ion/-ial/-ious) can be undercounted by the
 * orthographic syllable counter, so those stay approximate (documented limit).
 */
const PRESTRESS_SUFFIXES: { suffix: string; offset: number }[] = [
  // hand-curated originals (Hayes)
  { suffix: 'graphy', offset: 3 }, { suffix: 'ically', offset: 4 },
  { suffix: 'ation', offset: 2 }, { suffix: 'ition', offset: 2 },
  { suffix: 'itude', offset: 3 }, { suffix: 'ical', offset: 3 },
  { suffix: 'logy', offset: 3 }, { suffix: 'nomy', offset: 3 },
  { suffix: 'cracy', offset: 3 }, { suffix: 'pathy', offset: 3 },
  { suffix: 'meter', offset: 3 }, { suffix: 'tion', offset: 2 },
  { suffix: 'sion', offset: 2 }, { suffix: 'ity', offset: 3 },
  { suffix: 'ety', offset: 3 }, { suffix: 'ify', offset: 3 },
  { suffix: 'ics', offset: 2 }, { suffix: 'ic', offset: 2 },
  // data-derived 2026-06-10: final-stressing (ultShift)
  { suffix: 'ette', offset: 1 }, { suffix: 'ese', offset: 1 },
  { suffix: 'eer', offset: 1 }, { suffix: 'ique', offset: 1 },
  // -oon is a reliable final-stresser (bal·LOON, car·TOON, co·COON, after·NOON);
  // OOV-only.  -ee/-ade are deliberately NOT added: they are impure (COF·fee,
  // com·RADE, DEC·ade) and would mis-stress more than they fix.
  { suffix: 'oon', offset: 1 },
  // data-derived: penult-stressing
  { suffix: 'ion', offset: 2 }, { suffix: 'sive', offset: 2 },
  { suffix: 'lla', offset: 2 }, { suffix: 'llo', offset: 2 },
  { suffix: 'lli', offset: 2 }, { suffix: 'tti', offset: 2 },
  { suffix: 'ina', offset: 2 }, { suffix: 'ino', offset: 2 },
  { suffix: 'ano', offset: 2 }, { suffix: 'ana', offset: 2 },
  { suffix: 'ini', offset: 2 },
  { suffix: 'ski', offset: 2 }, { suffix: 'sky', offset: 2 },
  // data-derived: antepenult-stressing
  { suffix: 'ate', offset: 3 }, { suffix: 'cal', offset: 3 },
  { suffix: 'onal', offset: 3 }, { suffix: 'nger', offset: 3 },
  { suffix: 'son', offset: 3 }, { suffix: 'man', offset: 3 },
  { suffix: 'berg', offset: 3 }, { suffix: 'gton', offset: 3 },
  // data-derived: preantepenult-stressing (4+ syllables only via the guard)
  { suffix: 'ary', offset: 4 },
].sort((a, b) => b.suffix.length - a.suffix.length);

/**
 * Tier 2 — the English Stress Rule for genuine OOV (no recognisable stem).
 * First honours a pre-stressing derivational suffix (terRIF·ic, ac·TIV·i·ty,
 * pho·TOG·ra·phy).  Otherwise it is quantity-sensitive with final-syllable
 * extrametricality: monosyllables take primary; disyllables keep the English
 * forestress default; for 3+ syllables the final is extrametrical and stress
 * falls on a heavy penult, else the antepenult (Hayes 1982).  This fixes e.g.
 * an·FRAC·tuous / e·NIG·ma where blind forestress erred.
 */
function englishStressRule(w: string, isContent: boolean): number[] {
  const n = countVowelGroups(w);
  const primary = isContent ? 2 : 1;
  if (n <= 1) return [primary];
  for (const { suffix, offset } of PRESTRESS_SUFFIXES) {
    if (w.endsWith(suffix) && n >= offset) {
      const pattern = new Array(n).fill(0);
      pattern[n - offset] = primary;
      return pattern;
    }
  }
  if (n === 2) return [primary, 0]; // English disyllabic default (trochaic)
  const sylls = syllabifyWord(w, n);
  const pattern = new Array(n).fill(0);
  const penult = n - 2;                 // final (n-1) is extrametrical
  const heavyPenult = sylls[penult] ? syllableIsHeavy(sylls[penult]) : true;
  pattern[heavyPenult ? penult : Math.max(0, n - 3)] = primary;
  return pattern;
}

/**
 * Per-syllable heaviness from nounsing's `syllStruct` CV transcription
 * ("L.CL.CLC": C = consonant, L = lax/short nucleus, T = tense/long nucleus).
 * Heavy = tense nucleus OR closed syllable (a coda consonant after the nucleus).
 * Returns undefined when the segment count doesn't match the syllable count, so
 * callers fall back to the orthographic estimate.
 */
function heavyFromSyllStruct(syllStruct: string | undefined, n: number): boolean[] | undefined {
  if (!syllStruct) return undefined;
  const segs = syllStruct.split('.');
  if (segs.length !== n) return undefined;
  return segs.map(seg => {
    const vi = seg.search(/[LT]/);
    if (vi < 0) return false;
    return seg[vi] === 'T' || vi < seg.length - 1;
  });
}

/**
 * The syllable index that should bear the default stress of a polysyllabic word
 * whose dictionary entry records NO stress at all (an all-zero pattern — the
 * maximally-reduced citation form of a few function words, chiefly "into"=00).
 * Every lexical word bears at least one stress, so we restore it: a pre-stressing
 * suffix fixes the count-from-end syllable; otherwise the English forestress
 * default for disyllables (IN-to, ON-to), and the quantity-sensitive penult/
 * antepenult (Hayes) for longer words.  Mirrors englishStressRule's placement.
 * `heavyFlags` (real per-syllable quantity from nounsing's syllStruct) replaces
 * the orthographic heaviness guess when the word is in-vocabulary.
 */
function defaultStressIndex(word: string, n: number, heavyFlags?: boolean[]): number {
  for (const { suffix, offset } of PRESTRESS_SUFFIXES) {
    if (word.endsWith(suffix) && n >= offset) return n - offset;
  }
  if (n <= 2) return 0;                 // English disyllabic forestress default
  const penult = n - 2;                 // final (n-1) extrametrical
  const heavyPenult = heavyFlags
    ? heavyFlags[penult]
    : (() => { const sylls = syllabifyWord(word, n); return sylls[penult] ? syllableIsHeavy(sylls[penult]) : true; })();
  return heavyPenult ? penult : Math.max(0, n - 3);
}

/**
 * Map CMU stress (0=unstressed, 1=primary, 2=secondary) to
 * McAleese's numeric scale: 0=unstressed, 1=secondary, 2=primary.
 */
function mapCMUStress(cmuStress: number): number {
  if (cmuStress === 1) return 2;   // primary → 2
  if (cmuStress === 2) return 1;   // secondary → 1
  return 0;                        // unstressed → 0
}

/**
 * Assign per‑syllable lexical stress to each word in a sentence.
 *
 * Uses the first CMU pronunciation.  Function words have their
 * primary stress downgraded to secondary (2 → 1).
 */
export function assignLexicalStress(words: ClsWord[]): void {
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    if (isPunctuation(word.lexicalClass)) {
      word.syllables = [];
      continue;
    }

    // Explicitly assign 0 syllables to possessive/contraction clitic "'s"
    if (word.word === "'s") {
      word.syllables = [];
      continue;
    }

    // Poetic aphaeresis clipping ('neath, o'er, 'gainst…) → treat as the reduced
    // function word it stands for, instead of the OOV default (NNP → stressed).
    // Guard on an actual apostrophe (split off as the prior token, or internal),
    // so a literal "mid"/"side"/"cross" is untouched.
    {
      const bare = word.word.toLowerCase().replace(/['’]/g, '');
      const hasApostrophe = /['’]/.test(word.word)
        || (wi > 0 && (words[wi - 1].word === "'" || words[wi - 1].word === '’'));
      if (hasApostrophe && APHAERESIS_CLITICS.has(bare)) {
        word.isContent = false;
        // One weak monosyllable; lexical 0 + function ⇒ maps to 'x' (reduced clitic).
        word.syllables = [{ text: word.word, phones: '', stress: 0, lexicalStress: 0 }];
        continue;
      }
    }

    let lookupWord = word.word.toLowerCase();

    // Letter-name dictionary anomalies ("am" = A.M., "us" = U.S.): stamp the
    // ordinary citation monosyllable directly (see ANOMALOUS_MONOSYLLABLES).
    {
      const fix = ANOMALOUS_MONOSYLLABLES[lookupWord];
      if (fix) {
        const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
        word.isContent = isContent;
        const numeric = fix.stress ?? (isContent ? 2 : 1);   // citation primary; function words reduce to secondary
        word.syllables = [{ text: word.word, phones: fix.syllab, weight: fix.weight ?? 'H', stress: numeric, lexicalStress: numeric }];
        continue;
      }
    }

    // Elided article fused to its host (th'expense, th'inconstant): "th'" is
    // non-syllabic, so the HOST word's dictionary entry is the right source for
    // stress and syllable count — otherwise the fused token goes OOV and takes
    // the disyllabic forestress default (TH'EX-pense instead of th'ex-PENSE).
    {
      const m = lookupWord.match(/^th['’](.+)$/);
      if (m && m[1].length >= 2) lookupWord = m[1];
    }

    let allData = nounsing.all(lookupWord);
    if (!allData && lookupWord.includes('-')) {
      const noHyphen = lookupWord.replace(/-/g, '');
      allData = nounsing.all(noHyphen);
    }
    if ((!allData || allData.length === 0) && lookupWord.includes('-')) {
      const parts = lookupWord.split('-');
      const partStresses: string[] = [];
      const partWeights: string[] = [];
      for (const part of parts) {
        const partData = nounsing.all(part);
        if (partData && partData.length > 0) {
          partStresses.push(partData[0].stress.stressTrans || '');
          partWeights.push(partData[0].weightPattern || '');
        }
      }
      if (partStresses.length === parts.length && partStresses.every(s => s.length > 0)) {
        const combinedStress = partStresses.join('');
        const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
        word.isContent = isContent;
        const syls: Syllable[] = [];
        for (let i = 0; i < combinedStress.length; i++) {
          const cmu = parseInt(combinedStress[i], 10);
          let numeric = mapCMUStress(cmu);
          if (!isContent && numeric === 2) numeric = 1;
          syls.push({ text: word.word, phones: '', stress: numeric, lexicalStress: numeric });
        }
        word.syllables = syls;
        continue;
      }
    }
    if (!allData || allData.length === 0) {
      const cleanWord = word.word.toLowerCase().replace(/-/g, '').replace(/['’]/g, '');
      const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
      word.isContent = isContent;
      // Tier 1: morphological stem (reuse real lexical stress); Tier 2: ESR.
      const morph = morphologicalStress(cleanWord);
      const pattern = morph ? morph.pattern : englishStressRule(cleanWord, isContent);
      // Record an archaic verbal suffix so the display splits know·est, not kno·west.
      if (morph && DISPLAY_PEEL_SUFFIXES.has(morph.suffix)) word.morphSuffix = morph.suffix;
      const syls: Syllable[] = pattern.map(numeric => {
        // Mirror the in-vocab function-word reduction (primary → secondary).
        const n = (!isContent && numeric === 2) ? 1 : numeric;
        return { text: word.word, phones: '', stress: n, lexicalStress: n };
      });
      word.syllables = syls;
      continue;
    }

    // For nouns with multiple pronunciations, prefer front‑stressed (noun form).
    let profile = allData[0];
    if (allData.length > 1 && word.lexicalClass.startsWith('N')) {
      for (const p of allData) {
        const stressStr = p.stress.stressTrans;
        if (stressStr && stressStr.length > 0 && (stressStr[0] === '1' || stressStr[0] === '2')) {
          profile = p;
          break;
        }
      }
    }

    let rawStress = profile.stress.stressTrans || '';   // e.g., "010"

    // The CMU syllabification is authoritative for the syllable count.  The
    // orthographic vowel-group count UNDER-counts vowel-hiatus / glide words
    // (goo·ey, play·ers, be·ing each read as a single vowel run), so it must NOT
    // truncate the dictionary's count — doing so collapsed those to one syllable.
    // Only clamp when stressTrans is genuinely LONGER than the CMU
    // syllabification (a rare data inconsistency).
    const syllsMatch = (profile.phonology.syllabification || '').match(/\([^)]+\)/g) || [];
    if (syllsMatch.length > 0 && rawStress.length > syllsMatch.length) {
      rawStress = rawStress.slice(0, syllsMatch.length);
    }

    // Synaeresis (verse vowel-gliding): an UNSTRESSED open syllable ending in a
    // high-front vowel (IY/IH), followed by an UNSTRESSED vowel-initial syllable,
    // glides into one syllable in verse — As·syr·i·an → as·syr·yan, var·i·ous →
    // var·yous, glor·i·ous → glor·yous.  It does NOT fire on a stressed nucleus
    // (be·ing, i·DE·a) or before a stressed vowel (cre·ATE), so those keep their
    // full count.  Distinct from the (removed) orthographic truncation: it merges
    // only genuine glide pairs, leaving goo·ey / play·ers / po·et intact.
    if (syllsMatch.length === rawStress.length && rawStress.length >= 2) {
      const tokensOf = (s: string) => s.replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean);
      const mStress: string[] = [];
      const mSylls: string[] = [];
      for (let i = 0; i < rawStress.length; i++) {
        const cur = tokensOf(syllsMatch[i]);
        const last = cur[cur.length - 1] ?? '';
        const next = i + 1 < rawStress.length ? tokensOf(syllsMatch[i + 1]) : [];
        if (i + 1 < rawStress.length
            && rawStress[i] === '0' && rawStress[i + 1] === '0'
            && (last === 'IY' || last === 'IH')
            && /^[AEIOU]/.test(next[0] ?? '')) {
          mStress.push('0');
          mSylls.push('(' + cur.concat(next).join(' ') + ')');
          i++; // absorb the glided syllable
        } else {
          mStress.push(rawStress[i]);
          mSylls.push(syllsMatch[i]);
        }
      }
      rawStress = mStress.join('');
      syllsMatch.splice(0, syllsMatch.length, ...mSylls);
    }

    // All-zero CMU pattern on a polysyllabic word: restore the default stress.
    // A handful of reduced function words (chiefly "into"=00) are recorded with
    // NO stress at all, which left every syllable at 'x' (in·to = x·x) — both
    // unlike careful usage (IN-to) and metrically inert.  Every lexical word
    // bears a stress, so we re-stamp a CMU primary on the default-stress syllable
    // (forestress for disyllables); function-word demotion downstream turns this
    // into a secondary, giving the natural IN-to contour.  Only fires on the
    // genuine all-zero artifact, so words that already carry a peak are untouched.
    if (rawStress.length >= 2 && /^0+$/.test(rawStress)) {
      const cw = word.word.toLowerCase().replace(/-/g, '').replace(/['’]/g, '');
      const heavy = heavyFromSyllStruct(profile.phonology.syllStruct, rawStress.length);
      // Rising/iambic function words (be·CAUSE, a·BOUT) recorded fully-reduced
      // take FINAL-syllable stress; everything else keeps the forestress default
      // (IN·to, and polysyllabic content artifacts).
      const idx = RISING_FUNCTION_WORDS.has(cw)
        ? rawStress.length - 1
        : defaultStressIndex(cw, rawStress.length, heavy);
      rawStress = rawStress.split('').map((c, i) => (i === idx ? '1' : '0')).join('');
    }

    // Targeted fix for the "I'm" anomaly: a subject-pronoun contraction the
    // dictionary records as fully unstressed ("i'm"=0, while "i'll"=1) is restamped
    // to a weak (function) stress, so it reads like its siblings ('n') rather than
    // sinking to Zero-Provision 'x'.  Narrow by construction — only fires on a
    // monosyllabic, genuinely all-zero pronoun contraction; everything else is
    // left exactly as it was.
    if (rawStress === '0' && PRONOUN_SUBJECT_CONTRACTIONS.has(lookupWord)) {
      rawStress = '1';
    }

    const isContent = isContentWord(word.lexicalClass, word.word) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
    word.isContent = isContent;

    const syllables: Syllable[] = [];
    const weightsArray = (profile.weightPattern || '').split(' ').filter(x => x === 'H' || x === 'L');
    
    // Determine extrametricality classification for the final syllable.
    // Uses Hayes (1980) constraints: only Light edge syllables, only noun final syllables,
    // morphological s/z (plural/tense) markers, and derivational suffixes in adjectives.
    const sClassifier = profile.S ?? '';
    // Extrametricality is a property of nouns / derived adjectives.  Key it off
    // the word's actual sentence POS (from the parser), NOT nounsing's lexical
    // pos — otherwise function words like the preposition "underneath" (which the
    // CMU data may tag nominally) wrongly lose the stress on their final syllable.
    const isNoun = word.lexicalClass.startsWith('N');
    const isAdj = word.lexicalClass.startsWith('JJ');
    const finalWeight = profile.weight.find(w => w.syllable === 'final')?.heaviness ?? '';
    const nsylls = rawStress.length;
    
    let extrametricalType: Syllable['extrametrical'] = undefined;
    if (nsylls >= 2) {
      if ((sClassifier === 'S' || sClassifier === 'SCluster') && isNoun) {
        extrametricalType = 'morphological';
      } else if (isNoun && finalWeight === 'L' && nsylls >= 3) {
        extrametricalType = 'light_noun';
      } else if (isAdj && profile.morphology.suffix === 'suffix') {
        extrametricalType = 'derivational';
      }
    }

    const phonesTokens = profile.phonology.phones.split(' ');
    let phoneIdx = 0;

    for (let i = 0; i < rawStress.length; i++) {
      const ch = rawStress[i];
      const cmu = parseInt(ch, 10);
      let numeric = mapCMUStress(cmu);
      // Function words are reduced in running speech, but their INTERNAL stress
      // contour must be preserved: demote the primary syllable to secondary AND
      // the secondary syllables to none, so the lexical peak stays the peak.
      // (Flattening primary→secondary alone would tie "un" and "neath" in
      //  "underneath", letting a later clash invert it to ÚN-der-neath.)
      if (!isContent) {
        if (numeric === 2) numeric = 1;
        else if (numeric === 1) numeric = 0;
      }

      const wPatLen = weightsArray.length;
      const rLen = rawStress.length;
      const wIdx = wPatLen - (rLen - i);
      const weight = wIdx >= 0 && wIdx < wPatLen ? weightsArray[wIdx] as 'H' | 'L' : 'L';
      
      const sylTextMatch = syllsMatch[i];
      const sylText = sylTextMatch ? sylTextMatch.replace(/[()]/g, '') : word.word;

      const sylPhonesMatch = syllsMatch[i] || '';
      const isLastSyl = i === rawStress.length - 1;

      syllables.push({
        text: sylText,
        phones: sylPhonesMatch,
        weight,
        stress: numeric,
        lexicalStress: numeric,
        relativeStress: undefined,
        extrametrical: isLastSyl ? extrametricalType : undefined,
      });
    }

    if (extrametricalType) {
        word.lexicalDetails = `extrametrical_${extrametricalType}`;
    }

    // A focus demonstrative ("What's THAT?", "Give me THIS.") carries PRIMARY
    // stress; CMU lists the weak/reduced (complementizer) form, which would leave
    // it merely 'n' after the nuclear boost.  Force its peak to primary so the
    // sentence's prominence lands on it.
    if (isFocusDemonstrative(words, wi) && syllables.length > 0) {
      const pk = syllables.reduce((a, b) => (b.stress >= a.stress ? b : a));
      pk.stress = 2;
      pk.lexicalStress = 2;
    }

    word.syllables = syllables;
  }
}

// ─── COMPOUND STRESS RULE ─────────────────────────────────────────

/**
 * Adjust stresses for nominal compounds.
 *
 * Fore-stressed by default: an N+N compound puts primary (2) on the first
 * element, secondary (1) on the second — the Compound Stress Rule (Chomsky–
 * Halle; McAleese marks ICE cream with primary on "ice", KITCHen table,
 * WINdow frame).  The marked right-stress exceptions — food/temporal "made of"
 * heads (apple PIE), Adj+N phrases (sweet CREAM), and proper-name sequences
 * (New YORK) — reverse it.  All of this lives in `compoundStressSide`.
 */
export function applyCompoundStress(ius: IntonationalUnit[]): void {
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const words = collectPPTokens(pp);
      // We don't want compound stress applied between arbitrary words across a phrase!
      // Only apply to ADJACENT content words!
      const contentWords = words.filter(w => w.isContent);
      for (let i = 0; i < contentWords.length - 1; i++) {
        const w1 = contentWords[i];
        const w2 = contentWords[i + 1];

        // Wait, they must be adjacent in the sentence!
        if (Math.abs(w1.absoluteIndex - w2.absoluteIndex) !== 1) continue;

        const side = compoundStressSide(w1.word, w1.lexicalClass, w2.word, w2.lexicalClass);
        if (side === null) continue;

        if (side === 'left') {
          setPrimaryStress(w1, 2);
          setPrimaryStress(w2, 1);
        } else {
          setPrimaryStress(w1, 1);
          setPrimaryStress(w2, 2);
        }
      }
    }
  }
}

/** Locate the syllable with the highest stress and set it to `value`. */
export function setPrimaryStress(word: ClsWord, value: number): void {
  let maxIdx = -1;
  let maxVal = -1;
  for (let i = 0; i < word.syllables.length; i++) {
    if (word.syllables[i].stress > maxVal) {
      maxVal = word.syllables[i].stress;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) {
    word.syllables[maxIdx].stress = value;
  }
}

// ─── NUCLEAR STRESS RULE ──────────────────────────────────────────

/**
 * Recursively assign higher stress to content words from right to left.
 * Only the rightmost content word receives a boost (+1 above lexical primary).
 * All other content words keep their lexical stress.
 * This preserves lexical stress for meter detection while still indicating
 * the nuclear accent for phonological phrasing.
 */
export function applyNuclearStress(ius: IntonationalUnit[]): void {
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const words = collectPPTokens(pp).sort((a, b) => a.index - b.index);
      // The nuclear accent normally lands on the rightmost CONTENT word.
      let target: ClsWord | null = null;
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i].isContent) { target = words[i]; break; }
      }
      // But a content-less phrase ending in a non-oblique personal pronoun puts
      // the nuclear accent on that final pronoun (NSR: the accent falls on the
      // last accentable item; a clause-final addressee/focus pronoun bears it —
      // "…to YOU").  Only when there is no content word to carry it, so "I KNOW
      // you" is untouched; oblique objects (me/him/them) stay deaccented.
      if (!target) {
        let lastIdx = -1;
        for (let i = words.length - 1; i >= 0; i--) {
          if (!isPunctuation(words[i].lexicalClass)) { lastIdx = i; break; }
        }
        if (lastIdx >= 0) {
          const w = words[lastIdx];
          if (w.lexicalClass === 'PRP'
              && !OBLIQUE_PRONOUNS.has(w.word.toLowerCase().replace(/['’]/g, ''))) {
            target = w;
          }
        }
      }
      if (target) {
        let maxIdx = -1;
        let maxVal = -1;
        for (let j = 0; j < target.syllables.length; j++) {
          if (target.syllables[j].stress > maxVal) {
            maxVal = target.syllables[j].stress;
            maxIdx = j;
          }
        }
        if (maxIdx >= 0) target.syllables[maxIdx].stress += 1;
      }
    }
  }
}

// ─── RELATIVE STRESS ASSIGNMENT (4‑LEVEL) ─────────────────────────

/**
 * Phrase-edge sets used for the "endings strict / beginnings loose" floor gate.
 * McAleese (after Hayes & Kaun): metrical and lexical stress coincide at the
 * ENDS of phonological units (clitic phrase 90% / phonological phrase 97% /
 * intonational unit 99%); Selkirk notes a function word is not reduced at the
 * end of a clitic phrase ("of" never → "o'" there).  So a function word at the
 * right edge of a PP or IU — or the phrase-stress PEAK (nucleus) of its PP —
 * resists the citation-floor reduction, while interior / left-edge function
 * words reduce as before.  Reads the Phrase-Stress phase (word.phraseStress).
 */
function phraseEdgeSets(ius: IntonationalUnit[]): {
  ppFinal: Set<ClsWord>; iuFinal: Set<ClsWord>; ppPeak: Set<ClsWord>;
} {
  const ppFinal = new Set<ClsWord>();
  const iuFinal = new Set<ClsWord>();
  const ppPeak = new Set<ClsWord>();
  for (const iu of ius) {
    let iuLast: ClsWord | null = null;
    for (const pp of iu.phonologicalPhrases) {
      const toks = collectPPTokens(pp)
        .filter(w => !isPunctuation(w.lexicalClass))
        .sort((a, b) => a.index - b.index);
      if (toks.length === 0) continue;
      const last = toks[toks.length - 1];
      ppFinal.add(last);
      iuLast = last;
      let peak = toks[0];
      let peakVal = peak.phraseStress ?? 0;
      for (const t of toks) {
        const v = t.phraseStress ?? 0;
        if (v > peakVal) { peak = t; peakVal = v; }
      }
      // Only protect a genuine nuclear ramp peak (phraseStress ≥ 2): an all-floor
      // PP (all function words, or the Phase-Stress phase not run) has no nucleus
      // to protect, so we must not spuriously shield its first token.
      if (peakVal >= 2) ppPeak.add(peak);
    }
    if (iuLast) iuFinal.add(iuLast);
  }
  return { ppFinal, iuFinal, ppPeak };
}

/**
 * Convert numeric per‑syllable stress to McAleese’s symbolic levels
 * (w, n, m, s) and resolve adjacent identical stresses using dependency
 * information.
 */
export function assignRelativeStresses(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Phrase-edge sets for the endings-strict floor gate (read from Phase-Stress).
  const edges = phraseEdgeSets(ius);
  // Syllables raised by dependency-mined prominence (stranded preposition,
  // contrastive possessive, vocative): protected from the per-PP trailing-run
  // flatten so the recovered beat survives.
  const prominenceProtected = new Set<Syllable>();

  // First pass: numeric → symbolic (0→w, 1→n, 2→m, 3+→s)
  // Use lexicalStress (pre-nuclear) so nuclear stress doesn't corrupt meter detection.
  for (const word of words) {
    for (const syl of word.syllables) {
      const val = syl.lexicalStress ?? syl.stress;
      if (val === 0) {
        // Zero-Provision (`x`) for a maximally-reduced clitic: a stressless
        // syllable of a function word reads *below* a stressless content
        // syllable (the/a/of/and… vs. the weak syllable of a content word).
        // EXCEPTION: an aphaeresis clipping ('neath/o'er/'gainst…) is the
        // *lexically-stressed* syllable of its base word surviving the clip — an
        // overt syllable carrying real stress, merely reduced in context.  `x`
        // means extrametrical (Hayes' zero-provision), which it is NOT; so it
        // floors at `w` (overt weak), promotable like any weak syllable.
        const bare = word.word.toLowerCase().replace(/['’]/g, '');
        // Function VERBS (copula/aux/aspectual: be/is/keeps/began…) and
        // function ADVERBS (deictic/scalar: just/now/then/here/there…) floor
        // at 'w', not 'x': both classes carry full, unreducible vowels —
        // 'x' is for schwa-able clitics (the/a/of/and).  At 'w' they remain
        // Attridge-promotable, recovering e.g. the dactylic opening beat of
        // "JUST for a riband to STICK in his coat" (Browning).
        if (word.isContent || APHAERESIS_CLITICS.has(bare)
            || FUNCTION_VERBS.has(bare) || FUNCTION_ADVERBS.has(bare)) {
          syl.relativeStress = 'w';
        } else {
          syl.relativeStress = 'x';
        }
      } else if (val === 1) {
        syl.relativeStress = 'n';
      } else if (val === 2) {
        syl.relativeStress = 'm';
      } else {
        syl.relativeStress = 's';
      }
      // Monosyllabic function clitic → floor at 'w' (overt-weak, promotable),
      // never 'n'.  A CMU-primary monosyllabic preposition/determiner/possessive/
      // wh-word/coordinator is reduced in running speech; flooring it at 'n' is
      // what produced the flat function-word runs ("So on my", "where strange").
      // (Pure clitics the/a/of already read 'x' via the val===0 branch.)
      if (syl.relativeStress === 'n'
          && (isMonosyllabicClitic(word) || word.word.toLowerCase() === 'am')) {
        // "am" (1sg copula) is reliably reduced — far more so than beat-bearing
        // is/are/was/were — so it floors at 'w' (still Attridge-promotable) rather
        // than surfacing at 'm' as a spurious beat in "As I am BLOOD…".  Kept to
        // this one form: flooring all be-verbs regressed Wyatt's accentual + corpus.
        syl.relativeStress = 'w';
      }
      // Downgrade extrametrical syllables by one level.  We do NOT push a weak
      // syllable to 'x' here: 'x' (zero-provision) is reserved for maximally-
      // reduced *clitics*, whereas a weak *content* syllable (e.g. the feminine
      // ending "li·cense") stays 'w' per the maintainer's tier semantics.
      if (syl.extrametrical === 'morphological') {
        if (syl.relativeStress === 'n') syl.relativeStress = 'w';
        else if (syl.relativeStress === 'm') syl.relativeStress = 'n';
        else if (syl.relativeStress === 's') syl.relativeStress = 'm';
      }
    }

    // Honest baseline prominence: floor a monosyllabic function word to its true
    // reading prominence ('x' schwa-clitic / 'w' overt-weak), never raising it.
    // The dictionary's citation stress on "and"/"in"/"my"/"could" is an artefact;
    // the meter layer re-promotes these where the metre needs a beat.
    //
    // ENDINGS STRICT / BEGINNINGS LOOSE (McAleese; Selkirk): withhold the floor
    // for a function word at the right edge of a PP or IU, or one that is its
    // PP's phrase-stress peak — it resists reduction there (a stranded/clause-
    // final "to"/"you"/"of" is not crushed to a clitic).  Oblique object
    // pronouns (me/him/thee…) are excepted: they stay default-deaccented even
    // phrase-finally ("I gave it to HIM" only under focus, handled later).
    const lemma = word.word.toLowerCase().replace(/['’]/g, '');
    const edgeProtected =
      (edges.iuFinal.has(word) || edges.ppFinal.has(word) || edges.ppPeak.has(word))
      && !OBLIQUE_PRONOUNS.has(lemma);
    const floor = relativeFloorFor(word);
    if (floor && !edgeProtected) {
      const fr = STRESS_RANK[floor];
      for (const syl of word.syllables) {
        if (STRESS_RANK[syl.relativeStress ?? 'w'] > fr) syl.relativeStress = floor;
      }
    }

    // Dependency-mined prominence (the parse IS the semantic layer): recover the
    // beat a flat POS floor would crush.  A STRANDED preposition ("waiting FOR",
    // "stare AT") and a CONTRASTIVE possessive ("THY choice, not mine") bear
    // real stress → raise the peak to at least 'n' (promotable); a VOCATIVE
    // address ("Sing, O GODDESS") to at least 'm'.  Raise-only; the raised peak
    // is protected from the per-PP trailing-run flatten below.
    let promoteTo: StressLevel | null = null;
    if (isVocative(word, words) || isDeicticLocative(word, words)) promoteTo = 'm';
    else if (isStrandedPreposition(word, words) || isContrastivePossessive(word, words)) promoteTo = 'n';
    if (promoteTo) {
      const pk = wordPeak(word);
      if (pk && STRESS_RANK[pk.relativeStress ?? 'w'] < STRESS_RANK[promoteTo]) {
        pk.relativeStress = promoteTo;
      }
      if (pk) prominenceProtected.add(pk);
    }

    // Exclamatory interjection ("O", "Oh", "Ah", "Lo", "Alas"): emphatic, never
    // reduced — raise its peak to at least 'n' (corrects the mis-tag that floored
    // vocative "O"→IN→'x').  Raise-only; an exclaimed one is lifted further below.
    if (EXCLAM_INTERJECTIONS.has(word.word.toLowerCase())) {
      const pk = wordPeak(word);
      if (pk && STRESS_RANK[pk.relativeStress ?? 'w'] < STRESS_RANK.n) pk.relativeStress = 'n';
    }
  }

  // Apply nuclear stress boosts to relative stress.
  // `syl.stress` may be higher than `syl.lexicalStress` after applyNuclearStress
  // boosted the rightmost content word. Each level of increase promotes the
  // relative stress by one tier: w→n, n→m, m→s.
  for (const word of words) {
    for (const syl of word.syllables) {
      const base = syl.lexicalStress ?? 0;
      const boost = syl.stress - base;
      if (boost > 0) {
        let current = syl.relativeStress ?? 'w';
        for (let i = 0; i < boost; i++) {
          if (current === 'x') current = 'w';
          else if (current === 'w') current = 'n';
          else if (current === 'n') current = 'm';
          else if (current === 'm') current = 's';
        }
        syl.relativeStress = current;
      }
    }
  }

  // Second pass: resolve adjacent identical stresses within each phonological phrase
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const ppWords = collectPPTokens(pp);
      resolveAdjacentClashes(ppWords, prominenceProtected);
    }
  }

  // Third pass: resolve clashes across prosodic boundaries (PP and IU).
  // McAleese: when two adjacent syllables at a prosodic boundary have equal stress
  // and one is a function word, demote the function word (beginnings-free principle).
  resolveCrossBoundaryClashes(words, ius);

  // Compound forestress (linear surface order): a left-stressed compound's
  // prominence sits on its LEFT element (WASTE·shore, SEA·shore, GHOST·town).
  // The phrasal compound/nuclear rules run in hierarchy order, which a mis-
  // grouped parse can split (e.g. "a cavernous waste shore" separating
  // waste/shore), so we re-assert forestress here on true surface adjacency,
  // after the clash passes, so it survives the rightmost-content nuclear boost.
  resolveCompoundForestress(words);
  resolveCollocationForestress(words);
  resolveHyphenCompounds(words);

  // Fourth pass: resolve clashes on the LINEAR SURFACE order.  A stress clash is
  // a property of *contiguous pronounced* syllables (Hayes' "two contiguous
  // syllables"), i.e. surface order — but the phrasal passes above run in
  // hierarchy order, which a mis-grouped parse can scramble (e.g. "a cavernous
  // waste shore" leaving "waste"/"shore" non-adjacent in the tree though
  // contiguous in speech).  Catch any residual cardinal s–s clash here.
  resolveLinearClashes(words);

  // Exclaimed interjection: an interjection immediately followed by "!" (Oh!, Ah!,
  // O!, Lo!) is an emphatic peak — raise it one tier so it stands out from a flat
  // run of neighbouring function words ("But—Oh! ye lords…" was a monotone n·n·n,
  // with the interjection no louder than the conjunction beside it).  Narrow by
  // construction: only an UH whose very next token is "!".
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    if (w.lexicalClass !== 'UH' || w.syllables.length === 0) continue;
    if (words[i + 1].word !== '!') continue;
    const pk = wordPeak(w);
    if (!pk) continue;
    const r = STRESS_RANK[pk.relativeStress ?? 'w'];
    if (r < STRESS_RANK.s) pk.relativeStress = STRESS_LEVELS[r + 1];
  }

}

/** Ascending rank of the 5 relative-stress tiers, for level arithmetic. */
const STRESS_RANK: Record<StressLevel, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const STRESS_LEVELS: StressLevel[] = ['x', 'w', 'n', 'm', 's'];

/**
 * Re-assert left-stress on forestressed compounds over the LINEAR surface
 * sequence (e.g. WASTE·shore, SEA·shore, GHOST·town, STORM·cloud).  For each
 * pair of truly-adjacent content words (by absoluteIndex) that the Compound
 * Stress Rule marks left-stressed, the left element's peak is raised to the
 * pair's maximum prominence and the right element's peak is demoted one rung
 * below it — never raising the subordinate.  Runs on surface order so it works
 * even when the parse mis-groups the two into different phrases.
 */
function resolveCompoundForestress(words: ClsWord[]): void {
  const content = words.filter(w => w.isContent && !isPunctuation(w.lexicalClass));
  for (let i = 0; i < content.length - 1; i++) {
    const w1 = content[i];
    const w2 = content[i + 1];
    if (Math.abs(w1.absoluteIndex - w2.absoluteIndex) !== 1) continue; // truly adjacent
    const pos1 = w1.lexicalClass, pos2 = w2.lexicalClass;
    if (!(pos2.startsWith('N') && (pos1.startsWith('N') || pos1.startsWith('J')))) continue;
    if (!isLeftStressedPair(w1.word, w2.word)) continue;

    const s1 = wordPeak(w1);
    const s2 = wordPeak(w2);
    if (!s1 || !s2) continue;
    const r1 = STRESS_RANK[s1.relativeStress ?? 'w'];
    const r2 = STRESS_RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = STRESS_LEVELS[hi];                         // head ≥ both
    s2.relativeStress = STRESS_LEVELS[Math.min(r2, Math.max(0, hi - 1))]; // demote-only
  }
}

/**
 * Forestress lexicalised collocations (GOOD old, END-all) over the LINEAR
 * surface sequence.  Unlike `resolveCompoundForestress` this iterates ALL words
 * (not just content), because a collocation's second element may be a function
 * word ("end ALL" — "all" is a determiner): raise the left element's peak to the
 * pair maximum and demote the right one rung (demote-only, never raises the
 * subordinate).
 */
function resolveCollocationForestress(words: ClsWord[]): void {
  const seq = words
    .filter(w => !isPunctuation(w.lexicalClass) && w.syllables.length > 0)
    .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  for (let i = 0; i < seq.length - 1; i++) {
    const w1 = seq[i];
    const w2 = seq[i + 1];
    if (w2.absoluteIndex - w1.absoluteIndex !== 1) continue; // truly adjacent
    if (!isLeftStressedCollocation(w1, w2)) continue;

    const s1 = wordPeak(w1);
    const s2 = wordPeak(w2);
    if (!s1 || !s2) continue;
    const r1 = STRESS_RANK[s1.relativeStress ?? 'w'];
    const r2 = STRESS_RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = STRESS_LEVELS[hi];                         // left element ≥ both
    s2.relativeStress = STRESS_LEVELS[Math.min(r2, Math.max(0, hi - 1))]; // demote-only
  }
}

/**
 * Resolve the dual-strong clash at a hyphen seam inside a compound word
 * ("torch-flames", "blood-red").  The parser keeps a hyphenated compound as a
 * single token, so the word-level compound and clash passes never see its two
 * halves — left alone, both keep primary stress (s·s).  For a hyphenated content
 * word whose hyphen parts align 1:1 with its syllables, an adjacent s·s seam is
 * resolved with the same logic as a two-word compound: forestress the left if it
 * is a known forestress modifier, otherwise retract the left (the nuclear /
 * right-stress default, e.g. torch-FLAMES).
 */
function resolveHyphenCompounds(words: ClsWord[]): void {
  for (const w of words) {
    if (!w.isContent || !w.word.includes('-')) continue;
    const parts = w.word.split('-').filter(p => p.length > 0);
    if (parts.length < 2 || parts.length !== w.syllables.length) continue;
    for (let i = 0; i < w.syllables.length - 1; i++) {
      const a = w.syllables[i];
      const b = w.syllables[i + 1];
      // An equal-strong seam (s·s or m·m) is the unresolved compound clash.
      const equalStrong = a.relativeStress === b.relativeStress
        && (a.relativeStress === 's' || a.relativeStress === 'm');
      if (equalStrong) {
        if (isLeftStressedPair(parts[i], parts[i + 1])) demoteOneLevel(b); // BLOOD-red
        else demoteOneLevel(a);                                            // torch-FLAMES
      }
    }
  }
}

/**
 * THE CLASH FILTER — an absolute surface well-formedness constraint.
 *
 * On the STRESSED tier {n, m, s} no two *contiguous* syllables may carry the SAME
 * level: that is a stress clash (two equal prominences with no gradation between
 * them), which English categorically disallows.  Gradient pairs (sm/ms/sn/ns/mn/nm)
 * are fine — there is still a step down — as are runs of the unstressed tiers
 * {w, x} (an unstressed sequence is tolerated, if not ideal).  This generalises
 * McAleese's Appendix-A step 3d-ii ("stress clashes (ss, ms) > s-s") and Liberman
 * & Prince's (1977) grid alternation to every level of the strong tier.
 *
 * Resolution is DEMOTE-ONLY (never promote — promotion is the meter layer's job,
 * McAleese Test 2), so the contour is never inflated to break a clash; we iterate
 * to a fixed point (each change strictly lowers total stress mass, so it
 * terminates).  Which member yields is decided by `demoteRightOfClash` (grid-based
 * relative prominence).  Runs on the LINEAR surface order because a clash is a
 * property of contiguous *pronounced* syllables (Hayes), which a mis-grouped
 * dependency parse can scatter across phrases.
 */
export function resolveLinearClashes(words: ClsWord[]): void {
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of words) for (const s of w.syllables) flat.push({ word: w, syl: s });

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 24) {
    changed = false;
    for (let i = 0; i < flat.length - 1; i++) {
      const a = flat[i];
      const b = flat[i + 1];
      const lvl = a.syl.relativeStress;
      if (lvl !== b.syl.relativeStress) continue;
      if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue; // only the stressed tier clashes
      // Intra-word clashes are NOT skipped: a hyphenated-compound seam
      // (deep·voiced, snow·storm, gate·bolts) or any word with two adjacent equal
      // stresses is still a clash, and must be made gradient like any other.

      if (demoteRightOfClash(flat, i)) demoteOneLevel(b.syl);
      else demoteOneLevel(a.syl);
      changed = true;
    }
  }
}

/**
 * Decide which member of an equal-stress clash at (i, i+1) yields.  Rather than a
 * blunt leftward retraction, a layered cascade consults — in descending
 * authority — lexical, syntactic, and phonological context, so the demotion is
 * theory-grounded and the arbitrary default fires only as a last resort.  Returns
 * true to demote the RIGHT member (i+1), false to demote the LEFT (i).
 *
 *   1. Lexical integrity (Kiparsky): never demote a polysyllable's own stress
 *      peak for an adjacent monosyllable — the monosyllable yields.
 *   2. Inherent lexical prominence: a primary-stressed syllable outranks a
 *      secondary one — the lower-lexical-stress member yields.
 *   3. Syntactic headedness (Nuclear Stress Rule; Liberman & Prince 1977; Cinque
 *      1993): when the two words stand in a direct head–dependent relation, the
 *      DEPENDENT yields to its governor (the phrasal head is the more prominent).
 *   4. Content/function asymmetry — a coarse proxy for headedness when no direct
 *      dependency links the pair: the function word yields.
 *   5. Phonological weight: a light (open, short-vowel) syllable reduces more
 *      readily than a heavy (closed / long-vowel) one — the lighter member yields.
 *   6. Rhythm Rule (Liberman & Prince 1977; Hayes 1984): the clash member abutting
 *      the stronger OUTER beat is that beat's off-beat, so it retracts — "wet
 *      CHURCH" retracts wet (church is nuclear), "LATE last NIGHT" retracts last
 *      onto late (night is the following beat).
 *   7. Default (Hayes): retract the LEFT stress.
 */
function demoteRightOfClash(
  flat: { word: ClsWord; syl: Syllable }[],
  i: number
): boolean {
  const a = flat[i];
  const b = flat[i + 1];

  // (1) lexical integrity
  const aPeak = a.word.syllables.length > 1 && a.syl === wordPeak(a.word);
  const bPeak = b.word.syllables.length > 1 && b.syl === wordPeak(b.word);
  if (aPeak && !bPeak && b.word.syllables.length === 1) return true;
  if (bPeak && !aPeak && a.word.syllables.length === 1) return false;

  // (2) inherent lexical prominence
  const la = a.syl.lexicalStress ?? a.syl.stress ?? 0;
  const lb = b.syl.lexicalStress ?? b.syl.stress ?? 0;
  if (la !== lb) return la > lb;

  // (3) syntactic headedness — the dependent yields to its governor
  if (a.word !== b.word) {
    const gov = getGovernor(a.word, b.word);
    if (gov === a.word) return true;   // a heads b → demote b
    if (gov === b.word) return false;  // b heads a → demote a
  }

  // (4) content/function asymmetry — the function word yields
  if (a.word.isContent !== b.word.isContent) return a.word.isContent;

  // (5) phonological weight — the lighter syllable yields
  if (a.syl.weight && b.syl.weight && a.syl.weight !== b.syl.weight) {
    return a.syl.weight === 'H'; // a heavy → demote the lighter b
  }

  // (6) Rhythm Rule — yield to the stronger adjacent (outer) beat
  const outerA = i - 1 >= 0 ? STRESS_RANK[flat[i - 1].syl.relativeStress ?? 'w'] : -1;
  const outerB = i + 2 < flat.length ? STRESS_RANK[flat[i + 2].syl.relativeStress ?? 'w'] : -1;
  if (outerA !== outerB) return outerB > outerA;

  // (7) default: retract the left
  return false;
}

/**
 * Scan across the linear sequence of syllables and adjust any adjacent
 * identical relative stress levels using syntactic governance.
 */
function resolveAdjacentClashes(words: ClsWord[], protect?: Set<Syllable>): void {
  // "Endings strict": when a phrase ends in a run of two or more bare function
  // words (e.g. "…fast as you MIGHT"), the metrical beat gravitates to one of
  // them; the others are upbeat.  Demote the others so a leftward governance
  // clash can't promote a medial off-beat ("you") over the phrase-final beat.
  // Phrases ending in a content word are untouched.
  {
    let runStart = words.length;
    while (runStart > 0 && !words[runStart - 1].isContent) runStart--;
    if (words.length - runStart >= 2) {
      // The beat is normally the run's last word, UNLESS that is a clause-final
      // oblique pronoun (me/him/them…), which is canonically unstressed — then
      // the beat falls on the preceding member ("and beHIND me", not "behind ME").
      let beatIdx = words.length - 1;
      if (OBLIQUE_PRONOUNS.has(words[beatIdx].word.toLowerCase()) && beatIdx > runStart) {
        beatIdx--;
      }
      for (let wi = runStart; wi < words.length; wi++) {
        if (wi === beatIdx) continue;
        const w = words[wi];
        const peak = wordPeak(w);
        for (const s of w.syllables) {
          // Protect a polysyllabic word's own lexical peak: never flatten a real
          // internal stress (be·HIND) to 'w' just because the word is functional.
          if (w.syllables.length > 1 && s === peak && (s.lexicalStress ?? s.stress) >= 1) continue;
          // Protect a dependency-mined prominence (stranded preposition etc.).
          if (protect && protect.has(s)) continue;
          s.relativeStress = 'w';
        }
      }
    }
  }

  // Flatten all syllables with reference to their owning word.
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of words) {
    for (const s of w.syllables) {
      flat.push({ word: w, syl: s });
    }
  }

  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    if (a.syl.relativeStress !== b.syl.relativeStress) continue;
    // Only the stressed tier {n,m,s} clashes; {w,x} may repeat (maintainer's rule:
    // an unstressed run is tolerated, never "resolved" by demoting a clitic to 'x').
    const lvl = a.syl.relativeStress;
    if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue;

    // Within-word strictness (Kiparsky): a polysyllabic word's own stress peak
    // must not be demoted below its word-mates by a clash with an adjacent
    // monosyllable.  Protect the peak; demote the monosyllable instead.
    const aPeak = a.word.syllables.length > 1 && a.syl === wordPeak(a.word);
    const bPeak = b.word.syllables.length > 1 && b.syl === wordPeak(b.word);
    if (aPeak && b.word.syllables.length === 1) {
      adjustAdjacent(a.syl, b.syl, governorDependentDirection);
      continue;
    }
    if (bPeak && a.word.syllables.length === 1) {
      adjustAdjacent(b.syl, a.syl, governorDependentDirection);
      continue;
    }

    // Otherwise use the syntactic governor relationship.
    const governor = getGovernor(a.word, b.word);
    if (governor === a.word) {
      // a governs b → a stronger, b weaker
      adjustAdjacent(a.syl, b.syl, governorDependentDirection);
    } else if (governor === b.word) {
      // b governs a → b stronger, a weaker
      adjustAdjacent(b.syl, a.syl, governorDependentDirection);
    }
    // If no relationship, leave untouched.
  }
}

/** The syllable bearing a word's lexical stress peak (used for within-word protection). */
function wordPeak(word: ClsWord): Syllable | undefined {
  let best: Syllable | undefined;
  let bestVal = -Infinity;
  for (const s of word.syllables) {
    const v = s.lexicalStress ?? s.stress;
    if (v > bestVal) { bestVal = v; best = s; }
  }
  return best;
}

/** Return the governor word if one directly governs the other, else null. */
function getGovernor(w1: ClsWord, w2: ClsWord): ClsWord | null {
  const dep1 = w1.dependency;
  const dep2 = w2.dependency;
  if (!dep1 || !dep2) return null;

  // Check if w2 is a dependent of w1.
  if (dep2.governor === w1) return w1;
  // Check if w1 is a dependent of w2.
  if (dep1.governor === w2) return w2;
  return null;
}

/** Adjustment direction: governor stronger (promote), dependent weaker (demote). */
function governorDependentDirection(gov: Syllable, dep: Syllable): void {
  const govStress = gov.relativeStress!;
  const depStress = dep.relativeStress!;

  // Promote governor (if possible)
  if (govStress === 'n') gov.relativeStress = 'm';
  else if (govStress === 'm') gov.relativeStress = 's';
  // 'w' or 's' stay the same (can't promote 's', can't easily promote 'w' to 'n' without risking equal)

  // Demote dependent (if possible)
  if (depStress === 's') dep.relativeStress = 'm';
  else if (depStress === 'm') dep.relativeStress = 'n';
  else if (depStress === 'n') dep.relativeStress = 'w';
  else if (depStress === 'w') dep.relativeStress = 'x';
}

/** Simple adjustment for two adjacent syllables. */
function adjustAdjacent(
  stronger: Syllable,
  weaker: Syllable,
  direction: (s: Syllable, w: Syllable) => void
): void {
  direction(stronger, weaker);
}

/** Demote a syllable's relative stress by one level: s→m, m→n, n→w, w→x, x stays x. */
function demoteOneLevel(syl: Syllable): void {
  const cur = syl.relativeStress;
  if (cur === 's') syl.relativeStress = 'm';
  else if (cur === 'm') syl.relativeStress = 'n';
  else if (cur === 'n') syl.relativeStress = 'w';
  else if (cur === 'w') syl.relativeStress = 'x';
}

/**
 * Resolve stress clashes across prosodic boundaries (PP and IU).
 * When adjacent syllables at a boundary have equal stress:
 *   - If one word is function and the other content, demote the function word
 *     (per "beginnings free": the start of a new unit can be weakened)
 *   - If both are same type, use dependency relationship
 *   - If no relationship exists, leave untouched
 */
function resolveCrossBoundaryClashes(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Build flat array with prosodic position tracking
  const flat: { word: ClsWord; syl: Syllable; ppKey: string }[] = [];
  for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
    const iu = ius[iuIdx];
    for (let ppIdx = 0; ppIdx < iu.phonologicalPhrases.length; ppIdx++) {
      const pp = iu.phonologicalPhrases[ppIdx];
      const ppWords = collectPPTokens(pp);
      for (const w of ppWords) {
        for (const s of w.syllables) {
          flat.push({ word: w, syl: s, ppKey: `${iuIdx}:${ppIdx}` });
        }
      }
    }
  }

  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i];
    const b = flat[i + 1];
    if (a.syl.relativeStress !== b.syl.relativeStress) continue;
    // Only the stressed tier {n,m,s} clashes; {w,x} may repeat (maintainer's rule).
    const lvl = a.syl.relativeStress;
    if (lvl !== 'n' && lvl !== 'm' && lvl !== 's') continue;

    // Only adjust if they span a prosodic boundary
    if (a.ppKey === b.ppKey) continue;

    const aContent = a.word.isContent;
    const bContent = b.word.isContent;

    if (aContent && !bContent) {
      demoteOneLevel(b.syl);
    } else if (!aContent && bContent) {
      demoteOneLevel(a.syl);
    } else {
      // Both same content/function type — try dependency relationship.
      // (A blanket Selkirk "demote the PP-initial" was tried and regressed
      // litlab/prosodic: the linear-clash cascade's nuanced resolution — weight,
      // Rhythm Rule, governance — captures "beginnings loose" better than a flat
      // directional rule, so a clash with no governance is left for it.)
      const governor = getGovernor(a.word, b.word);
      if (governor === a.word) {
        adjustAdjacent(a.syl, b.syl, governorDependentDirection);
      } else if (governor === b.word) {
        adjustAdjacent(b.syl, a.syl, governorDependentDirection);
      }
    }
  }
}

/** Check whether a POS tag belongs to a content word category. */
function isContentWord(tag: string, word?: string): boolean {
  if (CONTENT_POS.has(tag)) {
    if (word) {
      const lower = word.toLowerCase();
      if (FUNCTION_ADVERBS.has(lower)) return false;
      if (FUNCTION_VERBS.has(lower)) return false;
    }
    return true;
  }
  return false;
}