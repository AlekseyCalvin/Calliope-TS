// calliope/engine.ts — the "Calliope" engine: the faithful, default,
// syntax-driven prosody pipeline.  It derives the κ/ϕ/ι prosodic hierarchy and
// word prominence from a canonical, DepEdit-normalised dependency parse via the
// Scenario A–O relation-keyed stress rules and the corrected Match-Theory
// boundary map.
//
// Build status: STAGE 0 — the engine seam is in place but the per-sentence
// sequence is, for now, identical to the legacy ("Clio") one, so the default
// output is unchanged and the existing tests stay green.  Stages 1–4 progressively
// replace the body with: canonical deps (Stage 1) → Match-Theory hierarchy
// (Stage 2) → Scenario A–O stress (Stage 3) → phrase-stress ramp + relativise
// (Stage 4).  The legacy path remains untouched in `src/clio/engine.ts`.

import { ClsSentence, IntonationalUnit } from '../types.js';
import { assignLexicalStress, applySurfacePostProcessing, detectDisplayPrefixes, applyStressShift, applyRhythmicPeakPlacement } from '../stress.js';
import { ProsodyEngine } from '../engine.js';
import { correctPosWithLexicon } from './postag.js';
import { tagNames } from './names.js';
import { parseFeats } from './feats.js';
import { normalizeDeps } from './deps.js';
import { buildProsodicHierarchy } from './prosodic.js';
import { computePhraseStress } from './bracketing.js';
import { computeRelativeStress } from './relstress.js';

function analyzeSentenceCalliope(sent: ClsSentence): IntonationalUnit[] {
  // ── Stage F1: reliable parse over the whole utterance (Calliope-only). ──
  // Correct spurious proper-noun tags via en-lexicon (Pale/High → JJ); type real
  // proper nouns as person/place names; normalise en-parse's hybrid relations into
  // the Scenario label space on word.canonicalRel (with surface-adjacency fallback
  // for pre-head modifiers).  Mutates the Calliope-only view of the parse; Clio,
  // invoked via --clio, never runs these and keeps its frozen reading.
  correctPosWithLexicon(sent);
  tagNames(sent);
  // Parse UD morphological FEATS (Number/VerbForm/Voice/PronType/Definite/Degree/…)
  // from lexicalDetails onto word.featsMap so the Wagner/Krifka stress + bracketing
  // refinements can read morphology.  Must precede normalizeDeps (which may consult it).
  parseFeats(sent);
  normalizeDeps(sent);

  // ── Stress path: lexical → genuine phrase stress → relative, per McAleese E4. ──
  // 1. Lexical stress (syllabification + word contour 0-3).
  // 2. κ/ϕ/ι hierarchy fixed over the whole utterance from the dependency relations.
  // 3. PHRASE STRESS: the genuine cyclic Compound + Nuclear Stress Rules over the
  //    dependency tree's constituent bracketing (bracketing.ts) — an integer
  //    prominence ranking (1 = strongest utterance nuclear), NOT a ramp.
  // 4. RELATIVE STRESS: the x/w/n/m/s contour DERIVED per φ from that phrase stress
  //    (the φ's lowest-phraseStress word is its beat), then clash-resolved.  The two
  //    layers are separate signals — global integer vs local contour — free to
  //    diverge.  (Replaces the legacy compound→nuclear→phrase→relativise chain, which
  //    Clio still runs.)
  assignLexicalStress(sent.words);
  // Display-only prefix detection: set `morphPrefix` on words whose productive
  // prefix + dictionary stem split would guide the display syllabifier to
  // respect the morpheme boundary (dis·il·lu·sions, un·ed·u·ca·ted).  Runs for
  // ALL words (in-vocab AND OOV), never affects stress or meter.
  detectDisplayPrefixes(sent.words);
  const ius = buildProsodicHierarchy(sent);
  // Stress Shift: swap primary↔secondary for words where Nounsing-Pro confirms
  // shiftLikely=true AND the context motivates it (imperative at phrase start or
  // Rhythm Rule clash).  Runs after hierarchy (needs PP-initial info) but before
  // phrase stress (so the shifted peak flows into the NSR ramp).
  applyStressShift(sent.words, ius);
  // Rhythm-Rule peak placement for bistable disyllables (contourless
  // shift-likely words like "into"; fused negatives like "cannot"): the peak
  // is selected by grid alternation with the neighbouring lexical stresses,
  // before phrase stress reads the contour.
  applyRhythmicPeakPlacement(sent.words);
  computePhraseStress(sent);
  computeRelativeStress(sent.words, ius);
  // Surface-order post-processing passes shared with the Clio engine: compound
  // forestress, lexicalised collocation forestress, hyphen-seam clash resolution,
  // residual linear clash resolution, and exclaimed-interjection raise.  These
  // re-assert forestress on surface-adjacent pairs the hierarchy-order passes may
  // miss (mis-grouped parses) and catch any residual equal-stress clashes.
  applySurfacePostProcessing(sent.words);
  return ius;
}

export const calliopeEngine: ProsodyEngine = {
  name: 'calliope',
  analyzeSentence: analyzeSentenceCalliope,
};
