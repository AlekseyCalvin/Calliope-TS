// bench-hayes.mjs — relative-stress benchmark against the maintainer's revised
// Hayes English-folk-song corpus (tests/DataForHayesStressSymbolsRevised.txt),
// whose per-syllable x/w/n/m/s patterns were re-marked BY EAR (sung aloud) in our
// gradience nomenclature.  This is ground truth for the Calliope relative-stress
// engine — not a meter fixture.
//
//   node tests/bench-hayes.mjs            # summary
//   node tests/bench-hayes.mjs --worst 20 # + the N worst-disagreeing lines
//   node tests/bench-hayes.mjs --clio     # benchmark the frozen Clio engine
//
// Metrics (on lines whose engine syllable count matches the marking):
//   BEAT agreement = fraction of syllables where engine and ear agree on
//                    is-this-a-beat (relative stress >= m).  The headline number.
//   exact / within-1 = tier-level agreement on x<w<n<m<s.
//   strong-adjacencies = engine count of abutting beats (the ear's corpus has 0).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const useClio = process.argv.includes('--clio');
const worstN = (() => { const i = process.argv.indexOf('--worst'); return i >= 0 ? +process.argv[i + 1] || 10 : 0; })();

const { analyzeText } = await import(join(here, '..', 'dist', 'index.js'));
const { analyzeTextClio } = await import(join(here, '..', 'dist', 'clio', 'pipeline.js'));
const analyze = useClio ? analyzeTextClio : analyzeText;

const RANK = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const isBeat = (c) => RANK[c] >= 3;

const lines = readFileSync(join(here, 'DataForHayesStressSymbolsRevised.txt'), 'utf8').split(/\r?\n/);
const rows = [];
let curText = null;
for (const ln of lines) {
  const t = ln.match(/line text\s+(.*\S)\s*$/);
  const p = ln.match(/stress pattern\s+([xwnms=]+)\s*$/);
  if (t) curText = t[1];
  if (p && curText) { rows.push({ text: curText, pat: p[1].replace(/[^xwnms]/g, '') }); curText = null; }
}

let aligned = 0, mismatch = 0, beatAgree = 0, beatTot = 0, exact = 0, within1 = 0, tierTot = 0, strongAdj = 0;
const diffs = [];
for (const r of rows) {
  const res = analyze(r.text, false);
  const seq = res.flatMap(x => x.sentence.words.flatMap(w => w.syllables.map(s => s.relativeStress ?? 'w')));
  const wrd = res.flatMap(x => x.sentence.words.flatMap(w => w.syllables.map(() => w.word)));
  if (seq.length !== r.pat.length) { mismatch++; continue; }
  aligned++;
  for (let i = 0; i + 1 < seq.length; i++) if (isBeat(seq[i]) && isBeat(seq[i + 1])) strongAdj++;
  let mism = 0; const detail = [];
  for (let i = 0; i < seq.length; i++) {
    const e = RANK[seq[i]], u = RANK[r.pat[i]];
    tierTot++; if (e === u) exact++; if (Math.abs(e - u) <= 1) within1++;
    beatTot++; if (isBeat(seq[i]) === isBeat(r.pat[i])) beatAgree++;
    else { mism++; detail.push((isBeat(seq[i]) ? '+' : '-') + wrd[i] + '(' + seq[i] + '/' + r.pat[i] + ')'); }
  }
  if (mism) diffs.push({ mism, text: r.text, detail });
}

const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
console.log(`engine: ${useClio ? 'Clio (frozen)' : 'Calliope'}`);
console.log(`rows ${rows.length} · aligned ${aligned} · syllable-count mismatch ${mismatch}`);
console.log(`BEAT agreement   ${pct(beatAgree, beatTot)}`);
console.log(`exact tier       ${pct(exact, tierTot)}`);
console.log(`within-1 tier    ${pct(within1, tierTot)}`);
console.log(`engine strong-adjacencies ${strongAdj} (ear corpus: 0)`);
if (worstN) {
  console.log(`\nworst ${worstN} lines (engine-tier/ear-tier; + = engine over-beats, - = engine misses):`);
  diffs.sort((a, b) => b.mism - a.mism);
  for (const d of diffs.slice(0, worstN)) console.log(`${d.mism}  ${d.text}\n     ${d.detail.join(' ')}`);
}
