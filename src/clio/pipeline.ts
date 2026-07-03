// clio/pipeline.ts — the FROZEN Clio analysis pipeline (the "control group").
//
// This is a verbatim snapshot of index.ts's orchestration (processLine +
// applyContinuityRename + analyzeStanzas/analyzeText/analyzeReadingDocument) as it
// stood at the structure-first rebuild, wired EXCLUSIVELY to clio-local frozen
// modules (clio/parser, clio/scansion, clio/rhyme, clio/scandroid, clio/phonological,
// clio/display) and hard-wired to clioEngine.  Nothing here imports the live
// top-level pipeline, so changes to the regular (Calliope) pipeline — including the
// shared scorer — CANNOT affect Clio's output.  Clio is grounded in this tree alone.
//
// DO NOT evolve this file or any clio/* module with the Calliope rebuild.

import { parseDocument } from './parser.js';
import { renderHierarchy, renderKeyStresses } from './phonological.js';
import {
  extractKeyStresses, scoreMeters, applyStanzaConsensus, applyRhythmLayer, applyMetricalityLayer,
} from './scansion.js';
import { applyRhymeAndForm } from './rhyme.js';
import { scandroidCorralWeird, scandroidMaximizeNormal, stressToMarks } from './scandroid.js';
import { type ReadingStanza } from './display.js';
import { clioEngine } from './engine.js';
import type {
  ClsSentence, MetreName, IntonationalUnit, StressLevel, ScansionResult, LineResult,
} from '../types.js';

export type { ReadingStanza } from './display.js';
// Frozen Clio renderers + parse entry, so the CLI can render Clio output entirely
// from the clio/ tree (live display.ts changes cannot reach Clio).
export { renderUnifiedDisplay, renderReadingView, renderFullLegend } from './display.js';
export { parseDocument, isPunctuation } from './parser.js';
export { renderHierarchy, renderKeyStresses } from './phonological.js';
export { clioEngine } from './engine.js';

/** Scan one verse line (which may parse into several grammatical sentences). */
function processLine(sents: ClsSentence[]): LineResult | null {
  if (sents.length === 0) return null;

  const iusPerSent: IntonationalUnit[][] = [];
  for (const sent of sents) {
    iusPerSent.push(clioEngine.analyzeSentence(sent));
  }

  const words = sents.flatMap(s => s.words);
  const ius = iusPerSent.flat();
  let merged: ClsSentence;
  if (sents.length === 1) {
    merged = sents[0];
  } else {
    words.forEach((w, i) => { w.index = i + 1; });
    merged = {
      index: sents[0].index, nodes: null,
      dependencies: sents.flatMap(s => s.dependencies), words, xml: '',
    };
  }

  const keyStresses = extractKeyStresses(ius, words);
  const phonoDetail = scoreMeters(keyStresses, words, ius);
  phonoDetail.all = renderHierarchy(ius, words);
  phonoDetail.keyStresses = renderKeyStresses(ius, words, keyStresses);

  const stressPattern: StressLevel[] = words.flatMap(w => w.syllables.map(s => s.relativeStress ?? 'w'));
  const marks = stressToMarks(stressPattern);
  const actualFeet = phonoDetail.footCount > 0 ? phonoDetail.footCount : 5;
  const corral = scandroidCorralWeird(marks, actualFeet);
  const max = scandroidMaximizeNormal(marks, actualFeet);

  const corralResult: ScansionResult | undefined = corral.footlist.length
    ? { meter: 'iambic', scansion: corral.footlist.map(f => f.replace(/[()]/g, '')).join(' | '),
        certainty: 0, weightScore: 0, maxPossibleWeight: 0, algorithm: 'Scandroid Corral the Weird' }
    : undefined;
  const maxResult: ScansionResult | undefined = max.footlist.length
    ? { meter: 'iambic', scansion: max.footlist.map(f => f.replace(/[()]/g, '')).join(' | '),
        certainty: 0, weightScore: 0, maxPossibleWeight: 0, algorithm: 'Scandroid Maximise the Normal' }
    : undefined;

  return {
    sentence: merged, phonologicalHierarchy: ius, keyStresses,
    phonologicalScansion: phonoDetail, scandroidCorral: corralResult, scandroidMaximise: maxResult,
  };
}

function applyContinuityRename(results: LineResult[]): void {
  const noted = results.filter(r => r.phonologicalScansion.rhythmNote).length;
  if (results.length > 0 && noted >= results.length / 2) return;
  for (const res of results) {
    const d = res.phonologicalScansion;
    if (!d.consensusMeter) continue;
    const family = d.consensusMeter.split(' ')[0] as MetreName;
    const forced = scoreMeters(res.keyStresses, res.sentence.words, res.phonologicalHierarchy, family);
    if (!forced || forced.meterName === 'free verse' || forced.footCount <= 0) continue;
    d.standaloneMeter = d.meter;
    d.meter = forced.meter; d.meterName = forced.meterName; d.footCount = forced.footCount;
    d.scansion = forced.scansion; d.certainty = forced.certainty; d.summary = forced.summary;
    d.consensusMeter = undefined;
  }
}

export function analyzeStanzasClio(text: string): LineResult[][] {
  const stanzas = text.split(/\n\s*\n/);
  const results: LineResult[][] = [];
  for (const stanza of stanzas) {
    const lines = stanza.split('\n').filter(l => l.trim() !== '');
    const stanzaResults: LineResult[] = [];
    for (const line of lines) {
      const doc = parseDocument(line);
      const res = processLine(doc.sentences);
      if (res) stanzaResults.push(res);
    }
    applyStanzaConsensus(stanzaResults.map(r => r.phonologicalScansion));
    applyRhythmLayer(stanzaResults.map(r => r.phonologicalScansion));
    applyContinuityRename(stanzaResults);
    results.push(stanzaResults);
  }
  if (results.length > 1) {
    const all = results.flat();
    applyStanzaConsensus(all.map(r => r.phonologicalScansion));
    applyContinuityRename(all);
    for (const st of results) applyRhythmLayer(st.map(r => r.phonologicalScansion));
  }
  applyMetricalityLayer(results.flatMap(st => st.map(r => r.phonologicalScansion)));
  applyRhymeAndForm(results);
  return results;
}

export function analyzeTextClio(text: string): LineResult[] {
  return analyzeStanzasClio(text).flat();
}

export function analyzeReadingDocumentClio(text: string): ReadingStanza[] {
  const stanzas = text.split(/\n\s*\n/);
  const out: ReadingStanza[] = [];
  for (const stanza of stanzas) {
    const rawLines = stanza.split('\n').filter(l => l.trim() !== '');
    if (rawLines.length === 0) continue;
    const lines = rawLines.map(raw => {
      const doc = parseDocument(raw);
      const res = processLine(doc.sentences);
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
