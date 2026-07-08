// Top-level orchestration for the independent Scandroid engine.  Public API:
// `scanTextNatively(rawLines)` takes ONLY the raw verse-line strings of a
// poem (or a single line) and returns one rich, self-contained result per
// line -- Hartman's own verdict, Hartman's own stress map, in Hartman's own
// symbols and foot names.  Nothing here reads anything Calliope has already
// worked out about the same lines.

import { footDict, AnapSubs, lineLengthName, FOOTDIV } from './constants.js';
import { invertFootDict } from './utilities.js';
import { ScansionMachine } from './machine.js';
import { deduceParametersForPoem, deduceParametersForSingleLine, type ScandroidParams, type Metron } from './deduceParameters.js';

const footDictInverse = invertFootDict(footDict);
const anapSubsInverse = invertFootDict(AnapSubs);

export interface ScandroidNativeFootResult {
  /** 'Corral the Weird' | 'Maximize the Normal' | 'Anapestic' */
  algorithm: string;
  footlist: string[];
  /** Feet joined by FOOTDIV ('|'), each foot's own STRESS/SLACK/PROMOTED marks. */
  scanString: string;
  /** The same marks with no foot divisions -- one character per syllable. */
  marksString: string;
  substitutions: number;
  /** false = FAIL: wrong foot count against a fixed line length, a pyrrhic
   *  before a trochee, an amphibrach inside an anapestic line, etc. */
  ok: boolean;
  failReason?: string;
}

export interface ScandroidNativeLineResult {
  metron: Metron;
  metronName: string; // 'IAMBIC' | 'ANAPESTIC', Hartman's own status-bar wording
  lineFeet: number;
  lineFeetSet: boolean;
  lineLengthName: string; // e.g. 'PENTAMETER', or 'VARIABLE' when lineFeetSet is false
  /** The ChooseAlgorithm / GetBestAnapLexes winner -- Scandroid's own verdict. */
  verdict: ScandroidNativeFootResult | null;
  /** Iambic lines only: each algorithm's own independent best, for side-by-side display. */
  corralTheWeird?: ScandroidNativeFootResult | null;
  maximizeTheNormal?: ScandroidNativeFootResult | null;
  /** 0-based syllable indices where a pyrrhic/slack-run was promoted to a beat. */
  promotions: number[];
}

// Display-only helper (not a port of anything in the 2005 source): walks the
// footlist in pattern-length chunks to insert FOOTDIV between feet.  On a
// length-mismatch FAIL the footlist can run past the syllables actually
// available (CleanUpRE/TestLengthAndDice keep assembling feet from whatever
// state a wrong-length line leaves them in) -- stop once marks are exhausted
// rather than emit a trail of empty '||||' segments.
function renderFootDividedString(marks: string, footlist: string[], patternDict: Record<string, string>): string {
  const parts: string[] = [];
  let pos = 0;
  for (const foot of footlist) {
    if (pos >= marks.length) break;
    const len = patternDict[foot]?.length ?? 0;
    parts.push(marks.slice(pos, pos + len));
    pos += len;
  }
  return parts.join(FOOTDIV);
}

function buildFootResult(
  algorithm: string,
  footlist: string[],
  marks: string,
  substitutions: number,
  ok: boolean,
  patternDict: Record<string, string>,
  failReason?: string
): ScandroidNativeFootResult {
  return {
    algorithm,
    footlist: footlist.slice(),
    scanString: renderFootDividedString(marks, footlist, patternDict),
    marksString: marks,
    substitutions,
    ok,
    failReason,
  };
}

function runIndividualIambic(
  line: string,
  params: ScandroidParams,
  algorithm: 1 | 2,
  candidate: { marks: string; complexity: number },
  algLabel: string
): ScandroidNativeFootResult {
  const m = new ScansionMachine();
  m.SetLineFeet(params.lineFeet, params.lineFeetSet);
  m.ParseLine(line);
  // Mirror DoAlgorithm's own auto-length side effect (this candidate never ran
  // DoAlgorithm on THIS fresh machine, since we're going straight to the
  // step-by-step path) -- every candidate shares the same total syllable
  // count, so this is exactly what DoAlgorithm would have set LD.lfeet to.
  if (!params.lineFeetSet) m.LD.lfeet = Math.floor(candidate.marks.length / 2);
  const stepOk = m.runIambicStepByStep(algorithm, candidate.marks);
  const promote = m.PromotePyrrhics();
  const howwedoing = m.HowWeDoing();
  return buildFootResult(algLabel, m.LD.footlist, m.P.GetMarks(), howwedoing.substitutions, stepOk && promote.ok && howwedoing.ok, footDictInverse);
}

function lengthName(feet: number, feetSet: boolean): string {
  return feetSet ? lineLengthName[feet] ?? '' : 'VARIABLE';
}

/** Scan one line under already-deduced poem-level (or single-line) parameters. */
export function scanLineNatively(line: string, params: ScandroidParams): ScandroidNativeLineResult {
  const metronName = params.metron === 'iambic' ? 'IAMBIC' : 'ANAPESTIC';

  if (params.metron === 'iambic') {
    const machine = new ScansionMachine();
    machine.SetLineFeet(params.lineFeet, params.lineFeetSet);
    machine.ParseLine(line);
    const chosen = machine.ChooseAlgorithm();
    if (!chosen) {
      return {
        metron: 'iambic', metronName, lineFeet: params.lineFeet, lineFeetSet: params.lineFeetSet,
        lineLengthName: lengthName(params.lineFeet, params.lineFeetSet),
        verdict: null, corralTheWeird: null, maximizeTheNormal: null, promotions: [],
      };
    }
    const promote = machine.PromotePyrrhics();
    const howwedoing = machine.HowWeDoing();
    const verdict = buildFootResult(
      chosen.verdictAlgorithm === 1 ? 'Corral the Weird' : 'Maximize the Normal',
      machine.LD.footlist,
      machine.P.GetMarks(),
      howwedoing.substitutions,
      chosen.verdictOk && promote.ok && howwedoing.ok,
      footDictInverse
    );
    const corral = chosen.alg1Best ? runIndividualIambic(line, params, 1, chosen.alg1Best, 'Corral the Weird') : null;
    const maximize = chosen.alg2Best ? runIndividualIambic(line, params, 2, chosen.alg2Best, 'Maximize the Normal') : null;
    return {
      metron: 'iambic', metronName, lineFeet: machine.LD.lfeet, lineFeetSet: params.lineFeetSet,
      lineLengthName: lengthName(machine.LD.lfeet, params.lineFeetSet),
      verdict, corralTheWeird: corral, maximizeTheNormal: maximize, promotions: promote.promotions,
    };
  }

  // Anapestic
  const machine = new ScansionMachine();
  machine.SetLineFeet(params.lineFeet, params.lineFeetSet);
  machine.ParseLine(line);
  const best = machine.GetBestAnapLexes();
  if (!best) {
    return {
      metron: 'anapestic', metronName, lineFeet: params.lineFeet, lineFeetSet: params.lineFeetSet,
      lineLengthName: lengthName(params.lineFeet, params.lineFeetSet),
      verdict: null, promotions: [],
    };
  }
  const cleanup = machine.AnapCleanUpAndReport();
  const verdict = buildFootResult(
    'Anapestic', machine.LD.footlist, machine.P.GetMarks(), cleanup.substitutions,
    cleanup.ok, anapSubsInverse, cleanup.fail
  );
  return {
    metron: 'anapestic', metronName, lineFeet: machine.LD.lfeet, lineFeetSet: params.lineFeetSet,
    lineLengthName: lengthName(machine.LD.lfeet, params.lineFeetSet),
    verdict, promotions: [],
  };
}

/** Scan a whole poem (or a single line): deduces Metron/line-length exactly
 *  once over the full raw-line list -- matching Scandroid's own "loaded
 *  document" behaviour for 2+ lines, and its "typed single line" behaviour
 *  (variable length, per-line Metron) for exactly one line -- then scans
 *  every line under those shared parameters.  `rawLines` should be every
 *  non-blank line of the poem in reading order, spanning stanza breaks: the
 *  original deduces Metron/length from up to a dozen lines of the whole
 *  loaded document, not per stanza. */
export function scanTextNatively(rawLines: string[]): ScandroidNativeLineResult[] {
  if (rawLines.length === 0) return [];
  const params = rawLines.length < 2 ? deduceParametersForSingleLine(rawLines[0]) : deduceParametersForPoem(rawLines);
  return rawLines.map(line => scanLineNatively(line, params));
}
