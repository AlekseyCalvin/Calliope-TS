// calliope/udpos.ts — UNIVERSAL POS → Penn Treebank conversion.
//
// WHY: the phonological pipeline keys on Penn XPOS (NN/VBZ/JJ/DT/IN…), but
// UDPipe's XPOS column is treebank-specific and INCONSISTENT across models —
// EWT/GUM emit Penn tags, but LinES emits its own morphological tagset
// (DEF/SG-NOM/PL-NOM/ING/REL…) and ParTUT an Italian-derived one (RD/S/V/E/A/PD…),
// neither of which the downstream understands.  UPOS and FEATS, by contrast, are
// the Universal Dependencies standard and are consistent (and more accurate:
// ~94% UPOS vs ~93% XPOS) across ALL four models.  So we DERIVE the Penn tag the
// pipeline needs from UPOS + morphological FEATS, making the parser model-agnostic
// AND giving us morphology en-parse never had (Number, Tense, Degree, PronType,
// VerbForm) to make finer, more reliable distinctions.

import type { UDWord } from 'udpipe-node';

// The Penn Treebank tag set the downstream understands.  EWT/GUM emit these
// directly (and reliably — a lexicalised PDT like "all" stays PDT even when the
// parse mislabels its relation); LinES/ParTUT do NOT, so for those we derive the
// Penn tag from UPOS+FEATS instead.
const PENN_TAGS = new Set([
  'NN', 'NNS', 'NNP', 'NNPS', 'JJ', 'JJR', 'JJS',
  'VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ', 'MD',
  'RB', 'RBR', 'RBS', 'PRP', 'PRP$', 'WP', 'WP$', 'WDT', 'WRB',
  'DT', 'PDT', 'CD', 'IN', 'TO', 'CC', 'RP', 'EX', 'POS', 'UH', 'FW', 'SYM', 'LS',
]);

/** True if `xpos` is a Penn tag the pipeline consumes directly (EWT/GUM). */
export function isPennTag(xpos: string | undefined): boolean {
  return !!xpos && PENN_TAGS.has(xpos);
}

/** The Penn tag for a token: the raw XPOS when it is already Penn (EWT/GUM),
 *  otherwise derived from UPOS+FEATS (LinES/ParTUT, or a missing XPOS). */
export function pennTagOf(w: UDWord): string {
  if (isPennTag(w.xpos)) return w.xpos;
  return udToPenn(w);
}

const MODAL_LEMMAS = new Set([
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'ought', "'ll", "'d", 'wilt', 'shalt', 'canst', 'wouldst', 'shouldst', 'couldst',
]);
// Pre-determiners ("ALL the books", "BOTH his hands", "such a day", "HALF the night").
const PREDET_LEMMAS = new Set(['all', 'both', 'half', 'such', 'quite', 'many']);

function feat(w: UDWord, k: string): string | undefined {
  return w.featsMap ? w.featsMap[k] : undefined;
}

/**
 * Convert one UDPipe token to a Penn Treebank tag from UPOS + FEATS (+ lemma /
 * deprel for the cases morphology alone can't settle).  Falls back to the raw XPOS
 * only when UPOS is absent.
 */
export function udToPenn(w: UDWord): string {
  const upos = w.upos || '';
  const lemma = (w.lemma || w.form || '').toLowerCase();
  const deprel = (w.deprel || '').toLowerCase();
  const num = feat(w, 'Number');
  const degree = feat(w, 'Degree');
  const pron = feat(w, 'PronType');
  const poss = feat(w, 'Poss');
  const vform = feat(w, 'VerbForm');
  const tense = feat(w, 'Tense');
  const person = feat(w, 'Person');

  // Pre-determiner ("ALL the time", "BOTH his hands"): a stress-bearing quantifier
  // (Penn PDT, content), regardless of whether the model calls it DET or PRON.  UD
  // marks it with the det:predet relation; the non-Penn models lose that, so back
  // it up with the lemma list.
  if (deprel === 'det:predet') return 'PDT';

  switch (upos) {
    case 'NOUN':
      return num === 'Plur' ? 'NNS' : 'NN';
    case 'PROPN':
      return num === 'Plur' ? 'NNPS' : 'NNP';

    case 'ADJ':
      if (degree === 'Cmp') return 'JJR';
      if (degree === 'Sup') return 'JJS';
      // Ordinal numerals tag JJ in UD but CD-like in Penn; keep JJ (attributive).
      return 'JJ';

    case 'ADV':
      if (pron === 'Int' || pron === 'Rel') return 'WRB';   // when/where/why/how
      if (degree === 'Cmp') return 'RBR';
      if (degree === 'Sup') return 'RBS';
      return 'RB';

    case 'VERB':
    case 'AUX': {
      if (upos === 'AUX' && (feat(w, 'VerbType') === 'Mod' || MODAL_LEMMAS.has(lemma))) return 'MD';
      if (vform === 'Ger') return 'VBG';
      if (vform === 'Part') return tense === 'Past' ? 'VBN' : 'VBG';
      if (vform === 'Inf') return 'VB';
      if (vform === 'Fin') {
        if (tense === 'Past') return 'VBD';
        if (person === '3' && num === 'Sing') return 'VBZ';
        return 'VBP';
      }
      // No VerbForm feature: best-effort by tense/person.
      if (tense === 'Past') return 'VBD';
      if (person === '3' && num === 'Sing') return 'VBZ';
      return upos === 'AUX' ? 'VBP' : 'VB';
    }

    case 'PRON':
      if (poss === 'Yes') return (pron === 'Rel' || pron === 'Int') ? 'WP$' : 'PRP$';
      if (pron === 'Rel' || pron === 'Int') return 'WP';
      if (pron === 'Dem') return 'DT';                       // "this/that" pronominal
      return 'PRP';

    case 'DET':
      if (pron === 'Rel' || pron === 'Int') return 'WDT';    // which/that(rel)/what
      if (poss === 'Yes') return 'PRP$';                     // my/your/their (UD DET)
      if (PREDET_LEMMAS.has(lemma) && deprel === 'det:predet') return 'PDT';
      return 'DT';                                           // articles + demonstratives

    case 'ADP':
      // A particle of a phrasal verb ("came DOWN", "give UP") is stress-bearing RP;
      // an ordinary preposition is the reducible IN.  UD marks the particle by the
      // compound:prt relation.
      return deprel === 'compound:prt' ? 'RP' : 'IN';
    case 'SCONJ':
      return 'IN';
    case 'CCONJ':
      return 'CC';

    case 'PART':
      if (lemma === 'to') return 'TO';
      if (lemma === "'s" || lemma === '’s' || deprel === 'case') return 'POS';
      if (lemma === 'not' || lemma === "n't" || lemma === "n’t") return 'RB';
      return 'RB';

    case 'NUM':
      return 'CD';
    case 'INTJ':
      return 'UH';
    case 'SYM':
      return 'SYM';
    case 'X':
      return 'FW';

    case 'PUNCT':
      // EWT/GUM give the punctuation char as XPOS already; otherwise use the form.
      return (w.xpos && /[^A-Za-z0-9]/.test(w.xpos)) ? w.xpos : (w.form || w.xpos || ':');

    default:
      return w.xpos || w.upos || 'NN';
  }
}
