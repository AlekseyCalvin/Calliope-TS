// calliope/feats.ts — parse UD morphological FEATS onto ClsWord (Phase 1 enabler).
//
// The parser stores the raw FEATS string ("Number=Sing|Person=3|Tense=Pres|
// VerbForm=Fin") on `word.lexicalDetails`, but no downstream module could read it:
// `udpos.ts:feat()` only sees the UDPipe-level `UDWord.featsMap` at parse time.  This
// pass parses `lexicalDetails` into `word.featsMap` ONCE, early in the Calliope
// pipeline, so the stress / bracketing / relativiser modules can key on morphology
// (VerbForm=Part → participle, Voice=Pass → underlying object subject, PronType=Prs →
// inherently given, Degree=Cmp → JJR, …).  Pure plumbing — it mutates only the
// additive `featsMap`, never the parse.

import { ClsSentence, ClsWord } from '../types.js';

/** Parse a UD FEATS string ("A=b|C=d") into a key→value record. */
function parseFeatsString(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split('|')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/** Populate `word.featsMap` for every word in the sentence from `lexicalDetails`. */
export function parseFeats(sent: ClsSentence): void {
  for (const w of sent.words) {
    if (w.featsMap) continue;                // already parsed (idempotent)
    w.featsMap = parseFeatsString(w.lexicalDetails);
  }
}

/** Read one morphological feature, undefined if absent.  Lazily parses on demand
 *  so callers reached before `parseFeats` still work. */
export function feat(w: ClsWord, key: string): string | undefined {
  if (!w.featsMap) w.featsMap = parseFeatsString(w.lexicalDetails);
  return w.featsMap[key];
}

/** True when a feature has the given value. */
export function featIs(w: ClsWord, key: string, value: string): boolean {
  return feat(w, key) === value;
}
