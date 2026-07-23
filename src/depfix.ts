// depfix.ts — Post-parse dependency repair via DepEdit rules (the `depedits`
// npm package, the maintainer's TypeScript port of DepEdit).
//
// Runs AFTER en-parse, complementing the pre-parse tag corrections in
// tagfix.ts: tagfix repairs what the tagger got wrong before the tree is
// built; this pass repairs systematic attachment errors en-parse makes even
// with correct tags.  Rules are written in DepEdit's declarative format
// (definitions ⟶ relations ⟶ actions, tab-separated) over en-parse's own
// label space (DOBJ/NSUBJ/DEP/…), so the round-trip is lossless and every
// rule is independently testable.
//
// The rule set is deliberately small and evidence-based — each rule cites the
// observed failure it corrects.  `depedits` is ESM-only; it is loaded lazily
// and failures degrade gracefully (the unrepaired parse is still a parse).

import { createRequire } from 'module';

interface FinDepNode {
  label: string;      // dependency label, e.g. "NSUBJ", "ROOT"
  type: string;       // phrase type, e.g. "NP", "VP"
  parent: number;     // 0-based index of governor token; -1 for root
}

// Observed failure (probe: "I had quit the programming paradigm"): en-parse
// attaches BOTH nouns of a noun compound to the verb as parallel objects
// ("programming ←DOBJ← quit", "paradigm ←DOBJ← quit"), and leaves the
// determiner dangling on the first noun as generic DEP.  The repairs:
//   1. Two adjacent common nouns sharing a governor with the same object
//      relation → the first is a compound modifier (AMOD) of the second.
//   2. A determiner left as DEP on a noun that has become a modifier →
//      re-attach it as DET to that noun's head (the true NP head).
const CALLIOPE_DEP_FIXES = [
  'xpos=/NNS?/&func=/DOBJ|IOBJ/;xpos=/NNS?/&func=/DOBJ|IOBJ/;xpos=/VB.*/\t#3>#1;#3>#2;#1.#2\t#2>#1;#1:func=AMOD',
  'xpos=/DT/&func=/DEP|EXT/;xpos=/NNS?/&func=/AMOD/;xpos=/NNS?.*/\t#2>#1;#3>#2\t#3>#1;#1:func=DET',
].join('\n');

let engine: { process(conllu: string): string } | null | undefined;

function loadEngine(): typeof engine {
  if (engine !== undefined) return engine;
  try {
    // This package compiles to ESM, where bare `require` does not exist, and
    // the parse path is synchronous, so dynamic import() is not an option:
    // createRequire gives a sync loader, and since `depedits` is itself
    // ESM-only this resolves via Node's require(esm) (≥20.17 / ≥22.12).  On
    // older runtimes it throws and the repair pass degrades to a no-op (the
    // unrepaired parse is still a parse).
    const req = createRequire(import.meta.url);
    const { DepEditEngine } = req('depedits');
    const e = new DepEditEngine();
    e.loadIniString(CALLIOPE_DEP_FIXES);
    engine = e;
  } catch {
    engine = null;
  }
  return engine;
}

/**
 * Repair systematic en-parse attachment errors.  Returns a new deps array
 * (same shape as en-parse's `toArray` output); on any failure returns the
 * input unchanged.
 */
export function applyDepFixes(tokens: string[], tags: string[], deps: FinDepNode[]): FinDepNode[] {
  const e = loadEngine();
  if (!e || tokens.length === 0 || deps.length !== tokens.length) return deps;
  try {
    const conllu = tokens.map((tok, i) => {
      const head = deps[i].parent >= 0 ? deps[i].parent + 1 : 0;
      const safe = tok.replace(/\s/g, '_') || '_';
      return `${i + 1}\t${safe}\t${safe}\t_\t${tags[i] || '_'}\t_\t${head}\t${deps[i].label || 'DEP'}\t_\t_`;
    }).join('\n') + '\n\n';
    const out = e.process(conllu);
    const fixed: FinDepNode[] = deps.map(d => ({ ...d }));
    for (const row of out.split('\n')) {
      const cols = row.split('\t');
      if (cols.length < 10) continue;
      const idx = parseInt(cols[0], 10) - 1;
      if (!(idx >= 0 && idx < fixed.length)) continue;
      const head = parseInt(cols[6], 10);
      fixed[idx].parent = Number.isFinite(head) ? head - 1 : fixed[idx].parent;
      if (cols[7] && cols[7] !== '_') fixed[idx].label = cols[7];
    }
    return fixed;
  } catch {
    return deps;
  }
}
