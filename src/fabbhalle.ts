// fabbhalle.ts — Fabb & Halle (2008, *Meter in Poetry*) Bracketed-Grid
// scansion: an INDEPENDENT second-opinion module beside Scandroid.
//
// F&H hold that the fundamental principle of metrical verse is COUNTING, not
// rhythm: each syllable projects an asterisk on gridline 0; iterative rules
// insert parentheses (a left paren groups rightward, a right paren leftward),
// each group projects its HEAD (edgemost asterisk) to the next gridline, and
// a well-formed grid terminates with EXACTLY ONE asterisk on the bottom
// gridline (their condition (11)).  Rhythm falls out as a condition stated
// over the grid — for English strict meters, condition (7)/(8):
//
//   A MAXIMUM — a syllable carrying primary stress in a polysyllabic word,
//   preceded AND followed in the same line by syllables without lexical
//   stress — must project to gridline 1.
//
// Monosyllables are unregulated (their placement is a *tendency*, which Fabb
// 2004 argues is implied form, explained pragmatically — not constitutive
// form, not part of the generative rules).  This is deliberately a far more
// LINEAR and textocentric method than the Calliope pipeline (McAleese's
// critique); it is offered as an extra signal, never feeding the main
// scansion.
//
// Rule sets follow the book's worked examples: iambic pentameter (§1.1 (5):
// G0 R→L binary heads-right; G1 R→L ternary, final group binary; G2 L→R
// binary), trochaic tetrameter (Keats 'Fancy': all gridlines L→R binary,
// heads left), anapestic tetrameter (Byron 'Sennacherib': G0 R→L ternary
// heads-right, initial group may be incomplete).  Amphibrachic lines fall
// out of the ANAPESTIC rules for free: R→L ternary grouping of an
// 11-syllable amphibrachic tetrameter yields groups |2|3|3|3| whose right
// heads sit at positions 2·5·8·11 — exactly the amphibrach's medial beats
// (F&H have no medial-headed groups; none are needed).

export interface FHSyllable {
  text: string;    // orthographic chunk for display
  lex: number;     // lexical stress: 0 none, 1 secondary, 2+ primary
  poly: boolean;   // belongs to a polysyllabic word
}

export interface FabbHalleResult {
  ruleLabel: string;      // human-readable rule-set summary
  rows: string[][];       // rows[g][col]: '*', '*)', '(*', '(*)', or '' per G0 column
  maxima: number[];       // G0 columns that are maxima (condition (8) / (21))
  violations: number[];   // maxima that fail to project to gridline 1
  metrical: boolean;      // condition (7) satisfied (strict); count-based (loose)
  looseFeet?: number;     // set for LOOSE meters: the foot count IS the meter
}

interface GroupSpec {
  dir: 'LR' | 'RL';       // iteration direction (paren type follows: LR → '(', RL → ')')
  size: 2 | 3;            // group size (skip = size − 1)
}

/** Group the asterisks at `cols` per `spec`; return groups in left-to-right
 *  order, each an array of member columns.  The group at the far end of the
 *  iteration may be incomplete (F&H allow non-maximal edge groups). */
function group(cols: number[], spec: GroupSpec): number[][] {
  const groups: number[][] = [];
  if (spec.dir === 'RL') {
    for (let end = cols.length; end > 0; end -= spec.size) {
      const start = Math.max(0, end - spec.size);
      groups.unshift(cols.slice(start, end));
    }
  } else {
    for (let start = 0; start < cols.length; start += spec.size) {
      groups.push(cols.slice(start, Math.min(cols.length, start + spec.size)));
    }
  }
  return groups;
}

/** Head column of a group: rightmost for RL ')' groups, leftmost for LR '(' . */
function headOf(g: number[], spec: GroupSpec): number {
  return spec.dir === 'RL' ? g[g.length - 1] : g[0];
}

/** Pick the grouping rule for a HIGHER gridline holding `n` asterisks,
 *  following the book's worked examples where they exist (pentameter:
 *  ternary-with-final-binary then binary; tetrameter: binary/binary;
 *  trimeter: one ternary group).  `dir` for gridline 1 inherits the meter's
 *  G0 direction; gridlines 2+ run L→R (per the pentameter example). */
function higherSpec(n: number, g: number, g0dir: 'LR' | 'RL'): GroupSpec {
  const dir: 'LR' | 'RL' = g === 1 ? g0dir : 'LR';
  if (n === 2) return { dir, size: 2 };
  // Divisible-by-three counts take ternary metra (F&H 2006 fn. 9: the
  // hexameter/alexandrine is scanned with a FULL ternary final metron at
  // gridline 1 — two metra of three, then one binary colon).
  if (n % 3 === 0) return { dir, size: 3 };
  if (n % 2 === 0) return { dir, size: 2 };
  return { dir, size: 3 };                    // odd > 3 → ternary w/ incomplete group
}

/** G0 rule set from the main engine's meter family name.  Returns null for
 *  meters outside F&H's English inventory (accentual, free…). */
function g0Spec(meterName: string): { spec: GroupSpec; label: string } | null {
  const m = meterName.toLowerCase();
  if (m.includes('iamb'))   return { spec: { dir: 'RL', size: 2 }, label: 'iambic: G0 R→L binary, heads right' };
  if (m.includes('troch'))  return { spec: { dir: 'LR', size: 2 }, label: 'trochaic: G0 L→R binary, heads left' };
  if (m.includes('anap') || m.includes('amph'))
    return { spec: { dir: 'RL', size: 3 }, label: (m.includes('amph') ? 'amphibrachic (via ternary R→L): ' : 'anapestic: ') + 'G0 R→L ternary, heads right' };
  if (m.includes('dact'))   return { spec: { dir: 'LR', size: 3 }, label: 'dactylic: G0 L→R ternary, heads left' };
  return null;
}

/** Construct rows + G0 head set for a given projection (the columns that
 *  project to gridline 0), leaving unprojected columns blank on every row. */
function construct(
  syls: FHSyllable[], projected: number[], g0: { spec: GroupSpec; label: string },
): { rows: string[][]; g1cols: Set<number>; complete: boolean } {
  const rows: string[][] = [];
  let cols = projected.slice();
  let g1cols = new Set<number>();
  let spec: GroupSpec = g0.spec;
  for (let g = 0; g < 4 && cols.length > 1; g++) {
    if (g > 0) spec = higherSpec(cols.length, g, g0.spec.dir);
    const groups = group(cols, spec);
    const row: string[] = syls.map(() => '');
    for (const c of cols) row[c] = '*';
    for (const grp of groups) {
      if (spec.dir === 'RL') row[grp[grp.length - 1]] = '*)';
      else row[grp[0]] = '(*';
    }
    rows.push(row);
    const heads = groups.map(grp => headOf(grp, spec));
    if (g === 0) g1cols = new Set(heads);
    cols = heads;
  }
  const bottom: string[] = syls.map(() => '');
  if (cols.length === 1) bottom[cols[0]] = '*';
  rows.push(bottom);
  return { rows, g1cols, complete: cols.length === 1 };
}

/** Maxima per condition (8): primary stress in a polysyllable, flanked in the
 *  line by syllables without lexical stress.  Line-edge syllables never qualify. */
function findMaxima(syls: FHSyllable[]): number[] {
  const maxima: number[] = [];
  for (let i = 1; i < syls.length - 1; i++) {
    if (!syls[i].poly || syls[i].lex < 2) continue;
    if (syls[i - 1].lex === 0 && syls[i + 1].lex === 0) maxima.push(i);
  }
  return maxima;
}

/**
 * LOOSE iambic meter (F&H 2006 §3, "Spring Quiet"): in loose meters maxima
 * DETERMINE grid construction rather than being checked against it.
 *   (21) maximum = any syllable carrying primary stress in a polysyllable
 *        (no flanking condition);
 *   (22) insert a right parenthesis after each maximum's asterisk, FIRST;
 *   (23) then iterate R→L: skip one asterisk, insert a LEFT parenthesis to
 *        the left of the next — but an already-parenthesized asterisk
 *        refuses the insertion and the procedure reverts to the skip step
 *        (the (27) walkthrough: "Arching high over" → *) * (* *) *).
 * Feet are asterisk runs preceded by "(" or followed by ")" (definition (6),
 * Idsardi's one-boundary feet); syllables between feet stay UNFOOTED (the
 * "-ching" of "Arching").  Line length = FEET, so 4–7-syllable lines all
 * count as dimeter — the meter of folk verse, ballads, dol'nik.  Heads
 * project right.  Condition (17) does not apply: metricality is the foot
 * count itself.
 */
function buildLooseGrid(syls: FHSyllable[]): FabbHalleResult {
  const n = syls.length;
  const rightP = new Array<boolean>(n).fill(false);
  const leftP = new Array<boolean>(n).fill(false);
  const maxima: number[] = [];
  for (let i = 0; i < n; i++) {
    if (syls[i].poly && syls[i].lex >= 2) { maxima.push(i); rightP[i] = true; }
  }
  // Iterative footing (23): skip-first, R→L.
  let p = n - 1;
  let state: 'skip' | 'insert' = 'skip';
  while (p >= 0) {
    if (state === 'skip') { p--; state = 'insert'; continue; }
    if (rightP[p] || leftP[p]) { state = 'skip'; continue; }  // insertion refused
    leftP[p] = true; p--; state = 'skip';
  }
  // Feet: "(…" runs and bare "…)" singletons; unfooted syllables in neither.
  const feet: number[][] = [];
  let open: number[] | null = null;
  for (let i = 0; i < n; i++) {
    if (leftP[i]) {
      if (open) feet.push(open);
      open = [i];
    } else if (open) {
      open.push(i);
    }
    if (rightP[i]) {
      if (open) { feet.push(open); open = null; }
      else feet.push([i]);
    }
  }
  if (open) feet.push(open);

  // Display: G0 marks + G1 heads (rightmost per foot) — the loose grid stops
  // at the foot count, which IS the meter (F&H display no deeper gridlines
  // for Spring Quiet).
  const rows: string[][] = [];
  rows.push(syls.map((_, i) => {
    if (leftP[i] && rightP[i]) return '(*)';
    if (leftP[i]) return '(*';
    if (rightP[i]) return '*)';
    return '*';
  }));
  const g1 = syls.map(() => '');
  for (const f of feet) g1[f[f.length - 1]] = '*';
  rows.push(g1);

  return {
    ruleLabel: `loose iambic (maxima-anchored, F&H 2006 §3): pre-paren maxima, then R→L skip-first left parens — ${feet.length} feet`,
    rows,
    maxima,
    violations: [],
    metrical: true,
    looseFeet: feet.length,
  };
}

/**
 * Build the bracketed grid for one line.  `meterName` selects the rule set
 * (the F&H parse is relative to a stipulated meter — the theory generates
 * lines, it does not discover meters); `footCount`, when the main engine
 * supplies it, fixes the expected G0 count so that OVERLONG lines exercise
 * F&H's optional NON-PROJECTION (their underlined syllables: synaloepha,
 * "Heav'n"-type syncope, feminine endings — §1.1 example (2)).  Only
 * lexically stressless syllables may fail to project; the choice minimizes
 * maximum-condition violations, ties resolving to the EARLIEST position
 * (King James VI's observation that projection is likelier near the line's
 * end).  ACCENTUAL / dol'nik verdicts route to the LOOSE-meter rules
 * instead.  Returns null when the line's meter has no F&H rule set.
 */
export function buildFabbHalleGrid(
  syls: FHSyllable[], meterName: string, footCount?: number,
): FabbHalleResult | null {
  if (syls.length < 2) return null;
  if (/accentual|dolnik|dol'nik|loose/i.test(meterName)) return buildLooseGrid(syls);
  const g0 = g0Spec(meterName);
  if (!g0) return null;

  const maxima = findMaxima(syls);
  const all = syls.map((_, i) => i);

  // Candidate projections: all syllables, or (for overlong lines with a known
  // foot count) drop 1–2 stressless syllables to reach the expected count.
  const expected = footCount && footCount > 0 ? footCount * g0.spec.size : 0;
  const extra = expected > 0 ? syls.length - expected : 0;
  let candidates: number[][] = [all];
  if (extra === 1 || extra === 2) {
    const droppable = all.filter(i => syls[i].lex === 0);
    const sets: number[][] = [];
    if (extra === 1) {
      for (const d of droppable) sets.push(all.filter(i => i !== d));
    } else {
      for (let a = 0; a < droppable.length; a++) {
        for (let b = a + 1; b < droppable.length; b++) {
          sets.push(all.filter(i => i !== droppable[a] && i !== droppable[b]));
        }
      }
    }
    if (sets.length > 0) candidates = sets;
  }

  let best: { rows: string[][]; g1cols: Set<number>; complete: boolean } | null = null;
  let bestViol = Infinity;
  for (const proj of candidates) {
    const c = construct(syls, proj, g0);
    const viol = maxima.filter(i => proj.includes(i) && !c.g1cols.has(i)).length
      + (c.complete ? 0 : 10);
    if (viol < bestViol) { bestViol = viol; best = c; }
    if (bestViol === 0) break;                    // earliest zero-violation wins
  }
  if (!best) return null;

  const violations = maxima.filter(i => !best!.g1cols.has(i));
  return {
    ruleLabel: g0.label,
    rows: best.rows,
    maxima,
    violations,
    metrical: violations.length === 0 && best.complete,
  };
}
