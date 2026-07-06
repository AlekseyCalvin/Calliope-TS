// scandroid.ts — Optional Scandroid integration: provides classic iambic and
// anapestic scansion algorithms from Hartman’s Scandroid, adapted to TypeScript.
// This module is purely functional; it does not modify the main pipeline and
// can be omitted without affecting the phonological scansion.

import { StressLevel, MetreName, ScansionResult } from '../types.js';

// ─── Constants from scanstrings.py ─────────────────────────────────

const STRESS = '/';
const SLACK = 'x';
const PROMOTED = '%';
const FOOTDIV = '|';

/** Foot dictionary for iambic lines (Scandroid’s footDict). */
const IAMBIC_FOOT_DICT: Record<string, string> = {
  'x/': 'iamb',
  'xx': 'pyrrhic',
  '//': 'spondee',
  '/x': 'trochee',
  'x/x': 'amphibrach',
  '//x': 'palimbacchius',
  'xx/': 'anapest',
  '/': 'defective',
  '/xx': 'dactyl',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '%x': '(trochee)',
  'x/xx': '2nd paeon',
  'xx/x': '3rd paeon',
};

/** Foot dictionary for anapestic lines (Scandroid’s AnapSubs). */
const ANAPESTIC_FOOT_DICT: Record<string, string> = {
  'xx/': 'anapest',
  '/x/': 'cretic',
  'x//': 'bacchius',
  'x/': 'iamb',
  'x%': '(iamb)',
  'xx%': '(anapest)',
  '//': 'spondee',
  'xx/x': '3rd paeon',
  'x/x': 'amphibrach',
  '///': 'molossus',
  '/x%': '(cretic)',
  '//x': 'palimbacchius',
};

// ─── Utility functions (adapted from scanutilities.py) ────────────

/** Generator-like function to walk through a string in chunks, matching a dictionary. */
function footFinder(
  fDict: Record<string, string>,
  str: string,
  chunkSize: number,
  start: number,
  end: number
): Array<{ foot: string; index: number }> {
  const result: Array<{ foot: string; index: number }> = [];
  let pos = start;
  while (pos < end) {
    const chunk = str.slice(pos, pos + chunkSize);
    if (chunk in fDict) {
      pos += chunkSize;
      result.push({ foot: fDict[chunk], index: pos });
    } else {
      // signal failure by returning empty array
      return [];
    }
  }
  return result;
}

/** Find the longest match of a RegExp in a string (last occurrence of longest length). */
function longestMatch(rx: RegExp, s: string): { start: number; length: number } | null {
  let start = -1, length = 0;
  let current = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s.slice(current))) !== null) {
    const mStart = current + m.index;
    const mEnd = mStart + m[0].length;
    if (mEnd - mStart >= length) {
      start = mStart;
      length = mEnd - mStart;
    }
    current = mStart + 1;
  }
  return start >= 0 ? { start, length } : null;
}

/** Compute line length in feet by counting non-adjacent stresses (for anapestic estimation). */
function altLineLenCalc(marks: string): number {
  const arr = marks.split('');
  for (let i = 0; i < arr.length; i++) {
    if (i === 0 || arr[i - 1] === '/') {
      if (arr[i] === '/') arr[i] = 'x';
    }
  }
  return arr.filter(ch => ch === '/').length;
}

// ─── Complexity measurement (from Scandroid’s _measureComplexity) ──

function iambicComplexity(footlist: string[], numFeet: number): number {
  if (footlist.length !== numFeet) return 100;
  let prevIsTrochee = false;
  let points = 0;
  for (let i = 0; i < footlist.length; i++) {
    let f = footlist[i];
    if (f.startsWith('(') && f.endsWith(')')) f = f.slice(1, -1);
    if (['spondee', 'pyrrhic', 'trochee'].includes(f)) points += 2;
    if (['anapest', 'defective', '3rd paeon', 'amphibrach', 'palimbacchius', '2nd paeon'].includes(f)) points += 4;
    if (['dactyl', 'cretic', 'bacchius'].includes(f)) points += 10;
    if (f === 'trochee') {
      if (i === footlist.length - 1) points += 6;
      if (prevIsTrochee) points += 8;
      prevIsTrochee = true;
    } else prevIsTrochee = false;
    if ((f === 'trochee' || f === 'defective') /* bounds test omitted for simplicity */) points += 4;
  }
  return points;
}

function anapesticComplexity(footlist: string[]): number {
  if (footlist.length === 0) return 100;
  let points = 0;
  for (const f of footlist) {
    if (f === 'bacchius') points += 2;
    else if (f === '(anapest)') points += 1;
    else if (f === 'iamb' || f === '(iamb)') points += 2;
    else if (f === 'cretic') points += 4;
    else if (['spondee', 'pyrrhic'].includes(f)) points += 4;
    else if (['amphibrach', '3rd paeon'].includes(f)) points += 4;
    else if (['2nd paeon', 'molossus', 'palimbacchius'].includes(f)) points += 5;
  }
  return points;
}

// ─── Iambic Algorithm 1: Corral the Weird ─────────────────────────

export function scandroidCorralWeird(
  marks: string,
  numFeet: number
): { footlist: string[]; scansionMarks: string } {
  const footlist: string[] = [];
  let remaining = marks;
  let lastFoot = '';

  // Step 1: handle terminal slack (extra syllables at end)
  const normLen = numFeet * 2;
  if (remaining.length > normLen + 1 && ['x/xx', 'xx/x'].includes(remaining.slice(-4))) {
    lastFoot = IAMBIC_FOOT_DICT[remaining.slice(-4)];
    remaining = remaining.slice(0, -4);
  } else if (remaining.length >= normLen && ['x/x', '//x'].includes(remaining.slice(-3))) {
    lastFoot = IAMBIC_FOOT_DICT[remaining.slice(-3)];
    remaining = remaining.slice(0, -3);
  }

  // Step 2: handle acephalous (headless) line
  if (remaining.length <= normLen - 2 && (remaining.startsWith('/x/x') || remaining.startsWith('/xxx'))) {
    footlist.push('defective');
    remaining = remaining.slice(1);
  }

  const currLen = remaining.length;
  const needFeet = numFeet - footlist.length - (lastFoot ? 1 : 0);
  const targetLen = needFeet * 2;

  if (currLen === targetLen) {
    const feet = footFinder(IAMBIC_FOOT_DICT, remaining, 2, 0, currLen);
    if (feet.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...feet.map(f => f.foot));
  } else if (currLen < targetLen) {
    // seek a defective foot (single stress)
    const candidate = remaining.indexOf('x//');
    if (candidate === -1 || candidate % 2 !== 0) return { footlist: [], scansionMarks: '' };
    const defectivePos = candidate + 2;
    const before = footFinder(IAMBIC_FOOT_DICT, remaining, 2, 0, defectivePos);
    if (before.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...before.map(f => f.foot));
    footlist.push('defective');
    const after = footFinder(IAMBIC_FOOT_DICT, remaining, 2, defectivePos + 1, currLen);
    if (after.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...after.map(f => f.foot));
  } else {
    // need anapests to fill extra syllables
    const need = currLen - targetLen;
    // collect candidate positions for anapest insertion
    const candidates: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (remaining.slice(i, i + 4) === '/xx/') candidates.push(i + 1);
    }
    if (candidates.length < need) {
      for (let i = 0; i < remaining.length; i++) {
        if (remaining.slice(i, i + 3) === 'xx/') candidates.push(i);
      }
    }
    let pos = 0;
    let anapestsUsed = 0;
    while (pos < currLen) {
      if (anapestsUsed < need && candidates.includes(pos)) {
        const chunk = remaining.slice(pos, pos + 3);
        if (!(chunk in IAMBIC_FOOT_DICT)) return { footlist: [], scansionMarks: '' };
        footlist.push(IAMBIC_FOOT_DICT[chunk]);
        pos += 3;
        anapestsUsed++;
      } else {
        const chunk = remaining.slice(pos, pos + 2);
        if (!(chunk in IAMBIC_FOOT_DICT)) return { footlist: [], scansionMarks: '' };
        footlist.push(IAMBIC_FOOT_DICT[chunk]);
        pos += 2;
      }
    }
  }

  if (lastFoot) footlist.push(lastFoot);

  // Generate scansion string with foot divisions
  const scansion = footlist.map(f => f.startsWith('(') ? f : f).join('|'); // simplistic
  return { footlist, scansionMarks: scansion };
}

// ─── Iambic Algorithm 2: Maximize the Normal ─────────────────────

export function scandroidMaximizeNormal(
  marks: string,
  numFeet: number
): { footlist: string[]; scansionMarks: string } {
  const possIambRE = /(x[x/])+/;
  const match = longestMatch(possIambRE, marks);
  if (!match) return { footlist: [], scansionMarks: '' };
  const { start, length } = match;
  const runEnd = start + length;
  const headMarks = marks.slice(0, start);
  const tailMarks = marks.slice(runEnd);
  const mainMarks = marks.slice(start, runEnd);
  const footlist: string[] = [];
  const headFeet: string[] = [];
  const tailFeet: string[] = [];

  // Scan the regular middle stretch
  const mainFeet = footFinder(IAMBIC_FOOT_DICT, mainMarks, 2, 0, mainMarks.length);
  if (mainFeet.length === 0) return { footlist: [], scansionMarks: '' };
  footlist.push(...mainFeet.map(f => f.foot));

  // Scan head
  if (headMarks.length > 0) {
    if (headMarks.length % 2 === 0) {
      const hf = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, 0, headMarks.length);
      if (hf.length === 0) return { footlist: [], scansionMarks: '' };
      headFeet.push(...hf.map(f => f.foot));
    } else {
      if (headMarks.startsWith('/x')) {
        headFeet.push('defective');
        const rest = headMarks.slice(1);
        if (rest.length > 0) {
          const hf = footFinder(IAMBIC_FOOT_DICT, rest, 2, 0, rest.length);
          if (hf.length === 0) return { footlist: [], scansionMarks: '' };
          headFeet.push(...hf.map(f => f.foot));
        }
      } else {
        // try to find an anapest in the head
        const anap = headMarks.indexOf('xx/');
        if (anap === -1) return { footlist: [], scansionMarks: '' };
        const before = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, 0, anap);
        if (before.length === 0) return { footlist: [], scansionMarks: '' };
        headFeet.push(...before.map(f => f.foot));
        headFeet.push('anapest');
        const after = footFinder(IAMBIC_FOOT_DICT, headMarks, 2, anap + 3, headMarks.length);
        if (after.length === 0) return { footlist: [], scansionMarks: '' };
        headFeet.push(...after.map(f => f.foot));
      }
    }
  }

  // Scan tail
  if (tailMarks.length > 0) {
    let lastFootStr = '';
    let tailPart = tailMarks;
    if (tailPart.slice(-1) === 'x' && tailPart.length > 2 && tailPart.slice(-3) in IAMBIC_FOOT_DICT) {
      lastFootStr = IAMBIC_FOOT_DICT[tailPart.slice(-3)];
      tailPart = tailPart.slice(0, -3);
    }
    const tf = footFinder(IAMBIC_FOOT_DICT, tailPart, 2, 0, tailPart.length);
    if (tf.length === 0) return { footlist: [], scansionMarks: '' };
    tailFeet.push(...tf.map(f => f.foot));
    if (lastFootStr) tailFeet.push(lastFootStr);
  }

  const completeList = [...headFeet, ...footlist, ...tailFeet];
  // Promote pyrrhics as in Scandroid’s PromotePyrrhics
  for (let i = 0; i < completeList.length; i++) {
    if (completeList[i] === 'pyrrhic') {
      if (i < completeList.length - 1 && completeList[i + 1] === 'spondee') {
        // nothing
      } else {
        completeList[i] = '(iamb)';
      }
    }
  }

  const scansion = completeList.join('|');
  return { footlist: completeList, scansionMarks: scansion };
}

// ─── Anapestic scanning ──────────────────────────────────────────

export function scandroidAnapestic(
  marks: string,
  numFeet?: number
): { footlist: string[]; scansionMarks: string } {
  let remaining = marks;
  if (!numFeet) {
    const [q, r] = [Math.floor(remaining.length / 3), remaining.length % 3];
    let need = q;
    if (r > 0) need++;
    need = Math.max(need, altLineLenCalc(remaining));
    numFeet = need;
  }

  // Handle terminal slack (promotions etc.)
  if (remaining.slice(-2) === 'xx') remaining = remaining.slice(0, -1) + '%';
  let lastFootStr = '';
  if (remaining && remaining.slice(-1) === 'x') {
    let tailStart = remaining.lastIndexOf('/');
    tailStart = remaining.lastIndexOf('/', tailStart - 1);
    if (tailStart === -1) return { footlist: [], scansionMarks: '' };
    const tail = remaining.slice(tailStart);
    if (tail in ANAPESTIC_FOOT_DICT) {
      lastFootStr = ANAPESTIC_FOOT_DICT[tail];
      remaining = remaining.slice(0, tailStart);
    } else if (tail.length > 1 && tail.slice(1) in ANAPESTIC_FOOT_DICT) {
      lastFootStr = ANAPESTIC_FOOT_DICT[tail.slice(1)];
      remaining = remaining.slice(0, tailStart + 1);
    } else return { footlist: [], scansionMarks: '' };
  }

  // Promote slack runs (long sequences of unstressed)
  const slackRun = remaining.indexOf('xxxx');
  if (slackRun !== -1) {
    remaining = remaining.slice(0, slackRun + 2) + '%' + remaining.slice(slackRun + 3);
  }

  const len = remaining.length;
  const footlist: string[] = [];
  if (len === numFeet! * 3) {
    const feet = footFinder(ANAPESTIC_FOOT_DICT, remaining, 3, 0, len);
    if (feet.length === 0) return { footlist: [], scansionMarks: '' };
    footlist.push(...feet.map(f => f.foot));
  } else {
    const needDisyls = (numFeet! * 3) - len;
    if (needDisyls > numFeet!) return { footlist: [], scansionMarks: '' };
    const pattern = '2'.repeat(needDisyls) + '3'.repeat(numFeet! - needDisyls);
    const allPerms = uniquePermutations(pattern);
    let validPattern: string | null = null;
    for (const pat of allPerms) {
      let okay = true;
      let idx = 0;
      for (const d of pat) {
        const stride = parseInt(d);
        idx += stride;
        if (!'/%'.includes(remaining[idx - 1])) {
          okay = false;
          break;
        }
      }
      if (okay) {
        validPattern = pat;
        break;
      }
    }
    if (!validPattern) return { footlist: [], scansionMarks: '' };
    let pos = 0;
    for (const d of validPattern) {
      const stride = parseInt(d);
      const chunk = remaining.slice(pos, pos + stride);
      if (chunk in ANAPESTIC_FOOT_DICT) {
        footlist.push(ANAPESTIC_FOOT_DICT[chunk]);
        pos += stride;
      } else return { footlist: [], scansionMarks: '' };
    }
  }

  if (lastFootStr) footlist.push(lastFootStr);
  const scansion = footlist.join('|');
  return { footlist, scansionMarks: scansion };
}

// ─── Helper: unique permutations of a string ────────────────────

function uniquePermutations(s: string): string[] {
  if (s.length <= 1 || s.length > 9) return [s];
  const results: string[] = [];
  function permute(prefix: string, rest: string) {
    if (rest.length === 0) results.push(prefix);
    const seen = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
      if (seen.has(rest[i])) continue;
      seen.add(rest[i]);
      permute(prefix + rest[i], rest.slice(0, i) + rest.slice(i + 1));
    }
  }
  permute('', s);
  return results;
}

// ─── Public API: convert our relative stress to Scandroid marks ──

export function stressToMarks(stressArray: StressLevel[]): string {
  return stressArray.map(s => (s === 's' ? STRESS : SLACK)).join('');
}

export function marksToFeetString(footlist: string[]): string {
  return footlist.join(' | ');
}

// ─── Convenience: produce a ScansionResult from footlist ─────────

export function scansionResultFromFootlist(
  footlist: string[],
  meter: MetreName,
  complexity?: number
): ScansionResult {
  return {
    meter,
    scansion: marksToFeetString(footlist),
    certainty: 0, // not computed
    weightScore: 0,
    maxPossibleWeight: 0,
    algorithm: 'Scandroid',
  };
}
