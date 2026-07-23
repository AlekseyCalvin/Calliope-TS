// Faithful port of dictfuncs.py's ScanDict (a thin wrapper over the data table)
// plus scanfuncs.py's ScansionMachine._dictLookup (the actual -s/-ed suffix
// fallback search).  Independent of Calliope's own lexicon (Nounsing) entirely.

import { SCANDICT_DATA } from './dictionary-data.js';

/**
 * word, or word less a trailing -s/-ed, is in the dictionary?  Returns a
 * FRESH copy of the syllable list (never the shared table entry — callers
 * mutate the last syllable to append the suffix letters).
 */
export function dictLookup(word: string): string[] | null {
  const direct = SCANDICT_DATA[word];
  if (direct) return direct.slice();
  if (word.length < 5) return null; // e.g. 'bed' -- too short to risk a suffix guess
  if (word.endsWith('s')) {
    const base = SCANDICT_DATA[word.slice(0, -1)];
    if (!base) return null;
    const syls = base.slice();
    const last = syls[syls.length - 1];
    syls[syls.length - 1] = isUpperWord(last) ? last + 'S' : last + 's';
    return syls;
  }
  if (word.endsWith('ed')) {
    const baseEd = SCANDICT_DATA[word.slice(0, -2)];
    if (baseEd) {
      const syls = baseEd.slice();
      const last = syls[syls.length - 1];
      syls[syls.length - 1] = isUpperWord(last) ? last + 'ED' : last + 'ed';
      return syls;
    }
    const baseD = SCANDICT_DATA[word.slice(0, -1)];
    if (baseD) {
      const syls = baseD.slice();
      const last = syls[syls.length - 1];
      syls[syls.length - 1] = isUpperWord(last) ? last + 'D' : last + 'd';
      return syls;
    }
    return null;
  }
  return null;
}

/** Python's str.isupper(): true only if the string has at least one cased
 *  character and all of them are uppercase (so a bare "'" or digits alone
 *  would be false, matching CPython's semantics closely enough for our
 *  A-Za-z-only syllable strings). */
export function isUpperWord(s: string): boolean {
  return /[A-Z]/.test(s) && s === s.toUpperCase();
}
