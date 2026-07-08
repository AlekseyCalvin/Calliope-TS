// calliope/names.ts — proper-NOUN (person) vs proper-NAME (place) typing via the
// `humannames` and `cities-list` membership lists.  These packages are JUST lists
// ({ "John": 1, … }), so this is a boolean enrichment, not a pipeline: it flags a
// token as a known person and/or place name to drive Scenario C (proper-name
// head-stress) and EXT.
//
// Lookups are GATED to proper-noun-tagged tokens (NNP/NNPS).  Both lists are huge
// (197k names, 79k cities) and overlap heavily with common words — "Will", "May",
// "Rose", "Sun", "York", "Reading" are all in them — so flagging an untyped token
// would be noise.  Restricting to NNP(S) keeps the signal honest.

import { createRequire } from 'module';
import { ClsSentence } from '../types.js';

const req = createRequire(import.meta.url);

function loadList(pkg: string): Record<string, number> {
  try {
    const m = req(pkg);
    return (m && typeof m === 'object' ? m : {}) as Record<string, number>;
  } catch {
    return {};
  }
}

export const PERSON = loadList('humannames');
export const PLACE = loadList('cities-list');
const PROPER = /^(NNP|NNPS)$/;

export function inList(list: Record<string, number>, surface: string): boolean {
  const key = surface.replace(/['’].*$/, '').replace(/[^A-Za-z-]/g, '');
  if (!key) return false;
  const cap = key[0].toUpperCase() + key.slice(1);
  return !!(list[key] || list[cap]);
}

/** Flag proper-noun tokens as person and/or place names (membership only). */
export function tagNames(sent: ClsSentence): void {
  for (const w of sent.words) {
    if (!PROPER.test(w.lexicalClass)) continue;
    if (inList(PERSON, w.word)) w.isPersonName = true;
    if (inList(PLACE, w.word)) w.isPlaceName = true;
  }
}
