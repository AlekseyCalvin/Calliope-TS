// tagfix.ts — Pre-parse POS-tag correction layer.
//
// FinNLP's en-pos tagger is structurally sound but carries a small tail of
// SYSTEMATIC tag errors that matter enormously for verse analysis, because a
// wrong tag flips a word's content/function status (→ its stress tier) and
// derails the en-parse dependency tree built from the tags.  This pass runs
// BETWEEN en-pos and en-parse (see parseDocument in parser.ts), so corrected
// tags repair both the tagging AND the resulting dependency structure — a
// post-hoc fix of the parse could never do that.
//
// Every rule below targets an error class actually observed in this repo's
// trials; rules are deliberately narrow (anti-gaming: each must be justified
// by the error it fixes, not by benchmark deltas).

/** Zero-derived irregular past participles that en-pos tags NN/VBP after a
 *  have-auxiliary ("had quit", "has put", "have read").  Only forms whose
 *  participle is identical to the base/noun spelling — the -en/-ed forms tag
 *  fine on their own. */
const ZERO_PARTICIPLES = new Set([
  'quit', 'put', 'set', 'cut', 'hit', 'let', 'shut', 'cast', 'cost', 'hurt',
  'burst', 'split', 'spread', 'bet', 'wed', 'read', 'rid', 'shed', 'thrust',
  'slit', 'bid', 'broadcast', 'upset', 'sunburst',
]);

const HAVE_FORMS = new Set(['have', 'has', 'had', 'having', "'ve", "'d"]);

/** Archaic / Early-Modern-English forms en-pos has no lexicon entries for —
 *  ubiquitous in the verse this toolkit exists to scan. */
const ARCHAIC_TAGS: Record<string, string> = {
  thou: 'PRP', thee: 'PRP', ye: 'PRP',
  thy: 'PRP$', thine: 'PRP$',
  art: 'VBP', wert: 'VBD', wast: 'VBD',
  doth: 'VBZ', hath: 'VBZ', dost: 'VBZ', hast: 'VBZ', saith: 'VBZ',
  didst: 'VBD', hadst: 'VBD', wouldst: 'MD', couldst: 'MD', shouldst: 'MD',
  shalt: 'MD', wilt: 'MD', canst: 'MD', mayst: 'MD', 'mightst': 'MD',
  wherefore: 'WRB', whither: 'WRB', whence: 'WRB',
  hither: 'RB', thither: 'RB', yon: 'JJ', yonder: 'RB',
  ere: 'IN', oft: 'RB', anon: 'RB',
};

/**
 * Correct a sentence's tags in place-safe fashion (returns a new array).
 * `tokens` and `tags` are the en-pos outputs, index-aligned.
 */
export function correctTags(tokens: string[], tags: string[]): string[] {
  const out = tags.slice();
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase();

    // 1. The pronoun "I".  en-norm lowercases sentence-initial "I" → "i",
    //    which en-pos then reads as a foreign word / letter name (FW).
    if (w === 'i' && out[i] === 'FW') out[i] = 'PRP';

    // 2. Archaic forms (thou/thy/doth/shalt/wherefore…): en-pos guesses
    //    NN/JJ/FW for these, wrecking both stress class and the parse.
    //    Guard "art": only when a pronoun precedes ("thou art"), since the
    //    noun reading ("the art of…") is the modern default.
    const archaic = ARCHAIC_TAGS[w];
    if (archaic && !/^(NNP|NNPS)$/.test(out[i])) {
      if (w === 'art') {
        const prev = i > 0 ? tokens[i - 1].toLowerCase() : '';
        if (prev === 'thou' || prev === 'ye' || prev === 'you') out[i] = 'VBP';
      } else {
        out[i] = archaic;
      }
    }

    // 3. Perfect-tense zero participles: have-form + ("quit"/"put"/"read"…)
    //    tagged as NN/VBP/VBD → VBN, so en-parse builds the verb chain
    //    instead of treating the participle as a direct-object noun
    //    ("I had quit the programming paradigm").  An intervening adverb
    //    ("had just quit") is allowed.
    if (ZERO_PARTICIPLES.has(w) && /^(NN|NNS|VBP|VBD|VB)$/.test(out[i])) {
      const prev1 = i > 0 ? tokens[i - 1].toLowerCase() : '';
      const prev2 = i > 1 ? tokens[i - 2].toLowerCase() : '';
      const prev1IsAdv = i > 0 && /^RB/.test(out[i - 1]);
      if (HAVE_FORMS.has(prev1) || (prev1IsAdv && HAVE_FORMS.has(prev2))) {
        out[i] = 'VBN';
      }
    }

    // 4. Impossible gerunds: a VBG tag on a token that does not end in
    //    -ing/-in' cannot be a gerund/present participle — it is an en-pos
    //    lexicon glitch.  The right tag depends on context: before a noun it
    //    is a noun modifier ("wisdom"/VBG teeth → NN); after a subject
    //    pronoun it is a finite verb ("as they bicycle/VBG through" → VBP,
    //    which keeps "through" a phrasal particle in the parse).  With no
    //    deciding context, leave the tag alone (en-parse treats VBG
    //    verb-ishly, the safer default).
    if (out[i] === 'VBG' && !/in[g'’]?$/.test(w)) {
      const prevTag = i > 0 ? out[i - 1] : '';
      const nextTag = i + 1 < tokens.length ? out[i + 1] : '';
      if (/^NNS?$/.test(nextTag)) out[i] = 'NN';
      else if (prevTag === 'PRP') out[i] = 'VBP';
    }

    // 5. Vocative "O" ("O wild West Wind"): en-pos gives NNP/JJ; it is an
    //    interjection (and must not become a content word with a beat by
    //    default).  Only the bare capital O — "o'er" etc. are handled by the
    //    aphaeresis lexicon in stress.ts.
    if (tokens[i] === 'O' && i + 1 < tokens.length && out[i] !== 'UH') out[i] = 'UH';
  }
  return out;
}
