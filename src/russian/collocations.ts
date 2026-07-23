// collocations.ts — Collocation stress overrides.
// Some multi-word expressions have non-obvious stress patterns that differ
// from the individual words' dictionary stress. This module applies a small
// set of overrides (185 entries from the original tool).

import { requireRussianDataFile } from './paths.js';
import { readFileSync } from 'node:fs';

interface CollocationEntry {
  words: string[];
  stressed_word_index: number;
  stress_pos: number;
}

let _collocations: Record<string, CollocationEntry[]> | null = null;

function loadCollocations(): Record<string, CollocationEntry[]> {
  if (_collocations) return _collocations;
  const p = requireRussianDataFile('collocations.json');
  _collocations = JSON.parse(readFileSync(p, 'utf-8'));
  return _collocations!;
}

/** Check if a sequence of words matches a collocation override.
 *  Returns the stress override for the matched word, or null. */
export function checkCollocation(
  words: string[],
  currentIdx: number,
): { wordIndex: number; stressPos: number } | null {
  const colls = loadCollocations();

  // Check 2-word collocations
  if (currentIdx > 0) {
    const key = words[currentIdx - 1].toLowerCase() + '|' + words[currentIdx].toLowerCase();
    if (colls[key]) {
      for (const entry of colls[key]) {
        return { wordIndex: entry.stressed_word_index, stressPos: entry.stress_pos };
      }
    }
  }

  // Check forward
  if (currentIdx < words.length - 1) {
    const key = words[currentIdx].toLowerCase() + '|' + words[currentIdx + 1].toLowerCase();
    if (colls[key]) {
      for (const entry of colls[key]) {
        return { wordIndex: entry.stressed_word_index, stressPos: entry.stress_pos };
      }
    }
  }

  return null;
}
