#!/usr/bin/env node
// Calliope TS — web app server.
// Serves the static front-end from webapp/public and exposes the full analysis
// pipeline as structured JSON at POST /api/analyze.  All the information the
// CLI's Reading and Detailed views print (plus the raw UDPipe / nounsing-pro
// substrates) is serialized here so the browser can render it interactively.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeReadingDocument } from '../dist/index.js';
import { analyzeReadingDocumentClio } from '../dist/clio/pipeline.js';
import { isPunctuation } from '../dist/parser.js';
import { syllabifyWord, syllableVowelLengths, vowelLengthOf } from '../dist/phonological.js';
import { computeCaesurae } from '../dist/caesura.js';
import { buildFabbHalleGrid } from '../dist/fabbhalle.js';
import { computeBoundaries } from '../dist/calliope/boundaries.js';
import { summarizePoem, analyzePhonopoetics } from '../dist/rhyme.js';
import * as nounsing from 'nounsing-pro';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4321);

// ─── Serialization helpers ──────────────────────────────────────────────

const normWordForm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

/** Non-punctuation, syllable-bearing words across a line's results, in order. */
function collectLineWords(ln) {
  const ws = [];
  for (const res of ln.results) {
    for (const w of res.sentence.words) {
      if (!isPunctuation(w.lexicalClass) && w.syllables.length > 0) ws.push(w);
    }
  }
  return ws;
}

/** Orthographic syllable chunks for a token, aligned to its word's syllables.
 *  Mirrors display.ts colourToken(): fast path when the syllabifier's chunks
 *  reconstruct the token exactly; otherwise walk the token char-by-char. */
function chunkToken(tokenText, word) {
  const sylCount = Math.max(1, word.syllables.length);
  const chunks = syllabifyWord(
    tokenText, sylCount, syllableVowelLengths(word.syllables),
    word.morphSuffix, word.morphPrefix,
  );
  if (chunks.join('') === tokenText) {
    return chunks.map((c, i) => ({ text: c, si: Math.min(i, word.syllables.length - 1) }));
  }
  // Fallback: assign each original character to a syllable by chunk lengths.
  const lens = chunks.map(c => c.length);
  const out = [];
  let ci = 0, consumed = 0;
  const push = (ch, si) => {
    const last = out[out.length - 1];
    if (last && last.si === si) last.text += ch;
    else out.push({ text: ch, si });
  };
  for (const ch of tokenText) {
    if (ch === '-') { push(ch, Math.min(ci, word.syllables.length - 1)); continue; }
    while (ci < lens.length - 1 && consumed >= lens[ci]) { ci++; consumed = 0; }
    push(ch, Math.min(ci, word.syllables.length - 1));
    consumed++;
  }
  return out;
}

/** Structural port of projectStressOntoLine(): the verbatim raw line split into
 *  gap segments (spaces, punctuation — emitted untouched) and word segments
 *  (chunked into syllables, each chunk pointing at its word + syllable). */
function buildSegments(rawLine, words) {
  const tokenRe = /[A-Za-z\u00C0-\u024F]+(?:['’\-][A-Za-z\u00C0-\u024F]+)*/g;  // accented Latin included (Milésien)
  const segments = [];
  let cursor = 0, wi = 0, m;
  const pushGap = (text) => { if (text) segments.push({ t: 'gap', text }); };
  while ((m = tokenRe.exec(rawLine)) !== null) {
    const start = m.index, end = start + m[0].length;
    pushGap(rawLine.slice(cursor, start));
    cursor = end;
    const token = m[0];
    const tokNorm = normWordForm(token);
    const matches = (w) => {
      if (!w) return false;
      const wn = normWordForm(w.word);
      return wn.length > 0 && (tokNorm === wn || tokNorm.startsWith(wn));
    };
    let matched = -1;
    if (matches(words[wi])) matched = wi;
    else {
      for (let k = wi; k < Math.min(words.length, wi + 4); k++) {
        if (matches(words[k])) { matched = k; break; }
      }
    }
    if (matched >= 0) {
      segments.push({ t: 'word', w: matched, chunks: chunkToken(token, words[matched]) });
      wi = matched + 1;
    } else {
      pushGap(token);
    }
  }
  pushGap(rawLine.slice(cursor));
  return segments;
}

/** Fine-grained syllable phonology derived from the ARPAbet transcription:
 *  onset geometry, nucleus type, rime structure, coda status. */
const ARPA_VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)/;
const ARPA_DIPH = new Set(['AY', 'AW', 'OY', 'EY', 'OW']);
function sylPhonology(phonesStr) {
  const toks = String(phonesStr ?? '').replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean);
  const vIdx = toks.findIndex(t => ARPA_VOWEL.test(t));
  if (vIdx < 0) return null;
  const onsetN = vIdx;
  const codaN = toks.length - vIdx - 1;
  const vowel = toks[vIdx].replace(/\d/g, '');
  const isDiph = ARPA_DIPH.has(vowel);
  let long = isDiph;
  try { if (vowelLengthOf(phonesStr) === 'long') long = true; } catch { /* keep */ }
  const rime = codaN === 0 ? (long ? '-VV' : '-V')
    : long ? (codaN >= 2 ? '-TCC' : '-TC')
    : (codaN >= 2 ? '-LCC' : '-LC');
  return {
    onset: onsetN === 0 ? '0' : 'C'.repeat(Math.min(3, onsetN)),
    nucleus: isDiph ? 'diphthong' : 'monophthong',
    vlen: long ? 'long' : 'short',
    codaC: codaN,
    open: codaN === 0,
    rime,
  };
}
const SYL_POSITION = ['final', 'penult', 'antepenult', 'preantepenult'];

function serializeWord(w, idx, firstSyl) {
  const dep = w.dependency;
  // Orthographic syllable chunks for display (syl.text from the dictionary is
  // phone-based); group the token chunking by syllable index.
  const display = w.displayWord ?? w.word;
  const orth = new Array(w.syllables.length).fill('');
  try {
    for (const c of chunkToken(display, w)) orth[c.si] = (orth[c.si] ?? '') + c.text;
  } catch { /* fall back to phone text below */ }
  return {
    i: idx,
    text: w.displayWord ?? w.word,
    norm: w.word,
    pos: w.lexicalClass,
    isContent: !!w.isContent,
    phraseStress: w.phraseStress ?? 0,
    feats: w.featsMap && Object.keys(w.featsMap).length ? w.featsMap : null,
    canonicalRel: w.canonicalRel ?? null,
    dep: dep ? {
      rel: dep.dependentType,
      isRoot: dep.governorIndex === 0 || dep.dependentType === 'root',
      govWord: dep.governor?.word ?? null,
      govIndex: dep.governorIndex,
    } : null,
    flags: {
      person: !!w.isPersonName,
      place: !!w.isPlaceName,
      given: !!w.discourseGiven,
      coordGiven: !!w.coordinateGiven,
    },
    morph: (w.morphPrefix || w.morphSuffix)
      ? { prefix: w.morphPrefix ?? null, suffix: w.morphSuffix ?? null } : null,
    firstSyl,
    syls: w.syllables.map((s, si) => ({
      si,
      text: orth[si] || s.text,
      phones: s.phones,
      weight: s.weight ?? null,
      lex: s.lexicalStress ?? s.stress,
      boosted: s.stress,
      rel: s.relativeStress ?? 'w',
      extrametrical: s.extrametrical ?? null,
      pos: SYL_POSITION[Math.min(3, w.syllables.length - 1 - si)],
      ph: sylPhonology(s.phones),
    })),
  };
}

/** Map each display word to its IU.PP.CP membership in the prosodic hierarchy. */
function hierarchyMembership(ius, words) {
  const loc = new Map();
  ius.forEach((iu, ii) =>
    iu.phonologicalPhrases.forEach((pp, pi) =>
      pp.cliticGroups.forEach((cg, ci) =>
        cg.tokens.forEach(t => loc.set(t, { iu: ii, pp: pi, cp: ci })))));
  return words.map(w => loc.get(w) ?? null);
}

/** Serialize the hierarchy as nested word-index lists (IU → PP → CP). */
function serializeHierarchy(ius, words) {
  const indexOf = new Map(words.map((w, i) => [w, i]));
  return ius.map(iu => ({
    pps: iu.phonologicalPhrases.map(pp => ({
      cps: pp.cliticGroups.map(cg =>
        cg.tokens.map(t => indexOf.get(t)).filter(i => i !== undefined)),
    })),
  }));
}

/** Align scansion feet to global syllable indices (display.ts Layer 6 logic). */
function serializeFeet(scansion, totalSyls) {
  const isSylChar = (ch) => 'xXwWnNmMsS'.includes(ch);
  const feet = [];
  let sylIdx = 0;
  for (const rawFoot of scansion.split('|')) {
    const cells = [];
    for (const ch of rawFoot) {
      if (ch === '-') { cells.push({ silent: true }); continue; }
      if (!isSylChar(ch)) continue;
      if (sylIdx < totalSyls) cells.push({ s: sylIdx++, mark: ch.toLowerCase() });
    }
    feet.push({ pattern: rawFoot, cells });
  }
  return feet;
}

function serializeDetail(d) {
  if (!d) return null;
  return {
    meter: d.meter,
    meterName: d.meterName,
    footCount: d.footCount,
    scansion: d.scansion,
    certainty: d.certainty,
    summary: d.summary,
    ranking: (d.ranking ?? []).map(r => ({ meter: r.meter, score: Number(r.score.toFixed(3)) })),
    standaloneMeter: d.standaloneMeter ?? null,
    consensusMeter: d.consensusMeter ?? null,
    rhythmNote: d.rhythmNote ?? null,
    metricalityNote: d.metricalityNote ?? null,
    formNote: d.formNote ?? null,
    rhyme: d.rhyme ? {
      endWord: d.rhyme.endWord,
      letter: d.rhyme.letter,
      type: d.rhyme.type ?? null,
      matchedLine: d.rhyme.matchedLine ?? null,
      notation: d.rhyme.notation ?? null,
      internal: (d.rhyme.internal ?? []).map(iw => ({
        word: iw.word, letter: iw.letter, type: iw.type ?? null,
      })),
    } : null,
  };
}

function serializeLine(ln) {
  const res = ln.results[0];
  if (!res) return { raw: ln.raw, parsed: false };

  const words = collectLineWords(ln);
  let firstSyl = 0;
  const serWords = words.map((w, i) => {
    const sw = serializeWord(w, i, firstSyl);
    firstSyl += w.syllables.length;
    return sw;
  });
  const totalSyls = firstSyl;

  // Flat global syllable list (word order — the scansion domain's order).
  const syllables = [];
  serWords.forEach(sw => sw.syls.forEach(s => syllables.push({
    w: sw.i, si: s.si, text: s.text, phones: s.phones, weight: s.weight,
    lex: s.lex, rel: s.rel,
  })));

  const ius = res.phonologicalHierarchy;
  const allWords = res.sentence.words;

  let boundaries = null;
  try {
    const b = computeBoundaries(allWords, ius);
    boundaries = {
      phi: b.phi.map(x => ({ strength: x.strength, syl: x.syllableIndex })),
      iota: b.iota.map(x => ({ strength: x.strength, syl: x.syllableIndex })),
    };
  } catch { /* clio lines may lack substrate for graded boundaries */ }

  let caesurae = [];
  try {
    caesurae = [...computeCaesurae(allWords, ius, res.phonologicalScansion.scansion)]
      .map(([after, info]) => ({ after, kind: info.kind, strength: info.strength }));
  } catch { /* non-fatal */ }

  const deps = serWords
    .filter(sw => sw.dep)
    .map(sw => {
      const govIdx = sw.dep.isRoot ? -1
        : serWords.findIndex(o => words[o.i].index === sw.dep.govIndex
            && words[o.i] === (words[sw.i].dependency?.governor ?? null));
      // Prefer object identity; fall back to name match when identity fails.
      let to = govIdx;
      if (to === -1 && !sw.dep.isRoot) {
        to = words.findIndex(w => w === words[sw.i].dependency?.governor);
      }
      return { from: sw.i, to: sw.dep.isRoot ? -1 : to, rel: sw.dep.rel };
    });

  return {
    raw: ln.raw,
    parsed: true,
    segments: buildSegments(ln.raw, words),
    words: serWords,
    syllables,
    hierarchy: serializeHierarchy(ius, words),
    unitOf: hierarchyMembership(ius, words),
    boundaries,
    caesurae,
    keyStresses: (res.keyStresses ?? []).map(k => ({
      unitType: k.unitType, pattern: k.pattern, weight: k.weight, positions: k.positions,
    })),
    feet: serializeFeet(res.phonologicalScansion.scansion, totalSyls),
    detail: serializeDetail(res.phonologicalScansion),
    // Charles Hartman's Scandroid (2005), run as a fully independent second
    // opinion: its own dictionary, syllabifier, and algorithms, working only
    // from the raw line text.
    scandroid: (() => {
      const sn = res.scandroidNative;
      if (!sn) return null;
      const serFoot = f => f ? {
        algorithm: f.algorithm, scanString: f.scanString, marksString: f.marksString,
        substitutions: f.substitutions, ok: f.ok, failReason: f.failReason ?? null,
      } : null;
      return {
        metronName: sn.metronName,
        lineLengthName: sn.lineLengthName,
        lineFeetSet: sn.lineFeetSet,
        verdict: serFoot(sn.verdict),
        corralTheWeird: serFoot(sn.corralTheWeird ?? null),
        maximizeTheNormal: serFoot(sn.maximizeTheNormal ?? null),
        promotions: sn.promotions,
      };
    })(),
    // Fabb–Halle bracketed grid (Meter in Poetry, 2008) — an independent
    // second-opinion scansion computed from the line's FINAL meter name;
    // null when the meter has no F&H rule set (accentual, free verse).
    fabbHalle: (() => {
      try {
        const perWord = new Map();
        syllables.forEach(s => perWord.set(s.w, (perWord.get(s.w) ?? 0) + 1));
        const fhSyls = syllables.map(s => ({
          text: s.text, lex: s.lex ?? 0, poly: (perWord.get(s.w) ?? 1) > 1,
        }));
        const d = res.phonologicalScansion;
        const fh = buildFabbHalleGrid(fhSyls, d.meter || '', d.footCount);
        return fh ? {
          rule: fh.ruleLabel, rows: fh.rows,
          maxima: fh.maxima, violations: fh.violations, metrical: fh.metrical,
          looseFeet: fh.looseFeet ?? null,
        } : null;
      } catch { return null; }
    })(),
    deps,
  };
}

/** Enjambment summary — port of display.ts summariseEnjambment(). */
function lineRunsOn(raw) {
  const t = raw.replace(/["'’”»)\]]+$/, '').trimEnd();
  if (!t) return false;
  return !/[.!?;:,—–…]$/.test(t);
}
function summariseEnjambment(stanzas) {
  const raws = stanzas.flatMap(st => st.lines.map(l => l.raw));
  if (raws.length < 2) return null;
  const interior = raws.slice(0, -1);
  const enjambed = [];
  interior.forEach((r, i) => { if (lineRunsOn(r)) enjambed.push(i + 1); });
  const n = interior.length, k = enjambed.length;
  if (k === 0) return 'end-stopped throughout';
  const where = k <= 6 ? ' (lines ' + enjambed.join(', ') + ')' : '';
  return k >= Math.ceil(n / 2)
    ? `predominantly enjambed — ${k} of ${n} line-ends run on${where}`
    : `mostly end-stopped — ${k} of ${n} line-ends enjambed${where}`;
}

function analyze(text, engine) {
  const t0 = Date.now();
  const stanzas = engine === 'clio'
    ? analyzeReadingDocumentClio(text)
    : analyzeReadingDocument(text);

  const resultStanzas = stanzas.map(st => {
    const firstDetail = st.lines.flatMap(l => l.results)[0]?.phonologicalScansion;
    return {
      formNote: firstDetail?.formNote ?? null,
      lines: st.lines.map(serializeLine),
    };
  });

  const grouped = stanzas.map(st => st.lines.flatMap(l => l.results));
  let synopsis = [];
  let phonopoetics = null;
  try { synopsis = summarizePoem(grouped); } catch { /* non-fatal */ }
  try {
    const p = analyzePhonopoetics(grouped);
    phonopoetics = {
      endScheme: p.endScheme,
      end: p.end, caesural: p.caesural, head: p.head,
      alliteration: p.alliteration, acrostics: p.acrostics,
    };
  } catch { /* non-fatal */ }

  return {
    engine: engine === 'clio' ? 'clio' : 'calliope',
    elapsedMs: Date.now() - t0,
    stanzas: resultStanzas,
    synopsis,
    enjambment: summariseEnjambment(stanzas),
    phonopoetics,
  };
}

/** The Nounsing Pro dossier for one word: deep morpho-phonological data from
 *  the augmented CMU lexicon.  Every probe is optional — OOV words return
 *  whatever survives. */
function wordDossier(raw) {
  const word = String(raw).toLowerCase().replace(/[^a-z'’\-]/g, '').replace(/’/g, "'");
  const first = (fn) => { try { const r = fn(word); return Array.isArray(r) ? r[0] ?? null : r ?? null; } catch { return null; } };
  const insetsRaw = first(nounsing.metricalInsets);
  // keep only foot types actually found inside the word
  const insets = insetsRaw
    ? Object.fromEntries(Object.entries(insetsRaw).filter(([, v]) => v?.length))
    : null;
  let rhymes = [];
  try { rhymes = nounsing.rhymes(word).slice(0, 18); } catch { /* OOV */ }
  return {
    word,
    lexicon: first(nounsing.lexicon),                    // freq, pos, nsylls
    phonemics: first(nounsing.phonemics),                // phones, syllStruct, syllabification, vowelLength
    scansion: first(nounsing.scansion),                  // contour, label ("dactylic"…), weightPattern
    weights: first(nounsing.weights),                    // pattern[HL], details
    vowels: first(nounsing.vowels),
    vowelQualities: first(nounsing.vowelQualities),      // diphthongs vs monophthongs
    edges: first(nounsing.edges),                        // onset/coda geometry
    onsetParse: first(nounsing.onsetParse),              // CV structure, maximal onsets
    morphology: first(nounsing.morphology),              // prefix/suffix types, extrametrical S
    suffixShift: first(nounsing.suffixShiftPotential),
    extrametricals: first(nounsing.extrametricals),
    rhymeProfile: first(nounsing.rhymeProfile),
    codaComplexity: first(nounsing.codaComplexity),
    insets,                                              // feet hiding inside the word
    rhymes,                                              // strict perfect rhymes
  };
}

// ─── HTTP plumbing ──────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 512 * 1024) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/analyze') {
    try {
      const body = await readBody(req);
      const { text, engine } = JSON.parse(body || '{}');
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No text supplied.' }));
        return;
      }
      const lineCount = text.split('\n').filter(l => l.trim()).length;
      if (lineCount > 200) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Poem too long — please keep it under 200 lines per request.' }));
        return;
      }
      const result = analyze(text, engine);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('analyze failed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Analysis failed: ' + (err?.message ?? String(err)) }));
    }
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/api/word')) {
    try {
      const params = new URL(req.url, 'http://x').searchParams;
      const w = params.get('w') ?? '';
      if (!w.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'no word' })); return; }
      const dossier = wordDossier(w);
      const syll = Number(params.get('syll'));
      if (syll >= 1 && syll <= 8) {
        try { dossier.rhymesBySyll = nounsing.rhymeBySyllables(dossier.word, syll).slice(0, 60); }
        catch { dossier.rhymesBySyll = []; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dossier));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/api/meter')) {
    try {
      const params = new URL(req.url, 'http://x').searchParams;
      const pattern = (params.get('pattern') ?? '').replace(/[^012]/g, '');
      if (!pattern) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'pattern must be digits 0/1/2, e.g. 010' })); return; }
      let words = [];
      try { words = nounsing.meterMatch(pattern); } catch { /* none */ }
      // a stable-but-varied sample: shuffle then cap
      for (let i = words.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [words[i], words[j]] = [words[j], words[i]]; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pattern, total: words.length, words: words.slice(0, 72) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/rewrite') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const text = String(body.text ?? '').slice(0, 4000);
      if (!text.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No text supplied.' })); return; }
      const pos = Math.max(0, Math.min(3, Number(body.posPrecision ?? 1)));
      const freq = Math.max(0, Math.min(4, Number(body.freqThreshold ?? 0)));
      const mode = body.mode;
      const fn = mode === 'stress' ? nounsing.rewriteWithStressPattern
        : mode === 'rhyme' ? nounsing.rewriteWithRhymes
        : nounsing.rewriteFromFirstTwoPhones;
      // rewrite per line so verse formatting survives the transmutation
      const output = text.split('\n').map(line => line.trim() ? fn(line, pos, freq) : line).join('\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(req, res); return; }
  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  console.log(`Calliope web listening on http://localhost:${PORT}`);
  // Warm the UDPipe model so the first user request is fast.
  try { analyze('Shall I compare thee to a summer’s day?', 'calliope'); console.log('pipeline warm'); }
  catch (e) { console.error('warm-up failed:', e); }
});
