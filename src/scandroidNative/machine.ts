// Faithful port of scanfuncs.py's ScansionMachine: ParseLine, both iambic
// algorithms (DoAlgorithm), the real ChooseAlgorithm arbiter (tries every
// stress-ambiguity resolution x both algorithms, keeps the lowest-complexity
// winner), PromotePyrrhics, HowWeDoing, and the anapestic engine
// (scanAnapestics, GetBestAnapLexes, AnapPromoteSlack, AnapCleanUpAndReport).
//
// This machine operates ONLY on a raw line string, its own Positioner grid,
// its own dictionary, and its own syllabizer -- it never reads a Calliope
// stress grade, dependency parse, or phonological hierarchy.  Deliberate,
// disclosed deviations from the 2005 source (all narrow, all documented at
// point of use):
//   - ChooseAlgorithm/GetBestAnapLexes break complexity ties by taking the
//     FIRST-encountered best candidate (stable order) instead of Python's
//     `random.choice` -- a batch/display tool that answered differently on
//     every run for the same line would be worse, not more "faithful".
//   - A handful of the original's own incidental quirks (a stale
//     currlen/normlen reused after headless-line truncation in DoAlgorithm
//     algorithm 1; a loop variable in DoAlgorithm algorithm 2 that shadows and
//     corrupts the outer `longest`; PromotePyrrhics capturing the
//     pre-reassignment foot name for its syllable-index bookkeeping) are
//     reproduced deliberately, not fixed -- see the inline notes.

import { STRESS, SLACK, PROMOTED, footDict, AnapSubs } from './constants.js';
import { footFinder, invertFootDict, longestMatch, uniquePermutations, altLineLenCalc } from './utilities.js';
import { Positioner } from './positioner.js';
import { dictLookup } from './dictionary.js';
import { syllabize } from './syllabizer.js';

const footDictInverse = invertFootDict(footDict);
const anapSubsInverse = invertFootDict(AnapSubs);

const VOWEL_RE = /[aeiouyAEIOUY]/;
const WORD_BOUNDS_RE = /([-.,;:?!()"\s]+)/;
const POSS_IAMB_RE = /(x[x/])+/;

function stripPunct(word: string): string {
  let w = word;
  let start = 0;
  while (start < w.length && !/[A-Za-z]/.test(w[start])) start++;
  let end = w.length;
  while (end > start && !/[A-Za-z]/.test(w[end - 1])) end--;
  return w.slice(start, end);
}

/** Python's str.rfind(sub, start, end): a negative `end` wraps to
 *  len(s)+end (may still land on a normal, non-degenerate range) -- JS's
 *  lastIndexOf has no such convention (it clamps a negative fromIndex to 0),
 *  so `scansion.lastIndexOf(sub, someIndex - 1)` silently diverges from
 *  Python whenever someIndex can be 0 or negative (e.g. no prior '/' found). */
function pyRfind(s: string, sub: string, start: number, end: number): number {
  const e = end < 0 ? Math.max(0, s.length + end) : Math.min(end, s.length);
  if (e < start) return -1;
  const idx = s.slice(0, e).lastIndexOf(sub);
  return idx < start ? -1 : idx;
}

export interface LineDataState {
  lfeet: number;
  lfeetset: boolean;
  footlist: string[];
  lastfoot: string;
  hremain: [number, number];
  midremain: [number, number];
}

export interface FailableFeet {
  footlist: string[];
  boundstest: boolean[];
  ok: boolean;
}

export class ScansionMachine {
  LD: LineDataState = { lfeet: 5, lfeetset: false, footlist: [], lastfoot: '', hremain: [0, 0], midremain: [0, 0] };
  P = new Positioner();

  SetLineFeet(num: number, setflag: boolean): void {
    this.LD.lfeet = num;
    this.LD.lfeetset = setflag;
  }

  // ─── ParseLine (scanfuncs.py ParseLine + _dictLookup + _stripPunct) ─────

  ParseLine(line: string): void {
    if (line.length < 1) return;
    this.LD.footlist = [];
    this.LD.lastfoot = '';
    this.P.NewLine(line.length);
    const words = line.split(WORD_BOUNDS_RE);
    let lineindex = 0;
    for (const wORD of words) {
      if (!wORD) continue;
      if (!VOWEL_RE.test(wORD)) {
        lineindex += wORD.length;
        continue;
      }
      if (!stripPunct(wORD)) {
        lineindex = this.P.AddPunct(wORD, lineindex);
        continue;
      }
      const w = wORD.toLowerCase();
      let syls = dictLookup(w);
      if (!syls) syls = syllabize(w);
      lineindex = this.P.AddWord(syls, lineindex);
    }
    this.P.LocateFootDivPositions();
  }

  // ─── Iambic Algorithm 1 & 2 (DoAlgorithm) ───────────────────────────────

  /** Run the whole iambic scansion (either algorithm) silently against one
   *  candidate marks string.  Mutates `this.LD.lfeet` when line length is not
   *  fixed, exactly as the original (and that mutation then persists for
   *  every later candidate tried in the same ChooseAlgorithm search). */
  DoAlgorithm(whichAlgorithm: 1 | 2, scansionIn: string): FailableFeet {
    const FAIL: FailableFeet = { footlist: [], boundstest: [], ok: false };
    let linefeet: number;
    if (!this.LD.lfeetset) {
      if (Math.floor(scansionIn.length / 2) >= 2) {
        linefeet = Math.floor(scansionIn.length / 2);
        this.LD.lfeet = linefeet;
      } else return FAIL;
    } else {
      linefeet = this.LD.lfeet;
    }
    const footlist: string[] = [];
    let scansion = scansionIn;

    if (whichAlgorithm === 1) {
      let normlen = linefeet * 2;
      let currlen = scansion.length;
      let lastfoot = '';
      if (currlen > normlen + 1 && ['x/xx', 'xx/x'].includes(scansion.slice(-4))) {
        lastfoot = footDict[scansion.slice(-4)];
        linefeet -= 1;
        scansion = scansion.slice(0, -4);
      } else if (currlen >= normlen && ['x/x', '//x'].includes(scansion.slice(-3))) {
        lastfoot = footDict[scansion.slice(-3)];
        linefeet -= 1;
        scansion = scansion.slice(0, -3);
      }
      normlen = linefeet * 2;
      currlen = scansion.length;
      if (currlen <= normlen && ['/x/x', '/xxx'].includes(scansion.slice(0, 4))) {
        footlist.push('defective');
        linefeet -= 1;
        scansion = scansion.slice(1);
      }
      // currlen/normlen deliberately NOT recomputed here -- the original
      // itself reuses the pre-truncation values for the branch below.
      if (currlen === normlen) {
        const r = footFinder(footDict, scansion, 2, 0, scansion.length);
        if (!r.ok) return FAIL;
        footlist.push(...r.feet.map(f => f.foot));
      } else if (currlen < normlen) {
        const candidate = scansion.indexOf('x//');
        if (candidate % 2 !== 0) return FAIL; // also true for candidate===-1 (JS -1%2===-1)
        const r1 = footFinder(footDict, scansion, 2, 0, candidate);
        if (!r1.ok) return FAIL;
        footlist.push(...r1.feet.map(f => f.foot));
        footlist.push('defective');
        const r2 = footFinder(footDict, scansion, 2, candidate + 1, scansion.length);
        if (!r2.ok) return FAIL;
        footlist.push(...r2.feet.map(f => f.foot));
      } else {
        const need = currlen - normlen;
        const candidates: number[] = [];
        for (let p = 0; p <= scansion.length - 4; p++) if (scansion.slice(p, p + 4) === '/xx/') candidates.push(p + 1);
        if (candidates.length < need) {
          for (let p = 0; p <= scansion.length - 3; p++) if (scansion.slice(p, p + 3) === 'xx/') candidates.push(p);
        }
        let i = 0;
        while (i < currlen) {
          if (candidates.includes(i)) {
            footlist.push('anapest');
            i += 3;
          } else {
            const chunk = scansion.slice(i, i + 2);
            if (!(chunk in footDict)) return FAIL;
            footlist.push(footDict[chunk]);
            i += 2;
          }
        }
      }
      if (lastfoot) footlist.push(lastfoot);
    } else {
      // Algorithm 2: Maximize the Normal
      const match = longestMatch(POSS_IAMB_RE, scansion);
      if (!match) return FAIL;
      let { start: startoflongest, length: longest } = match;
      if (startoflongest % 2 === 0) {
        const r = footFinder(footDict, scansion, 2, 0, startoflongest);
        if (!r.ok) return FAIL;
        footlist.push(...r.feet.map(f => f.foot));
      } else if (scansion.slice(0, 2) === '/x') {
        footlist.push('defective');
        const r = footFinder(footDict, scansion, 2, 1, startoflongest);
        if (!r.ok) return FAIL;
        footlist.push(...r.feet.map(f => f.foot));
      } else {
        const anap = scansion.slice(0, startoflongest).indexOf('xx/');
        if (anap === -1) return FAIL;
        const rHead = footFinder(footDict, scansion, 2, 0, anap);
        if (!rHead.ok) return FAIL;
        footlist.push(...rHead.feet.map(f => f.foot));
        // Faithful replication of the source's own variable-shadowing quirk:
        // Hartman's loop variable here is literally named `longest`, silently
        // overwriting the true longestMatch() length with this footfinder
        // call's final index -- which the two statements below then inherit.
        longest = rHead.feet.length ? rHead.feet[rHead.feet.length - 1].index : anap;
        footlist.push('anapest');
        const rTail = footFinder(footDict, scansion, 2, anap + 3, startoflongest);
        if (!rTail.ok) return FAIL;
        footlist.push(...rTail.feet.map(f => f.foot));
      }
      const rMain = footFinder(footDict, scansion, 2, startoflongest, startoflongest + longest);
      if (!rMain.ok) return FAIL;
      footlist.push(...rMain.feet.map(f => f.foot));
      let tailScansion = scansion.slice(startoflongest + longest);
      if (tailScansion.length > 0) {
        let lastfoot = '';
        if (tailScansion[tailScansion.length - 1] === 'x' && tailScansion.length > 2) {
          const tail3 = tailScansion.slice(-3);
          if (tail3 in footDict) {
            lastfoot = footDict[tail3];
            tailScansion = tailScansion.slice(0, -3);
          }
        }
        const rTailFeet = footFinder(footDict, tailScansion, 2, 0, tailScansion.length);
        if (!rTailFeet.ok) return FAIL;
        footlist.push(...rTailFeet.feet.map(f => f.foot));
        if (lastfoot) footlist.push(lastfoot);
      }
    }
    // NOTE: the original's trailing "for inx,f: if f=='pyrrhic': ... f =
    // '(iamb)'" loop reassigns only the local loop variable, never
    // footlist[inx] -- a documented no-op in the source, correctly omitted.
    const boundstest = this.P.FeetAtPunctBounds(footlist);
    return { footlist, boundstest, ok: true };
  }

  private measureComplexity(footlist: string[], boundstest: boolean[]): number {
    if (footlist.length !== this.LD.lfeet) return 100;
    let points = 0;
    let prevIsTrochee = false;
    for (let inx = 0; inx < footlist.length; inx++) {
      let f = footlist[inx];
      if (f.startsWith('(')) f = f.slice(1, -1);
      if (['spondee', 'pyrrhic', 'trochee'].includes(f)) points += 2;
      if (['anapest', 'defective', '3rd paeon', 'amphibrach', 'palimbacchius', '2nd paeon'].includes(f)) points += 4;
      if (['dactyl', 'cretic', 'bacchius'].includes(f)) points += 10;
      if (f === 'trochee') {
        if (inx === footlist.length - 1) points += 6;
        if (prevIsTrochee) points += 8;
        prevIsTrochee = true;
      } else {
        prevIsTrochee = false;
      }
      if ((f === 'trochee' || f === 'defective') && !boundstest[inx]) points += 4;
    }
    return points;
  }

  private computeIambicCandidates(): Array<{ marks: string; algorithm: 1 | 2; footlist: string[]; complexity: number }> {
    const possScansions = this.P.GetAmbiguities();
    const out: Array<{ marks: string; algorithm: 1 | 2; footlist: string[]; complexity: number }> = [];
    for (const marks of possScansions) {
      for (const algorithm of [1, 2] as const) {
        const { footlist, boundstest } = this.DoAlgorithm(algorithm, marks);
        out.push({ marks, algorithm, footlist, complexity: this.measureComplexity(footlist, boundstest) });
      }
    }
    return out;
  }

  // ─── Step-by-step derivation of the REAL displayed footlist ─────────────
  //
  // DoAlgorithm's own footlist (above) is Hartman's "quick, silent" version,
  // used ONLY to score candidates for ChooseAlgorithm's arbitration -- it is
  // NOT what a Scandroid user actually sees.  The real displayed result comes
  // from a SEPARATE step-by-step derivation (WeirdEnds+TestLengthAndDice for
  // algorithm 1, TryREs+CleanUpRE for algorithm 2), which turns out to differ
  // from DoAlgorithm's own result in several real cases (verified empirically
  // against the adapted 2005 source: DoAlgorithm's defective-foot branch uses
  // a stale `candidate` where TestLengthAndDice adds +2; several disyllable-
  // pattern edge cases DoAlgorithm rejects that the step-by-step path
  // accepts).  So: DoAlgorithm scores candidates; THIS re-derives the winner
  // for real, exactly as Hartman's own GUI flow does after ChooseAlgorithm.

  /** Algorithm 1's step-by-step pass (WeirdEnds then TestLengthAndDice). */
  private weirdEnds(): void {
    const endfeet = ['x/xx', 'xx/x', 'x/x', '//x'];
    const marks = this.P.GetMarks();
    const normlen = this.LD.lfeet * 2;
    const currlen = marks.length;
    let lastfootstring = '';
    if (currlen > normlen + 1 && endfeet.includes(marks.slice(-4))) lastfootstring = marks.slice(-4);
    else if (currlen >= normlen && endfeet.includes(marks.slice(-3))) lastfootstring = marks.slice(-3);
    if (lastfootstring) {
      this.LD.lastfoot = footDict[lastfootstring];
      this.P.AddFootDivMark(marks.length - lastfootstring.length);
    } else {
      this.LD.lastfoot = '';
    }
    if (currlen - lastfootstring.length <= normlen - 2 && (marks.startsWith('/x/x') || marks.startsWith('/xxx'))) {
      this.LD.footlist.push('defective');
      this.P.AddFootDivMark(1);
      this.LD.midremain = [1, currlen - lastfootstring.length];
    } else {
      this.LD.midremain = [0, currlen - lastfootstring.length];
    }
  }

  private testLengthAndDice(): boolean {
    let normlen = (this.LD.lfeet - this.LD.footlist.length) * 2;
    if (this.LD.lastfoot) normlen -= 2;
    const start = this.LD.midremain[0];
    const end = this.LD.midremain[1];
    const currlen = end - start;
    const marks = this.P.GetMarks();
    if (currlen === normlen) {
      const r = footFinder(footDict, marks, 2, start, end);
      if (!r.ok) return false;
      for (const { foot, index } of r.feet) {
        this.LD.footlist.push(foot);
        if (index < end) this.P.AddFootDivMark(index + this.LD.midremain[0]);
      }
    } else if (currlen < normlen) {
      const rel = marks.slice(start, end).indexOf('x//');
      const candidateRaw = rel === -1 ? -1 : rel + start;
      if (candidateRaw % 2 !== 0) return false;
      const candidate = candidateRaw + 2; // "point directly at the defective foot"
      const r1 = footFinder(footDict, marks, 2, start, candidate);
      if (!r1.ok) return false;
      for (const { foot, index } of r1.feet) { this.LD.footlist.push(foot); this.P.AddFootDivMark(index); }
      this.LD.footlist.push('defective');
      this.P.AddFootDivMark(candidate + 1);
      const r2 = footFinder(footDict, marks, 2, candidate + 1, end);
      if (!r2.ok) return false;
      for (const { foot, index } of r2.feet) { this.LD.footlist.push(foot); if (index < end) this.P.AddFootDivMark(index); }
    } else {
      let need = currlen - normlen;
      const candidates: number[] = [];
      for (let p = 0; p <= marks.length - 4; p++) if (marks.slice(p, p + 4) === '/xx/') candidates.push(p + 1);
      if (candidates.length < need) {
        for (let p = 0; p <= marks.length - 3; p++) if (marks.slice(p, p + 3) === 'xx/') candidates.push(p);
      }
      let pos = start;
      while (pos < end) {
        if (need && candidates.includes(pos)) {
          const foot = marks.slice(pos, pos + 3);
          if (!(foot in footDict)) return false;
          this.LD.footlist.push(footDict[foot]);
          pos += 3;
          need -= 1;
        } else {
          const foot = marks.slice(pos, pos + 2);
          if (!(foot in footDict)) return false;
          this.LD.footlist.push(footDict[foot]);
          pos += 2;
        }
        if (pos < end) this.P.AddFootDivMark(pos);
      }
    }
    if (this.LD.lastfoot) this.LD.footlist.push(this.LD.lastfoot);
    return true;
  }

  /** Algorithm 2's step-by-step pass (TryREs then CleanUpRE). */
  private tryREs(): boolean {
    const marks = this.P.GetMarks();
    const match = longestMatch(POSS_IAMB_RE, marks);
    if (!match) return false;
    const { start: startlongest, length: longest } = match;
    const runend = startlongest + longest;
    this.P.AddFootDivMark(startlongest);
    this.P.AddFootDivMark(runend);
    this.LD.hremain = [0, startlongest];
    this.LD.midremain = [runend, marks.length];
    const r = footFinder(footDict, marks, 2, startlongest, runend);
    if (!r.ok) return false;
    for (const { foot, index } of r.feet) {
      this.LD.footlist.push(foot);
      if (index < marks.length) this.P.AddFootDivMark(index);
    }
    return true;
  }

  private cleanUpRE(): boolean {
    const marks = this.P.GetMarks();
    this.P.RemoveEndFootMarks();
    const head = this.LD.hremain[1]; // hremain[0] is always 0
    const tail = marks.length - this.LD.midremain[0];
    let insertpoint = 0;
    if (head && head % 2 === 0) {
      const r = footFinder(footDict, marks, 2, 0, head);
      if (!r.ok) return false;
      for (const { foot, index } of r.feet) {
        this.LD.footlist.splice(insertpoint, 0, foot);
        this.P.AddFootDivMark(index);
        insertpoint += 1;
      }
    } else if (head) {
      if (marks.slice(0, 2) === '/x') {
        this.LD.footlist.splice(insertpoint, 0, 'defective');
        insertpoint += 1;
        const r = footFinder(footDict, marks, 2, 1, head);
        if (!r.ok) return false;
        for (const { foot, index } of r.feet) {
          this.LD.footlist.splice(insertpoint, 0, foot);
          this.P.AddFootDivMark(index);
          insertpoint += 2; // faithful: the source increments by 2 here, not 1
        }
      } else {
        const anap = marks.slice(0, head).indexOf('xx/');
        if (anap === -1) return false;
        const r1 = footFinder(footDict, marks, 2, 0, head);
        if (!r1.ok) return false;
        for (const { foot, index } of r1.feet) {
          this.LD.footlist.splice(insertpoint, 0, foot);
          this.P.AddFootDivMark(index);
          insertpoint += 1;
        }
        this.LD.footlist.push('anapest'); // faithful: appendFoot (tacked at the END), a source quirk -- not insertFoot
        const r2 = footFinder(footDict, marks, 2, anap + 3, head);
        if (!r2.ok) return false;
        for (const { foot, index } of r2.feet) {
          this.LD.footlist.splice(insertpoint, 0, foot);
          this.P.AddFootDivMark(index);
          insertpoint += 1;
        }
      }
    }
    if (tail) {
      let startlastfoot: number;
      if (marks[marks.length - 1] === 'x' && tail % 2 !== 0) {
        startlastfoot = marks.length - 3;
        const tail3 = marks.slice(-3);
        if (tail3 in footDict) {
          this.LD.lastfoot = footDict[tail3];
          this.P.AddFootDivMark(startlastfoot);
        } else return false;
      } else {
        startlastfoot = marks.length;
        this.LD.lastfoot = '';
      }
      const r3 = footFinder(footDict, marks, 2, this.LD.midremain[0], startlastfoot);
      if (!r3.ok) return false;
      for (const { foot, index } of r3.feet) {
        this.LD.footlist.push(foot);
        if (index < startlastfoot) this.P.AddFootDivMark(index);
      }
    }
    if (this.LD.lastfoot) this.LD.footlist.push(this.LD.lastfoot);
    return true;
  }

  /** Reset LD to a clean slate and re-derive the REAL footlist for one
   *  (algorithm, marks) candidate via the step-by-step path. */
  runIambicStepByStep(algorithm: 1 | 2, marks: string): boolean {
    this.LD.footlist = [];
    this.LD.lastfoot = '';
    this.LD.hremain = [0, 0];
    this.LD.midremain = [0, 0];
    this.P.AdjustMarks(marks);
    if (algorithm === 1) {
      this.weirdEnds();
      return this.testLengthAndDice();
    }
    if (!this.tryREs()) return false;
    return this.cleanUpRE();
  }

  /** The full "Corral the Weird" vs "Maximize the Normal" arbiter: DoAlgorithm
   *  scores every stress-ambiguity resolution under both algorithms, then the
   *  lowest-complexity winner is re-derived for real via the step-by-step path. */
  ChooseAlgorithm(): {
    verdictAlgorithm: 1 | 2;
    verdictMarks: string;
    verdictOk: boolean;
    alg1Best: { marks: string; complexity: number } | null;
    alg2Best: { marks: string; complexity: number } | null;
  } | null {
    const candidates = this.computeIambicCandidates();
    if (candidates.length === 0) return null;
    const lowest = Math.min(...candidates.map(c => c.complexity));
    const winner = candidates.find(c => c.complexity === lowest)!; // first-best, deterministic
    const alg1 = candidates.filter(c => c.algorithm === 1);
    const alg2 = candidates.filter(c => c.algorithm === 2);
    const bestOf = (arr: typeof candidates) => {
      if (arr.length === 0) return null;
      const lo = Math.min(...arr.map(c => c.complexity));
      const w = arr.find(c => c.complexity === lo)!;
      return w.complexity < 100 ? { marks: w.marks, complexity: w.complexity } : null;
    };
    const verdictOk = this.runIambicStepByStep(winner.algorithm, winner.marks);
    return {
      verdictAlgorithm: winner.algorithm,
      verdictMarks: winner.marks,
      verdictOk,
      alg1Best: bestOf(alg1),
      alg2Best: bestOf(alg2),
    };
  }

  /** Lightweight equivalent of ChooseAlgorithm(deducingParams=True): lowest
   *  complexity score and its foot count, no mutation. */
  ChooseAlgorithmComplexityOnly(): { score: number; length: number } {
    const candidates = this.computeIambicCandidates();
    if (candidates.length === 0) return { score: 100, length: 0 };
    const lowest = Math.min(...candidates.map(c => c.complexity));
    const winner = candidates.find(c => c.complexity === lowest)!;
    return { score: lowest, length: winner.footlist.length };
  }

  /** Identify and mark promoted stress in an iambic footlist (mutates
   *  this.LD.footlist and this.P's charlist/foot-division marks). */
  PromotePyrrhics(): { ok: boolean; promotions: number[] } {
    const fl = this.LD.footlist;
    if (this.LD.lfeetset && fl.length !== this.LD.lfeet) return { ok: false, promotions: [] };
    const promotions: number[] = [];
    let sylinx = 0;
    for (let inx = 0; inx < fl.length; inx++) {
      const f = fl[inx]; // captured ONCE per iteration -- matches Python's `for inx, f in enumerate(fl)`
      if (f === 'pyrrhic') {
        if (inx < fl.length - 1 && (fl[inx + 1] === 'anapest' || fl[inx + 1] === '3rd paeon')) {
          fl[inx] = '(anapest)';
          if (fl[inx + 1] === 'anapest') fl[inx + 1] = 'iamb';
          else fl[inx + 1] = 'amphibrach';
          this.P.AddScanMark(PROMOTED, sylinx + 2);
          this.P.EraseFootDivMark(sylinx + 2);
          this.P.AddFootDivMark(sylinx + 3);
          promotions.push(sylinx + 2);
        } else if (inx < fl.length - 1 && fl[inx + 1] === 'trochee') {
          return { ok: false, promotions }; // "bad pyrrhic (word wrongly stressed?)"
        } else if (inx === fl.length - 1 || !['spondee', 'palimbacchius'].includes(fl[inx + 1])) {
          fl[inx] = '(iamb)';
          this.P.AddScanMark(PROMOTED, sylinx + 1);
          promotions.push(sylinx + 1);
        }
      }
      sylinx += footDictInverse[f].length; // uses the ORIGINAL (pre-reassignment) foot name, like Python's `f`
    }
    return { ok: true, promotions };
  }

  HowWeDoing(): { ok: boolean; substitutions: number } {
    let substitutions = 0;
    for (const f of this.LD.footlist) if (f !== 'iamb' && f !== '(iamb)') substitutions += 1;
    if (this.LD.lfeetset && this.LD.footlist.length !== this.LD.lfeet) return { ok: false, substitutions };
    return { ok: true, substitutions };
  }

  // ─── Anapestic engine ────────────────────────────────────────────────

  /** Run the whole anapestic scansion silently against one candidate marks
   *  string.  Returns [] on failure (an anapestic line always has >=1 foot,
   *  so an empty footlist is an unambiguous failure sentinel, exactly as the
   *  original's own `return []`). */
  scanAnapestics(scansionIn: string): string[] {
    let scansion = scansionIn;
    let numsyls = scansion.length;
    let needfeet: number;
    if (this.LD.lfeetset) {
      needfeet = this.LD.lfeet;
    } else {
      let excess: number;
      needfeet = Math.floor(numsyls / 3);
      excess = numsyls % 3;
      if (scansion && scansion[scansion.length - 1] === SLACK) excess -= 1;
      if (excess > 0) needfeet += 1;
      const altlen = altLineLenCalc(scansion);
      needfeet = Math.max(needfeet, altlen);
      this.LD.lfeet = needfeet;
    }
    if (scansion.slice(-2) === 'xx') {
      scansion = scansion.slice(0, -1) + PROMOTED;
      this.P.AddScanMark(PROMOTED, scansion.length - 1);
    }
    let lastfoot = '';
    if (scansion && scansion[scansion.length - 1] === SLACK) {
      let tailstart = scansion.lastIndexOf(STRESS);
      tailstart = pyRfind(scansion, STRESS, 0, tailstart);
      let tail = numsyls - tailstart - 1; // tailstart===-1 is a VALID case here, not a failure (Python does no such check)
      if (AnapSubs[scansion.slice(-tail)] !== undefined) {
        lastfoot = AnapSubs[scansion.slice(-tail)];
      } else {
        tail += 1;
        if (AnapSubs[scansion.slice(-tail)] !== undefined) {
          lastfoot = AnapSubs[scansion.slice(-tail)];
        } else return [];
      }
      needfeet -= 1;
      numsyls -= tail;
      scansion = scansion.slice(0, scansion.length - tail);
    }
    if (numsyls > needfeet * 3) return [];
    let footlist: string[] = [];
    if (numsyls === needfeet * 3) {
      scansion = this.anapPromoteSlack(scansion, false);
      const r = footFinder(AnapSubs, scansion, 3, 0, numsyls);
      if (!r.ok) return [];
      footlist = r.feet.map(f => f.foot);
    } else {
      const needDisyls = needfeet * 3 - numsyls;
      if (needDisyls > needfeet) return [];
      scansion = this.anapPromoteSlack(scansion, false);
      const numlist = '2'.repeat(needDisyls) + '3'.repeat(needfeet - needDisyls);
      const listoflists = uniquePermutations(numlist);
      let pat = '';
      let thislldo = false;
      for (const candidate of listoflists) {
        thislldo = true;
        let index = 0;
        for (const foot of candidate) {
          index += parseInt(foot, 10);
          if (!'/%'.includes(scansion[index - 1])) { thislldo = false; break; }
        }
        pat = candidate;
        if (thislldo) break;
      }
      if (!thislldo) return [];
      let f = 0;
      for (const digit of pat) {
        const stride = parseInt(digit, 10);
        const endf = f + stride >= scansion.length ? scansion.length : f + stride;
        const chunk = scansion.slice(f, endf);
        if (AnapSubs[chunk] !== undefined) {
          footlist.push(AnapSubs[chunk]);
          f += stride;
        } else return [];
      }
    }
    if (lastfoot) footlist.push(lastfoot);
    return footlist;
  }

  private anapComplexity(footlist: string[]): number {
    if (footlist.length === 0) return 100;
    let points = 0;
    for (const f of footlist) {
      if (f === 'bacchius') points += 2;
      else if (f === '(anapest)') points += 1;
      else if (f === 'iamb' || f === '(iamb)') points += 2;
      else if (f === 'cretic') points += 4;
      else if (f === 'spondee' || f === 'pyrrhic') points += 4;
      else if (f === 'amphibrach' || f === '3rd paeon') points += 4;
      else if (f === '2nd paeon' || f === 'molossus' || f === 'palimbacchius') points += 5;
    }
    return points;
  }

  private computeAnapCandidates(): Array<{ marks: string; footlist: string[]; complexity: number }> {
    const possScansions = this.P.GetAmbiguities();
    return possScansions.map(marks => {
      const footlist = this.scanAnapestics(marks);
      return { marks, footlist, complexity: this.anapComplexity(footlist) };
    });
  }

  GetBestAnapLexes(): { marks: string; footlist: string[] } | null {
    const candidates = this.computeAnapCandidates();
    if (candidates.length === 0) return null;
    const lowest = Math.min(...candidates.map(c => c.complexity));
    const winner = candidates.find(c => c.complexity === lowest)!;
    if (winner.footlist.length === 0) return null;
    this.P.AdjustMarks(winner.marks);
    this.anapPromoteSlack(winner.marks, true); // now WITH the real char-grid mark, for display
    this.LD.footlist = winner.footlist;
    return { marks: winner.marks, footlist: winner.footlist };
  }

  GetBestAnapLexesComplexityOnly(): { score: number; length: number } {
    const candidates = this.computeAnapCandidates();
    if (candidates.length === 0) return { score: 100, length: 0 };
    const lowest = Math.min(...candidates.map(c => c.complexity));
    const winner = candidates.find(c => c.complexity === lowest)!;
    return { score: lowest, length: winner.footlist.length };
  }

  private anapPromoteSlack(scansion: string, insertMark: boolean): string {
    const slackrun = scansion.indexOf('xxxx');
    if (slackrun === -1) return scansion;
    const out = scansion.slice(0, slackrun + 2) + PROMOTED + scansion.slice(slackrun + 3);
    if (insertMark) this.P.AddScanMark(PROMOTED, slackrun + 2);
    return out;
  }

  /** Final-condition check + cosmetic iamb+cretic -> bacchius+iamb pass over
   *  the WINNING anapestic footlist (this.LD.footlist). */
  AnapCleanUpAndReport(): { ok: boolean; substitutions: number; footAdjust: boolean; fail?: string } {
    const fl = this.LD.footlist;
    let substitutions = 0;
    let sylinx = 0;
    let footAdjust = false;
    // Deliberately `fl.length - 1`: the original's own range(len(fl)-1)
    // excludes the LAST foot from every check here, including the
    // substitution count -- reproduced exactly, not "fixed".
    for (let finx = 0; finx < fl.length - 1; finx++) {
      if (fl[finx] === 'amphibrach') {
        return { ok: false, substitutions, footAdjust, fail: 'amphibrach within anapestic line' };
      }
      if (fl[finx] === 'iamb' && fl[finx + 1] === 'cretic') {
        fl[finx] = 'bacchius';
        fl[finx + 1] = 'iamb';
        this.P.EraseFootDivMark(sylinx + 2);
        this.P.AddFootDivMark(sylinx + 3);
        footAdjust = true;
      }
      if (fl[finx] !== 'anapest' && fl[finx] !== '(anapest)') substitutions += 1;
      sylinx += anapSubsInverse[fl[finx]].length; // re-reads fl[finx] AFTER any reassignment above, per source
    }
    if (this.LD.lfeetset && fl.length !== this.LD.lfeet) return { ok: false, substitutions, footAdjust };
    return { ok: true, substitutions, footAdjust };
  }
}
