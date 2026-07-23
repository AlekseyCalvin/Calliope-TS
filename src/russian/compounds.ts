// compounds.ts — Compound word and secondary stress handling.
// Russian frequently uses compound words in poetry. The algorithm detects
// compound prefixes, places secondary stress on the first root, and primary
// stress on the second root.

import { getAccentsData } from './accentuator.js';
import { countVowels } from './syllabifier.js';
import { RU_VOWELS } from './types.js';

/** Check if a word is a compound and return secondary stress info. */
export function getCompoundSecondaryStress(word: string): number[] | null {
  const data = getAccentsData();
  const lower = word.toLowerCase();

  // 1. Check explicit secondary stress dictionary
  if (data.secondaryStress[lower]) {
    return data.secondaryStress[lower];
  }

  // 2. Skip if word already has known stress (not compound)
  if (data.wordAccents.has(lower) || data.ambiguousAccents[lower] || data.ambiguousAccents2[lower]) {
    return null;
  }

  // 3. Check compound prefixes
  const deriv = data.derivationData;
  if (!deriv?.compound2stress || !deriv?.compound_prefixes) return null;

  for (const prefix of deriv.compound_prefixes) {
    if (lower.startsWith(prefix) && lower.length > prefix.length) {
      const tail = lower.slice(prefix.length);
      const isValidTail =
        data.wordAccents.has(tail) ||
        data.ambiguousAccents[tail] ||
        data.ambiguousAccents2[tail] ||
        deriv.compound_tails?.[tail];

      if (isValidTail) {
        const stressedHead = deriv.compound2stress[prefix];
        if (stressedHead) {
          const secPos = stressPosFromForm(stressedHead);
          if (secPos > 0) {
            const nVowels = countVowels(lower);
            const result = new Array(nVowels).fill(0);
            let vCount = 0;
            for (let i = 0; i < prefix.length && vCount < secPos; i++) {
              if (RU_VOWELS.includes(lower[i])) {
                vCount++;
                if (vCount === secPos) result[vCount - 1] = 2;
              }
            }
            return result;
          }
        }
      }
    }
  }

  return null;
}

function stressPosFromForm(form: string): number {
  let nvowels = 0;
  for (const c of form) {
    if ('уеыаоэёяию'.includes(c.toLowerCase())) nvowels++;
    if ('АЕЁИОУЫЭЮЯ'.includes(c)) return nvowels;
  }
  return -1;
}

/** Apply verb prefix derivation: for prefixed verbs, preserve the stress
 *  of the original unprefixed verb. */
export function applyVerbPrefixDerivation(word: string, upos: string): number | null {
  if (upos !== 'VERB') return null;
  const data = getAccentsData();
  const lower = word.toLowerCase();
  const verbPrefixes: string[] = data.derivationData?.verb_prefixes || [];

  for (const prefix of verbPrefixes) {
    if (lower.startsWith(prefix) && lower.length > prefix.length) {
      const stem = lower.slice(prefix.length);
      if (data.wordAccents.has(stem)) {
        return data.wordAccents.get(stem)!;
      }
    }
  }
  return null;
}
