// Faithful port of Scandroid.py's DeduceParameters (the "loaded whole
// document" path: sample up to a dozen real lines, decide Metron by summed
// complexity, then decide a consistent line length via _setLineLengthIfPossible)
// and of ShowTextLine's "typed single line" path (decide Metron for just that
// one line, line length stays variable).  Calliope has two real analogues of
// these: a multi-line poem (deduce once over the whole text) and a single
// verse line typed/pasted alone (per-line decision, matching OnTypeBtn).

import { ScansionMachine } from './machine.js';

export type Metron = 'iambic' | 'anapestic';

export interface ScandroidParams {
  metron: Metron;
  lineFeet: number;
  lineFeetSet: boolean;
}

const LINES_TO_SAMPLE = 12;

/** Mirrors Scandroid.py's _setLineLengthIfPossible: an average with a small
 *  enough fractional remainder rounds to a fixed length; otherwise length
 *  stays variable (lineFeetSet=false) and lineFeet keeps its prior/default value. */
function setLineLengthIfPossible(lengths: number[], priorLineFeet: number): { lineFeet: number; lineFeetSet: boolean } {
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!total || lengths.length === 0) return { lineFeet: priorLineFeet, lineFeetSet: false };
  const avg = total / lengths.length;
  const integ = Math.trunc(avg);
  const frac = avg - integ;
  if (frac > 0.8) return { lineFeet: integ + 1, lineFeetSet: true };
  if (frac < 0.2) return { lineFeet: integ, lineFeetSet: true };
  return { lineFeet: priorLineFeet, lineFeetSet: false };
}

/** DeduceParameters: samples up to 12 non-title-like lines from the whole
 *  poem, tries each as iambic (ChooseAlgorithm, deducingParams) and as
 *  anapestic (GetBestAnapLexes, deducingParams), sums complexity per metron,
 *  and picks whichever metron scored lower overall. */
export function deduceParametersForPoem(rawLines: string[]): ScandroidParams {
  const machine = new ScansionMachine();
  machine.SetLineFeet(5, false);
  let iambCompTotal = 0;
  let anapCompTotal = 0;
  const iambLens: number[] = [];
  const anapLens: number[] = [];
  let sampled = 0;
  for (const line of rawLines) {
    if (sampled >= LINES_TO_SAMPLE) break;
    if (line.length < 5 || line.startsWith('\t')) continue; // skip titles/short lines
    sampled += 1;
    machine.ParseLine(line);
    const iamb = machine.ChooseAlgorithmComplexityOnly();
    iambCompTotal += iamb.score;
    if (iamb.score < 100) iambLens.push(iamb.length);
    const anap = machine.GetBestAnapLexesComplexityOnly();
    anapCompTotal += anap.score;
    if (anap.score < 100) anapLens.push(anap.length);
  }
  const metron: Metron = iambCompTotal < anapCompTotal ? 'iambic' : 'anapestic';
  const { lineFeet, lineFeetSet } = setLineLengthIfPossible(metron === 'iambic' ? iambLens : anapLens, 5);
  return { metron, lineFeet, lineFeetSet };
}

/** ShowTextLine's typed-single-line path: decide Metron for just this one
 *  line by comparing its own iambic vs anapestic complexity; line length
 *  stays variable (lineFeetSet=false), matching OnTypeBtn's own reset. */
export function deduceParametersForSingleLine(line: string): ScandroidParams {
  const machine = new ScansionMachine();
  machine.SetLineFeet(5, false);
  machine.ParseLine(line);
  const iamb = machine.ChooseAlgorithmComplexityOnly();
  const anap = machine.GetBestAnapLexesComplexityOnly();
  const metron: Metron = iamb.score < anap.score ? 'iambic' : 'anapestic';
  return { metron, lineFeet: 5, lineFeetSet: false };
}
