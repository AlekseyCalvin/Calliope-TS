// display.ts — Unified, integrated CLI display for Calliope TS
// Shows ALL information layers in a single comprehensive view

import chalk from 'chalk';
import {
  ClsWord,
  ClsSentence,
  IntonationalUnit,
  PhonologicalPhrase,
  CliticGroup,
  StressLevel,
  LineResult,
  SyllableDisplayEntry,
  MeterScore,
} from './types.js';
import { isPunctuation } from './parser.js';
import { syllabifyWord, syllableVowelLengths } from './phonological.js';
import { buildFabbHalleGrid } from './fabbhalle.js';
import { computeCaesurae, CaesuraInfo } from './caesura.js';
import { computeBoundaries } from './calliope/boundaries.js';
import { summarizePoem, analyzePhonopoetics, type Phonopoetics, type RhymeRel } from './rhyme.js';

// ═══════════════════════════════════════════════════════════════════════
// COLOUR SYSTEM — Conceptually motivated palettes
// ═══════════════════════════════════════════════════════════════════════

// Lexical stress (numeric 0–3): blue→magenta→red→bold red
// Represents phonetic prominence from dictionary
const LEX0 = (s: string) => chalk.blue(s);
const LEX1 = (s: string) => chalk.magenta(s);
const LEX2 = (s: string) => chalk.red(s);
const LEX3 = (s: string) => chalk.red.bold(s);

function lexColour(val: number): (s: string) => string {
  if (val === 0) return LEX0;
  if (val === 1) return LEX1;
  if (val === 2) return LEX2;
  return LEX3;
}

// Relative / phonological stress (x w n m s): light-grey→cyan→green→yellow→bright red
// Represents phonological prominence after phrasal rules.  `x` = zero-provision
// (maximally-reduced clitic), one rung below the stressless-overt floor `w`.
// Light grey (not dark blue) so it stays legible on a black terminal.
const REL_X = (s: string) => chalk.hex('#b0b0b0')(s);
const REL_W = (s: string) => chalk.cyan(s);
const REL_N = (s: string) => chalk.green(s);
const REL_M = (s: string) => chalk.yellow(s);
const REL_S = (s: string) => chalk.redBright(s);

function relColour(rel: StressLevel): (s: string) => string {
  if (rel === 'x') return REL_X;
  if (rel === 'w') return REL_W;
  if (rel === 'n') return REL_N;
  if (rel === 'm') return REL_M;
  if (rel === 's') return REL_S;
  return chalk.gray.dim;
}

// Phrasal boundaries — distinct palette (purple/blue/green)
const B_CP = chalk.magentaBright;
const B_PP = chalk.blueBright;
const B_IU = chalk.greenBright;
const B_CAESURA = chalk.whiteBright.bold;       // hard caesura (overt: punctuation / IU edge)
const B_CAESURA_SOFT = chalk.cyan.dim;          // inferred caesura (phonological-phrase pause)
const B_FOOT = chalk.gray;
const B_SILENT = chalk.gray.dim;

// ── Graded boundary-strength colour (Wagner Ch.4–5): cold blue (weak) → warm red
// (strong).  The relational grid says boundaries differ in DEGREE, not just kind, so
// ϕ/ι brackets are tinted along a continuous spectrum by their NSBR-scaled strength
// (boundaries.ts).  κ (clitic-group) boundaries are the weakest tier — a constant dim
// blue.  This makes the boundary-strength dimension VISIBLE in the bracketing view.
const GRAD_STOPS: [number, [number, number, number]][] = [
  [0.00, [0x6a, 0x8c, 0xc7]],   // cold blue
  [0.30, [0x5f, 0xc7, 0xc0]],   // teal
  [0.55, [0xd9, 0xc2, 0x4d]],   // yellow
  [0.78, [0xe0, 0x91, 0x3f]],   // orange
  [1.00, [0xe0, 0x56, 0x4b]],   // red
];
function gradHex(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRAD_STOPS.length; i++) {
    const [t1, c1] = GRAD_STOPS[i - 1];
    const [t2, c2] = GRAD_STOPS[i];
    if (x <= t2) {
      const f = t2 === t1 ? 0 : (x - t1) / (t2 - t1);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
      return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
  }
  return '#e0564b';
}
/** Colour for a ϕ/ι bracket given its boundary strength (0..1). */
function boundaryColour(strength: number): (s: string) => string {
  return (s: string) => chalk.hex(gradHex(strength))(s);
}
const B_KAPPA = (s: string) => chalk.hex('#5a6f9e').dim(s);   // κ — weakest, dim blue

// Word roles
const W_CONTENT = chalk.white;
const W_FUNCTION = chalk.gray;
const W_DEP = chalk.italic.dim;

// Section headers
const H1 = chalk.bold.underline;
const H2 = chalk.bold;

const HR = '─'.repeat(70);
const HR_THIN = '─'.repeat(50);

// ═══════════════════════════════════════════════════════════════════════
// PER-SYLLABLE DATA STRUCTURE
// ═══════════════════════════════════════════════════════════════════════

interface ColSyl {
  chunk: string;
  word: string;
  pos: string;
  isContent: boolean;
  lexStress: number;
  relStress: StressLevel;
  cpId: number;
  ppId: number;
  iuId: number;
  isFirstInWord: boolean;
  isFirstInCP: boolean;
  isFirstInPP: boolean;
  isFirstInIU: boolean;
  isLastInCP: boolean;
  isLastInPP: boolean;
  isLastInIU: boolean;
  depLabel: string;
  govWord: string;
  globalIdx: number;
  wordRef: ClsWord;
}

function buildColSyls(words: ClsWord[], ius: IntonationalUnit[]): ColSyl[] {
  const result: ColSyl[] = [];
  let globalIdx = 0;

  for (let iuIdx = 0; iuIdx < ius.length; iuIdx++) {
    const iu = ius[iuIdx];
    for (let ppIdx = 0; ppIdx < iu.phonologicalPhrases.length; ppIdx++) {
      const pp = iu.phonologicalPhrases[ppIdx];
      for (let cpIdx = 0; cpIdx < pp.cliticGroups.length; cpIdx++) {
        const cg = pp.cliticGroups[cpIdx];
        for (let tIdx = 0; tIdx < cg.tokens.length; tIdx++) {
          const w = cg.tokens[tIdx];
          if (isPunctuation(w.lexicalClass)) continue;
          const dep = w.dependency;
          const sylCount = w.syllables.length;
          const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix, w.morphPrefix);

          for (let si = 0; si < sylCount; si++) {
            const syl = w.syllables[si];
            const lex = syl.lexicalStress ?? syl.stress;
            const rel = syl.relativeStress ?? 'w';

            result.push({
              chunk: chunks[si] || w.word,
              word: w.word,
              pos: w.lexicalClass,
              isContent: w.isContent,
              lexStress: lex,
              relStress: rel,
              cpId: cpIdx,
              ppId: ppIdx,
              iuId: iuIdx,
              isFirstInWord: si === 0,
              isFirstInCP: tIdx === 0 && si === 0,
              isFirstInPP: cpIdx === 0 && tIdx === 0 && si === 0,
              isFirstInIU: ppIdx === 0 && cpIdx === 0 && tIdx === 0 && si === 0,
              isLastInCP: tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              isLastInPP: cpIdx === pp.cliticGroups.length - 1 &&
                tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              isLastInIU: ppIdx === iu.phonologicalPhrases.length - 1 &&
                cpIdx === pp.cliticGroups.length - 1 &&
                tIdx === cg.tokens.length - 1 && si === sylCount - 1,
              depLabel: dep?.dependentType ?? '',
              govWord: dep?.governor?.word ?? '',
              globalIdx: globalIdx++,
              wordRef: w,
            });
          }
          // A 0-syllable possessive enclitic ('s) has no syllable column of its own;
          // append its surface to the preceding syllable so "Nature's" renders WITH its
          // 's instead of as bare "Nature" (and so its κ-boundary does not collapse into
          // the next group — the "Nature first" mis-bracketing the maintainer flagged).
          if (sylCount === 0 && w.lexicalClass === 'POS' && result.length > 0) {
            result[result.length - 1].chunk += w.word;
          }
        }
      }
    }
  }

  // Bracket-boundary flags via look-around over the SYLLABLE-bearing columns, so a
  // 0-syllable token (possessive 's, an elided clitic) can never swallow a κ/ϕ/ι
  // boundary: a column is first/last in its unit when the adjacent column belongs to a
  // different unit.  (Composite key, since cpId/ppId are indices LOCAL to their parent.)
  const uKey = (c: { iuId: number; ppId: number; cpId: number }, lvl: 'cp' | 'pp' | 'iu') =>
    lvl === 'cp' ? `${c.iuId}.${c.ppId}.${c.cpId}` : lvl === 'pp' ? `${c.iuId}.${c.ppId}` : `${c.iuId}`;
  for (let i = 0; i < result.length; i++) {
    const cur = result[i], prev = result[i - 1], next = result[i + 1];
    result[i].isFirstInCP = !prev || uKey(prev, 'cp') !== uKey(cur, 'cp');
    result[i].isLastInCP = !next || uKey(next, 'cp') !== uKey(cur, 'cp');
    result[i].isFirstInPP = !prev || uKey(prev, 'pp') !== uKey(cur, 'pp');
    result[i].isLastInPP = !next || uKey(next, 'pp') !== uKey(cur, 'pp');
    result[i].isFirstInIU = !prev || uKey(prev, 'iu') !== uKey(cur, 'iu');
    result[i].isLastInIU = !next || uKey(next, 'iu') !== uKey(cur, 'iu');
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// UNIFIED DISPLAY — All layers integrated
// ═══════════════════════════════════════════════════════════════════════

export function renderUnifiedDisplay(result: LineResult, rawLine?: string): string {
  const words = result.sentence.words;
  const ius = result.phonologicalHierarchy;
  const detail = result.phonologicalScansion;
  const colSyls = buildColSyls(words, ius);

  const lines: string[] = [];
  lines.push('');
  lines.push(HR);

  // ── Layer 1: Original text with word-role coloring ──────────────
  lines.push(H1('Original Text'));
  lines.push('');
  const textParts: string[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const wc = w.isContent ? W_CONTENT : W_FUNCTION;
    const posTag = W_DEP('(' + w.lexicalClass + ')');
    textParts.push(wc(w.word) + posTag);
  }
  lines.push('  ' + textParts.join(' '));
  lines.push('');

  // ── Layer 2: Phrasal structure tree ─────────────────────────────
  lines.push(H1('Phrasal Structure') + '  ' + B_IU('IU') + ' → ' + B_PP('PP') + ' → ' + B_CP('CP'));
  // Mini-legend: only the POS tags & dependencies that occur in THIS line.
  lines.push(...renderLineGlossary(words));
  lines.push('');

  const wordSet = new Set<ClsWord>();
  const dedupedEntries: { col: ColSyl; word: ClsWord }[] = [];
  for (const cs of colSyls) {
    if (!wordSet.has(cs.wordRef)) {
      wordSet.add(cs.wordRef);
      dedupedEntries.push({ col: cs, word: cs.wordRef });
    }
  }

  let lastIU = -1, lastPP = -1;
  for (const we of dedupedEntries) {
    const cs = we.col;
    if (cs.iuId !== lastIU) {
      lines.push(B_IU('  IU' + (cs.iuId + 1)));
      lastIU = cs.iuId;
      lastPP = -1;
    }
    if (cs.ppId !== lastPP) {
      lines.push(B_PP('    PP' + (cs.ppId + 1) + ': {'));
      lastPP = cs.ppId;
    }
    const dep = we.word.dependency;
    const depInfo = dep && dep.governorIndex > 0
      ? W_DEP(' ←' + dep.dependentType)
      : '';
    const wordLabel = W_CONTENT(we.word.word) + W_DEP('(' + we.word.lexicalClass + ')');
    lines.push('      ' + B_CP('[') + wordLabel + depInfo + B_CP(']'));
  }
  lines.push('    ' + B_PP('}'));
  lines.push('');

  // ── Layer 3: Lexical stress (numeric) ───────────────────────────
  lines.push(H1('Lexical Stress') + '  ' + LEX0('0') + LEX1('1') + LEX2('2') + LEX3('3') + '  (0=none 1=secondary 2=primary 3+=boosted)');
  lines.push('');

  const lexParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) lexParts.push(' ');
    lexParts.push(lexColour(cs.lexStress)(String(cs.lexStress)));
  }
  lines.push('  ' + lexParts.join(''));
  lines.push('');

  // ── Layer 3b: Phrase stress (genuine cyclic Compound + Nuclear Stress Rules) ───
  // The real phrase-stress stage (bracketing.ts): the SPE/Hayes cyclic CSR (compound
  // → primary LEFT) + NSR (phrase → primary RIGHT) over the dependency tree's
  // constituent bracketing.  1 = STRONGEST (the utterance nuclear); higher = weaker.
  // Reproduces "Mary 2, ate 3, sweet 4, ice 1, cream 5".  An integer prominence
  // ranking, computed INDEPENDENTLY of the relative contour below.
  lines.push(H1('Phrase Stress') + '  ' + chalk.dim('1 = strongest (utterance nuclear) → higher = weaker · 0 = none'));
  lines.push('');

  const phrParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) phrParts.push(' ');
    if (cs.isFirstInWord) {
      const ps = cs.wordRef.phraseStress || 0;
      const colour = ps === 0 ? chalk.dim
        : ps === 1 ? chalk.cyanBright           // the utterance nuclear (strongest)
        : ps <= 3 ? chalk.cyan                   // strong
        : chalk.dim;                             // weak / deeply demoted
      phrParts.push(colour(String(ps)));
    } else {
      phrParts.push(' '); // continuation syllable — keep word-start alignment
    }
  }
  lines.push('  ' + phrParts.join(''));
  lines.push('');

  // ── Layer 4: Relative stress (w/n/m/s) ──────────────────────────
  lines.push(H1('Relative Stress') + '  ' + REL_X('x') + REL_W('w') + REL_N('n') + REL_M('m') + REL_S('s') + '  (zero‑provision→weak→low→moderate→strong)');
  lines.push('');

  const relParts: string[] = [];
  for (const cs of colSyls) {
    if (cs.isFirstInWord && cs.globalIdx > 0) relParts.push(' ');
    relParts.push(relColour(cs.relStress)(cs.relStress));
  }
  lines.push('  ' + relParts.join(''));
  lines.push('');

  // ── Layer 5: Phonological bracketing (graded by boundary strength) ──────
  lines.push(H1('Phonological Bracketing') + '  ' + B_KAPPA('[]') + ' κ  ' + B_PP('{}') + ' ϕ  ' + B_IU('<>') + ' ι' +
    chalk.dim('   — ϕ/ι tint: ') + boundaryColour(0.1)('weak') + chalk.dim('→') + boundaryColour(1)('strong'));
  lines.push('');

  // Graded boundary strengths (NSBR, boundaries.ts), zipped to the ϕ/ι opens as we
  // walk the syllable columns: each ϕ is tinted by the strength of the break that
  // introduced it (its left-edge boundary); κ stays the weakest dim-blue tier.
  const bounds = computeBoundaries(words, ius);
  let phiOrd = -1;
  let ppColourFn: (s: string) => string = B_PP;
  let iuColourFn: (s: string) => string = B_IU;
  const sylParts: string[] = [];
  let iuOpen = false, ppOpen = false, cpOpen = false;
  for (const cs of colSyls) {
    if (cs.isFirstInPP) {
      phiOrd++;
      const st = bounds.phi[phiOrd]?.strength ?? 0;
      ppColourFn = boundaryColour(st);
      if (cs.isFirstInIU) iuColourFn = boundaryColour(st);
    }
    if (cs.isFirstInIU && !iuOpen) { sylParts.push(iuColourFn('<')); iuOpen = true; }
    if (cs.isFirstInPP && !ppOpen) { sylParts.push(ppColourFn('{')); ppOpen = true; }
    if (cs.isFirstInCP && !cpOpen) { sylParts.push(B_KAPPA('[')); cpOpen = true; }

    if (cs.isFirstInWord && cs.globalIdx > 0) sylParts.push(' ');
    sylParts.push(relColour(cs.relStress)(cs.chunk));

    if (cs.isLastInCP && cpOpen) { sylParts.push(B_KAPPA(']')); cpOpen = false; }
    if (cs.isLastInPP && ppOpen) { sylParts.push(ppColourFn('}')); ppOpen = false; }
    if (cs.isLastInIU && iuOpen) { sylParts.push(iuColourFn('>')); iuOpen = false; }
  }
  lines.push('  ' + sylParts.join(''));
  lines.push('');

  // ── Layer 6: Metrical scansion with caesura ─────────────────────
  lines.push(H1('Metrical Scansion'));
  lines.push('');

  const scansion = detail.scansion;
  const feetRaw = scansion.split('|');

  interface LinearSyl {
    chunk: string;
    relStress: StressLevel;
    wordRef: ClsWord;
  }
  const linearSyls: LinearSyl[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    const sylCount = w.syllables.length;
    const chunks = syllabifyWord(w.word, sylCount, syllableVowelLengths(w.syllables), w.morphSuffix, w.morphPrefix);
    for (let si = 0; si < sylCount; si++) {
      linearSyls.push({
        chunk: chunks[si] || w.word,
        relStress: w.syllables[si].relativeStress ?? 'w',
        wordRef: w,
      });
    }
  }

  // Caesurae: hard at IU/punctuation breaks, plus one inferred (soft) medial
  // caesura at a phonological-phrase boundary for a punctuation-free line.
  const caesurae = computeCaesurae(words, ius, scansion);

  function isSyllableChar(ch: string): boolean {
    return 'xXwWnNmMsS'.includes(ch);
  }

  // Feet whose right edge carries a caesura take the caesura GLYPH as their
  // separator (matching the reading view's "xs ‖ xnw"), never a doubled "‖ |".
  const joinFeet = (feet: string[], caesAfter: boolean[]): string => {
    let out = '';
    for (let i = 0; i < feet.length; i++) {
      out += feet[i];
      if (i < feet.length - 1) out += caesAfter[i] ? ' ' : B_FOOT(' | ');
    }
    return out;
  };

  let sylIdx = 0;
  const footDisplays: string[] = [];
  const footCaes: boolean[] = [];
  let prevWordRef: ClsWord | null = null;
  for (const rawFoot of feetRaw) {
    let footOut = '';
    for (const ch of rawFoot) {
      if (ch === '-') {
        footOut += B_SILENT('·');
        continue;
      }
      if (!isSyllableChar(ch)) continue;
      if (sylIdx < linearSyls.length) {
        const ls = linearSyls[sylIdx];
        if (prevWordRef !== null && ls.wordRef !== prevWordRef) footOut += ' ';
        footOut += relColour(ls.relStress)(ls.chunk);
        prevWordRef = ls.wordRef;
        sylIdx++;
      }
    }
    const ck = caesurae.get(sylIdx); if (ck) footOut += ' ' + caesuraGlyph(ck);
    footCaes.push(!!ck);
    footDisplays.push(footOut);
  }
  lines.push('  ' + H2('Feet:   ') + joinFeet(footDisplays, footCaes));

  const stressDisplays: string[] = [];
  const stressCaes: boolean[] = [];
  let rIdx = 0;
  for (const rawFoot of feetRaw) {
    let s = '';
    for (const ch of rawFoot) {
      if (ch === '-') { s += B_SILENT('_'); continue; }
      if (!isSyllableChar(ch)) continue;
      if (rIdx < linearSyls.length) {
        s += relColour(linearSyls[rIdx].relStress)(linearSyls[rIdx].relStress);
        rIdx++;
      }
    }
    const ck2 = caesurae.get(rIdx); if (ck2) s += ' ' + caesuraGlyph(ck2);
    stressCaes.push(!!ck2);
    stressDisplays.push(s);
  }
  lines.push('  ' + H2('Stress: ') + joinFeet(stressDisplays, stressCaes));
  lines.push('');

  // ── Layer 7: Dependencies ───────────────────────────────────────
  lines.push(H1('Dependencies'));
  lines.push('');
  for (const we of dedupedEntries) {
    const w = we.word;
    if (isPunctuation(w.lexicalClass)) continue;
    const dep = w.dependency;
    if (!dep) continue;
    if (dep.governorIndex === 0 || dep.dependentType === 'root') {
      lines.push('  ' + B_IU('ROOT →') + ' ' + W_CONTENT(w.word));
    } else {
      lines.push('  ' +
        W_FUNCTION(w.word.padEnd(12)) +
        W_DEP('←' + dep.dependentType + '← ') +
        W_CONTENT(dep.governorName)
      );
    }
  }
  lines.push('');

  // ── Layer 8: Summary ────────────────────────────────────────────
  lines.push(H1('Summary'));
  lines.push('');
  lines.push('  ' + H2('Meter:    ') + detail.meter + chalk.dim('  (' + detail.footCount + ' feet)') + consensusNote(detail) + rhythmNoteStr(detail));
  const rank = formatRanking(detail.ranking);
  lines.push('  ' + H2('Fit:      ') + chalk.yellow(detail.certainty + '%') + (rank ? '   ' + rank : ''));
  lines.push('  ' + H2('Scansion: ') + detail.scansion);
  lines.push('  ' + H2('Summary:  ') + detail.summary);
  lines.push('');

  // ── Layer 9: Scandroid — Hartman's own, fully independent second opinion ──
  // Its own dictionary, its own syllabifier, its own algorithms; reads only
  // the raw line text.  Never touches or is touched by anything above.
  if (result.scandroidNative) {
    const sn = result.scandroidNative;
    lines.push(H1('Scandroid (independent)'));
    lines.push('');
    const lengthTxt = sn.lineFeetSet ? sn.lineLengthName : `${sn.lineLengthName} (variable length)`;
    lines.push('  ' + H2('Metron:   ') + `${sn.metronName} ${lengthTxt}`);
    if (sn.verdict) {
      const failTxt = sn.verdict.ok ? '' : chalk.red(' FAIL' + (sn.verdict.failReason ? ` (${sn.verdict.failReason})` : ''));
      lines.push('  ' + H2('Verdict:  ') + `${sn.verdict.algorithm} — ${sn.verdict.scanString}` + failTxt);
      lines.push('  ' + H2('Marks:    ') + sn.verdict.marksString + '   ' + chalk.dim(`${sn.verdict.substitutions} substitution(s)`));
    } else {
      lines.push('  ' + H2('Verdict:  ') + chalk.red('FAIL (no scannable resolution)'));
    }
    if (sn.corralTheWeird) lines.push('  ' + H2('CW:       ') + sn.corralTheWeird.scanString + (sn.corralTheWeird.ok ? '' : chalk.red(' FAIL')));
    if (sn.maximizeTheNormal) lines.push('  ' + H2('MN:       ') + sn.maximizeTheNormal.scanString + (sn.maximizeTheNormal.ok ? '' : chalk.red(' FAIL')));
    lines.push('');
  }

  // ── Layer 9b: Fabb–Halle bracketed grid (independent second opinion) ──
  // Built fresh from the line's FINAL meter name (post-consensus), never fed
  // back into the main scansion.  Rule sets exist for the English strict
  // meters (iamb/trochee/anapest/dactyl; amphibrach via ternary R→L); other
  // verdicts (accentual, free) have no F&H grid and the section is skipped.
  {
    const fhSyls = linearSyls.map(ls => ({
      text: ls.chunk,
      lex: 0,
      poly: ls.wordRef.syllables.length > 1,
    }));
    // Lexical stresses assigned positionally, walking words in surface order
    // (mirrors how linearSyls itself was built).
    {
      let k = 0;
      for (const w of words) {
        if (isPunctuation(w.lexicalClass)) continue;
        for (const s of w.syllables) {
          if (k < fhSyls.length) fhSyls[k].lex = s.lexicalStress ?? s.stress ?? 0;
          k++;
        }
      }
    }
    const fh = buildFabbHalleGrid(fhSyls, detail.meter || '', detail.footCount);
    if (fh) {
      lines.push(H1('Fabb–Halle Grid') + chalk.dim('  — bracketed-grid scansion (Meter in Poetry, 2008); * projects, ( groups rightward, ) leftward'));
      lines.push('');
      lines.push('  ' + chalk.dim(fh.ruleLabel));
      const maximaSet = new Set(fh.maxima);
      const violSet = new Set(fh.violations);
      const colW = fhSyls.map((s, i) =>
        Math.max(s.text.length, ...fh.rows.map(r => (r[i] || '').length)) + 1);
      const pad = (t: string, wd: number) => t + ' '.repeat(Math.max(0, wd - t.length));
      lines.push('  ' + chalk.dim('Syl: ') + fhSyls.map((s, i) => {
        const t = pad(s.text, colW[i]);
        return violSet.has(i) ? chalk.red(t) : maximaSet.has(i) ? chalk.yellow(t) : t;
      }).join(''));
      fh.rows.forEach((row, g) => {
        lines.push('  ' + chalk.dim(`G${g}:  `) + row.map((m, i) => pad(m, colW[i])).join(''));
      });
      const verdict = fh.looseFeet != null
        ? `${fh.looseFeet} feet — in a loose meter the foot count IS the meter; maxima anchor the feet, unfooted syllables are free`
        : fh.maxima.length === 0
          ? 'no maxima in this line — vacuously metrical'
          : fh.violations.length === 0
            ? `${fh.maxima.length} maxim${fh.maxima.length === 1 ? 'um' : 'a'}, all project to gridline 1 → metrical`
            : `${fh.violations.length} of ${fh.maxima.length} maxima fail to project → unmetrical under these rules`;
      lines.push('  ' + (fh.metrical ? chalk.green(verdict) : chalk.red(verdict)));
      lines.push('');
    }
  }

  // ── Layer 10: Reading projection (stress gradient over the input) ──
  // A reading-view-style colourisation of the verbatim input, so the finalised
  // analysis always shows "something that looks like the input".  Falls back to
  // the parsed surface forms when the raw line wasn't supplied.
  lines.push(H1('Reading Projection') + chalk.dim('  — stress gradient over the input'));
  lines.push('');
  const projection = rawLine && rawLine.trim()
    ? projectStressOntoLine(rawLine, words)
    : words.filter(w => !isPunctuation(w.lexicalClass)).map(w => colourToken(w.word, w)).join(' ');
  lines.push('  ' + projection);
  lines.push('');

  // ── Layer 11: Legend ────────────────────────────────────────────
  lines.push(HR_THIN);
  lines.push(renderLegend());
  lines.push(HR);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// LEGEND
// ═══════════════════════════════════════════════════════════════════════

export function renderLegend(): string {
  return [
    H2('Legend'),
    '  ' + B_CP('[]') + ' Clitic Phrase  ' + B_PP('{}') + ' Phonological Phrase  ' + B_IU('<>') + ' Intonational Unit',
    '  ' + LEX0('0') + LEX1('1') + LEX2('2') + LEX3('3') + '  Lexical stress (0=none 1=secondary 2=primary 3+=boosted)',
    '  ' + REL_X('x') + REL_W('w') + REL_N('n') + REL_M('m') + REL_S('s') + '  Relative stress (zero‑provision→weak→low→moderate→strong)',
    '  ' + W_CONTENT('content') + '  ' + W_FUNCTION('function') + '  Word class',
    '  ' + B_CAESURA('‖') + ' Caesura (phrasal break)  ' + B_CAESURA_SOFT('¦') + ' Inferred caesura  ' +
      B_FOOT('|') + ' Foot boundary  ' + B_SILENT('·') + ' Silent beat',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// GLOSSARIES — Penn POS tags & grammatical dependencies
// (For the long-form Display Legend [menu] and the per-line mini-legend in the
//  detailed views.  NOT shown in the compact in-output legend above.)
// ═══════════════════════════════════════════════════════════════════════

interface Gloss { name: string; eg: string; }

// Penn Treebank POS tags that FinNLP's en-pos tagger assigns to words (the tags
// shown as "(TAG)" in the Original Text / Phrasal Structure layers).  Pure
// punctuation/symbol/list tags (, : . ( ) # $ SYM LS) are intentionally omitted —
// they label no lexical word in the prosodic analysis.  Grouped by word class so
// the distinctions read clearly.
const POS_GROUPS: { label: string; tags: [string, Gloss][] }[] = [
  { label: 'Nouns', tags: [
    ['NN',   { name: 'noun, singular or mass',  eg: 'table, water, dust' }],
    ['NNS',  { name: 'noun, plural',            eg: 'tables, waters' }],
    ['NNP',  { name: 'proper noun, singular',   eg: 'London, Pound' }],
    ['NNPS', { name: 'proper noun, plural',     eg: 'Americans, Smiths' }],
  ]},
  { label: 'Verbs & modals', tags: [
    ['VB',   { name: 'verb, base form',                 eg: 'throw, eat, run' }],
    ['VBD',  { name: 'verb, past tense',                eg: 'threw, ate, ran' }],
    ['VBG',  { name: 'verb, gerund / present part.',    eg: 'throwing, eating' }],
    ['VBN',  { name: 'verb, past participle',           eg: 'thrown, eaten' }],
    ['VBP',  { name: 'verb, non-3rd-sg present',        eg: '(I) throw, run' }],
    ['VBZ',  { name: 'verb, 3rd-sg present',            eg: 'throws, runs' }],
    ['MD',   { name: 'modal',                           eg: 'can, will, must' }],
  ]},
  { label: 'Adjectives & adverbs', tags: [
    ['JJ',   { name: 'adjective',               eg: 'green, large' }],
    ['JJR',  { name: 'adjective, comparative',  eg: 'greener, larger' }],
    ['JJS',  { name: 'adjective, superlative',  eg: 'greenest, largest' }],
    ['RB',   { name: 'adverb',                  eg: 'quickly, very' }],
    ['RBR',  { name: 'adverb, comparative',     eg: 'faster, better' }],
    ['RBS',  { name: 'adverb, superlative',     eg: 'fastest, best' }],
  ]},
  { label: 'Determiners & numbers', tags: [
    ['DT',   { name: 'determiner',              eg: 'the, a, an' }],
    ['PDT',  { name: 'predeterminer',           eg: 'all (the books), both' }],
    ['CD',   { name: 'cardinal number',         eg: 'one, two, three' }],
  ]},
  { label: 'Pronouns', tags: [
    ['PRP',  { name: 'personal pronoun',        eg: 'I, you, he, they' }],
    ['PRP$', { name: 'possessive pronoun',      eg: 'my, your, their' }],
  ]},
  { label: 'Wh-words', tags: [
    ['WDT',  { name: 'wh-determiner',           eg: 'which, that' }],
    ['WP',   { name: 'wh-pronoun',              eg: 'who, what' }],
    ['WP$',  { name: 'possessive wh-pronoun',   eg: 'whose' }],
    ['WRB',  { name: 'wh-adverb',               eg: 'when, where, why' }],
  ]},
  { label: 'Function & other', tags: [
    ['IN',   { name: 'preposition / subord. conj.', eg: 'in, of, although' }],
    ['TO',   { name: 'infinitival "to"',            eg: 'to (go)' }],
    ['CC',   { name: 'coordinating conjunction',    eg: 'and, but, or' }],
    ['RP',   { name: 'particle',                    eg: 'up (give up), off' }],
    ['EX',   { name: 'existential "there"',         eg: 'there (is)' }],
    ['POS',  { name: 'possessive ending',           eg: "'s, '" }],
    ['UH',   { name: 'interjection',                eg: 'oh, wow, ah' }],
    ['FW',   { name: 'foreign word',                eg: 'je ne sais quoi' }],
  ]},
];

// Grammatical dependency relations AS THE TOOLKIT DISPLAYS THEM (the lowercase
// labels shown as "←label", after FinNLP's relations are mapped to the
// Antelope/Universal-Dependencies scheme in parser.ts).  Grouped by role.
const DEP_GROUPS: { label: string; deps: [string, Gloss][] }[] = [
  { label: 'Core arguments', deps: [
    ['nsubj',     { name: 'nominal subject',            eg: 'I like you' }],
    ['nsubjpass', { name: 'nominal subject (passive)',  eg: 'I was given a chance' }],
    ['dobj',      { name: 'direct object',              eg: 'I like you' }],
    ['iobj',      { name: 'indirect object',            eg: 'she gave me a book' }],
    ['pobj',      { name: 'object of preposition (oblique)', eg: 'to the children' }],
  ]},
  { label: 'Clausal relations', deps: [
    ['ccomp',     { name: 'clausal complement',         eg: 'ordered to dig' }],
    ['xcomp',     { name: 'open clausal complement',    eg: 'told us to dig' }],
    ['advcl',     { name: 'adverbial clause modifier',  eg: 'walking as rain fell' }],
    ['acl',       { name: 'clausal modifier of a noun', eg: 'the man you love' }],
  ]},
  { label: 'Modifiers', deps: [
    ['amod',      { name: 'adjectival modifier',        eg: 'good to him' }],
    ['advmod',    { name: 'adverbial modifier',         eg: 'genetically modified' }],
    ['nummod',    { name: 'numeric modifier',           eg: '2 eggs' }],
    ['nmod',      { name: 'nominal modifier',           eg: 'news of the market' }],
    ['poss',      { name: 'possessive / nominal mod.',  eg: "Senka's match" }],
    ['det',       { name: 'determiner',                 eg: 'the book' }],
  ]},
  { label: 'Function & markers', deps: [
    ['prep',      { name: 'case / preposition marker',  eg: 'went to Rome' }],
    ['aux',       { name: 'auxiliary',                  eg: 'am going' }],
    ['auxpass',   { name: 'auxiliary (passive)',        eg: 'have been marked' }],
    ['cc',        { name: 'coordinating conjunction',   eg: 'Matt and Alex' }],
    ['mark',      { name: 'clause / complement marker', eg: 'if I like it' }],
    ['prt',       { name: 'verb particle',              eg: 'switched it off' }],
    ['expl',      { name: 'expletive',                  eg: 'there is' }],
    ['discourse', { name: 'discourse element',          eg: 'I like that :)' }],
    ['intj',      { name: 'interjection',               eg: 'pass it, please' }],
  ]},
  { label: 'Other', deps: [
    ['root',      { name: 'root (head of the sentence)', eg: 'the main predicate' }],
    ['dep',       { name: 'unspecified dependency',      eg: '(unresolved)' }],
    ['punct',     { name: 'punctuation',                 eg: 'Guys, calm!' }],
  ]},
];

// Flat lookups (used by the per-line mini-legend).
const POS_GLOSS: Record<string, Gloss> = Object.fromEntries(POS_GROUPS.flatMap(g => g.tags));
const DEP_GLOSS: Record<string, Gloss> = Object.fromEntries(DEP_GROUPS.flatMap(g => g.deps));

/** A glossary row, padded on the RAW strings (so chalk colour codes don't skew
 *  alignment).  `tagWidth` is sized to the widest tag in the table. */
function glossRow(tag: string, g: Gloss, tagWidth: number): string {
  return '  ' + chalk.cyan(tag.padEnd(tagWidth)) + W_CONTENT(g.name.padEnd(32)) + chalk.dim('e.g. ' + g.eg);
}

/**
 * The long-form legend triggered from the main menu's "Display Legend" option:
 * the compact legend PLUS full Penn POS-tag and grammatical-dependency glossaries.
 * (These glossaries are deliberately NOT part of the compact in-output legend.)
 */
export function renderFullLegend(): string {
  const out: string[] = [];
  out.push(renderLegend());
  out.push('');
  out.push(HR_THIN);
  out.push(H1('Part-of-Speech Tags') + chalk.dim('  — Penn Treebank, as tagged by en-pos'));
  const posWidth = Math.max(...POS_GROUPS.flatMap(g => g.tags.map(([t]) => t.length))) + 2;
  for (const grp of POS_GROUPS) {
    out.push('');
    out.push('  ' + H2(grp.label));
    for (const [tag, g] of grp.tags) out.push(glossRow(tag, g, posWidth));
  }
  out.push('');
  out.push(HR_THIN);
  out.push(H1('Grammatical Dependencies') + chalk.dim('  — relation of each word to its governor (←label)'));
  const depWidth = Math.max(...DEP_GROUPS.flatMap(g => g.deps.map(([d]) => d.length))) + 2;
  for (const grp of DEP_GROUPS) {
    out.push('');
    out.push('  ' + H2(grp.label));
    for (const [dep, g] of grp.deps) out.push(glossRow(dep, g, depWidth));
  }
  return out.join('\n');
}

/**
 * A compact per-line mini-legend: only the POS tags and dependency relations that
 * actually occur in THIS line's parse, defined briefly (no examples), for the head
 * of the detailed view's Phrasal Structure section.  Fits in one or two lines.
 */
function renderLineGlossary(words: ClsWord[]): string[] {
  const posSeen: string[] = [];
  const depSeen: string[] = [];
  for (const w of words) {
    if (isPunctuation(w.lexicalClass)) continue;
    if (!posSeen.includes(w.lexicalClass)) posSeen.push(w.lexicalClass);
    const dep = w.dependency;
    if (dep && dep.governorIndex > 0 && dep.dependentType && !depSeen.includes(dep.dependentType)) {
      depSeen.push(dep.dependentType);
    }
  }
  // Concise gloss for the mini-legend: drop the comma/parenthesis qualifier that
  // the full legend carries ("noun, singular or mass" → "noun").
  const brief = (name: string): string => name.split(/,| \(/)[0].trim();
  const out: string[] = [];
  if (posSeen.length) {
    const items = posSeen.map(t => chalk.cyan(t) + chalk.dim('=') + W_FUNCTION(brief(POS_GLOSS[t]?.name ?? t)));
    out.push('  ' + chalk.dim('PoS  ') + items.join(chalk.dim(' · ')));
  }
  if (depSeen.length) {
    const items = depSeen.map(d => chalk.cyan(d) + chalk.dim('=') + W_FUNCTION(brief(DEP_GLOSS[d]?.name ?? d)));
    out.push('  ' + chalk.dim('Dep  ') + items.join(chalk.dim(' · ')));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// READING VIEW — original formatting, stress-gradient coloured per syllable
// ═══════════════════════════════════════════════════════════════════════

/** One input line with its (1+) parsed sentence results. */
export interface ReadingLine {
  raw: string;            // the original line text, verbatim
  results: LineResult[];  // a line may parse into more than one sentence
}

/** A stanza: a run of consecutive non-blank input lines. */
export interface ReadingStanza {
  lines: ReadingLine[];
}

/** Surface form reduced to bare lowercase letters (drops apostrophes/hyphens). */
function normWordForm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
}

/** Colour each orthographic syllable of an original token by its relative stress. */
function colourToken(tokenText: string, word: ClsWord): string {
  const sylCount = Math.max(1, word.syllables.length);
   const chunks = syllabifyWord(tokenText, sylCount, syllableVowelLengths(word.syllables), word.morphSuffix, word.morphPrefix); // partitions the WHOLE token
  const stresses = chunks.map((_, i) => word.syllables[i]?.relativeStress ?? 'w');

  // Fast path: chunks reconstruct the token exactly (the common case).
  if (chunks.join('') === tokenText) {
    return chunks.map((c, i) => relColour(stresses[i])(c)).join('');
  }

  // Fallback: the syllabifier dropped a delimiter (it strips hyphens), so walk
  // the ORIGINAL token char-by-char, assigning each kept char to its syllable
  // by the chunk lengths and emitting dropped hyphens verbatim.  Every original
  // character is emitted exactly once, so nothing is ever lost.
  const lens = chunks.map(c => c.length);
  let out = '';
  let ci = 0;
  let consumed = 0;
  for (const ch of tokenText) {
    if (ch === '-') { out += ch; continue; }      // dropped delimiter, verbatim
    while (ci < lens.length - 1 && consumed >= lens[ci]) { ci++; consumed = 0; }
    out += relColour(stresses[ci])(ch);
    consumed++;
  }
  return out;
}

/**
 * Project per-syllable stress colours back onto the original line, preserving
 * capitalisation, punctuation, spacing and any extrametrical fragments the
 * pipeline dropped (e.g. possessive "'s").  Word-like tokens are coloured;
 * everything between them (spaces, punctuation, dashes) is emitted verbatim.
 *
 * Alignment is tolerant: it matches each token to the next parsed word by
 * normalised form (equal, or token starts with the word — handling "cat's"),
 * with a small look-ahead resync so a stray/unsyllabified token never derails
 * the rest of the line.  No original character is ever dropped.
 */
export function projectStressOntoLine(rawLine: string, words: ClsWord[]): string {
  const tokenRe = /[A-Za-z\u00C0-\u024F]+(?:['’\-][A-Za-z\u00C0-\u024F]+)*/g;  // accented Latin included (Milésien)
  let out = '';
  let cursor = 0;
  let wi = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rawLine)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out += rawLine.slice(cursor, start);          // gap text, verbatim
    cursor = end;
    const token = m[0];
    const tokNorm = normWordForm(token);

    const matches = (w: ClsWord | undefined): boolean => {
      if (!w) return false;
      const wn = normWordForm(w.word);
      return wn.length > 0 && (tokNorm === wn || tokNorm.startsWith(wn));
    };

    if (matches(words[wi])) {
      out += colourToken(token, words[wi]);
      wi++;
    } else {
      // Resync: a parsed word may have been skipped (e.g. unsyllabified "'s").
      let found = -1;
      for (let k = wi; k < Math.min(words.length, wi + 4); k++) {
        if (matches(words[k])) { found = k; break; }
      }
      if (found >= 0) {
        out += colourToken(token, words[found]);
        wi = found + 1;
      } else {
        out += token; // leave verbatim; do not advance the word cursor
      }
    }
  }
  out += rawLine.slice(cursor);                    // trailing text, verbatim
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// CAESURA RENDERING  (placement logic now lives in caesura.ts)
// ═══════════════════════════════════════════════════════════════════════

/** Render the glyph for a caesura, coloured by its boundary strength (Wagner
 *  Ch.4–5): a strong break is a warm-red '‖', a medium one an orange '¦', a weak
 *  one a dim '·' — the same cold-blue→warm-red spectrum as the brackets. */
function caesuraGlyph(info: CaesuraInfo): string {
  const glyph = info.kind === 'hard' ? '‖' : '¦';
  if (info.strength < 0.34) return chalk.hex(gradHex(info.strength))('·');
  return chalk.hex(gradHex(info.strength)).bold(glyph);
}

/** Colour a scansion string ("nws|nns|-wns") letter-by-letter, inserting caesura
 *  marks (at foot boundaries) when a caesura map is supplied. */
function colourScansionMap(scansion: string, caesurae?: Map<number, CaesuraInfo>): string {
  let out = '';
  let sc = 0;                       // syllables emitted so far
  const emitted = new Set<number>();
  const caesAt = (): string => {
    if (caesurae && caesurae.has(sc) && !emitted.has(sc)) {
      emitted.add(sc);
      return ' ' + caesuraGlyph(caesurae.get(sc)!) + ' ';
    }
    return '';
  };
  for (const ch of scansion) {
    if (ch === '|') {
      const c = caesAt();
      out += c || B_FOOT('|');
    } else if (ch === '-') {
      out += B_SILENT('-');
    } else if ('xwnms'.includes(ch)) {
      out += caesAt();              // a (rare) mid-foot caesura, inserted inline
      out += relColour(ch as StressLevel)(ch);
      sc++;
    } else {
      out += ch;
    }
  }
  return out;
}

const METER_ABBR: Record<string, string> = {
  iambic: 'iamb', trochaic: 'troch', anapestic: 'anap', dactylic: 'dact',
  amphibrachic: 'amph', bacchic: 'bacch', spondaic: 'spon', pyrrhic: 'pyrr',
  'free verse': 'free',
};

// ── Meter-family colours ───────────────────────────────────────────
// One consistent, legible LIGHT tone per metre family, reused EVERYWHERE a
// metre is named (the reading per-line meter, the top-3 ranking, and the
// synopsis).  The foot-count label (pentameter / octameter…) stays white — we
// tint only the family word, so the output is informative without being gaudy.
const METER_HUE: Record<string, (s: string) => string> = {
  iambic:       chalk.hex('#7fb8ff'),  // light blue
  trochaic:     chalk.hex('#ffc24d'),  // yellow / orange
  dactylic:     chalk.hex('#88e0a0'),  // mid / light green
  amphibrachic: chalk.hex('#ff9ec4'),  // pinkish
  anapestic:    chalk.hex('#ff7a6b'),  // reddish
  bacchic:      chalk.hex('#c08be6'),  // purple / wine
  spondaic:     chalk.hex('#b8b8b8'),
  pyrrhic:      chalk.hex('#b8b8b8'),
};
const METER_FALLBACK = chalk.hex('#cfd8e3'); // free verse / unknown

/** Tint a metre-family WORD (the first token of a metre name) by its hue. */
function meterFamilyColour(family: string): (s: string) => string {
  return METER_HUE[family.toLowerCase()] ?? METER_FALLBACK;
}

/** Colour a full metre label ("iambic pentameter"): family tinted, foot-count
 *  label left white.  Bare "free verse" / multi-word non-families: fallback. */
function colourMeterLabel(meter: string): string {
  const sp = meter.indexOf(' ');
  if (sp < 0) return meterFamilyColour(meter)(meter);
  const family = meter.slice(0, sp);
  const hue = METER_HUE[family.toLowerCase()];
  if (!hue) return METER_FALLBACK(meter);
  return hue(family) + chalk.whiteBright(meter.slice(sp));
}

/** Tint every metre-family word/abbreviation occurring inside a free-form
 *  string (used to colour the synopsis values without restructuring them).
 *  Longest-first so "iamb" inside "iambic" is not matched before the full word. */
const _METER_WORD_RE = /\b(iambic|trochaic|dactylic|amphibrachic|anapestic|bacchic|spondaic|pyrrhic|iamb|troch|dact|amph|anap|bacch|spon|pyrr)\b/gi;
function tintMeterNames(s: string): string {
  return s.replace(_METER_WORD_RE, (w) => {
    const key = w.toLowerCase();
    const fam = key.startsWith('iamb') ? 'iambic' : key.startsWith('troch') ? 'trochaic'
      : key.startsWith('dact') ? 'dactylic' : key.startsWith('amph') ? 'amphibrachic'
      : key.startsWith('anap') ? 'anapestic' : key.startsWith('bacch') ? 'bacchic'
      : key.startsWith('spon') ? 'spondaic' : 'pyrrhic';
    return meterFamilyColour(fam)(w);
  });
}

/** Compact top-3 meter fit scores, e.g. "anap 0.81 · iamb 0.77 · amph 0.74" —
 *  each family abbreviation tinted its hue, the score dimmed, no enclosing
 *  parentheses (set off from the meter name by a dim "|" at the call site). */
function formatRanking(ranking?: MeterScore[]): string {
  if (!ranking || ranking.length === 0) return '';
  const top = ranking.slice(0, 3).map(r =>
    meterFamilyColour(r.meter)(METER_ABBR[r.meter] ?? r.meter) + chalk.dim(' ' + r.score.toFixed(2)));
  return top.join(chalk.dim(' · '));
}

/** Divergence notes.  After the continuity rename, a near-tie line's BASE
 *  meter is already the stanza/poem-dominant one and `standaloneMeter` records
 *  the numerically-best standalone reading ("≈ continuity; standalone:
 *  dactylic tetrameter").  `consensusMeter` survives only when the forced
 *  re-fit failed — then the old "aligns w/" annotation still applies. */
function consensusNote(detail: { consensusMeter?: string; standaloneMeter?: string }): string {
  if (detail.standaloneMeter) {
    return chalk.dim.italic(`  ≈ continuity; standalone: ${detail.standaloneMeter}`);
  }
  if (!detail.consensusMeter) return '';
  return chalk.dim.italic(`  ↔ aligns w/ stanza ${detail.consensusMeter}`);
}

/** Non-classical rhythm annotation (dolnik / taktovik / accentual), set by the
 *  rhythm layer.  Shown as a separate chip AFTER the meter — it supplements the
 *  classical reading (in beats), it never replaces it. */
function rhythmNoteStr(detail: { rhythmNote?: string }): string {
  if (!detail.rhythmNote) return '';
  const note = detail.rhythmNote;
  // Some notes (the 4/3 accentual) already carry a ♪; don't double it.
  return chalk.magenta.dim('  ' + (note.includes('♪') ? note : '♪ ' + note));
}

/** Rhyme chip for a line: the end-rhyme scheme letter with its rhyme TYPE
 *  (e.g. "A(perfect)"; '·' = unrhymed), PLUS any pre-caesural INTERNAL rhymes,
 *  each parenthesised and cyan with its own type, shown before the end letter:
 *  e.g. "(C)(perfect) A(perfect)". */
function rhymeStr(detail: {
  rhyme?: { letter: string; type?: string; internal?: { letter: string; type?: string }[] };
}): string {
  const r = detail.rhyme;
  if (!r) return '';
  const parts: string[] = [];
  for (const iw of r.internal ?? []) {
    parts.push(chalk.cyan(`(${iw.letter})`) + (iw.type ? chalk.dim(`(${iw.type})`) : ''));
  }
  if (r.letter && r.letter !== '·') {
    parts.push(chalk.yellowBright(r.letter) + (r.type ? chalk.dim(`(${r.type})`) : ''));
  } else if (parts.length === 0) {
    parts.push(chalk.dim('·'));
  }
  return '  ' + parts.join(' ');
}

/** Non-punctuation, syllable-bearing words across all of a line's sentences. */
function collectLineWords(ln: ReadingLine): ClsWord[] {
  const ws: ClsWord[] = [];
  for (const res of ln.results) {
    for (const w of res.sentence.words) {
      if (!isPunctuation(w.lexicalClass) && w.syllables.length > 0) ws.push(w);
    }
  }
  return ws;
}

/**
 * The Phonopoetics block of the synopsis: end / caesural / head rhymes (each
 * letter coloured by the strongest relative-stress tier it spans), alliteration,
 * and acrostics.  Only subsections actually present in the poem are shown.
 */
function renderPhonopoetics(p: Phonopoetics): string[] {
  // a rhyme pair "word [A|L1(|kind)] -> word [A|L4]", letter tinted by top stress
  const rel = (r: RhymeRel): string => {
    const L = relColour(r.topStress)(r.letter);
    const D = chalk.dim;
    const kindTag = r.kind === 'end' ? '' : D('|' + r.kind);
    const typ = r.type ? D(` ${r.type}`) : '';
    return chalk.white(r.fromWord) + ' ' + D('[') + L + D('|') + D(r.fromLabel) + kindTag + D(']')
      + D(' → ') + chalk.white(r.toWord) + ' ' + D('[') + L + D('|') + D(r.toLabel) + D(']') + typ;
  };
  const SEP = chalk.dim('  ·  ');
  const sub: { label: string; body: string }[] = [];
  if (p.end.length)       sub.push({ label: 'End-Rhymes',      body: p.end.map(rel).join(SEP) });
  if (p.caesural.length)  sub.push({ label: 'Caesural Rhymes', body: p.caesural.map(rel).join(SEP) });
  if (p.head.length)      sub.push({ label: 'Head Rhymes',     body: p.head.map(rel).join(SEP) });
  if (p.alliteration.length) sub.push({
    label: 'Alliteration',
    body: p.alliteration.map(a => chalk.white(a.words.join(' ')) + chalk.dim(` (${a.label})`)).join(SEP),
  });
  if (p.acrostics.length) sub.push({
    label: 'Acrostic',
    body: p.acrostics.map(a =>
      a.firsts.map((f, i) => chalk.dim('[' + a.labels[i] + ':') + chalk.whiteBright(f) + chalk.dim(']')).join('')
      + chalk.dim(' → ') + chalk.yellowBright(a.word)).join(SEP),
  });
  if (sub.length === 0) return [];

  const out: string[] = ['', chalk.bold.cyan('Phonopoetics:')];
  const w = Math.max(...sub.map(s => s.label.length)) + 2;
  for (const s of sub) out.push('  ' + chalk.bold((s.label + ':').padEnd(w)) + s.body);
  return out;
}

/**
 * Reading view: the poem itself in its original formatting, each syllable
 * coloured by 4-tier relative stress, followed by a same-structure block of
 * per-line stress maps + meter (with top-3 fit scores).  This is the whole
 * output for this mode — not the full per-line analytic dump.
 */
/** A verse line CLOSED by terminal or clause punctuation is END-STOPPED (a
 *  prosodic pause at the line break); one ending on a word with no boundary
 *  punctuation RUNS ON — enjambment — its intonational unit spilling into the
 *  next line.  (Trailing quotes/brackets are ignored when judging the close.) */
function lineRunsOn(raw: string): boolean {
  const t = raw.replace(/["'’”»)\]]+$/, '').trimEnd();
  if (!t) return false;
  return !/[.!?;:,—–…]$/.test(t);
}

/** Poem-wide enjambment summary (end-stopped vs run-on line-ends), or null for
 *  a single line.  The final line is terminal by position, so only the
 *  line-INTERNAL breaks (lines 1..n-1) are judged. */
function summariseEnjambment(stanzas: ReadingStanza[]): string | null {
  const raws = stanzas.flatMap(st => st.lines.map(l => l.raw));
  if (raws.length < 2) return null;
  const interior = raws.slice(0, -1);
  const enjambed: number[] = [];
  interior.forEach((r, i) => { if (lineRunsOn(r)) enjambed.push(i + 1); });
  const n = interior.length, k = enjambed.length;
  if (k === 0) return 'end-stopped throughout';
  const where = k <= 6 ? ' (lines ' + enjambed.join(', ') + ')' : '';
  return k >= Math.ceil(n / 2)
    ? `predominantly enjambed — ${k} of ${n} line-ends run on${where}`
    : `mostly end-stopped — ${k} of ${n} line-ends enjambed${where}`;
}

export function renderReadingView(stanzas: ReadingStanza[]): string {
  const out: string[] = [];
  const multiStanza = stanzas.length > 1;

  out.push('');
  out.push(HR);
  out.push(H1('Reading View') + chalk.dim('  — stress gradient over input text'));
  out.push('');

  // ── Block 1: the poem, original formatting, syllables coloured ──
  // Multi-stanza poems get a right-aligned "Stanza N" counter in the blank line
  // before each stanza after the first (the gaps between stanzas).
  for (let s = 0; s < stanzas.length; s++) {
    if (multiStanza && s > 0) {
      out.push('');
      out.push(chalk.dim.italic(('Stanza ' + (s + 1)).padStart(HR.length)));
    }
    for (const ln of stanzas[s].lines) {
      out.push(projectStressOntoLine(ln.raw, collectLineWords(ln)));
    }
  }

  out.push('');
  out.push(HR_THIN);
  out.push(H1('Stress Maps, Meter, & Rhymes') + chalk.dim('  — top-3 fit scores per line'));
  out.push('');

  // ── Block 2: stress maps + meter, same stanza/line structure ──
  for (let s = 0; s < stanzas.length; s++) {
    const firstDetail = stanzas[s].lines.flatMap(l => l.results)[0]?.phonologicalScansion;
    const formNote = firstDetail?.formNote ? chalk.green.dim('  ❡ ' + firstDetail.formNote) : '';
    if (multiStanza) out.push(H2('Stanza ' + (s + 1)) + formNote);
    else if (formNote) out.push(formNote.trim());
    for (let l = 0; l < stanzas[s].lines.length; l++) {
      const ln = stanzas[s].lines[l];
      const baseLabel = multiStanza ? `S${s + 1}L${l + 1}` : `L${l + 1}`;
      if (ln.results.length === 0) {
        out.push('  ' + chalk.dim(baseLabel.padEnd(8) + '(no parse)'));
        continue;
      }
      for (let r = 0; r < ln.results.length; r++) {
        const res = ln.results[r];
        const d = res.phonologicalScansion;
        const label = ln.results.length > 1 ? `${baseLabel}.${r + 1}` : baseLabel;
        const caesurae = computeCaesurae(res.sentence.words, res.phonologicalHierarchy, d.scansion);
        const map = colourScansionMap(d.scansion, caesurae);
        const rank = formatRanking(d.ranking);
        out.push('  ' + chalk.bold(label.padEnd(8)) + map + '  ' +
          colourMeterLabel(d.meter) + (rank ? chalk.dim(' | ') + rank : '') + consensusNote(d) + rhythmNoteStr(d) + rhymeStr(d));
      }
    }
    if (multiStanza && s < stanzas.length - 1) out.push('');
  }

  // ── Block 3: Legend ──
  // Kept ABOVE the synopsis: the legend serves the Stress Maps & Meter, and the
  // Phonopoetics subsection of the synopsis below can run long — left at the
  // bottom it gets pushed out of the field of view.
  out.push('');
  out.push(HR_THIN);
  out.push(renderLegend());

  // ── Block 4: cumulative poem synopsis (non-interfering meta-measure) ──
  // Several top conclusions about the poem as a whole, drawn only from the
  // per-line determinations above — never overriding any of them.
  const synopsis = summarizePoem(stanzas.map(st => st.lines.flatMap(l => l.results)));
  if (synopsis.length > 0) {
    out.push('');
    out.push(HR_THIN);
    out.push(H1('Poem Synopsis') + chalk.dim(' In short, we have:'));
    out.push('');
    const w = Math.max(...synopsis.map(r => r.label.length)) + 2;
    for (const row of synopsis) {
      const label = chalk.bold.cyan((row.label + ':').padEnd(w));
      // Colour the value so the block is not a wall of white: tint any metre
      // names their family hue, and highlight the mean-fit %.
      let val = tintMeterNames(row.value);
      if (row.label === 'Meter') val = val.replace(/~\d+%/, (m) => chalk.yellow(m));
      out.push('  ' + label + val);
    }
    // Enjambment / end-stop — a poem-wide reading of the line-ends.
    const enj = summariseEnjambment(stanzas);
    if (enj) out.push('  ' + chalk.bold.cyan('Enjambment:'.padEnd(w)) + chalk.dim(enj));
    // Phonopoetics — end / caesural / head rhymes, alliteration, acrostic.
    out.push(...renderPhonopoetics(analyzePhonopoetics(stanzas.map(st => st.lines.flatMap(l => l.results)))));
  }

  out.push('');
  out.push(HR);
  return out.join('\n');
}
