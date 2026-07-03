// clio/engine.ts — the "Clio" engine: a FROZEN snapshot of the original
// per-sentence prosodic analysis as it stood before the Calliope rebuild
// (commit 3c016ad).  Clio is Calliope's historian sister — the legacy /
// alternative parse, kept verbatim and reachable from the CLI menu
// ("Ask Clio instead (alternative parse)") and the `--clio` flag.
//
// DO NOT evolve this file with the Calliope rebuild.  It deliberately pins the
// prior behaviour so the maintainer can A/B the new faithful engine against it.
// It composes the existing, unchanged linguistic modules in the original order.

import { ClsSentence, IntonationalUnit } from '../types.js';
import {
  assignLexicalStress,
  applyCompoundStress,
  applyNuclearStress,
  assignRelativeStresses,
} from './stress.js';
import { computePhraseStress } from './phrasestress.js';
import { buildPhonologicalHierarchy } from './phonological.js';
import { ProsodyEngine } from '../engine.js';

/** The original per-sentence sequence lifted verbatim from `processLine`. */
function analyzeSentenceClio(sent: ClsSentence): IntonationalUnit[] {
  assignLexicalStress(sent.words);
  const ius = buildPhonologicalHierarchy(sent);
  applyCompoundStress(ius);
  applyNuclearStress(ius);
  // McAleese's Phrase-Stress phase (integer nuclear ramp); populates
  // word.phraseStress, consumed by the relativiser.
  computePhraseStress(sent.words);
  assignRelativeStresses(sent.words, ius);
  return ius;
}

export const clioEngine: ProsodyEngine = {
  name: 'clio',
  analyzeSentence: analyzeSentenceClio,
};
