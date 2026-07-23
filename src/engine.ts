// engine.ts — the prosody-engine abstraction (type-only; no runtime deps, so
// the concrete engines can import this without a cycle).
//
// Two engines produce the SAME shape — a per-sentence prosodic hierarchy with
// lexical/phrase/relative stress populated on the words:
//   • "calliope" — the faithful, default, syntax-driven rebuild (Match-Theory
//     hierarchy + Scenario A–O relation-keyed stress);
//   • "clio"     — a frozen snapshot of the prior pipeline, the legacy /
//     alternative parse, selectable via the CLI.
// Everything downstream (metrical scoring, rhyme/form, display, synopsis) is
// shared and engine-agnostic.

import { ClsSentence, IntonationalUnit } from './types.js';

export type EngineName = 'calliope' | 'clio';

export interface ProsodyEngine {
  readonly name: EngineName;
  /** Populate lexical/phrase/relative stress on `sent.words` and return the
   *  sentence's intonational units (the prosodic hierarchy). */
  analyzeSentence(sent: ClsSentence): IntonationalUnit[];
}
