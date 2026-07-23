// accentuator.ts — Russian stress placement.
// Combines a 3.4M-entry pre-stressed dictionary with a neural MLP (arch=1)
// for OOV words, plus auxiliary dictionaries for:
//   - morphologically-conditioned ambiguous stress (ambiguous_accents)
//   - multi-stress words (ambiguous_accents2)
//   - ёфикация (yo_words, yo_by_gram)
//   - secondary stress (secondary_stress_dict)
//   - compound word stress (derivation_data)
//
// The neural MLP forward pass is implemented in pure TypeScript using
// Float32Array matrix operations. Weights are loaded from a binary file
// extracted from the original PyTorch model.

import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { countVowels } from './syllabifier.js';
import { applyVerbPrefixDerivation } from './compounds.js';
import { RU_VOWELS } from './types.js';
import type { RuToken } from './types.js';
import { russianDataFile, requireRussianDataFile } from './paths.js';

// ── Data loading ─────────────────────────────────────────────────────

interface AccentsData {
  wordAccents: Map<string, number>;
  ambiguousAccents: Record<string, Record<string, string[]>>;
  ambiguousAccents2: Record<string, number[]>;
  yoWords: Record<string, string>;
  yoByGram: Record<string, any>;
  secondaryStress: Record<string, number[]>;
  rhymedWords: Set<[string, string]>;
  rhymingDict: Record<string, string[]>;
  derivationData: any;
}

let _data: AccentsData | null = null;

function loadJson<T>(filename: string): T {
  const p = requireRussianDataFile(filename);
  return JSON.parse(readFileSync(p, 'utf-8')) as T;
}

/** Load a JSON data file (used by other modules). */
export { loadJson };

function loadAccentsData(): AccentsData {
  if (_data) return _data;

  // Load gzipped TSV dictionary
  const tsvPath = russianDataFile('word_accents.tsv.gz');
  const wordAccents = new Map<string, number>();
  if (tsvPath && existsSync(tsvPath)) {
    const raw = gunzipSync(readFileSync(tsvPath)).toString('utf-8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      if (tab > 0) {
        wordAccents.set(line.slice(0, tab), Number(line.slice(tab + 1)));
      }
    }
  }

  // Load JSON dictionaries
  const ambiguousAccents = loadJson<Record<string, Record<string, string[]>>>('ambiguous_accents.json');
  const ambiguousAccents2 = loadJson<Record<string, number[]>>('ambiguous_accents2.json');
  const yoWords = loadJson<Record<string, string>>('yo_words.json');
  const yoByGram = loadJson<Record<string, any>>('yo_by_gram.json');
  const secondaryStress = loadJson<Record<string, number[]>>('secondary_stress.json');
  const rhymedWordsArr = loadJson<string[][]>('rhymed_words.json');
  const rhymingDict = loadJson<Record<string, string[]>>('rhyming_dict.json');
  const derivationData = loadJson<any>('derivation_data.json');

  const rhymedWords = new Set<[string, string]>(
    rhymedWordsArr.map(p => [p[0], p[1]] as [string, string])
  );

  _data = {
    wordAccents, ambiguousAccents, ambiguousAccents2,
    yoWords, yoByGram, secondaryStress,
    rhymedWords, rhymingDict, derivationData,
  }!;
  return _data!;
}

// ── Neural MLP (arch=1) ──────────────────────────────────────────────

interface NeuralConfig {
  max_len: number;
  num_outputs: number;
  char2index: Record<string, number>;
  vocab_size: number;
  embed_dim: number;
  arch: number;
}

interface NeuralWeights {
  embeddingWeight: Float32Array;    // [vocab_size, embed_dim]
  fc1Weight: Float32Array;          // [out=1984, in=1984]
  fc1Bias: Float32Array;            // [1984]
  fc2Weight: Float32Array;          // [1984, 1984]
  fc2Bias: Float32Array;            // [1984]
  fc3Weight: Float32Array;          // [54, 1984]
  fc3Bias: Float32Array;            // [54]
  fc4Weight: Float32Array;          // [27, 54]
  fc4Bias: Float32Array;            // [27]
}

let _config: NeuralConfig | null = null;
let _weights: NeuralWeights | null = null;

function loadNeuralModel(): { config: NeuralConfig; weights: NeuralWeights } {
  if (_config && _weights) return { config: _config, weights: _weights };

  _config = loadJson<NeuralConfig>('accentuator.json');

  // Load binary weights
  const binPath = requireRussianDataFile('accentuator.bin');
  const buf = readFileSync(binPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;

  // Header: magic(4) + version(4) + num_layers(4)
  off += 4; // skip magic
  dv.getUint32(off, true); off += 4; // version
  const numLayers = dv.getUint32(off, true); off += 4;

  const layers: Record<string, { shape: number[]; data: Float32Array }> = {};

  for (let i = 0; i < numLayers; i++) {
    const nameLen = dv.getUint32(off, true); off += 4;
    const name = buf.toString('utf-8', off, off + nameLen); off += nameLen;
    const numDims = dv.getUint32(off, true); off += 4;
    const shape: number[] = [];
    for (let d = 0; d < numDims; d++) {
      shape.push(dv.getUint32(off, true)); off += 4;
    }
    const dataLen = dv.getUint32(off, true); off += 4;
    // Copy bytes into a new ArrayBuffer to guarantee 4-byte alignment
    // (the header strings can throw off alignment in the original buffer)
    const dataBuf = new ArrayBuffer(dataLen);
    new Uint8Array(dataBuf).set(buf.subarray(off, off + dataLen));
    const data = new Float32Array(dataBuf);
    off += dataLen;
    layers[name] = { shape, data };
  }

  _weights = {
    embeddingWeight: layers['embedding.weight'].data,
    fc1Weight: layers['fc1.weight'].data,
    fc1Bias: layers['fc1.bias'].data,
    fc2Weight: layers['fc2.weight'].data,
    fc2Bias: layers['fc2.bias'].data,
    fc3Weight: layers['fc3.weight'].data,
    fc3Bias: layers['fc3.bias'].data,
    fc4Weight: layers['fc4.weight'].data,
    fc4Bias: layers['fc4.bias'].data,
  };

  return { config: _config, weights: _weights };
}

function relu(x: number): number { return x > 0 ? x : 0; }

function linear(
  input: Float32Array, inDim: number,
  weight: Float32Array, bias: Float32Array, outDim: number,
): Float32Array {
  const out = new Float32Array(outDim);
  for (let o = 0; o < outDim; o++) {
    let sum = bias[o];
    const wOff = o * inDim;
    for (let i = 0; i < inDim; i++) {
      sum += input[i] * weight[wOff + i];
    }
    out[o] = sum;
  }
  return out;
}

function argmax(arr: Float32Array): number {
  let max = -Infinity, idx = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) { max = arr[i]; idx = i; }
  }
  return idx;
}

/** Neural stress prediction: returns 1-based vowel position, or -1. */
function neuralPredict(word: string): number {
  const { config, weights } = loadNeuralModel();
  const maxLen = config.max_len;
  const embedDim = config.embed_dim;
  const { char2index } = config;

  // Encode: [ + word + ], padded to maxLen
  const inputIds = new Int32Array(maxLen);
  const chars = ('[' + word.toLowerCase() + ']').split('');
  for (let i = 0; i < Math.min(chars.length, maxLen); i++) {
    inputIds[i] = char2index[chars[i]] ?? 0;
  }

  // Embedding lookup → flatten
  const flat = new Float32Array(maxLen * embedDim);
  for (let i = 0; i < maxLen; i++) {
    const row = inputIds[i] * embedDim;
    const off = i * embedDim;
    for (let j = 0; j < embedDim; j++) {
      flat[off + j] = weights.embeddingWeight[row + j];
    }
  }

  // FC1 + ReLU
  const h1 = linear(flat, maxLen * embedDim, weights.fc1Weight, weights.fc1Bias, 1984);
  for (let i = 0; i < h1.length; i++) h1[i] = relu(h1[i]);

  // FC2 + ReLU
  const h2 = linear(h1, 1984, weights.fc2Weight, weights.fc2Bias, 1984);
  for (let i = 0; i < h2.length; i++) h2[i] = relu(h2[i]);

  // FC3 + ReLU
  const h3 = linear(h2, 1984, weights.fc3Weight, weights.fc3Bias, 54);
  for (let i = 0; i < h3.length; i++) h3[i] = relu(h3[i]);

  // FC4 (no ReLU, softmax next)
  const logits = linear(h3, 54, weights.fc4Weight, weights.fc4Bias, 27);

  // Argmax → vowel index (0-based, convert to 1-based)
  const predictedIdx = argmax(logits);

  // Map vowel index to actual position in the word
  let nvowels = 0;
  for (let i = 0; i < word.length; i++) {
    if (RU_VOWELS.includes(word[i].toLowerCase())) {
      nvowels++;
      if (nvowels === predictedIdx + 1) return nvowels;
    }
  }
  return -1;
}

// ── Public API ───────────────────────────────────────────────────────

export interface AccentResult {
  stressPos: number;          // 1-based vowel position of primary stress
  secondaryStress: number[] | null;  // per-vowel array: 0=none, 2=secondary
  ambiguous: boolean;         // word has multiple possible stress positions
  allStressPositions: number[];  // all possible stress positions (for ambiguous words)
}

/** Apply ёфикация: replace 'е' with 'ё' where appropriate. */
export function yoficate(word: string, feats: Record<string, string> = {}, upos?: string): string {
  const data = loadAccentsData();
  const lower = word.toLowerCase();

  // If it's a known ambiguous accent2 word, don't yoficate (matching original logic)
  if (data.ambiguousAccents2[lower]) {
    return word;
  }

  // If there's a strict single yofication, use it
  if (data.yoWords[lower]) {
    return applyYo(word, data.yoWords[lower]);
  }

  // Check gram-specific ёфикация
  if (data.yoByGram[lower]) {
    const gramData = data.yoByGram[lower] as Record<string, string[]>;
    let bestYoForm: string | null = null;
    let bestMatching = -1;

    // Build the tagset the original Python uses: ud_tags + [upos]
    // Here we approximate with feats + upos
    const featSet = new Set<string>();
    if (upos) featSet.add(upos);
    for (const [k, v] of Object.entries(feats)) {
      featSet.add(`${k}=${v}`);
    }

    for (const [yoForm, tagsets] of Object.entries(gramData)) {
      for (const tagset of tagsets) {
        let nbMatched = 0;
        for (const tag of tagset.split('|')) {
          if (featSet.has(tag)) nbMatched++;
        }
        if (nbMatched > bestMatching) {
          bestMatching = nbMatched;
          bestYoForm = yoForm;
        }
      }
    }
    
    if (bestYoForm) {
      return applyYo(word, bestYoForm);
    }
  }

  return word;
}

function applyYo(word: string, yoForm: string): string {
  // The yoForm is the same word but with 'ё' where 'е' was.
  // Simply find all positions where yoForm has 'ё' and replace in word.
  const result = word.split('');
  const lowerWord = word.toLowerCase();
  const lowerYo = yoForm.toLowerCase();
  // Walk both strings in parallel, matching characters
  let wi = 0, yi = 0;
  while (wi < result.length && yi < yoForm.length) {
    if (lowerWord[wi] === lowerYo[yi]) {
      // Same character — check if yoForm has 'ё' here
      if (yoForm[yi] === 'ё' || yoForm[yi] === 'Ё') {
        // Replace with ё (preserving case)
        if (word[wi] === word[wi].toUpperCase()) {
          result[wi] = 'Ё';
        } else {
          result[wi] = 'ё';
        }
      }
      wi++;
      yi++;
    } else if (lowerWord[wi] === 'е' && lowerYo[yi] === 'ё') {
      // Direct е→ё replacement
      if (word[wi] === word[wi].toUpperCase()) {
        result[wi] = 'Ё';
      } else {
        result[wi] = 'ё';
      }
      wi++;
      yi++;
    } else {
      // Mismatch — skip
      yi++;
    }
  }
  return result.join('');
}

/** Get all accentuations for a word (multi-variant, like original get_accents). */
export function getAccents(word: string, feats: Record<string, string> = {}, upos?: string): AccentResult[] {
  const data = loadAccentsData();
  const lower = word.toLowerCase();
  const vowelCount = countVowels(lower);

  if (vowelCount === 0) {
    return [{ stressPos: -1, secondaryStress: null, ambiguous: false, allStressPositions: [] }];
  }

  if (vowelCount === 1) {
    return [{ stressPos: 1, secondaryStress: getSecondaryStress(lower, data), ambiguous: false, allStressPositions: [1] }];
  }

  const secondaryStress = getSecondaryStress(lower, data);

  // ё-stress
  if (lower.includes('ё')) {
    if (data.wordAccents.has(lower)) {
      return [{ stressPos: data.wordAccents.get(lower)!, secondaryStress, ambiguous: false, allStressPositions: [data.wordAccents.get(lower)!] }];
    }
    let nvowels = 0;
    for (const c of lower) {
      if ('уеыаоэёяию'.includes(c)) {
        nvowels++;
        if (c === 'ё') {
          return [{ stressPos: nvowels, secondaryStress, ambiguous: false, allStressPositions: [nvowels] }];
        }
      }
    }
  }

  // ambiguous_accents2 — multiple stress positions
  if (data.ambiguousAccents2[lower]) {
    return data.ambiguousAccents2[lower].map(sp => ({ stressPos: sp, secondaryStress, ambiguous: true, allStressPositions: data.ambiguousAccents2[lower] }));
  }

  // word_accents_dict — single stress
  if (data.wordAccents.has(lower)) {
    const sp = data.wordAccents.get(lower)!;
    return [{ stressPos: sp, secondaryStress, ambiguous: false, allStressPositions: [sp] }];
  }

  // ambiguous_accents — homograph resolution
  if (data.ambiguousAccents[lower]) {
    const forms = data.ambiguousAccents[lower];
    const results: AccentResult[] = [];
    for (const [stressedForm, tagsets] of Object.entries(forms)) {
      if (matchesFeatures(feats, tagsets, upos)) {
        const sp = stressPosFromForm(stressedForm);
        if (sp > 0) results.push({ stressPos: sp, secondaryStress, ambiguous: true, allStressPositions: [sp] });
      }
    }
    if (results.length === 0) {
      for (const stressedForm of Object.keys(forms)) {
        const sp = stressPosFromForm(stressedForm);
        if (sp > 0) results.push({ stressPos: sp, secondaryStress, ambiguous: true, allStressPositions: [sp] });
      }
    }
    if (results.length > 0) return results;
  }

  // Consonant-only abbreviations
  if (/^[бвгджзклмнпрстфхцчшщ]{2,}$/i.test(lower)) {
    return [{ stressPos: lower.length, secondaryStress: null, ambiguous: false, allStressPositions: [lower.length] }];
  }

  // Verb prefix derivation
  if (feats['VerbForm'] || feats['Aspect']) {
    // Basic heuristic to check if it's a verb, or we can just try it
    const verbStress = applyVerbPrefixDerivation(lower, 'VERB');
    if (verbStress && verbStress > 0) {
      return [{ stressPos: verbStress, secondaryStress, ambiguous: false, allStressPositions: [verbStress] }];
    }
  }

  // Neural MLP fallback
  const predicted = neuralPredict(lower);
  return [{ stressPos: predicted, secondaryStress: null, ambiguous: false, allStressPositions: predicted > 0 ? [predicted] : [] }];
}

/** Get stress position for a word, using dictionary + neural MLP fallback. */
export function getAccent(word: string, feats: Record<string, string> = {}, upos?: string): AccentResult {
  const data = loadAccentsData();
  const lower = word.toLowerCase();
  const vowelCount = countVowels(lower);

  // 0a. No vowels → no stress
  if (vowelCount === 0) {
    return { stressPos: -1, secondaryStress: null, ambiguous: false, allStressPositions: [] };
  }

  // 0b. Single-vowel words → stress on that vowel (universal Russian rule)
  if (vowelCount === 1) {
    return { stressPos: 1, secondaryStress: null, ambiguous: false, allStressPositions: [1] };
  }

  // 0c. ё-stress rule: if word contains ё, check dict first, then ё is always stressed
  if (lower.includes('ё')) {
    if (data.wordAccents.has(lower)) {
      return {
        stressPos: data.wordAccents.get(lower)!,
        secondaryStress: getSecondaryStress(lower, data),
        ambiguous: false,
        allStressPositions: [data.wordAccents.get(lower)!],
      };
    }
    // ё is always stressed in Russian (except ёфикация and derivatives)
    let nvowels = 0;
    for (const c of lower) {
      if ('уеыаоэёяию'.includes(c)) {
        nvowels++;
        if (c === 'ё') {
          return { stressPos: nvowels, secondaryStress: null, ambiguous: false, allStressPositions: [nvowels] };
        }
      }
    }
  }

  // 1. Check ambiguous_accents2 first (multiple possible stress positions)
  if (data.ambiguousAccents2[lower]) {
    const positions = data.ambiguousAccents2[lower];
    return {
      stressPos: positions[0],
      secondaryStress: getSecondaryStress(lower, data),
      ambiguous: true,
      allStressPositions: positions,
    };
  }

  // 2. Check ambiguous_accents (morphologically conditioned)
  if (data.ambiguousAccents[lower]) {
    const forms = data.ambiguousAccents[lower];
    for (const [stressedForm, tagsets] of Object.entries(forms)) {
      if (matchesFeatures(feats, tagsets, upos)) {
        const stressPos = stressPosFromForm(stressedForm);
        if (stressPos > 0) {
          return {
            stressPos,
            secondaryStress: getSecondaryStress(lower, data),
            ambiguous: true,
            allStressPositions: [stressPos],
          };
        }
      }
    }
    const firstForm = Object.keys(forms)[0];
    const stressPos = stressPosFromForm(firstForm);
    if (stressPos > 0) {
      return {
        stressPos,
        secondaryStress: getSecondaryStress(lower, data),
        ambiguous: true,
        allStressPositions: [stressPos],
      };
    }
  }

  // 3. Check main dictionary
  if (data.wordAccents.has(lower)) {
    return {
      stressPos: data.wordAccents.get(lower)!,
      secondaryStress: getSecondaryStress(lower, data),
      ambiguous: false,
      allStressPositions: [data.wordAccents.get(lower)!],
    };
  }

  // 4. Consonant-only abbreviations → stress on last "syllable"
  if (/^[бвгджзклмнпрстфхцчшщ]{2,}$/i.test(lower)) {
    return {
      stressPos: lower.length,
      secondaryStress: null,
      ambiguous: false,
      allStressPositions: [lower.length],
    };
  }

  // Verb prefix derivation
  if (feats['VerbForm'] || feats['Aspect']) {
    const verbStress = applyVerbPrefixDerivation(lower, 'VERB');
    if (verbStress && verbStress > 0) {
      return {
        stressPos: verbStress,
        secondaryStress: null,
        ambiguous: false,
        allStressPositions: [verbStress],
      };
    }
  }

  // 5. Neural MLP fallback for OOV words
  const predicted = neuralPredict(lower);
  return {
    stressPos: predicted,
    secondaryStress: null,
    ambiguous: false,
    allStressPositions: predicted > 0 ? [predicted] : [],
  };
}

/** Check if morphological features match any of the tagsets.  A tagset
 *  component without '=' is a bare UPOS requirement (e.g. 'NOUN|Gender=Neut')
 *  — enforced when the caller supplies the token's UPOS, ignored otherwise
 *  (legacy lenient behaviour). */
function matchesFeatures(feats: Record<string, string>, tagsets: string[], upos?: string): boolean {
  if (!tagsets || tagsets.length === 0) return false;
  for (const tagset of tagsets) {
    let allMatch = true;
    for (const pair of tagset.split('|')) {
      const [key, val] = pair.split('=');
      if (val === undefined) {
        if (upos && key !== upos) { allMatch = false; break; }
        continue;
      }
      if (feats[key] && feats[key] !== val) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}

/** Extract stress position from a stressed form (uppercase vowel = stressed). */
function stressPosFromForm(form: string): number {
  let nvowels = 0;
  for (const c of form) {
    if ('уеыаоэёяию'.includes(c.toLowerCase())) nvowels++;
    if ('АЕЁИОУЫЭЮЯ'.includes(c)) return nvowels;
  }
  return -1;
}

/** Get secondary stress for a word. */
function getSecondaryStress(word: string, data: AccentsData): number[] | null {
  if (data.secondaryStress[word]) {
    return data.secondaryStress[word];
  }
  // Check compound word prefixes
  const deriv = data.derivationData;
  if (deriv?.compound2stress && deriv?.compound_prefixes) {
    for (const prefix of deriv.compound_prefixes) {
      if (word.startsWith(prefix) && word.length > prefix.length) {
        const tail = word.slice(prefix.length);
        if (data.wordAccents.has(tail) || data.ambiguousAccents[tail] || deriv.compound_tails?.[tail]) {
          const stressedHead = deriv.compound2stress[prefix];
          if (stressedHead) {
            const secPos = stressPosFromForm(stressedHead);
            if (secPos > 0) {
              const result = new Array(countVowels(word)).fill(0);
              let vCount = 0;
              for (let i = 0; i < prefix.length && vCount < secPos; i++) {
                if (RU_VOWELS.includes(word[i])) {
                  vCount++;
                  if (vCount === secPos) result[vCount - 1] = 2;
                }
              }
              return result;
            }
          }
        }
      }
    }
  }
  return null;
}

/** Render a word with stress mark (U+0301 for primary, U+0300 for secondary). */
export function renderStressedWord(word: string, accent: AccentResult): string {
  const out: string[] = [];
  let vowelCount = 0;
  for (const c of word) {
    out.push(c);
    if (RU_VOWELS.includes(c.toLowerCase())) {
      vowelCount++;
      if (accent.secondaryStress && accent.secondaryStress[vowelCount - 1] === 2) {
        out.push('\u0300');
      } else if (accent.stressPos === vowelCount) {
        out.push('\u0301');
      }
    }
  }
  return out.join('');
}

/** Get the data handle (for rhyme module). */
export function getAccentsData(): AccentsData {
  return loadAccentsData();
}
