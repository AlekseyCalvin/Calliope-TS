// rhyme.ts — Russian rhyme detection.
// Detects end rhymes by comparing clausulas (stressed syllable + everything
// after it) using phonetic transcription. Supports fuzzy rhymes via a
// dictionary of known rhyming word pairs + regex patterns.

import { getAccentsData } from './accentuator.js';
import type { RuLine, RuRhymeEntry } from './types.js';
import { RU_VOWELS } from './types.js';

const VOICED_CONSONANTS = 'бвгджз';
const VOICELESS_CONSONANTS = 'пфктшс';
const DEVOICING: Record<string, string> = { 'б': 'п', 'в': 'ф', 'г': 'к', 'д': 'т', 'ж': 'ш', 'з': 'с' };
const VOICING: Record<string, string> = { 'п': 'б', 'ф': 'в', 'к': 'г', 'т': 'д', 'ш': 'ж', 'с': 'з' };

/** Apply Russian phonetic rules to transcribe a word ending. */
export function pronounce(text: string): string {
  let result = '';
  const lower = text.toLowerCase();

  for (let i = 0; i < lower.length; i++) {
    let c = lower[i];

    // Vowel reduction: unstressed о→а, е→и, я→и
    // (We don't know stress here, so we apply reductions conservatively)
    if (c === 'о') c = 'а';
    else if (c === 'е') c = 'и';
    else if (c === 'я') c = 'и';
    else if (c === 'ё') c = 'о';
    else if (c === 'ю') c = 'у';
    else if (c === 'э') c = 'и';

    // Consonant devoicing at word end
    if (i === lower.length - 1 && DEVOICING[c]) {
      c = DEVOICING[c];
    }

    // Voicing assimilation: voiced before voiceless → devoice
    if (i < lower.length - 1) {
      const next = lower[i + 1];
      if (DEVOICING[c] && VOICELESS_CONSONANTS.includes(next)) {
        c = DEVOICING[c];
      }
      // Voiceless before voiced → voice
      if (VOICING[c] && VOICED_CONSONANTS.includes(next) && !RU_VOWELS.includes(next)) {
        c = VOICING[c];
      }
    }

    result += c;
  }

  return result;
}

/** Extract the clausula (stressed vowel + everything after) from a word. */
export function extractClausula(
  word: string,
  stressPos: number,
  unstressedTail: string = '',
): string {
  const lower = word.toLowerCase();
  let vowelCount = 0;

  for (let i = 0; i < lower.length; i++) {
    if (RU_VOWELS.includes(lower[i])) {
      vowelCount++;
      if (vowelCount === stressPos) {
        let ending = lower.slice(i);
        // Apply special endings
        if (ending === 'ого' || ending === 'его') ending = 'ово';
        if (ending.startsWith('е') && vowelCount === stressPos) ending = 'э' + ending.slice(1);
        if (ending.startsWith('я') && vowelCount === stressPos) ending = 'а' + ending.slice(1);
        if (ending.startsWith('ё') && vowelCount === stressPos) ending = 'о' + ending.slice(1);
        if (ending.startsWith('ю') && vowelCount === stressPos) ending = 'у' + ending.slice(1);
        if (ending.startsWith('и') && vowelCount === stressPos) ending = 'ы' + ending.slice(1);

        const tailTranscription = pronounce(unstressedTail);
        // The STRESSED vowel is exempt from reduction (о́ never merges with
        // а́ — доро́гу/вла́гу is no rhyme); it was already normalised above.
        // Only the post-stress tail undergoes pronounce()'s reductions.
        return ending[0] + pronounce(ending.slice(1)) + tailTranscription;
      }
    }
  }

  return pronounce(lower);
}

/** Extract the spelling ending after the stressed syllable. */
export function extractSpellingEnding(
  word: string,
  stressPos: number,
  unstressedTail: string = '',
): string {
  const lower = word.toLowerCase();
  let vowelCount = 0;

  for (let i = 0; i < lower.length; i++) {
    if (RU_VOWELS.includes(lower[i])) {
      vowelCount++;
      if (vowelCount === stressPos) {
        return lower.slice(i) + lower.slice(0, 0) + unstressedTail.toLowerCase();
      }
    }
  }
  return lower + unstressedTail.toLowerCase();
}

/** Check if two clausulas are phonetically equal.  Exported for the rewrite
 *  engine's fuzzy-rhyme mode, which grades candidate clausulas by nearness. */
export function arePhoneticallyEqual(s1: string, s2: string): boolean {
  if (s1 === s2) return true;

  // Compare character by character with phonetic tolerance
  if (s1.length !== s2.length) {
    // Allow length difference of 1 (e.g., ь at end)
    if (Math.abs(s1.length - s2.length) > 1) return false;
  }

  const minLen = Math.min(s1.length, s2.length);
  let mismatches = 0;
  for (let i = 0; i < minLen; i++) {
    if (s1[i] !== s2[i]) {
      mismatches++;
      // Allow vowel substitutions (reduction differences)
      if (RU_VOWELS.includes(s1[i]) && RU_VOWELS.includes(s2[i])) continue;
      // Allow consonant devoicing/voicing pairs
      if (DEVOICING[s1[i]] === s2[i] || DEVOICING[s2[i]] === s1[i]) continue;
      // Allow ь/ъ interchange
      if ((s1[i] === 'ь' || s1[i] === 'ъ') && (s2[i] === 'ь' || s2[i] === 'ъ')) continue;
    }
  }

  return mismatches <= 1;
}

/** Check if two words rhyme. */
export function checkRhyme(
  word1: string, stress1: number, feats1: Record<string, string>,
  word2: string, stress2: number, feats2: Record<string, string>,
  unstressedTail1: string = '',
  unstressedTail2: string = '',
): { rhymes: boolean; type: string | null } {
  const data = getAccentsData();

  // Check explicit rhymed words dictionary
  const l1 = word1.toLowerCase(), l2 = word2.toLowerCase();
  if (data.rhymedWords.has([l1, l2] as [string, string]) ||
      data.rhymedWords.has([l2, l1] as [string, string])) {
    return { rhymes: true, type: 'explicit' };
  }

  // Calculate clausula positions (distance from end)
  const vowels1 = countVowelsInWord(word1) + countVowelsInWord(unstressedTail1);
  const vowels2 = countVowelsInWord(word2) + countVowelsInWord(unstressedTail2);
  const pos1 = vowels1 - stress1 + countVowelsInWord(unstressedTail1);
  const pos2 = vowels2 - stress2 + countVowelsInWord(unstressedTail2);

  if (pos1 !== pos2) return { rhymes: false, type: null };

  // Compare spelling endings
  const ending1 = extractSpellingEnding(word1, stress1, unstressedTail1);
  const ending2 = extractSpellingEnding(word2, stress2, unstressedTail2);
  if (ending1 === ending2) {
    return { rhymes: true, type: 'perfect' };
  }

  // Compare phonetic clausulas
  const claus1 = extractClausula(word1, stress1, unstressedTail1);
  const claus2 = extractClausula(word2, stress2, unstressedTail2);
  if (arePhoneticallyEqual(claus1, claus2)) {
    return { rhymes: true, type: 'phonetic' };
  }

  // Check fuzzy rhyming dictionary
  if (data.rhymingDict[l1]?.includes(l2) || data.rhymingDict[l2]?.includes(l1)) {
    return { rhymes: true, type: 'fuzzy' };
  }

  return { rhymes: false, type: null };
}

function countVowelsInWord(word: string): number {
  if (!word) return 0;
  let n = 0;
  for (const c of word.toLowerCase()) if (RU_VOWELS.includes(c)) n++;
  return n;
}

/** Detect rhyme scheme for a stanza's lines. */
export function detectRhymeScheme(lines: RuLine[]): RuRhymeEntry[] {
  const entries: RuRhymeEntry[] = [];
  const letterMap = new Map<number, string>();
  let currentLetterCode = 65; // 'A'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lastWord = getLastContentWord(line);

    if (!lastWord || lastWord.stressPos <= 0) {
      entries.push({
        endWord: lastWord?.form ?? '',
        letter: '-',
        rhymeType: null,
        matchedLine: null,
      });
      continue;
    }

    // Check rhyming with previous lines (look back up to 2 lines)
    let matched: number | null = null;
    let rhymeType: string | null = null;

    for (let j = Math.max(0, i - 2); j < i; j++) {
      const prevLine = lines[j];
      const prevLast = getLastContentWord(prevLine);
      if (!prevLast || prevLast.stressPos <= 0) continue;

      const result = checkRhyme(
        lastWord.form, lastWord.stressPos, lastWord.feats,
        prevLast.form, prevLast.stressPos, prevLast.feats,
      );

      if (result.rhymes) {
        matched = j;
        rhymeType = result.type;
        break;
      }
    }

    let letter: string;
    if (matched !== null) {
      letter = letterMap.get(matched) || '-';
    } else {
      letter = String.fromCharCode(currentLetterCode++);
    }
    letterMap.set(i, letter);

    entries.push({
      endWord: lastWord.form,
      letter,
      rhymeType,
      matchedLine: matched,
    });
  }

  return entries;
}

/** Get the last content word from a line (for rhyme detection). */
function getLastContentWord(line: RuLine): RuWord | null {
  for (let i = line.words.length - 1; i >= 0; i--) {
    const w = line.words[i];
    if (w.isContent && w.syllables.length > 0) return w;
  }
  // Fallback: any word with syllables
  for (let i = line.words.length - 1; i >= 0; i--) {
    if (line.words[i].syllables.length > 0) return line.words[i];
  }
  return null;
}

// Import type at the bottom to avoid circular dependency issues
import type { RuWord } from './types.js';
