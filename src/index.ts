#!/usr/bin/env node
import * as fs from 'fs';
import * as readline from 'readline';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { parseDocument, isPunctuation } from './parser.js';
import { ProsodyEngine } from './engine.js';
import { calliopeEngine } from './calliope/engine.js';
import { clioEngine } from './clio/engine.js';
// The FROZEN Clio pipeline + renderers (its own copy of the whole computational
// tree).  When Clio is active the CLI runs entirely through these, so live changes
// to the regular (Calliope) pipeline — scorer included — cannot affect Clio.
import {
  analyzeReadingDocumentClio,
  renderUnifiedDisplay as clioRenderUnifiedDisplay,
  renderReadingView as clioRenderReadingView,
  renderFullLegend as clioRenderFullLegend,
  parseDocument as clioParseDocument,
  isPunctuation as clioIsPunctuation,
} from './clio/pipeline.js';
import {
  renderHierarchy,
  renderKeyStresses,
  flattenDisplayEntries,
} from './phonological.js';
import { extractKeyStresses, scoreMeters, applyStanzaConsensus, applyRhythmLayer, applyMetricalityLayer } from './scansion.js';
import { applyRhymeAndForm, isBeatTransferRhyme } from './rhyme.js';
import { scanTextNatively } from './scandroidNative/engine.js';
import {
  renderUnifiedDisplay,
  renderFullLegend,
  renderReadingView,
  type ReadingStanza,
} from './display.js';
import type {
  ClsSentence,
  ClsWord,
  MetreName,
  IntonationalUnit,
  LineResult,
  PhonologicalScansionDetail,
  SyllableDisplayEntry,
  FootDisplayEntry,
  FormattedDisplay,
  DisplayOptions,
} from './types.js';

// The active prosody engine for this process: Calliope (faithful, default) or
// Clio (the frozen legacy / alternative parse), chosen by `--clio` or the REPL
// menu.  The exported analysis functions default their `engine` parameter to
// this, so library callers (tests, trials, benchmark) transparently use the
// active engine without signature churn.
let activeEngine: ProsodyEngine = calliopeEngine;

/**
 * Stanza-level discourse givenness (Wagner Ch.7, the plan's Gap 13) — CAREFUL and
 * cross-line only.  A CONTENT word repeated from an EARLIER line of the same stanza
 * is discourse-given, so it may be subordinated relative to a new-information sister
 * (the relativiser reads `discourseGiven`).  Constraints that protect single-line
 * scanning and thematically-focused words:
 *   • the first line is never marked (no prior context);
 *   • a lemma repeated WITHIN a single line is FOCUSED, not given → never marked
 *     (Eliot's "Nothing … nothing", a refrain);
 *   • only the 2nd-and-later occurrence (across lines) is marked, never the first;
 *   • single-line input has no previous line, so nothing is marked — the standout
 *     isolated-line feature is untouched.
 * Mutates `discourseGiven` on the words; must run BEFORE the per-line relativisation.
 */
function markStanzaGivenness(docPerLine: ClsSentence[][]): void {
  if (docPerLine.length < 2) return;                       // single line → no givenness
  const key = (w: ClsWord) => w.word.toLowerCase().replace(/['’]/g, '');
  // Lemmas that appear ≥2× within ANY one line are focal (refrain/emphasis) — exempt.
  const focal = new Set<string>();
  for (const sents of docPerLine) {
    const counts = new Map<string, number>();
    for (const sent of sents) for (const w of sent.words) {
      if (!w.isContent) continue;
      const k = key(w);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const [k, n] of counts) if (n >= 2) focal.add(k);
  }
  const seen = new Set<string>();                          // content lemmas in PRIOR lines
  for (const sents of docPerLine) {
    const thisLine = new Set<string>();
    for (const sent of sents) for (const w of sent.words) {
      if (!w.isContent) continue;
      const k = key(w);
      if (seen.has(k) && !focal.has(k)) w.discourseGiven = true;
      thisLine.add(k);
    }
    for (const k of thisLine) seen.add(k);
  }
}

/**
 * Stanza-level RHYME-FELLOW focus — the mirror image of givenness.  The end-rhyme
 * is the verse form's own focus device: a rhyme falls where the ear expects a
 * beat, and the poet who closes a line on a pronoun has PUT the punchline there
 * ("And he stoppeth one of THREE … Now wherefore stopp'st thou ME?" — the rhyme
 * pair three/me IS the contrast pair).  A weak-class line-final word therefore
 * inherits beat-eligibility from a rhyme partner that carries one lexically.
 * Guards (all must hold — none of this is a categorical pronoun rule):
 *   • only the LINE-FINAL word of a line is ever flagged (mid-line "me" untouched);
 *   • the word itself is FUNCTION-class (a content final already has its beat);
 *   • the partner is a CONTENT-class line-final in the SAME stanza — the beat is
 *     transferred from an attested template, never invented;
 *   • the rhyme is BEAT-BEARING (perfect/rich/family, or augmented/diminished —
 *     same stressed vowel ± one terminal consonant) and non-identical — looser
 *     slant hunches and mere repetition do not license promotion;
 *   • single lines and unrhymed finals (enjambment, free verse) are untouched.
 * Mutates `rhymeFocal`; must run BEFORE the per-line relativisation (the
 * relativiser gives a flagged MONOSYLLABLE the 'n' tier — a real, promotable
 * beat, graded below the clause's content beats).
 */
function markRhymeFellows(docPerLine: ClsSentence[][]): void {
  if (docPerLine.length < 2) return;                       // single line → no scheme
  const finals = docPerLine.map(sents => {
    const ws = sents.flatMap(s => s.words)
      .filter(w => /[a-z]/i.test(w.word) && !isPunctuation(w.lexicalClass));
    return ws.length ? ws.reduce((a, b) => (b.absoluteIndex > a.absoluteIndex ? b : a)) : null;
  });
  for (let i = 0; i < finals.length; i++) {
    const w = finals[i];
    if (!w || w.isContent) continue;                       // weak-class finals only
    for (let j = 0; j < finals.length; j++) {
      if (j === i) continue;
      const p = finals[j];
      if (!p || !p.isContent) continue;                    // template must be a content beat
      if (isBeatTransferRhyme(w.word, p.word)) { w.rhymeFocal = true; break; }
    }
  }
}

/**
 * Scan one VERSE LINE (which may parse into several grammatical sentences).
 *
 * The line — not the sentence — is the metrical domain (McAleese; Kiparsky's
 * "phonological phrasing determines the location of caesurae in verse").  A
 * line like "You'll slurp potato soup. No straws! Suck gauze." is ONE iambic
 * pentameter with internal intonational breaks, not three fragments each
 * carrying its own meter.  So the linguistic passes (lexical stress, phrasal
 * hierarchy, compound/nuclear/relative stress) run per sentence — those rules
 * are intra-sentence by nature — but the metrical fit runs once over the
 * line's full concatenated syllable stream, with each sentence's IUs preserved
 * as IU boundaries (→ hard caesurae) inside the line.
 */
function processLine(sents: ClsSentence[], engine: ProsodyEngine = activeEngine): LineResult | null {
  if (sents.length === 0) return null;

  const iusPerSent: IntonationalUnit[][] = [];
  for (const sent of sents) {
    // The selected engine runs the per-sentence linguistic passes (lexical →
    // hierarchy → compound/nuclear → phrase → relative stress) and returns the
    // prosodic hierarchy.  Calliope (default) and Clio differ only here.
    const sentIus = engine.analyzeSentence(sent);
    iusPerSent.push(sentIus);
  }

  // Merge the sentences' streams into the line-level scansion domain.
  const words = sents.flatMap(s => s.words);
  const ius = iusPerSent.flat();
  let merged: ClsSentence;
  if (sents.length === 1) {
    merged = sents[0];
  } else {
    // Re-index sequentially so per-sentence 1-based indices don't collide in
    // any downstream order-by-index logic.  (All hierarchy/dependency passes
    // above are already complete and reference words by object identity.)
    words.forEach((w, i) => { w.index = i + 1; });
    merged = {
      index: sents[0].index,
      nodes: null,
      dependencies: sents.flatMap(s => s.dependencies),
      words,
      xml: '',
    };
  }

  const keyStresses = extractKeyStresses(ius, words);

  // Full phonological scansion over the whole line.
  const phonoDetail = scoreMeters(keyStresses, words, ius);
  phonoDetail.all = renderHierarchy(ius, words);
  phonoDetail.keyStresses = renderKeyStresses(ius, words, keyStresses);

  return {
    sentence: merged,
    phonologicalHierarchy: ius,
    keyStresses,
    phonologicalScansion: phonoDetail,
  };
}

/**
 * Analyse a multi‑line text with stanza awareness.
 * Returns a list of stanza arrays, each containing the per‑line results.
 */

/**
 * Continuity rename (maintainer directive 2026-06-14): a line whose standalone
 * meter merely edges out the stanza/poem-dominant meter (consensusMeter set by
 * applyStanzaConsensus) ADOPTS the dominant meter as its base reading — the
 * scansion, foot count, and certainty are re-fitted under that meter — and the
 * numerically-best standalone meter is kept as a concise note
 * (`standaloneMeter`).  Metrical continuity outranks a hair of fit score.
 */
function applyContinuityRename(results: LineResult[]): void {
  // A stanza-level rhythm verdict (set on at least half the lines) means the
  // group reads as accentual/dolnik/taktovik — classical continuity renaming
  // does not apply there.
  const noted = results.filter(r => r.phonologicalScansion.rhythmNote).length;
  if (results.length > 0 && noted >= results.length / 2) return;
  for (const res of results) {
    const d = res.phonologicalScansion;
    if (!d.consensusMeter) continue;
    const family = d.consensusMeter.split(' ')[0] as MetreName;
    const forced = scoreMeters(res.keyStresses, res.sentence.words, res.phonologicalHierarchy, family);
    if (!forced || forced.meterName === 'free verse' || forced.footCount <= 0) continue;
    d.standaloneMeter = d.meter;
    d.meter = forced.meter;
    d.meterName = forced.meterName;
    d.footCount = forced.footCount;
    d.scansion = forced.scansion;
    d.certainty = forced.certainty;
    d.summary = forced.summary;
    d.consensusMeter = undefined;
  }
}

export function analyzeStanzas(text: string, useScandroid = true, engine: ProsodyEngine = activeEngine): LineResult[][] {
  const stanzas = text.split(/\n\s*\n/);
  const results: LineResult[][] = [];
  // Scandroid deduces its Metron/line-length ONCE over the WHOLE document (up
  // to a dozen sampled lines for a real multi-line poem; a per-line decision
  // for a single typed line) — exactly Hartman's own "loaded document" vs
  // "typed line" distinction — so this runs across stanza breaks, not per
  // stanza.  Independent of everything else computed below: raw text in,
  // Scandroid's own verdict out.
  const allRawLines = stanzas.flatMap(st => st.split('\n').filter(l => l.trim() !== ''));
  const nativeResults = useScandroid ? scanTextNatively(allRawLines) : [];
  let nativeIdx = 0;
  for (const stanza of stanzas) {
    const lines = stanza.split('\n').filter(l => l.trim() !== '');
    const stanzaResults: LineResult[] = [];
    // Parse every line first, then mark cross-line discourse givenness BEFORE the
    // per-line stress passes (relativisation reads `discourseGiven`).  Only the
    // default (Calliope) relativiser consults it; Clio ignores the flag.
    const docs = lines.map(line => parseDocument(line));
    markStanzaGivenness(docs.map(d => d.sentences));
    markRhymeFellows(docs.map(d => d.sentences));
    for (const doc of docs) {
      const res = processLine(doc.sentences, engine);
      if (res && useScandroid) res.scandroidNative = nativeResults[nativeIdx];
      nativeIdx++;
      if (res) stanzaResults.push(res);
    }
    // Resolve near-tie lines toward the stanza's dominant meter (explicit, non-
    // destructive: annotates phonologicalScansion.consensusMeter), then classify
    // non-classical rhythm (dolnik/taktovik/accentual → rhythmNote; ballad is a
    // FORM verdict and belongs to the rhyme-aware form layer).
    applyStanzaConsensus(stanzaResults.map(r => r.phonologicalScansion));
    // Classical-vs-accentual is decided FIRST (rhythm layer); continuity
    // renaming applies only where no stanza-level accentual/dolnik verdict
    // fired — otherwise the rename would snowball weak scattered classical
    // readings into false dominance (Wyatt lost its "4-beat accentual").
    applyRhythmLayer(stanzaResults.map(r => r.phonologicalScansion));
    applyContinuityRename(stanzaResults);
    results.push(stanzaResults);
  }
  // Poem-scale continuity: lines left un-renamed (their own stanza had no
  // unique dominant) get a second chance against the poem-wide dominant.
  if (results.length > 1) {
    const all = results.flat();
    applyStanzaConsensus(all.map(r => r.phonologicalScansion));
    applyContinuityRename(all);
    for (const st of results) applyRhythmLayer(st.map(r => r.phonologicalScansion));
  }
  // Prose-likeness hedge (Option 0): advisory, runs after the rhythm layer so it
  // can defer to any accentual/dolnik verdict; annotation-only (metricalityNote).
  applyMetricalityLayer(results.flatMap(st => st.map(r => r.phonologicalScansion)));
  // Rhyme scheme + poetic-form identification spans stanzas (sonnets, terza
  // rima); annotation-only (rhyme/formNote on each line's detail).
  applyRhymeAndForm(results);
  return results;
}

/**
 * Convenience wrapper: analyse a multi‑line text, ignore stanza breaks,
 * return a flat list of LineResult for each line.
 */
export function analyzeText(text: string, useScandroid = true, engine: ProsodyEngine = activeEngine): LineResult[] {
  const stanzaResults = analyzeStanzas(text, useScandroid, engine);
  return stanzaResults.flat();
}

/**
 * Analyse a document for the reading view: like analyzeStanzas, but retains
 * each original input line alongside its (1+) parsed sentence results so the
 * stress gradient can be projected back over the verbatim text.
 */
export function analyzeReadingDocument(text: string, engine: ProsodyEngine = activeEngine): ReadingStanza[] {
  const stanzas = text.split(/\n\s*\n/);
  const out: ReadingStanza[] = [];
  // See analyzeStanzas: Scandroid deduces Metron/line-length once over the
  // whole document, spanning stanza breaks.
  const allRawLines = stanzas.flatMap(st => st.split('\n').filter(l => l.trim() !== ''));
  const nativeResults = scanTextNatively(allRawLines);
  let nativeIdx = 0;
  for (const stanza of stanzas) {
    const rawLines = stanza.split('\n').filter(l => l.trim() !== '');
    if (rawLines.length === 0) continue;
    const rawDocs = rawLines.map(raw => ({ raw, doc: parseDocument(raw) }));
    markStanzaGivenness(rawDocs.map(rd => rd.doc.sentences));
    markRhymeFellows(rawDocs.map(rd => rd.doc.sentences));
    const lines = rawDocs.map(({ raw, doc }) => {
      const res = processLine(doc.sentences, engine);
      if (res) res.scandroidNative = nativeResults[nativeIdx];
      nativeIdx++;
      return { raw, results: res ? [res] : [] };
    });
    applyStanzaConsensus(lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
    applyRhythmLayer(lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
    applyContinuityRename(lines.flatMap(l => l.results));
    out.push({ lines });
  }
  if (out.length > 1) {
    const all = out.flatMap(st => st.lines.flatMap(l => l.results));
    applyStanzaConsensus(all.map(r => r.phonologicalScansion));
    applyContinuityRename(all);
    for (const st of out) applyRhythmLayer(st.lines.flatMap(l => l.results.map(r => r.phonologicalScansion)));
  }
  applyMetricalityLayer(out.flatMap(st => st.lines.flatMap(l => l.results.map(r => r.phonologicalScansion))));
  applyRhymeAndForm(out.map(st => st.lines.flatMap(l => l.results)));
  return out;
}

// ─── CLI HELPERS ────────────────────────────────────────────────

function showResults(text: string): void {
  // Use the reading-document analysis so each LineResult keeps its verbatim input
  // line (for the tail Reading Projection) and the stanza-consensus annotation.
  // Clio routes through its own frozen pipeline + renderer.
  const isClio = activeEngine.name === 'clio';
  const stanzas = (isClio ? analyzeReadingDocumentClio : analyzeReadingDocument)(text);
  const render = isClio ? clioRenderUnifiedDisplay : renderUnifiedDisplay;

  for (let s = 0; s < stanzas.length; s++) {
    if (stanzas.length > 1) {
      console.log('\n' + chalk.bold('═══ Stanza ' + (s + 1) + ' ═══'));
    }
    for (const ln of stanzas[s].lines) {
      for (const res of ln.results) {
        console.log(render(res, ln.raw));
      }
    }
  }
}

function showReadingView(text: string): void {
  const isClio = activeEngine.name === 'clio';
  const stanzas = (isClio ? analyzeReadingDocumentClio : analyzeReadingDocument)(text);
  console.log((isClio ? clioRenderReadingView : renderReadingView)(stanzas));
}

// ─── MULTI-LINE INPUT (paste-friendly) ──────────────────────────
// Goal: the user pastes a whole poem (stanza breaks and all) and presses Enter
// ONCE to scan it; Esc returns to the menu.  The trick is distinguishing a blank
// line that is a *stanza break* (part of the pasted burst) from a blank line that
// means *"I'm done"* (a deliberate, later keystroke).  A paste streams in as one
// rapid burst (sub-ms between lines); a human Enter comes after a real pause.  So
// once a burst has been seen, the next Enter that arrives after an idle gap
// submits — flushing the current line whether or not the paste ended in a newline.
// The pure decision below is unit-tested (a TTY can't be driven from CI).

export const ML_IDLE_MS = 120;

export type MLEvent =
  | { kind: 'char'; str: string; gap: number }
  | { kind: 'return'; gap: number }
  | { kind: 'backspace'; gap: number }
  | { kind: 'escape' }
  | { kind: 'eof' };

export interface MLState { lines: string[]; cur: string; sawBurst: boolean; }
export type MLResult = 'continue' | 'submit' | 'cancel';

export function newMLState(): MLState { return { lines: [], cur: '', sawBurst: false }; }

function mlHasContent(st: MLState): boolean {
  return st.cur.trim() !== '' || st.lines.some(l => l.trim() !== '');
}

/**
 * Fold one input event into the multi-line buffer, returning whether to keep
 * reading ('continue'), scan the buffer ('submit'), or abandon it ('cancel').
 *  • A burst-speed Enter (gap < ML_IDLE_MS) is always a line break — so pasted
 *    stanza-break blank lines are preserved.
 *  • After a burst, the first idle Enter submits (flushing any pending line).
 *  • With no burst (slow hand-typing), a non-empty line + Enter is a line break and
 *    a blank line submits — the conventional "blank line to finish".
 *  • Esc cancels (→ menu); Ctrl-D submits whatever is there.
 */
export function feedMultilineEvent(st: MLState, ev: MLEvent): MLResult {
  switch (ev.kind) {
    case 'escape':
      return 'cancel';
    case 'eof':
      if (st.cur.length) { st.lines.push(st.cur); st.cur = ''; }
      return mlHasContent(st) ? 'submit' : 'cancel';
    case 'backspace':
      if (st.cur.length) st.cur = st.cur.slice(0, -1);
      return 'continue';
    case 'char': {
      if (ev.gap < ML_IDLE_MS) st.sawBurst = true;
      // A pasted chunk may arrive with embedded newlines in one event.
      const parts = ev.str.split(/\r\n|\r|\n/);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) { st.lines.push(st.cur); st.cur = ''; }
        st.cur += parts[i];
      }
      return 'continue';
    }
    case 'return': {
      if (ev.gap < ML_IDLE_MS) {           // burst-speed → a line break (keep blanks)
        st.sawBurst = true;
        st.lines.push(st.cur); st.cur = '';
        return 'continue';
      }
      // Deliberate (idle) Enter.
      if (st.sawBurst || st.cur.trim() === '') {
        if (st.cur.length) { st.lines.push(st.cur); st.cur = ''; }
        return mlHasContent(st) ? 'submit' : 'continue';
      }
      // Slow hand-typing of a fresh non-empty line → just a line break.
      st.lines.push(st.cur); st.cur = '';
      return 'continue';
    }
  }
}

/** Strip trailing blank lines (e.g. a paste's trailing newline) from a buffer. */
function trimTrailingBlanks(lines: string[]): string[] {
  const out = lines.slice();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/**
 * Read a pasteable multi-line block from the TTY in raw mode (so Esc and the
 * paste-burst timing are observable).  Resolves to the lines, or null if the user
 * pressed Esc (→ return to menu).
 */
async function readPastableBlock(): Promise<string[] | null> {
  const stdin = process.stdin;
  return new Promise<string[] | null>((resolve) => {
    const st = newMLState();
    let lastTime = Date.now();
    readline.emitKeypressEvents(stdin);
    const wasRaw = !!(stdin as any).isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    const onKey = (str: string | undefined, key: any) => {
      const now = Date.now();
      const gap = now - lastTime;
      lastTime = now;
      key = key || {};
      if (key.ctrl && key.name === 'c') {                  // Ctrl-C → quit
        cleanup(); process.stdout.write('\n'); process.exit(0);
      }
      let ev: MLEvent | null = null;
      if (key.name === 'escape') ev = { kind: 'escape' };
      else if (key.ctrl && key.name === 'd') ev = { kind: 'eof' };
      else if (key.name === 'return' || key.name === 'enter') ev = { kind: 'return', gap };
      else if (key.name === 'backspace') ev = { kind: 'backspace', gap };
      else if (str && !key.ctrl && !key.meta) ev = { kind: 'char', str, gap };
      if (!ev) return;                                     // ignore arrows / fn keys
      // Echo (raw mode does not echo for us).
      if (ev.kind === 'char') process.stdout.write(str!);
      else if (ev.kind === 'return') process.stdout.write('\n');
      else if (ev.kind === 'backspace' && st.cur.length) process.stdout.write('\b \b');

      const result = feedMultilineEvent(st, ev);
      if (result === 'submit') { cleanup(); process.stdout.write('\n'); resolve(st.lines); }
      else if (result === 'cancel') { cleanup(); process.stdout.write('\n'); resolve(null); }
    };

    function cleanup() {
      stdin.removeListener('keypress', onKey);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
    }
    stdin.on('keypress', onKey);
  });
}

async function replMode(): Promise<void> {
  const prompts = (await import('prompts')).default;

  console.log('');
  console.log(chalk.bold('     CALLIOPE_TS — Phonological Poetry Scansion (CLI)  '));
  console.log(chalk.dim('• Multi-Step Syntactic, Phonological, & Prosodic Analysis •'));
  console.log('');

  let running = true;
  while (running) {
    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'Choose an action:',
      choices: [
        { title: 'Parse & Scan (multi-line reading view)', value: 'reading-multi' },
        { title: 'Single Line Analysis (detailed view)', value: 'scan' },
        { title: 'Line-by-Line Analysis (detailed view)', value: 'multiline' },
        { title: 'Parse & Scan from File (reading view)', value: 'reading-file' },
        { title: 'Analyze from File (detailed view)', value: 'file' },
        { title: 'Ask Clio instead (alternative parse) — toggle engine', value: 'engine' },
        { title: 'Display Legend', value: 'legend' },
        { title: 'Exit', value: 'exit' },
      ],
    });

    if (!response.action || response.action === 'exit') {
      running = false;
      console.log(chalk.dim('\nGoodbye.\n'));
      break;
    }

    if (response.action === 'engine') {
      // Toggle between Calliope (faithful, default) and Clio (the legacy /
      // alternative parse).  Clio is Calliope's historian sister — sometimes
      // on point, but not the primary poetic voice.
      activeEngine = activeEngine.name === 'calliope' ? clioEngine : calliopeEngine;
      const label = activeEngine.name === 'clio'
        ? 'Clio — legacy / alternative parse'
        : 'Calliope — faithful, default';
      console.log(chalk.dim(`\n  Active engine: ${chalk.bold(label)}\n`));
      continue;
    }

    if (response.action === 'legend') {
      const legend = activeEngine.name === 'clio' ? clioRenderFullLegend : renderFullLegend;
      console.log('\n' + legend() + '\n');
      continue;
    }

    if (response.action === 'scan') {
      const lineResponse = await prompts({
        type: 'text',
        name: 'line',
        message: 'Enter a line of verse:',
      });
      if (lineResponse.line && lineResponse.line.trim()) {
        try {
          showResults(lineResponse.line.trim());
        } catch (err) {
          console.error(chalk.red('Error during scansion:'), err);
        }
      }
      continue;
    }

    if (response.action === 'file' || response.action === 'reading-file') {
      const render = response.action === 'reading-file' ? showReadingView : showResults;
      const fileResponse = await prompts({
        type: 'text',
        name: 'path',
        message: 'Enter file path:',
      });
      if (fileResponse.path && fileResponse.path.trim()) {
        try {
          const text = fs.readFileSync(fileResponse.path.trim(), 'utf-8');
          render(text);
        } catch (err) {
          console.error(chalk.red('Error reading file:'), err);
        }
      }
      continue;
    }

    if (response.action === 'multiline' || response.action === 'reading-multi') {
      const render = response.action === 'reading-multi' ? showReadingView : showResults;
      console.log(chalk.dim('Paste your poem and press Enter to scan it.   (Esc to cancel)'));
      const block = await readPastableBlock();
      if (block === null) continue;          // Esc → back to the menu
      const lines = trimTrailingBlanks(block);
      if (lines.length > 0) {
        try {
          render(lines.join('\n'));
        } catch (err) {
          console.error(chalk.red('Error during scansion:'), err);
        }
      }
      continue;
    }
  }
}

// ─── PARSE-AUDIT DIAGNOSTIC ──────────────────────────────────────
//
// `--debug-parse` dumps, per word, the full chain the scansion rests on: POS
// tag, dependency role + governor, prosodic membership (IU.PP.CP), and the
// lexical / phrase / relative stress.  This is the audit instrument for the
// POS + dependency + correction layers — read alongside trials/parse_audit.mjs,
// which tabulates tag/dependency distributions and anomalies over a corpus.
function debugParse(text: string): void {
  // Clio audits through its own frozen parser; Calliope through the live one.
  const isClio = activeEngine.name === 'clio';
  const parse = isClio ? clioParseDocument : parseDocument;
  const isPunct = isClio ? clioIsPunctuation : isPunctuation;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const doc = parse(line);
    console.log('\n' + chalk.bold.cyan('› ' + line));
    for (const sent of doc.sentences) {
      // Route the audit dump through the active engine so --debug-parse reflects
      // whichever engine (Calliope / Clio) is selected.
      const ius = activeEngine.analyzeSentence(sent);
      const loc = new Map<ClsWord, string>();
      ius.forEach((iu, ii) =>
        iu.phonologicalPhrases.forEach((pp, pi) =>
          pp.cliticGroups.forEach((cg, ci) =>
            cg.tokens.forEach(t => loc.set(t, `${ii + 1}.${pi + 1}.${ci + 1}`)))));
      console.log(chalk.dim('  word         POS    C/F  dep            ←governor     IU.PP.CP  lex   phr  rel   canon      name'));
      for (const w of sent.words) {
        if (isPunctuation(w.lexicalClass)) continue;
        const d = w.dependency;
        const gov = d && d.governor ? d.governor.word : '—';
        const cf = w.isContent ? 'C' : 'f';
        const lex = w.syllables.map(s => (s.lexicalStress ?? s.stress)).join('');
        const rel = w.syllables.map(s => s.relativeStress).join('');
        // Calliope substrate (Stage 1): normalised relation + person/place flags.
        const canon = w.canonicalRel ?? '-';
        const name = w.isPersonName && w.isPlaceName ? 'P+C'
          : w.isPersonName ? 'person' : w.isPlaceName ? 'place' : '';
        console.log('  ' + w.word.padEnd(12) + w.lexicalClass.padEnd(6) + ' ' + cf + '   '
          + (d ? d.dependentType : '?').padEnd(14) + ' ' + String(gov).padEnd(13) + ' '
          + (loc.get(w) ?? '-').padEnd(9) + ' ' + lex.padEnd(5) + ' '
          + String(w.phraseStress).padEnd(4) + ' ' + rel.padEnd(5) + ' '
          + canon.padEnd(10) + ' ' + name);
      }
    }
  }
}

// ─── CLI ENTRY POINT ─────────────────────────────────────────────

async function main(): Promise<void> {
  let rawArgs = process.argv.slice(2);
  // --reading / -r : emit the compact reading view (poem in original formatting,
  // syllables stress-coloured, + per-line stress maps) instead of the full dump.
  const reading = rawArgs.includes('--reading') || rawArgs.includes('-r');
  rawArgs = rawArgs.filter(a => a !== '--reading' && a !== '-r');
  // --debug-parse : dump the per-word POS / dependency / prosody / stress chain.
  const debugParseMode = rawArgs.includes('--debug-parse');
  rawArgs = rawArgs.filter(a => a !== '--debug-parse');
  // --clio : run the frozen legacy / alternative parse engine instead of the
  // default faithful Calliope engine.
  if (rawArgs.includes('--clio')) activeEngine = clioEngine;
  rawArgs = rawArgs.filter(a => a !== '--clio');
  const show = debugParseMode ? debugParse : reading ? showReadingView : showResults;

  // Explicit arguments take precedence over piped stdin — otherwise running
  // `calliope_ts "some line"` from a script/CI (where stdin is a non-TTY but
  // empty) silently analysed the empty pipe and ignored the argument.
  if (rawArgs.length > 0) {
    // Check if first arg is a file
    const firstArg = rawArgs[0];
    if (fs.existsSync(firstArg) && fs.statSync(firstArg).isFile()) {
      const text = fs.readFileSync(firstArg, 'utf-8');
      show(text);
      return;
    }
    // Otherwise treat as text input
    const text = rawArgs.join(' ');
    show(text);
    return;
  }

  // No arguments: piped input (file redirect / heredoc) is the document.
  if (!process.stdin.isTTY) {
    const text = fs.readFileSync(0, 'utf-8');
    show(text);
    return;
  }

  // No arguments: launch interactive REPL
  await replMode();
}

// Is this module being run directly as the CLI, or imported as a library?
// A plain `process.argv[1] === fileURLToPath(import.meta.url)` check breaks under
// `npm install -g`: npm invokes us through a symlink in its bin directory, so
// process.argv[1] is that symlink's path, not the real dist/index.js. The two
// never match, `main()` never fires, and the command exits silently. Resolve
// symlinks on BOTH sides before comparing so the global command actually runs.
let isMain = false;
if (process.argv[1]) {
  try {
    isMain = fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isMain = false;
  }
}
if (isMain) {
  main().catch(err => {
    console.error(chalk.red('Fatal error:'), err);
    process.exit(1);
  });
}