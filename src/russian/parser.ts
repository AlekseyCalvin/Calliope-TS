// parser.ts — Russian UDPipe wrapper.
// Uses udpipe-node/wasm with the Russian SynTagRus model, producing RuTokens
// with UPOS tags, morphological features, and dependency relations.
//
// Unlike the English parser (src/parser.ts), this works with UPOS tags
// directly — the Russian UDPipe model does not produce XPOS (Penn Treebank).

import { createUDPipe } from 'udpipe-node/wasm';
import type { UDSentence } from 'udpipe-node';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { CONTENT_UPOS, PUNCT_UPOS, type RuToken } from './types.js';
import { russianDataFile } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _nlp: ReturnType<typeof createUDPipe> | null = null;

const MODEL_FILE = 'russian-syntagrus-ud-2.0-170801.udpipe';

function findModel(): string | undefined {
  // 1. Explicit env var (a full path to the .udpipe file).
  if (process.env.CALLIOPE_RUSSIAN_UDPIPE_MODEL) {
    return process.env.CALLIOPE_RUSSIAN_UDPIPE_MODEL;
  }
  // 2. The shared data-root search (src/ or dist/ layouts, $CALLIOPE_RUSSIAN_DATA,
  //    HF/Docker src-only layout) — the canonical location for the bundled model.
  const bundled = russianDataFile(MODEL_FILE);
  if (bundled) return bundled;
  // 3. Dev-checkout fallbacks: this repo sitting inside or beside a RussianScan
  //    clone that holds the model under models/.
  const devCandidates = [
    resolve(__dirname, '../../RussianScan/models', MODEL_FILE),
    resolve(__dirname, '../../../RussianScan/models', MODEL_FILE),
    resolve(__dirname, '../../models', MODEL_FILE),
  ];
  for (const p of devCandidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function nlp(): ReturnType<typeof createUDPipe> {
  if (_nlp) return _nlp;
  const modelPath = findModel();
  if (!modelPath) {
    // Without the SynTagRus model udpipe-node silently falls back to its
    // bundled ENGLISH model — every Russian token comes back NOUN/compound
    // and the whole pipeline (stress variants, ёфикация by gram, rhyme
    // feats, F&H maxima) degrades garbage-in.  Fail loudly instead.
    throw new Error(
      `Russian UDPipe model not found: put ${MODEL_FILE} in src/russian/data/ ` +
      'or dist/russian/data/, set CALLIOPE_RUSSIAN_DATA to the data directory, ' +
      'or set CALLIOPE_RUSSIAN_UDPIPE_MODEL to the model file path.'
    );
  }
  _nlp = createUDPipe({ defaultInputMode: 'tokenize', modelPath });
  return _nlp;
}

/** Pre-process text: space out punctuation so UDPipe doesn't glue it to words. */
function preprocessPunctuation(text: string): string {
  // Same approach as the original Python (poetry_alignment.py line 1264)
  const punctChars = '\'.‚,?!:;…-–—«»″""„‘’`ʹ"˝[]‹›·<>*/=()+®©‛¨×№\u05f4';
  let result = text;
  for (const c of punctChars) {
    result = result.split(c).join(' ' + c + ' ');
  }
  // Collapse multiple spaces
  result = result.replace(/  +/g, ' ');
  return result;
}

/** Parse Russian text into tokens with morphological features. */
export function parseRussianText(text: string): RuToken[][] {
  const preprocessed = preprocessPunctuation(text);
  const sentences = nlp().parse(preprocessed);
  return sentences.map((sent, si) => sent.words.map((w, wi) => ({
    form: w.form,
    lemma: w.lemma || w.form.toLowerCase(),
    upos: w.upos || 'X',
    feats: w.featsMap || {},
    deprel: w.deprel || '',
    head: w.head,
    id: (w as { id?: number }).id ?? wi + 1,
    sent: si,
    isContent: CONTENT_UPOS.has(w.upos || ''),
  })));
}

/** Check if a token is punctuation. */
export function isRuPunctuation(upos: string): boolean {
  return PUNCT_UPOS.has(upos);
}

/** Detect if text is predominantly Cyrillic (Russian). */
export function isRussianText(text: string): boolean {
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return cyrillic > latin && cyrillic > 0;
}
