// Faithful port of Scandroid_py_source/scanstrings.py's global constants, plus
// syllables.py's module-level constant tuples.  This whole `scandroidNative/`
// tree is a SELF-CONTAINED re-implementation of Charles Hartman's 2005
// Scandroid: its own syllabifier, its own small stress dictionary, its own two
// iambic algorithms, its own anapestic algorithm.  Nothing here reads a
// Calliope-derived stress grade, dependency parse, or phonological hierarchy —
// scanLineNatively (engine.ts) takes only the raw line text, exactly as
// Hartman's ParseLine did.  It is a genuine second, independent opinion.

export const STRESS = '/';
export const SLACK = 'x';
export const PROMOTED = '%';
export const SYLMARK = '#';
export const FOOTDIV = '|';

/** Iambic foot dictionary (Scandroid's footDict), verbatim. */
export const footDict: Record<string, string> = {
  'x/': 'iamb',
  'xx': 'pyrrhic',
  '//': 'spondee',
  '/x': 'trochee',
  'x/x': 'amphibrach',
  '//x': 'palimbacchius',
  'xx/': 'anapest',
  '/': 'defective',
  '/xx': 'dactyl',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '%x': '(trochee)',
  'x/xx': '2nd paeon',
  'xx/x': '3rd paeon',
};

/** Anapestic foot dictionary (Scandroid's AnapSubs), verbatim. */
export const AnapSubs: Record<string, string> = {
  'xx/': 'anapest',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x/': 'iamb',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '//': 'spondee',
  'xx/x': '3rd paeon',
  'x/x': 'amphibrach',
  '///': 'molossus',
  '/x%': '(cretic)',
  '//x': 'palimbacchius',
};

export const lineLengthName = [
  '', '', 'DIMETER', 'TRIMETER', 'TETRAMETER', 'PENTAMETER',
  'HEXAMETER', 'HEPTAMETER', 'OCTAMETER', 'NONAMETER',
];

// ─── syllables.py module constants ─────────────────────────────────

export const SIBILANTS = '40xzjgsc';
export const MIDS = 'bdfgklmnpstw%0245';
export const MULTISUFFIX = ['ible', 'able'];
export const STRESSSUFFIX = [
  'tion', 'sion', 'tiou', 'ciou', 'tious',
  'cious', 'cion', 'gion', 'giou', 'gious',
];
export const PREFIXES = ['a', 'as', 'be', 'con', 'de', 'di', 'ex', 're', 'un', 'en'];
