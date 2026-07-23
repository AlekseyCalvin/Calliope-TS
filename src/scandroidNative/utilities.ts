// Faithful port of scanutilities.py's out-of-class helpers (footfinder,
// longestMatch, dictinvert, uniquePermutations, AltLineLenCalc).

export interface FootFinderResult {
  feet: Array<{ foot: string; index: number }>;
  /** false the moment ANY chunk in [startpoint,endpoint) fails to match —
   *  mirrors every Python call site's `if footname: append() else: return
   *  ([],[])` bail-out.  An EMPTY range (startpoint===endpoint) is a valid,
   *  vacuous success (ok=true, feet=[]), never a failure. */
  ok: boolean;
}

/** Walk `scansion[startpoint:endpoint]` in `chunkSize`-wide steps, mapping
 *  each chunk through `fDict`. */
export function footFinder(
  fDict: Record<string, string>,
  scansion: string,
  chunkSize: number,
  startpoint: number,
  endpoint: number
): FootFinderResult {
  const feet: Array<{ foot: string; index: number }> = [];
  let pos = startpoint;
  while (pos < endpoint) {
    const possfoot = scansion.slice(pos, pos + chunkSize);
    const name = fDict[possfoot];
    if (name === undefined) return { feet, ok: false };
    pos += chunkSize;
    feet.push({ foot: name, index: pos });
  }
  return { feet, ok: true };
}

/** name -> its single pattern key.  Both footDict and AnapSubs happen to have
 *  every value distinct (verified against scanstrings.py), so a straight
 *  reverse map is the exact behavioural equivalent of Hartman's
 *  dictinvert()[name][0], without needing the list-of-keys wrapper. */
export function invertFootDict(d: Record<string, string>): Record<string, string> {
  const inv: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) inv[v] = k;
  return inv;
}

export interface LongestMatchResult {
  start: number;
  length: number;
}

/** Kent Johnson's "find the LAST-longest regex match" (scanutilities.py).
 *  Deliberately prefers the last of several equal-longest matches — Hartman's
 *  own comment: lines tend to be more regular at their ends than their
 *  beginnings.  `rx` must be a non-global, non-sticky pattern; a fresh `g`
 *  clone drives the repeated from-here search. */
export function longestMatch(rx: RegExp, s: string): LongestMatchResult | null {
  const search = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
  let start = 0;
  let length = 0;
  let current = 0;
  for (;;) {
    search.lastIndex = current;
    const m = search.exec(s);
    if (!m) break;
    const mStart = m.index;
    const mEnd = mStart + m[0].length;
    current = mStart + 1;
    if (mEnd - mStart >= length) {
      start = mStart;
      length = mEnd - mStart;
    }
    if (m[0].length === 0) search.lastIndex = current; // guard against zero-width infinite loop
  }
  return length ? { start, length } : null;
}

/** All permutations of the characters of `s` (ActiveState Cookbook code,
 *  ported literally, including the >9-chars short-circuit that just returns
 *  `s` unchanged to avoid a combinatorial explosion). */
function getPermutations(a: string): string[] {
  if (a.length === 1 || a.length > 9) return [a];
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const rest = a.slice(0, i) + a.slice(i + 1);
    for (const p of getPermutations(rest)) out.push(a[i] + p);
  }
  return out;
}

/** Deduped, lexicographically-sorted permutations of `lst`. */
export function uniquePermutations(lst: string): string[] {
  const all = getPermutations(lst);
  const u = new Set(all);
  return [...u].sort();
}

/** Rough minimum foot-count estimate: count stresses, but zero out the very
 *  first mark and any stress immediately following another stress — mutated
 *  IN PLACE, left-to-right, so a run of 3+ stresses only zeroes alternating
 *  members (matches the original's forward self-referential mutation). */
export function altLineLenCalc(lexmarks: string): number {
  const marklist = lexmarks.split('');
  for (let inx = 0; inx < marklist.length; inx++) {
    if (inx === 0 || marklist[inx - 1] === '/') marklist[inx] = 'x';
  }
  return marklist.filter(c => c === '/').length;
}
