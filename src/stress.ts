// stress.ts — Lexical, compound, nuclear stress assignment using nounsing-pro
// (augmented CMU dictionary with 52+ columns), then conversion to McAleese's
// 4‑level relative system.

import * as nounsing from 'nounsing-pro';
import { ClsWord, Syllable, StressLevel, IntonationalUnit, PhonologicalPhrase } from './types.js';
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
  'let', 'lets', "let's"
]);

/**
 * ASPECTUAL (phasal) verbs act as function verbs ONLY in their aspectual use —
 * governing an open-clausal complement ("stopped to pray", "kept singing",
 * "began to weep").  With a plain nominal/oblique complement or none at all
 * ("could not stop for Death", "keep the change", "the rain stopped") they are
 * full lexical verbs and keep content stress.  The old blanket listing in
 * FUNCTION_VERBS flattened both uses; `isAspectualFunctionUse` restores the
 * split by reading the complement's shape off the dependency parse.
 */
const ASPECTUAL_VERBS = new Set([
  'start', 'starts', 'started', 'starting',
  'begin', 'begins', 'began', 'beginning', 'begun',
  'keep', 'keeps', 'kept', 'keeping',
  'stop', 'stops', 'stopped', 'stopping',
  'continue', 'continues', 'continued', 'continuing',
]);
function isAspectualFunctionUse(words: ClsWord[], wi: number): boolean {
  const w = words[wi];
  if (!ASPECTUAL_VERBS.has(w.word.toLowerCase())) return false;
  if (!/^VB/.test(w.lexicalClass)) return false;
  // Aspectual = the verb governs an open-clausal complement (xcomp/ccomp whose
  // head is a verb or a to-infinitive)…
  for (const d of words) {
    if (d === w || d.dependency?.governor !== w) continue;
    const rel = (d.canonicalRel ?? d.dependency?.dependentType ?? '').toUpperCase();
    if (/^(XCOMP|CCOMP)/.test(rel) && /^(VB|TO)/.test(d.lexicalClass)) return true;
  }
  // …or, parse-robustly, is immediately followed by one ("kept singing",
  // "stopped to pray").
  const nx = words[wi + 1];
  return !!nx && (nx.lexicalClass === 'TO' || nx.lexicalClass === 'VBG');
}

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
  { w1: 'old', w2: 'days' },                                    // the OLD days (fixed expression: "days" is semantically light)
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

function countVowelGroups(word: string, keepDisyllabicFinalE = false): number {
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
  // Final orthographic silent-e ("magic e"): a word-final 'e' that opens its own
  // vowel group is silent in the default modern reading.  Original rule fired only
  // at 3+ groups; extended (2026-07-02) to DISYLLABIC shapes — archaic verse
  // spellings ("seke", "fote", "nowe", "raunge", "chaunge") read as their modern
  // monosyllables (seek, foot, now, range, change), which restored Wyatt's 4-beat
  // accentual profile.  Exclusions for the disyllabic case only:
  //   • -Cle/-Cre codas (obstruent+liquid+e): the liquid is syllabic and the 'e'
  //     is its written nucleus (table, sabre) — no deduction;
  //   • proper nouns (keepDisyllabicFinalE): foreign names pronounce it (Dante).
  if (groups >= 2 && n > 2 && lower[n - 1] === 'e' && VOWEL_CHARS.has(lower[n - 1])) {
    const lastVowelStart = vowelPositions[vowelPositions.length - 1];
    const syllabicLiquid = /[^aeiouy][lr]e$/.test(lower);
    const allow = groups >= 3 || (!syllabicLiquid && !keepDisyllabicFinalE);
    if (lastVowelStart === n - 1 && allow) {
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
 * Stress-neutral productive suffixes (Hayes 1982: Class-II / #-boundary
 * affixes — they attach OUTSIDE the stress domain and never shift the stem's
 * stress: ˈwarrant → ˈwarranˌtize, ˈmoment → ˈmomentless).  `stems(base)` lists
 * candidate stem spellings to try (order = most likely first — undoing the
 * orthographic adjustments of affixation: e-deletion, consonant doubling,
 * y→i); `added(stem)` is how many *syllables* the suffix contributes;
 * `suffStress` gives the suffix's OWN syllable stresses when non-zero (-ize
 * bears a secondary: ˈwarranˌtize; compound-like finals -ware/-wright/-like
 * likewise), defaulting to all-unstressed; `minStem` guards against splitting
 * short opaque words (default 2).
 *
 * Stress-SHIFTING suffixes (-ion/-ity/-ic/-ial/-ious/-ify…) are deliberately
 * omitted — treating them as neutral would mis-place the peak; they are
 * handled POSITIONALLY by the English Stress Rule's PRESTRESS_SUFFIXES table
 * (Tier 2), which is the correct generalization for them (stress counted from
 * the word's end, whatever the stem was).  -ance/-ence are also omitted: the
 * Latinate retraction cases (reside→RESidence, prefer→PREference) make them
 * unreliable as neutral.  Membership was cross-checked against the NIH
 * SPECIALIST/Lexical-Tools derivational suffix list (Sources2), adopting only
 * the entries whose prosodic behaviour is genuinely stress-preserving.
 */
const SUFFIX_RULES: {
  suffix: string;
  stems: (b: string) => string[];
  added: (stem: string) => number;
  suffStress?: number[];
  minStem?: number;
  /** Vowel-initial suffix whose attachment to a -y stem DELETES the y in
   *  spelling (tyranny → tyrannize): the y's syllable merges into the suffix
   *  vowel, so the stem's final (unstressed) syllable is dropped when the
   *  matched candidate was base+'y'.  The -ies/-iness rules do NOT need this —
   *  their `added` counts already reflect the y→i respelling. */
  yMerges?: boolean;
}[] = [
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
  // ── derivational stress-neutral suffixes (NIH-attested, Hayes Class II) ──
  // -ize/-ise: stem keeps its primary, the suffix bears a SECONDARY
  // (ˈwarranˌtize, ˈtyranˌnize — M-W transcribes -ˌīz throughout).
  { suffix: 'ize',   stems: b => [b, b + 'e', b + 'y', deDouble(b)], added: () => 1, suffStress: [1], minStem: 3, yMerges: true },
  { suffix: 'ise',   stems: b => [b, b + 'e', b + 'y', deDouble(b)], added: () => 1, suffStress: [1], minStem: 3, yMerges: true },
  { suffix: 'ism',   stems: b => [b, b + 'e', b + 'y', deDouble(b)], added: () => 2, minStem: 3, yMerges: true }, // hero·ism (i·sm = 2 sylls)
  { suffix: 'ist',   stems: b => [b, b + 'e', b + 'y', deDouble(b)], added: () => 1, minStem: 3, yMerges: true }, // harp·ist, botan·ist
  { suffix: 'ish',   stems: b => [b, deDouble(b), b + 'e'],          added: () => 1, minStem: 3 }, // green·ish, red·dish
  { suffix: 'hood',  stems: b => [b],                       added: () => 1, minStem: 3 },
  { suffix: 'ship',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 },
  { suffix: 'dom',   stems: b => [b],                       added: () => 1, minStem: 3 },
  { suffix: 'ess',   stems: b => [b, deDouble(b)],          added: () => 1, minStem: 3 }, // shepherd·ess
  { suffix: 'ery',   stems: b => [b, b + 'e', deDouble(b)], added: () => 2, minStem: 3 }, // knav·ery, trick·ery
  { suffix: 'ry',    stems: b => [b],                       added: () => 1, minStem: 4 }, // wizard·ry, rival·ry
  { suffix: 'age',   stems: b => [b, deDouble(b)],          added: () => 1, minStem: 3 }, // brigand·age
  { suffix: 'ous',   stems: b => [b, deDouble(b), b + 'e'], added: () => 1, minStem: 4 }, // thunder·ous, villain·ous
  { suffix: 'en',    stems: b => [b, deDouble(b), b + 'e'], added: () => 1, minStem: 3 }, // birch·en, gold·en (archaic adjectival)
  { suffix: 'or',    stems: b => [b, b + 'e', deDouble(b)], added: () => 1, minStem: 3 }, // conjur·or
  { suffix: 'let',   stems: b => [b],                       added: () => 1, minStem: 3 }, // king·let
  { suffix: 'ling',  stems: b => [b, deDouble(b)],          added: () => 1, minStem: 3 }, // prince·ling
  { suffix: 'ster',  stems: b => [b, deDouble(b)],          added: () => 1, minStem: 3 }, // trick·ster
  { suffix: 'nik',   stems: b => [b],                       added: () => 1, minStem: 3 },
  { suffix: 'most',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 }, // hind·ˌmost
  { suffix: 'some',  stems: b => [b, deDouble(b)],          added: () => 1, minStem: 3 }, // bother·some (reduced)
  { suffix: 'like',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 }, // god·ˌlike
  { suffix: 'wise',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 },
  { suffix: 'wards', stems: b => [b],                       added: () => 1, minStem: 3 },
  { suffix: 'ward',  stems: b => [b],                       added: () => 1, minStem: 3 }, // sea·ward (reduced in speech)
  { suffix: 'ways',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 },
  { suffix: 'fold',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 }, // hundred·ˌfold
  // compound-like finals (second elements of transparent compounds): the
  // final bears a secondary, the stem keeps the primary (ˈplayˌwright).
  { suffix: 'wright', stems: b => [b],                      added: () => 1, suffStress: [1], minStem: 3 },
  { suffix: 'ware',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 },
  { suffix: 'ville', stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 3 },
  { suffix: 'gate',  stems: b => [b],                       added: () => 1, suffStress: [1], minStem: 4 },
  // -th deverbal/deadjectival noun (warmth, growth, poetic "greenth", "coolth"):
  // adds NO syllable — the stem's pattern is the word's pattern.
  { suffix: 'th',    stems: b => [b],                       added: () => 0, minStem: 3 },
  { suffix: 'es',    stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
  { suffix: 's',     stems: b => [b, b + 'e'],              added: stem => isSibilantEnd(stem) ? 1 : 0 },
];

/** Bare lexicon stress lookup → numeric pattern (2=primary, 1=secondary, 0=none),
 *  or null when the spelling is absent/unstressed in the augmented CMU. */
function lexiconStress(w: string): number[] | null {
  if (w.length < 2) return null;
  let data;
  try { data = nounsing.all(w); } catch { return null; }
  const raw = data && data.length ? (data[0].stress?.stressTrans || '') : '';
  if (!raw) return null;
  const nums = [...raw].map(c => mapCMUStress(parseInt(c, 10)));
  return nums.length ? nums : null;
}

/** Depth limit for recursive affix stripping: enough for prefix + derivational
 *  suffix + inflection ("un·warrant·iz·ed"), small enough that a spurious chain
 *  cannot wander far — and every leaf must still be lexicon-attested. */
const MAX_DECOMP_DEPTH = 3;

/**
 * Tier 1 — derive an OOV word's numeric stress by stripping stress-neutral
 * affixes and reusing the in-lexicon stem's *real* stress.  RECURSIVE: stacked
 * affixes unwind one layer at a time (warrantizes → -es → warrantize → -ize →
 * warrant; unwarrantized → -ed → un- → -ize → warrant), each recursion trying
 * the lexicon FIRST so the shallowest attested decomposition wins.  Returns
 * null if no chain bottoms out in a known stem — the caller then falls through
 * to the English Stress Rule (Tier 2).
 */
function morphologicalStress(w: string): { pattern: number[]; suffix: string; prefix?: string } | null {
  return decomposeStress(w, MAX_DECOMP_DEPTH);
}

function decomposeStress(w: string, depth: number): { pattern: number[]; suffix: string; prefix?: string } | null {
  for (const rule of SUFFIX_RULES) {
    if (!w.endsWith(rule.suffix)) continue;
    const base = w.slice(0, w.length - rule.suffix.length);
    if (base.length < (rule.minStem ?? 2)) continue; // guard tiny stems (sing → s+ing)
    for (const stem of rule.stems(base)) {
      if (stem.length < (rule.minStem ?? 2)) continue;
      let stemNumeric = lexiconStress(stem);
      let inner: { pattern: number[]; suffix: string; prefix?: string } | null = null;
      if (!stemNumeric && depth > 1) {
        inner = decomposeStress(stem, depth - 1);
        // A recursive (unattested-spelling) stem must carry a primary — a chain
        // of strips that never reaches a stressed stem is a mis-decomposition.
        if (inner && inner.pattern.some(n => n >= 2)) stemNumeric = inner.pattern;
      }
      if (!stemNumeric || stemNumeric.length === 0) continue;
      // y-deletion before a vowel-initial suffix: the -y stem's final syllable
      // merged into the suffix vowel (tyranny → tyr·an·nize), so drop it —
      // guarded on that syllable being unstressed (it always is for -y nouns).
      if (rule.yMerges && stem === base + 'y' && stemNumeric.length > 1
          && stemNumeric[stemNumeric.length - 1] === 0) {
        stemNumeric = stemNumeric.slice(0, -1);
      }
      const added = rule.added(stem);
      const suffNumeric = added >= 1
        ? (rule.suffStress ? rule.suffStress.slice(0, added) : new Array(added).fill(0))
        : [];
      while (suffNumeric.length < added) suffNumeric.push(0);
      return {
        pattern: [...stemNumeric, ...suffNumeric],
        suffix: added >= 1 ? rule.suffix : '',
        prefix: inner?.prefix,
      };
    }
  }
  // Tier 1b: PREFIX decomposition (Wagner §6.5.2 — a prefix forms its OWN prosodic
  // domain; the STEM keeps its primary stress).  Only fires on a genuinely OOV word
  // (no suffix decomposition found and the bare word isn't in the lexicon — checked
  // by the caller), and only when the prefix-stripped remainder IS a known stem (or
  // itself decomposes to one), so it can only EXTEND coverage, never alter an
  // in-lexicon word.  Heavy separable prefixes (over-/under-/out-/anti-…) bear
  // secondary stress; light ones (un-/re-/dis-…) are unstressed before the stem's
  // primary.
  return prefixStress(w, depth);
}

/** Productive prefixes: syllable count + whether the prefix's first syllable bears
 *  a SECONDARY stress (separable/heavy Germanic & neoclassical combining forms) or
 *  is unstressed (light Latinate).  `pattern` overrides sylls/sec for prefixes
 *  whose stress is not initial (e·ˌlec·tro-).  Membership cross-checked against
 *  the NIH SPECIALIST prefix list (Sources2), adopting the prosodically
 *  transparent entries; deliberately EXCLUDED: bare "a-" (collides with the
 *  a-roving proclitic and privative a-, both handled elsewhere), and the
 *  assimilated Latin clusters (ad-/ab-/ob-/com- variants af-/at-/oc-/col-…)
 *  whose one-consonant forms would shear real word-initial syllables apart. */
const PREFIX_RULES: { prefix: string; sylls: number; sec: boolean; pattern?: number[] }[] = [
  { prefix: 'counter', sylls: 2, sec: true },
  { prefix: 'over', sylls: 2, sec: true }, { prefix: 'under', sylls: 2, sec: true },
  { prefix: 'inter', sylls: 2, sec: true }, { prefix: 'super', sylls: 2, sec: true },
  { prefix: 'anti', sylls: 2, sec: true }, { prefix: 'semi', sylls: 2, sec: true },
  { prefix: 'multi', sylls: 2, sec: true }, { prefix: 'ultra', sylls: 2, sec: true },
  { prefix: 'fore', sylls: 1, sec: true }, { prefix: 'out', sylls: 1, sec: true },
  { prefix: 'non', sylls: 1, sec: true }, { prefix: 'self', sylls: 1, sec: true },
  { prefix: 'un', sylls: 1, sec: false }, { prefix: 're', sylls: 1, sec: false },
  { prefix: 'pre', sylls: 1, sec: false }, { prefix: 'dis', sylls: 1, sec: false },
  { prefix: 'mis', sylls: 1, sec: false }, { prefix: 'de', sylls: 1, sec: false },
  // ── NIH SPECIALIST additions ──
  // heavy disyllabic combining forms (secondary on their first syllable)
  { prefix: 'auto', sylls: 2, sec: true }, { prefix: 'micro', sylls: 2, sec: true },
  { prefix: 'macro', sylls: 2, sec: true }, { prefix: 'mega', sylls: 2, sec: true },
  { prefix: 'mono', sylls: 2, sec: true }, { prefix: 'poly', sylls: 2, sec: true },
  { prefix: 'proto', sylls: 2, sec: true }, { prefix: 'pseudo', sylls: 2, sec: true },
  { prefix: 'quasi', sylls: 2, sec: true }, { prefix: 'retro', sylls: 2, sec: true },
  { prefix: 'extra', sylls: 2, sec: true }, { prefix: 'intra', sylls: 2, sec: true },
  { prefix: 'infra', sylls: 2, sec: true }, { prefix: 'contra', sylls: 2, sec: true },
  { prefix: 'hyper', sylls: 2, sec: true }, { prefix: 'hypo', sylls: 2, sec: true },
  { prefix: 'iso', sylls: 2, sec: true }, { prefix: 'tele', sylls: 2, sec: true },
  { prefix: 'neo', sylls: 2, sec: true }, { prefix: 'bio', sylls: 2, sec: true },
  { prefix: 'geo', sylls: 2, sec: true }, { prefix: 'cryo', sylls: 2, sec: true },
  { prefix: 'crypto', sylls: 2, sec: true }, { prefix: 'hydro', sylls: 2, sec: true },
  { prefix: 'photo', sylls: 2, sec: true }, { prefix: 'omni', sylls: 2, sec: true },
  { prefix: 'ambi', sylls: 2, sec: true }, { prefix: 'epi', sylls: 2, sec: true },
  { prefix: 'para', sylls: 2, sec: true }, { prefix: 'peri', sylls: 2, sec: true },
  { prefix: 'meta', sylls: 2, sec: true }, { prefix: 'uni', sylls: 2, sec: true },
  { prefix: 'demi', sylls: 2, sec: true }, { prefix: 'hemi', sylls: 2, sec: true },
  { prefix: 'eco', sylls: 2, sec: true },
  // trisyllabic / non-initial-stress combining forms (explicit patterns)
  { prefix: 'hetero', sylls: 3, sec: true, pattern: [1, 0, 0] },
  { prefix: 'electro', sylls: 3, sec: true, pattern: [0, 1, 0] }, // e·ˌlec·tro-
  // heavy monosyllables (secondary)
  { prefix: 'trans', sylls: 1, sec: true }, { prefix: 'post', sylls: 1, sec: true },
  { prefix: 'sub', sylls: 1, sec: true }, { prefix: 'mid', sylls: 1, sec: true },
  { prefix: 'up', sylls: 1, sec: true }, { prefix: 'down', sylls: 1, sec: true },
  { prefix: 'co', sylls: 1, sec: true }, { prefix: 'bi', sylls: 1, sec: true },
  { prefix: 'tri', sylls: 1, sec: true }, { prefix: 'ex', sylls: 1, sec: true },
  { prefix: 'vice', sylls: 1, sec: true }, { prefix: 'step', sylls: 1, sec: true },
  { prefix: 'pan', sylls: 1, sec: true }, { prefix: 'mal', sylls: 1, sec: true },
  { prefix: 'dys', sylls: 1, sec: true }, { prefix: 'arch', sylls: 1, sec: true },
  { prefix: 'twi', sylls: 1, sec: true },
  // light monosyllables (unstressed before the stem's primary)
  { prefix: 'be', sylls: 1, sec: false }, { prefix: 'en', sylls: 1, sec: false },
  { prefix: 'em', sylls: 1, sec: false }, { prefix: 'per', sylls: 1, sec: false },
  { prefix: 'pro', sylls: 1, sec: false }, { prefix: 'con', sylls: 1, sec: false },
  { prefix: 'sur', sylls: 1, sec: false }, { prefix: 'syn', sylls: 1, sec: false },
  { prefix: 'sym', sylls: 1, sec: false },
];

function prefixStress(w: string, depth: number = 1): { pattern: number[]; suffix: string; prefix?: string } | null {
  // longest prefix first (counter- before -); guard against tiny stems.
  for (const rule of [...PREFIX_RULES].sort((a, b) => b.prefix.length - a.prefix.length)) {
    if (!w.startsWith(rule.prefix)) continue;
    const stem = w.slice(rule.prefix.length);
    if (stem.length < 3) continue;                 // need a real stem (re+do too short)
    let stemNumeric = lexiconStress(stem);
    if ((!stemNumeric || !stemNumeric.some(n => n >= 2)) && depth > 1) {
      const inner = decomposeStress(stem, depth - 1);
      if (inner && inner.pattern.some(n => n >= 2)) stemNumeric = inner.pattern;
    }
    if (!stemNumeric || stemNumeric.length === 0 || !stemNumeric.some(n => n >= 2)) continue;  // stem must carry a primary
    const head = rule.sec ? 1 : 0;
    const preNumeric = rule.pattern ?? [head, ...new Array(Math.max(0, rule.sylls - 1)).fill(0)];
    return { pattern: [...preNumeric, ...stemNumeric], suffix: '', prefix: rule.prefix };
  }
  return null;
}

/** Display-only prefix detection for ALL words (in-vocab AND OOV).
 *
 *  The OOV-only `morphologicalStress` prefix path (Tier 1b) only fires when no
 *  suffix decomposition is found — so "disillusions" (OOV, suffix "-s" → stem
 *  "disillusion" IN-VOCAB) returns before the prefix path runs, and
 *  "uneducated" (IN-VOCAB) never hits the OOV branch at all.  Neither gets
 *  `morphPrefix` set, and the display syllabifier's Maximal Onset principle
 *  pulls the prefix's final consonant into the next syllable (di·sil·lu·sions,
 *  u·ne·du·ca·ted).
 *
 *  This pass runs AFTER `assignLexicalStress` for every word: if it starts with
 *  a known productive prefix (from `PREFIX_RULES`) and the stripped stem is in
 *  the nounsing-pro dictionary, set `word.morphPrefix`.  The syllabifier then
 *  peels the prefix as the first syllable(s) and syllabifies the stem
 *  separately, respecting the morpheme boundary (dis·il·lu·sions,
 *  un·ed·u·ca·ted).  DISPLAY-ONLY — never changes stress or meter.
 *
 *  Guards: the stem must carry a primary stress (so we don't peel a prefix off
 *  a function word like "into"), and the prefix must be at least 2 characters
 *  (to avoid false positives on short words). */
export function detectDisplayPrefixes(words: ClsWord[]): void {
  for (const word of words) {
    if (word.morphPrefix) continue;                    // already set by OOV path
    if (word.syllables.length < 2) continue;            // monosyllables: no boundary to place
    const clean = word.word.toLowerCase().replace(/-/g, '').replace(/[''']/g, '');
    if (clean.length < 5) continue;                     // too short to have prefix + real stem
    for (const rule of [...PREFIX_RULES].sort((a, b) => b.prefix.length - a.prefix.length)) {
      if (!clean.startsWith(rule.prefix)) continue;
      const stem = clean.slice(rule.prefix.length);
      if (stem.length < 3) continue;                    // need a real stem
      const data = nounsing.all(stem);
      if (!data || data.length === 0) continue;
      const raw = data[0].stress?.stressTrans || '';
      if (!raw || !raw.split('').some(c => c === '1' || c === '2')) continue; // stem must carry stress
      word.morphPrefix = rule.prefix;
      break;
    }
  }
}

/**
 * Stress Shift — swap primary↔secondary when Nounsing-Pro confirms the word
 * CAN shift (`suffixShiftPotential` returns `shiftLikely: true`) and the
 * phonological context motivates it.  This is NOT a global rule — it is
 * grounded in the dictionary's own shift-likelihood assessment plus a
 * syntactic/phonological context gate.
 *
 * Conditions (ALL must hold):
 *  1. `suffixShiftPotential(word)` returns `shiftLikely: true`
 *  2. The word's `stressTrans` has both `1` (primary) and `2` (secondary)
 *  3. The LAST digit of `stressTrans` is `2` — secondary is on the final
 *     syllable, so swapping 1↔2 moves primary TO the final
 *  4. Context gate (either):
 *     a. The word is a VB at the start of a phonological phrase (imperative
 *        at phrase start — "REcognize" → "recogNIZE")
 *     b. Rhythm Rule clash: a stressed syllable follows within 2 syllables
 *        (the shift avoids a clash with the following stress)
 *
 * Words like "realize" (shiftLikely=false) are correctly EXCLUDED —
 * Nounsing-Pro says they cannot shift, and the code respects that.
 *
 * Effect: swap the `lexicalStress` values of the primary (2) and secondary (1)
 * syllables, so `peakSyllable` and all downstream computation see the shifted
 * peak.  The syllables' `stress` (raw CMU) values are also swapped for
 * consistency.
 */
export function applyStressShift(words: ClsWord[], ius: IntonationalUnit[]): void {
  // Build a set of words that are at the start of a phonological phrase
  const ppInitials = new Set<ClsWord>();
  for (const iu of ius) {
    for (const pp of iu.phonologicalPhrases) {
      const toks = collectPPTokens(pp)
        .filter(w => w.syllables.length > 0)
        .sort((a, b) => a.absoluteIndex - b.absoluteIndex);
      if (toks.length > 0) ppInitials.add(toks[0]);
    }
  }

  const stressed = words.filter(w => w.syllables.length > 0 && !isPunctuation(w.lexicalClass));
  const flat: { word: ClsWord; syl: Syllable }[] = [];
  for (const w of [...stressed].sort((a, b) => a.absoluteIndex - b.absoluteIndex))
    for (const s of w.syllables) flat.push({ word: w, syl: s });

  for (const word of stressed) {
    if (word.syllables.length < 3) continue;             // need 3+ syllables for a meaningful shift
    const data = nounsing.all(word.word.toLowerCase().replace(/[''']/g, ''));
    if (!data || data.length === 0) continue;
    const st = data[0].stress?.stressTrans ?? '';
    if (!st) continue;

    // Condition 2: has both primary (1) and secondary (2)
    if (!st.includes('1') || !st.includes('2')) continue;
    // Condition 3: the secondary (2) is at a HIGHER index than the primary
    // (1) in the stressTrans string — the swap moves primary RIGHTWARD (toward
    // the end of the word).  This covers both "recognize" (102: 1→0, 2→2) and
    // "dictating" (120: 1→0, 2→1).  Words like "understand" (201: primary
    // already on final) are correctly excluded — the swap would move primary
    // leftward, which is wrong.
    const idx1 = st.indexOf('1');
    const idx2 = st.indexOf('2');
    if (idx2 <= idx1) continue;

    // Condition 1: shiftLikely from Nounsing-Pro
    let shiftLikely = false;
    try {
      const shift = nounsing.suffixShiftPotential(word.word.toLowerCase().replace(/[''']/g, ''));
      if (shift && shift.length > 0) shiftLikely = !!shift[0].shiftLikely;
    } catch { /* graceful no-op */ }
    if (!shiftLikely) continue;

    // Condition 4: context gate — any verb form (VB*).  The stress shift is a
    // well-known phonological process for English verbs (Rhythm Rule, imperative
    // emphasis, compound stress).  Nounsing-Pro's shiftLikely already encodes
    // the phonological possibility; restricting to verb forms excludes nouns
    // like "potato" (NN, shiftLikely=true) that should NOT shift.  No PP-initial
    // requirement — the shift applies to verb forms in any position, matching
    // how English speakers actually shift stress in running speech.
    if (!/^VB/.test(word.lexicalClass)) continue;

    // Execute the shift: swap lexicalStress (and stress) of the primary(2→1)
    // and secondary(1→2) syllables.  In our internal mapping:
    //   CMU/nounsing 1=primary → lexicalStress 2
    //   CMU/nounsing 2=secondary → lexicalStress 1
    //   CMU/nounsing 0=unstressed → lexicalStress 0
    // So we swap the syllable with lexicalStress===2 and the one with ===1.
    let primarySyl: Syllable | null = null;
    let secondarySyl: Syllable | null = null;
    for (const s of word.syllables) {
      if ((s.lexicalStress ?? s.stress) === 2) primarySyl = s;
      if ((s.lexicalStress ?? s.stress) === 1) secondarySyl = s;
    }
    if (!primarySyl || !secondarySyl) continue;
    // Swap lexicalStress
    const tmpLex = primarySyl.lexicalStress;
    primarySyl.lexicalStress = secondarySyl.lexicalStress;
    secondarySyl.lexicalStress = tmpLex;
    // Swap raw stress too (for consistency with downstream that reads s.stress)
    const tmpStress = primarySyl.stress;
    primarySyl.stress = secondarySyl.stress;
    secondarySyl.stress = tmpStress;
  }
}

/**
 * Rhythm-Rule peak placement for BISTABLE disyllables — the Iambic Reversal /
 * Rhythm Rule of Liberman & Prince (1977) generalized beyond word-pair clash
 * repair (cf. Kager & Visch 1988; the "thirtéen" ~ "thìrteen mén" alternation
 * arising from the interaction of latent lexical stress sites with phrasal
 * accent, not from a movement rule).  Two narrowly-gated classes:
 *
 *  (a) CONTOURLESS disyllables — Nounsing records stressTrans "00" WITH
 *      shiftLikely: the lexicon itself declines to fix a peak ("into": both
 *      syllables are latent stress sites, IH0/AH0; conversational "ÍNto" ~
 *      verse "intó").  The peak is placed by GRID ALTERNATION: never abutting
 *      a stressed neighbour, preferring the position flanked by weakness —
 *      "sailed intó his rest" (left neighbour stressed → peak right),
 *      "ínto the woods" (no left pressure → citation-leaning left).
 *
 *  (b) FUSED NEGATIVES — a disyllable of the shape X+"not" where X is itself
 *      a modal/auxiliary ("cannot"): BOTH morphemes are stress-bearing (the
 *      "thirteen" configuration), so the final-stressed citation form
 *      RETRACTS before a following lexical stress — "cánnot lácerate", while
 *      "cannót affórd" (no clash) keeps the citation iamb.
 *
 * The schwa-initial FIXED iambs ("upon", "about", "before" — stressTrans 01
 * with a reduced first vowel, shiftLikely false) match neither gate and are
 * untouched: "upón the hill" never retracts, because "u-" is not a latent
 * stress site.  Punctuation between words is a prosodic boundary: neighbours
 * across it exert no rhythmic pressure.
 */
const FUSED_NEGATIVE_STEMS = new Set(['can', 'may', 'must', 'shall', 'will', 'dare', 'need']);
export function applyRhythmicPeakPlacement(words: ClsWord[]): void {
  const ordered = [...words].sort((a, b) => a.absoluteIndex - b.absoluteIndex);
  const spoken = ordered.filter(w => w.syllables.length > 0);
  // Neighbouring syllable's lexical stress, 0 across a punctuation boundary.
  const boundaryBetween = (a: ClsWord, b: ClsWord): boolean =>
    ordered.some(x => x.syllables.length === 0 &&
      /^[,;:.!?…()—–-]+$/.test(x.word) &&
      x.absoluteIndex > a.absoluteIndex && x.absoluteIndex < b.absoluteIndex);
  const leftStress = (i: number): number => {
    if (i <= 0) return 0;
    const prev = spoken[i - 1];
    if (boundaryBetween(prev, spoken[i])) return 0;
    const s = prev.syllables[prev.syllables.length - 1];
    return s.lexicalStress ?? s.stress ?? 0;
  };
  const rightStress = (i: number): number => {
    if (i >= spoken.length - 1) return 0;
    const next = spoken[i + 1];
    if (boundaryBetween(spoken[i], next)) return 0;
    const s = next.syllables[0];
    return s.lexicalStress ?? s.stress ?? 0;
  };

  for (let i = 0; i < spoken.length; i++) {
    const word = spoken[i];
    if (word.syllables.length !== 2) continue;
    const bare = word.word.toLowerCase().replace(/['’]/g, '');
    const [s1, s2] = word.syllables;
    const l1 = s1.lexicalStress ?? s1.stress ?? 0;
    const l2 = s2.lexicalStress ?? s2.stress ?? 0;

    // (b) fused negative: X+"not", X a modal — retract under a following clash.
    if (bare.endsWith('not') && FUSED_NEGATIVE_STEMS.has(bare.slice(0, -3))) {
      if (l2 > l1 && rightStress(i) >= 1) {
        s1.lexicalStress = l2; s1.stress = l2;
        s2.lexicalStress = l1; s2.stress = l1;
      }
      continue;
    }

    // (a) contourless shift-likely disyllable: place the peak by alternation.
    let data;
    try { data = nounsing.all(bare); } catch { continue; }
    if (!data || data.length === 0) continue;
    if ((data[0].stress?.stressTrans ?? '') !== '00') continue;
    let shiftLikely = false;
    try {
      const shift = nounsing.suffixShiftPotential(bare);
      if (shift && shift.length > 0) shiftLikely = !!shift[0].shiftLikely;
    } catch { /* graceful no-op */ }
    if (!shiftLikely) continue;

    const L = leftStress(i);
    const R = rightStress(i);
    let peakFirst: boolean;
    if (L >= 1 && R === 0) peakFirst = false;        // clash left → peak right
    else if (R >= 1 && L === 0) peakFirst = true;    // clash right → peak left
    else if (L >= 1 && R >= 1) peakFirst = L <= R;   // both press → lesser-clash side
    else peakFirst = true;                           // no pressure → citation-leaning left
    const hi = word.isContent ? 2 : 1;
    const peak = peakFirst ? s1 : s2;
    const off = peakFirst ? s2 : s1;
    peak.lexicalStress = hi; peak.stress = hi;
    off.lexicalStress = 0; off.stress = 0;
  }
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
function englishStressRule(w: string, isContent: boolean, properNoun = false): number[] {
  const n = countVowelGroups(w, properNoun);
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
  // A CONTENT polysyllable does not stay flat after its one primary — give it the
  // rhythmic secondaries English requires (so an OOV 4+-syllable word reads with a
  // real 'n'-tier beat, not a long unstressed tail).
  if (isContent) {
    const heavy = sylls.map(s => (s ? syllableIsHeavy(s) : false));
    addSecondaryStresses(pattern, heavy);
  }
  return pattern;
}

/** Hayes-style rhythmic SECONDARY stresses for an OOV content polysyllable that the
 *  English Stress Rule has given a single primary (2).  English does not leave a long
 *  word with one stress and a flat reduced tail: PRETONIC syllables alternating
 *  leftward from the primary bear a secondary (1) — the metrical grid's lower beats —
 *  e.g. Mìs·sis·SÌp·pi, à·pa·là·CHI·an.  Only the PRETONIC pattern is added: English
 *  pre-stress secondaries are robust, whereas POST-tonic ones are weak and reduce, and
 *  adding them nudged the meter-fitter on a handful of corpus lines for no qualitative
 *  gain.  Deliberately conservative — a secondary is placed only ≥ 2 syllables from the
 *  primary (so it can never clash with the primary or another secondary), so it can
 *  only ADD the 'n'-tier differentiation the contour was missing, never a competing
 *  beat. */
function addSecondaryStresses(pattern: number[], _heavy: boolean[]): void {
  const p = pattern.indexOf(2);
  if (p < 2) return;                          // need a primary with ≥ 2 pretonic syllables
  for (let i = p - 2; i >= 0; i -= 2) {       // pretonic alternation only
    if (pattern[i] === 0) pattern[i] = 1;
  }
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

    // Explicit stress diacritics (Pound's "Milésien"; the archaic "belovèd").
    // Every lookup layer (lexicon, vowel counter, morphological decomposer) is
    // ASCII, so an accented vowel made the word invisible — under-syllabified
    // and dropped from display.  Fold the marks away for lookup, but FIRST
    // record what the poet wrote: an ACUTE over a vowel is an explicit stress
    // cue (that syllable takes the primary — mi·LÉ·sien), and a GRAVE on a
    // final -èd marks the ending as SYLLABIC (belov·èd), so the lexicon's
    // longer variant is preferred when one exists.
    let acuteVowelGroup = -1;            // 0-based vowel-group index of an acute-marked vowel
    let graveSyllabicEd = false;
    if (/[^\x00-\x7f]/.test(lookupWord)) {
      graveSyllabicEd = /èd$/.test(lookupWord);
      const folded = lookupWord.normalize('NFD');
      let groups = 0;
      let inVowel = false;
      for (const ch of folded) {
        if (/[̀-ͯ]/.test(ch)) {
          if (ch === '́' && inVowel) acuteVowelGroup = groups - 1;
          continue;                      // combining marks do not break a vowel group
        }
        const isV = /[aeiouy]/.test(ch);
        if (isV && !inVowel) groups++;
        inVowel = isV;
      }
      lookupWord = folded.replace(/[̀-ͯ]/g, '');
    }

    // Letter-name dictionary anomalies ("am" = A.M., "us" = U.S.): stamp the
    // ordinary citation monosyllable directly (see ANOMALOUS_MONOSYLLABLES).
    {
      const fix = ANOMALOUS_MONOSYLLABLES[lookupWord];
      if (fix) {
        const isContent = (isContentWord(word.lexicalClass, word.word) && !isAspectualFunctionUse(words, wi)) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
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

    // Archaic proclitic a- + present participle ("a-roving", "a-hunting we
    // will go", "a-changin'" — Old English "on" + gerund): the prefix is a
    // STRESSLESS SCHWA that slides up onto the participle's stressed onset.
    // Without this the hyphen-part lookup reads "a" as the letter name
    // (EY-roving, the "A-frame" pattern) and the apostrophe spelling goes OOV
    // and fuses into a forestressed "EY·rov·ing" — either way a spurious peak
    // that drags whole lines dactylic.  Letter compounds ("A-frame",
    // "A-bomb") have NOMINAL remainders and keep the letter stress: the gate
    // here is the -ing/-in' participle shape, which is the construction.
    {
      const m = lookupWord.match(/^a['’-](.+(?:ing|in['’]?))$/);
      if (m) {
        const stemKey = m[1].replace(/['’]/g, '').replace(/in$/, 'ing');
        const stemData = nounsing.all(stemKey);
        const stemStress = stemData && stemData.length > 0
          ? (stemData[0].stress.stressTrans || '') : '';
        if (stemStress.length > 0) {
          const isContent = (isContentWord(word.lexicalClass, word.word) && !isAspectualFunctionUse(words, wi)) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
          word.isContent = isContent;
          const syls: Syllable[] = [
            { text: word.word, phones: '(AH)', weight: 'L', stress: 0, lexicalStress: 0 },
          ];
          for (let i = 0; i < stemStress.length; i++) {
            const cmu = parseInt(stemStress[i], 10);
            let numeric = mapCMUStress(cmu);
            if (!isContent && numeric === 2) numeric = 1;
            syls.push({ text: word.word, phones: '', stress: numeric, lexicalStress: numeric });
          }
          word.syllables = syls;
          continue;
        }
      }
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
        const isContent = (isContentWord(word.lexicalClass, word.word) && !isAspectualFunctionUse(words, wi)) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
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
      const cleanWord = lookupWord.replace(/-/g, '').replace(/['’]/g, '');  // lookupWord: lowercased, diacritic-folded
      // The CLEANED spelling may itself be in-lexicon — a bare-apostrophe
      // possessive ("mistress'", "lips'") fails the raw lookup while its
      // apostrophe-stripped form is an ordinary entry.  Re-try the lexicon
      // BEFORE any decomposition: without this, the recursive stem-finder can
      // build a fluent-but-wrong chain for a word that was never OOV at all
      // ("mistress" → -s → mis- + "tres" → mis·TRES·ses, three syllables).
      if (cleanWord !== lookupWord && cleanWord.length >= 2) {
        const cleanData = nounsing.all(cleanWord);
        if (cleanData && cleanData.length > 0) {
          allData = cleanData;
        }
      }
    }
    if (!allData || allData.length === 0) {
      const cleanWord = lookupWord.replace(/-/g, '').replace(/['’]/g, '');  // lookupWord: lowercased, diacritic-folded
      const isContent = (isContentWord(word.lexicalClass, word.word) && !isAspectualFunctionUse(words, wi)) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
      word.isContent = isContent;
      // Tier 1: morphological stem (reuse real lexical stress); Tier 2: ESR.
      const morph = morphologicalStress(cleanWord);
      let pattern = morph ? morph.pattern
        : englishStressRule(cleanWord, isContent, /^NNPS?$/.test(word.lexicalClass));
      // The poet's ACUTE is an explicit stress cue: move the primary onto the
      // marked vowel's syllable (mi·LÉ·sien), whatever the rule inferred.
      if (acuteVowelGroup >= 0 && acuteVowelGroup < pattern.length) {
        pattern = pattern.map(v => (v === 2 ? 0 : v));
        pattern[acuteVowelGroup] = 2;
        word.acuteSyllable = acuteVowelGroup;
      }
      // Record an archaic verbal suffix so the display splits know·est, not kno·west.
      if (morph && DISPLAY_PEEL_SUFFIXES.has(morph.suffix)) word.morphSuffix = morph.suffix;
      // Record a productive prefix so the display splits dis·il·lu·sions, not
      // di·sil·lu·sions (the Maximal Onset principle would otherwise pull the
      // prefix's final consonant into the next syllable).
      if (morph && morph.prefix) word.morphPrefix = morph.prefix;
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
    // A GRAVE-marked -èd ("belovèd") is the poet's explicit syllabic-ending
    // cue: among the lexicon's pronunciations prefer the LONGEST (be·lov·ed
    // over be·loved).  Preference only — when no syllabic variant is recorded
    // the ordinary entry stands.
    if (graveSyllabicEd && allData.length > 1) {
      for (const p of allData) {
        if ((p.stress.stressTrans || '').length > (profile.stress.stressTrans || '').length) profile = p;
      }
    }
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

    // Lexicon citation corrections: entries where nounsing records only the
    // VERB-leaning rear stress while the modern NOUN citation is front-stressed
    // (Merriam-Webster: perfume n. ˈpər-ˌfyüm).  Applied only under a noun tag
    // — the verb keeps the lexicon's rear stress ("to perFUME the air").  This
    // is a DATA fix for a missing dictionary variant, not a prosodic rule: the
    // general noun/verb diatones (CONduct/conDUCT, IMport/imPORT…) already
    // carry front-stressed noun entries and never reach this table.
    {
      const NOUN_CITATION_FIX: Record<string, string> = { perfume: '10', perfumes: '10' };
      if (/^NN/.test(word.lexicalClass) && NOUN_CITATION_FIX[lookupWord]) {
        rawStress = NOUN_CITATION_FIX[lookupWord];
      }
    }

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

    // The poet's ACUTE outranks the LEXICON too, not just the OOV guesser: an
    // explicit mark exists precisely to override whatever the rules (or the
    // dictionary) would otherwise say — many such words are borrowings whose
    // native stress English constraints don't govern.  The primary moves onto
    // the marked vowel's syllable; the dictionary's own primary steps down to a
    // SECONDARY (the word's organic contour survives as an undertone, but the
    // mark wins the peak).  Last of the rawStress corrections, so nothing
    // downstream re-stamps over it.
    if (acuteVowelGroup >= 0 && rawStress.length > 0) {
      const idx = Math.min(acuteVowelGroup, rawStress.length - 1);
      if (rawStress[idx] !== '1') {
        rawStress = rawStress.replace(/1/g, '2');
        rawStress = rawStress.slice(0, idx) + '1' + rawStress.slice(idx + 1);
      }
      word.acuteSyllable = idx;
    }

    const isContent = (isContentWord(word.lexicalClass, word.word) && !isAspectualFunctionUse(words, wi)) || isPhrasalParticle(word) || isFocusDemonstrative(words, wi);
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
            || FUNCTION_VERBS.has(bare) || ASPECTUAL_VERBS.has(bare)
            || FUNCTION_ADVERBS.has(bare)) {
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

/**
 * Surface-order post-processing passes that re-assert forestress and resolve
 * residual clashes AFTER the main relativisation.  These run in the Clio engine
 * inside `assignRelativeStresses`; the Calliope engine calls this separately
 * after `computeRelativeStress` so the same repairs reach both pipelines.
 *
 * The passes are:
 *   1. resolveCompoundForestress — re-assert left-stress on surface-adjacent
 *      N+N/J+N compounds the tagger mislabels (WASTE·shore, SEA·shore).
 *   2. resolveCollocationForestress — forestress lexicalised collocations
 *      (GOOD old, END-all, OLD days).
 *   3. resolveHyphenCompounds — resolve dual-strong clashes at hyphen seams
 *      (torch-flames, blood-red).
 *   4. resolveLinearClashes — catch residual s-s / m-m / n-n surface clashes
 *      with the full 7-level demotion cascade (lexical integrity → prominence →
 *      syntactic headedness → content/function → weight → Rhythm Rule → default).
 *   5. Exclaimed interjection raise — an interjection immediately followed by
 *      "!" is lifted one tier ("But—Oh! ye lords…").
 *
 * All passes are DEMOTE-ONLY (or forestress re-assertions that raise the LEFT
 * element of a known compound); none inflate the contour beyond what the lexicon
 * and phrase-stress rules already established.
 */
export function applySurfacePostProcessing(words: ClsWord[]): void {
  resolveCompoundForestress(words);
  resolveCollocationForestress(words);
  resolveHyphenCompounds(words);
  resolveLinearClashes(words);
  resolvePhrasalVerbParticle(words);
  raiseInterrogativePronounFocus(words);

  // Exclaimed interjection: an interjection immediately followed by "!" (Oh!, Ah!,
  // O!, Lo!) is an emphatic peak — raise it one tier so it stands out from a flat
  // run of neighbouring function words.  Only an UH whose very next token is "!".
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    if (w.lexicalClass !== 'UH' || w.syllables.length === 0) continue;
    if (words[i + 1].word !== '!') continue;
    const pk = wordPeak(w);
    if (!pk) continue;
    const r = STRESS_RANK[pk.relativeStress ?? 'w'];
    if (r < STRESS_RANK.s) pk.relativeStress = STRESS_LEVELS[r + 1];
  }

  // The poet's explicit ACUTE survives every demotion pass: the marked
  // syllable ("Milésien") floors at 'm' — a real beat the metrical layer may
  // still promote, graded below 's' so it never crashes into a neighbouring
  // organic peak.  Runs LAST, after clash resolution and every phrasal
  // demotion, because the mark is an instruction, not a default.
  for (const w of words) {
    if (w.acuteSyllable == null) continue;
    const s = w.syllables[w.acuteSyllable];
    if (s && STRESS_RANK[s.relativeStress ?? 'w'] < STRESS_RANK.m) s.relativeStress = 'm';
  }
}

/** Interrogative copula pronoun focus: in "Is it YOU?", "Was it HIM?", the
 *  pronoun is the FOCUSED element — the question asks about identity, so the
 *  complement pronoun carries the focus stress.  UDPipe mis-tags this as
 *  NSUBJ (it parses "it" as ROOT, "you" as nsubj of "it"), but the real
 *  structure is: "it" is the dummy subject, the pronoun is the predicate
 *  complement.
 *
 *  Detection (very narrow, will NOT fire on the counter-examples):
 *    1. A PRP (personal pronoun, NOT PRP$ possessive) tagged NSUBJ
 *    2. Its governor is "it" (PRP, ROOT)
 *    3. "it" has an AUX dependent that is a be-form (is/are/was/were/be/been)
 *    4. The be-form is the first word of the sentence
 *
 *  Counter-examples that are correctly EXCLUDED:
 *    - "I'm asleep" → "I" is NSUBJ of "asleep" (not of "it") → not matched
 *    - "his mouth" → "his" is PRP$ (not PRP) → not matched
 *    - "our youth" → "our" is PRP$ → not matched
 *    - "we're awake" → "we" governor is "awake" (not "it") → not matched
 *    - "I would give you" → "you" is DOBJ (not NSUBJ) of "give" → not matched */
function raiseInterrogativePronounFocus(words: ClsWord[]): void {
  const BE_FORMS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being',
    "'s", "'re"]);
  const real = words.filter(w => w.syllables.length > 0 && !isPunctuation(w.lexicalClass));
  if (real.length === 0) return;

  for (const w of real) {
    if (w.lexicalClass !== 'PRP') continue;
    if ((w.canonicalRel ?? '') !== 'NSUBJ') continue;
    const gov = w.dependency?.governor;
    if (!gov || gov === w) continue;
    if (gov.word.toLowerCase() !== 'it' || gov.lexicalClass !== 'PRP') continue;
    if ((gov.canonicalRel ?? '') !== 'ROOT') continue;

    // Find the be-form AUX dependent of "it" that is the first word
    const aux = real.find(x =>
      (x.canonicalRel ?? '') === 'AUX' &&
      x.dependency?.governor === gov &&
      BE_FORMS.has(x.word.toLowerCase()));
    if (!aux) continue;

    // The be-form must be the first real word of the sentence (interrogative
    // verb-subject inversion)
    const firstWord = real.sort((a, b) => a.absoluteIndex - b.absoluteIndex)[0];
    if (aux !== firstWord) continue;

    // Found the interrogative copula construction: "Is it YOU?".
    // 1. Raise the focused pronoun to 'm' — it is the information-seeking
    //    element, the strongest stress in the question.
    const pk = wordPeak(w);
    if (pk) {
      const r = STRESS_RANK[pk.relativeStress ?? 'w'];
      if (r < STRESS_RANK.m) pk.relativeStress = 'm';
    }
    // 2. Lower the dummy subject "it" to 'w' — it is an expletive, not a real
    //    content word, and must not sit at 'n' creating a flat n-n-n chain with
    //    the pronoun and the following adverb.
    const itPk = wordPeak(gov);
    if (itPk) {
      const r = STRESS_RANK[itPk.relativeStress ?? 'w'];
      if (r > STRESS_RANK.w) itPk.relativeStress = 'w';
    }
  }
}

/** Phrasal-verb particle stress: in a VB+RP pair ("come ON", "take OFF", "give
 *  UP"), the PARTICLE bears the stress — English phonology places the phrasal
 *  accent on the particle, not the verb.  UDPipe confirms the relation via the
 *  `compound:prt` dependency (canonicalRel='VPRT') or the RP POS tag.  When the
 *  verb currently outranks the particle, swap their peaks: demote the verb one
 *  rung, promote the particle to the verb's former level.  Only fires when they
 *  are surface-adjacent (the particle immediately follows the verb). */
function resolvePhrasalVerbParticle(words: ClsWord[]): void {
  const content = words.filter(w => w.syllables.length > 0 && !isPunctuation(w.lexicalClass));
  for (let i = 0; i < content.length - 1; i++) {
    const verb = content[i];
    const particle = content[i + 1];
    if (Math.abs(verb.absoluteIndex - particle.absoluteIndex) !== 1) continue;
    if (!/^VB/.test(verb.lexicalClass)) continue;
    // The partner must be a phrasal-verb particle: RP POS, or has a prt/VPRT
    // dependency on the verb, or is recovered by isPhrasalParticle.
    const isParticle =
      particle.lexicalClass === 'RP' ||
      (particle.canonicalRel ?? '') === 'VPRT' ||
      particle.dependency?.dependentType === 'compound:prt' ||
      (PARTICLE_LEMMAS.has(particle.word.toLowerCase()) &&
       (particle.dependency?.dependentType === 'prt' ||
        particle.dependency?.dependentType === 'advmod'));
    if (!isParticle) continue;
    const vPeak = wordPeak(verb);
    const pPeak = wordPeak(particle);
    if (!vPeak || !pPeak) continue;
    const rv = STRESS_RANK[vPeak.relativeStress ?? 'w'];
    const rp = STRESS_RANK[pPeak.relativeStress ?? 'w'];
    if (rv <= rp) continue;                        // particle already ≥ verb → nothing to do
    // Swap: particle gets the verb's level, verb drops one rung
    pPeak.relativeStress = STRESS_LEVELS[rv];
    vPeak.relativeStress = STRESS_LEVELS[Math.max(0, rv - 1)];
    // The raise can mint a NEW s·s clash with the word that follows the
    // particle — the clash filter has already run, so repair it locally.
    // "drip off, fading stray": off's new 's' abuts fading's 's' across the
    // comma.  Two nuclear strengths cannot abut even across a pause; the
    // PRE-boundary member sits in phrase-final (nuclear) position and is
    // protected, so the follower — provided it is NOT the line's closing
    // nuclear (a later beat exists: "stray") — grades to 'm', still a beat.
    // Without an overt boundary the particle yields instead ("gave up HOPE"
    // keeps the object nuclear).  Only truly-abutting peak syllables count.
    if ((pPeak.relativeStress ?? 'w') === 's' &&
        pPeak === particle.syllables[particle.syllables.length - 1]) {
      const next = content[i + 2];
      if (next && next.absoluteIndex - particle.absoluteIndex <= 2) {
        const nPeak = wordPeak(next);
        if (nPeak && nPeak === next.syllables[0] &&
            (nPeak.relativeStress ?? 'w') === 's') {
          const boundary = words.some(x => x.syllables.length === 0 &&
            /^[,;:.!?…()—–-]+$/.test(x.word) &&
            x.absoluteIndex > particle.absoluteIndex &&
            x.absoluteIndex < next.absoluteIndex);
          if (boundary) {
            const laterBeat = words.some(x => x.absoluteIndex > next.absoluteIndex &&
              x.syllables.some(s => STRESS_RANK[s.relativeStress ?? 'w'] >= STRESS_RANK.m));
            if (laterBeat) nPeak.relativeStress = 'm';
            else pPeak.relativeStress = 'm';
          } else {
            pPeak.relativeStress = 'm';
          }
        }
      }
    }
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
  // Track words demoted as the RIGHT element of a collocation — a word just
  // demoted (e.g. "old" in "GOOD old") must NOT be re-forestressed as the LEFT
  // element of a following collocation ("old days"), or it would be raised back
  // up and "days" would be wrongly demoted, destroying "GOOD old DAYS".
  const demoted = new Set<ClsWord>();
  for (let i = 0; i < seq.length - 1; i++) {
    const w1 = seq[i];
    const w2 = seq[i + 1];
    if (w2.absoluteIndex - w1.absoluteIndex !== 1) continue; // truly adjacent
    if (!isLeftStressedCollocation(w1, w2)) continue;
    if (demoted.has(w1)) continue;                 // w1 was a prior collocation's right element — don't re-forestress

    const s1 = wordPeak(w1);
    const s2 = wordPeak(w2);
    if (!s1 || !s2) continue;
    const r1 = STRESS_RANK[s1.relativeStress ?? 'w'];
    const r2 = STRESS_RANK[s2.relativeStress ?? 'w'];
    const hi = Math.max(r1, r2);
    s1.relativeStress = STRESS_LEVELS[hi];                         // left element ≥ both
    s2.relativeStress = STRESS_LEVELS[Math.min(r2, Math.max(0, hi - 1))]; // demote-only
    demoted.add(w2);
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