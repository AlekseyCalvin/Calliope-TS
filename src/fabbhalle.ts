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
// Rule sets follow the worked examples: iambic pentameter (F&H 2006 (5)-(14):
// G0 R→L binary heads-right; G1 R→L ternary, final metron binary; all higher
// gridlines likewise R→L — rules (11) and (13) both begin "at the right
// edge", and the head is always the edgemost asterisk in the direction of
// iteration), trochaic tetrameter (Keats 'Fancy': all gridlines L→R binary,
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
  complete: boolean;      // grid terminated in a single top asterisk (loose: always)
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
 *  following the paper's worked examples where they exist.  Pentameter (F&H
 *  2006 rule (11)/(12)): G1 ternary R→L with the final (last-constructed,
 *  leftmost) metron binary.  Trimeter ("Up-Hill" (33), "Yes, to the very
 *  end"): G1 BINARY — `*) * *)`, two metra {1},{2,3} — NOT one ternary
 *  group.  Hexameter (fn. 9): two full ternary metra.  Tetrameter: binary.
 *  Direction: every gridline of a meter iterates the same way as its G0 —
 *  rules (11) and (13) both begin "at the right edge" for iambic, and the
 *  head is the edgemost asterisk in the direction of iteration ("the
 *  rightmost asterisk in each group projects"), so heads-right throughout
 *  R→L meters and, mirror-image, heads-left throughout L→R meters. */
function higherSpec(n: number, g0dir: 'LR' | 'RL'): GroupSpec {
  const dir = g0dir;
  if (n <= 4) return { dir, size: 2 };        // incl. n=3 → {1},{2,3} per (33)
  if (n % 3 === 0) return { dir, size: 3 };
  if (n % 2 === 0) return { dir, size: 2 };
  return { dir, size: 3 };                    // odd ≥ 5 → ternary w/ final binary
}

/** G0 rule set from the main engine's meter family name.  Returns null for
 *  meters outside F&H's English inventory (accentual, free…). */
function g0Spec(meterName: string): { spec: GroupSpec; label: string; dropFirst?: boolean } | null {
  const m = meterName.toLowerCase();
  if (m.includes('iamb'))   return { spec: { dir: 'RL', size: 2 }, label: 'iambic: G0 Right-to-Left binary, heads right' };
  if (m.includes('troch'))  return { spec: { dir: 'LR', size: 2 }, label: 'trochaic: G0 Left-to-Right binary, heads left' };
  if (m.includes('amph'))   return { spec: { dir: 'LR', size: 3 }, label: 'amphibrachic: G0 Left-to-Right ternary, heads left (initial ∆ unprojected)', dropFirst: true };
  if (m.includes('anap'))   return { spec: { dir: 'RL', size: 3 }, label: 'anapestic: G0 Right-to-Left ternary, heads right' };
  if (m.includes('dact'))   return { spec: { dir: 'LR', size: 3 }, label: 'dactylic: G0 Left-to-Right ternary, heads left' };
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
    if (g > 0) spec = higherSpec(cols.length, g0.spec.dir);
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

/** How maxima are defined.  'flanked' is the English strict-meter condition
 *  (F&H 2006 (16)): primary stress in a polysyllable, preceded AND followed
 *  in the line by syllables without lexical stress — line-edge syllables
 *  never qualify.  'polysyllabic' drops the flanking clause: any polysyllable
 *  primary stress is a maximum.  That is the correct parameter for RUSSIAN
 *  strict meters, where the empirical law (Taranovsky/Jakobson; F&H treat
 *  Russian with the same parametric latitude their fn. 12 grants) is that a
 *  polysyllabic word's stress may fall only on an ictus, with no adjacency
 *  escape hatch — Russian classical verse simply does not license the
 *  clash-adjacent inversions English does. */
export type MaximaMode = 'flanked' | 'polysyllabic';

export interface FabbHalleOptions {
  maximaMode?: MaximaMode;   // default 'flanked' (English strict meters)
}

/** Maxima per condition (8)/(16), or the flanking-free Russian variant. */
function findMaxima(syls: FHSyllable[], mode: MaximaMode): number[] {
  const maxima: number[] = [];
  if (mode === 'polysyllabic') {
    for (let i = 0; i < syls.length; i++) {
      if (syls[i].poly && syls[i].lex >= 2) maxima.push(i);
    }
    return maxima;
  }
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
    ruleLabel: `loose iambic (maxima-anchored, F&H 2006 §3): pre-paren maxima, then Right-to-Left skip-first left parens — ${feet.length} feet`,
    rows,
    maxima,
    violations: [],
    metrical: true,
    complete: true,
    looseFeet: feet.length,
  };
}

/**
 * Build the bracketed grid for one line.  `meterName` selects the rule set —
 * a single derivation VERIFIES a line against a stipulated rule set; meter
 * DISCOVERY is a poem-level matter (see buildFabbHalleGridsForPoem below).
 * `footCount`, when the caller supplies it, fixes the expected G0 count so
 * that OVERLONG lines exercise
 * F&H's optional NON-PROJECTION (their underlined syllables: synaloepha,
 * "Heav'n"-type syncope, feminine endings — §1.1 example (2)).  Only
 * lexically stressless syllables may fail to project; the choice minimizes
 * maximum-condition violations, ties resolving to the EARLIEST position
 * (King James VI's observation that projection is likelier near the line's
 * end).  ACCENTUAL / dol'nik verdicts route to the LOOSE-meter rules
 * instead.  Returns null when the line's meter has no F&H rule set.
 */
export function buildFabbHalleGrid(
  syls: FHSyllable[], meterName: string, footCount?: number, options?: FabbHalleOptions,
): FabbHalleResult | null {
  if (syls.length < 2) return null;
  if (meterName === 'auto') {
    // Fallback only — F&H's parse is relative to a STIPULATED meter, so
    // callers that know the line's meter must pass it.  Kept for lines whose
    // verdict names no meter at all.
    const schemas = ['iambic', 'trochaic', 'dactylic', 'amphibrachic', 'anapestic', 'loose'];
    let bestRes: FabbHalleResult | null = null;
    let bestScore = -Infinity;
    for (const schema of schemas) {
      const res = buildFabbHalleGrid(syls, schema, footCount, options);
      if (!res) continue;
      // Score: heavily penalize violations; loose meter gets a constant penalty so strict meters win if perfect.
      let score = 0;
      if (schema === 'loose') {
        score = -5; // Loose meter base penalty
      } else {
        score -= res.violations.length * 10;
        if (!res.metrical) score -= 100;
      }
      if (score > bestScore) {
        bestScore = score;
        bestRes = res;
      }
    }
    return bestRes;
  }

  if (/accentual|dolnik|dol'nik|loose/i.test(meterName)) return buildLooseGrid(syls);
  const g0 = g0Spec(meterName);
  if (!g0) return null;

  const maxima = findMaxima(syls, options?.maximaMode ?? 'flanked');
  const all = syls.map((_, i) => i);
  if (g0.dropFirst && all.length > 0) {
    all.shift();
  }

  // Candidate projections:
  // F&H allow dropping syllables that don't project to G0 (e.g. feminine endings, synaloepha).
  // If footCount is provided, we use it to calculate exactly how many to drop.
  // Otherwise, we guess by trying to drop up to 2 final stressless syllables.
  let candidates: number[][] = [all];
  const expected = footCount && footCount > 0 ? footCount * g0.spec.size : 0;
  
  if (expected > 0) {
    const extra = all.length - expected;
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
      // The FULL projection stays a candidate alongside the drop sets: a
      // "long" line may equally be a CATALECTIC line of the next foot count
      // (amphibrachic 11 = 4 feet with a short final group, not 3 feet + 2
      // extrametricals), and F&H's incomplete-final-group allowance handles
      // it without non-projection.  Violation-minimisation picks per line.
      candidates = [all, ...sets];
    }
  } else {
    // No expected count: try dropping 1 or 2 final stressless syllables
    // (feminine/dactylic endings) alongside the full projection.
    if (all.length > 0 && syls[all[all.length - 1]].lex === 0) {
      const c2 = all.slice(0, -1);
      candidates.push(c2);
      if (c2.length > 0 && syls[c2[c2.length - 1]].lex === 0) {
        candidates.push(all.slice(0, -2));
      }
    }
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
    complete: best.complete,
  };
}

// ── Poem-level rule-set discovery ────────────────────────────────────
//
// A single grid derivation VERIFIES a line against a stipulated rule set (the
// grid's core job is counting — F&H 2006 (14): the well-formedness condition
// "establishes that the line is exactly ten syllables long"; Kiparsky: "the
// defining feature of verse is not rhythm, but lineation").  But the theory
// does adjudicate meter at the POEM level, implicitly: a poem's meter is
// whichever rule set from the permitted parametric family (binary/ternary
// groups, edgemost heads, the loose variant) lets every line construct a
// well-formed grid with the maxima condition holding ("Up-Hill"'s 9-syllable
// opener "can be scanned... as a pentameter line with an initial short foot
// (and in fact must be so scanned)" — a poem-relative "must").  F&H leave
// that search to the analyst; this formalizes it: try each rule set over ALL
// lines, sum violations + incompleteness, lowest total wins.  Loose meter
// always constructs, so it carries a flat per-line cost and wins only when
// every strict setting keeps failing — mirroring how an analyst reaches for
// the dol'nik reading only after strict scansions collapse.

export interface FabbHallePoemResult {
  schema: string;                       // discovered rule set ('iambic' … 'loose')
  grids: (FabbHalleResult | null)[];    // one per input line, under that rule set
  cost: number;                         // the winning rule set's total cost
  runnerUp?: { schema: string; cost: number };
}

const DISCOVERY_SCHEMAS = ['iambic', 'trochaic', 'anapestic', 'amphibrachic', 'dactylic'];
// The condition on maxima is INVIOLABLE in a strict meter ("MAXIMA must
// project to gridline 1") — so a violation costs far more than the loose
// reading's flat per-line rate: a poem whose lines keep violating under
// every strict setting (a dol'nik) tips to loose, while sporadic violations
// (tagger noise on a homograph, a genuinely transgressive line) don't flip
// an otherwise-clean strict poem.
const VIOLATION_COST = 2.0;
const INCOMPLETE_COST = 6.0;
const LOOSE_COST_PER_LINE = 0.9;

function schemaFootSize(schema: string): number {
  return schema === 'iambic' || schema === 'trochaic' ? 2 : 3;
}

export function buildFabbHalleGridsForPoem(
  lines: FHSyllable[][], options?: FabbHalleOptions,
): FabbHallePoemResult | null {
  const usable = lines.filter(l => l.length >= 2);
  if (usable.length === 0) return null;

  const ranked: { schema: string; cost: number }[] = [];
  for (const schema of DISCOVERY_SCHEMAS) {
    const size = schemaFootSize(schema);
    let cost = 0;
    for (const syls of usable) {
      const fh = buildFabbHalleGrid(syls, schema, Math.floor(syls.length / size), options);
      if (!fh) { cost += 8; continue; }
      cost += fh.violations.length * VIOLATION_COST + (fh.complete ? 0 : INCOMPLETE_COST);
    }
    ranked.push({ schema, cost });
  }
  ranked.push({ schema: 'loose', cost: usable.length * LOOSE_COST_PER_LINE });
  // Stable sort: ties resolve to the DISCOVERY_SCHEMAS order (a frequency
  // prior over the tradition's meters — iambic first), loose last.
  ranked.sort((a, b) => a.cost - b.cost);
  const winner = ranked[0];

  const size = winner.schema === 'loose' ? 0 : schemaFootSize(winner.schema);
  const grids = lines.map(syls => syls.length < 2 ? null :
    buildFabbHalleGrid(
      syls, winner.schema,
      size > 0 ? Math.floor(syls.length / size) : undefined, options,
    ));
  return {
    schema: winner.schema,
    grids,
    cost: winner.cost,
    runnerUp: ranked[1] ? { schema: ranked[1].schema, cost: ranked[1].cost } : undefined,
  };
}
