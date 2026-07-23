// syllabifier.ts — Russian syllabification (port of rusyllab).
// The original is an auto-generated finite-state transducer that inserts
// syllable boundaries by checking character classes at fixed offsets.
// Ported mechanically to preserve exact behavior.

const VOWELS = 'АЕЁИОУЫЭЮЯаеёиоуыэюя';
const CONSONANTS = 'БВГДЖЗКЛМНПРСТФХЦЧШЩбвгджзклмнпрстфхцчшщ';
const J_SIGNS = 'Йй';
const SIGNS = 'ЪЬъь';

function isV(c: string): boolean { return VOWELS.includes(c); }
function isC(c: string): boolean { return CONSONANTS.includes(c); }
function isS(c: string): boolean { return J_SIGNS.includes(c); }
function isM(c: string): boolean { return SIGNS.includes(c); }
function isBEG(c: string): boolean { return c === '['; }
function isEND(c: string): boolean { return c === ']'; }

/** Safe character access — returns ']' (END sentinel) for out-of-bounds. */
function at(s: string[], i: number): string { return s[i] ?? ']'; }

type Rule = [string[], number, number] | null;

function apply1(s: string[]): Rule {
  const s0 = at(s, 0), s1 = at(s, 1), s2 = at(s, 2), s3 = at(s, 3);
  const s4 = at(s, 4), s5 = at(s, 5), s6 = at(s, 6), s7 = at(s, 7), s8 = at(s, 8);

  if (isC(s0)) {
    if (isV(s1)) {
      if (isC(s2)) {
        if (isV(s3)) return [[s0+s1, s2, s3], 4, 1];
        if (isC(s3)) {
          if (isV(s4)) return [[s0+s1+s2, s3, s4], 5, 1];
          if (isC(s4)) {
            if (isC(s5)) {
              if (isEND(s6)) return [[s0+s1+s2+s3+s4+s5, s6], 7, 1];
              if (!isEND(s6)) return [[s0+s1+s2+s3+s4, s5, s6], 7, 1];
            }
            if (isV(s5)) return [[s0+s1+s2+s3, s4, s5], 6, 1];
            if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
            if (isM(s5)) { if (isEND(s6)) return [[s0+s1+s2+s3+s4+s5, s6], 7, 1]; }
          }
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          if (isM(s4)) {
            if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
            if (isC(s5)) { if (isV(s6)) return [[s0+s1+s2+s3+s4, s5, s6], 7, 1]; }
            if (isV(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
          }
        }
        if (isEND(s3)) return [[s0+s1+s2, s3], 4, 1];
        if (isM(s3)) {
          if (isC(s4)) {
            if (!isEND(s5)) return [[s0+s1+s2+s3, s4, s5], 6, 1];
            if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
            if (isC(s5)) { if (isC(s6)) { if (isEND(s7)) return [[s0+s1+s2+s3+s4+s5+s6, s7], 8, 1]; } }
          }
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          if (isV(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
        }
      }
      if (isEND(s2)) return [[s0+s1, s2], 3, 1];
      if (isS(s2)) {
        if (isC(s3)) {
          if (isV(s4)) return [[s0+s1+s2, s3, s4], 5, 1];
          if (isC(s4)) { if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1]; }
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          if (isM(s4)) { if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1]; }
        }
        if (isEND(s3)) return [[s0+s1+s2, s3], 4, 1];
        return [[s0+s1+s2], 3, 1];
      }
      if (isV(s2)) return [[s0+s1, s2], 3, 1];
    }
    if (isC(s1)) {
      if (isC(s2)) {
        if (isV(s3)) {
          if (isC(s4)) {
            if (isC(s5)) {
              if (isV(s6)) return [[s0+s1+s2+s3+s4, s5, s6], 7, 1];
              if (isM(s6)) { if (isEND(s7)) return [[s0+s1+s2+s3+s4+s5+s6, s7], 8, 1]; }
            }
            if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
            if (isV(s5)) return [[s0+s1+s2+s3, s4, s5], 6, 1];
            if (isM(s5)) {
              if (isC(s6)) { if (isM(s7)) { if (isEND(s8)) return [[s0+s1+s2+s3+s4+s5+s6+s7, s8], 9, 1]; } }
              return [[s0+s1+s2+s3+s4+s5], 6, 1];
            }
          }
          if (isS(s4)) return [[s0+s1+s2+s3+s4], 5, 1];
          if (isV(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          return [[s0+s1+s2+s3], 4, 1];
        }
        if (isC(s3)) {
          if (isV(s4)) {
            if (isS(s5)) return [[s0+s1+s2+s3+s4+s5], 6, 1];
            return [[s0+s1+s2+s3+s4], 5, 1];
          }
        }
      }
      if (isV(s2)) {
        if (isC(s3)) {
          if (isC(s4)) {
            if (isV(s5)) return [[s0+s1+s2+s3, s4, s5], 6, 1];
            if (isC(s5)) {
              if (isC(s6)) { if (isEND(s7)) return [[s0+s1+s2+s3+s4+s5+s6, s7], 8, 1]; }
              return [[s0+s1+s2+s3+s4, s5], 6, 1];
            }
            if (isM(s5)) {
              if (isV(s6)) return [[s0+s1+s2+s3+s4+s5, s6], 7, 1];
              if (isC(s6)) { if (isV(s7)) return [[s0+s1+s2+s3+s4+s5, s6, s7], 8, 1]; }
            }
            if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
          }
          if (isM(s4)) {
            if (!isC(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
            if (isC(s5)) {
              if (isV(s6)) return [[s0+s1+s2+s3+s4, s5, s6], 7, 1];
              if (isC(s6)) { if (isV(s7)) return [[s0+s1+s2+s3+s4, s5, s6, s7], 8, 1]; }
            }
          }
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          if (isV(s4)) return [[s0+s1+s2, s3, s4], 5, 1];
        }
        if (isV(s3)) {
          if (isC(s4)) return [[s0+s1+s2, s3, s4], 5, 1];
          return [[s0+s1+s2, s3], 4, 1];
        }
        if (isS(s3)) {
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          if (isC(s4)) {
            if (isV(s5)) return [[s0+s1+s2+s3, s4, s5], 6, 1];
            if (isC(s5)) { if (isC(s6)) { if (isEND(s7)) return [[s0+s1+s2+s3+s4+s5+s6, s7], 8, 1]; } }
          }
          return [[s0+s1+s2+s3], 4, 1];
        }
        if (isEND(s3)) return [[s0+s1+s2, s3], 4, 1];
      }
      if (isM(s2)) {
        if (isV(s3)) {
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
          if (isC(s4)) { if (isV(s5)) return [[s0+s1+s2+s3, s4, s5], 6, 1]; }
        }
      }
    }
    if (isM(s1)) {
      if (isV(s2)) {
        if (isC(s3)) {
          if (isV(s4)) return [[s0+s1+s2, s3, s4], 5, 1];
          if (isC(s4)) {
            if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1];
            if (isV(s5)) return [[s0+s1+s2+s3, s4, s5], 6, 1];
            if (isC(s5)) { if (isC(s6)) { if (isV(s7)) return [[s0+s1+s2+s3+s4+s5, s6, s7], 8, 1]; } }
          }
          if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
        }
        if (isEND(s3)) return [[s0+s1+s2, s3], 4, 1];
      }
      if (isC(s2)) {
        if (isV(s3)) {
          if (isS(s4)) { if (isEND(s5)) return [[s0+s1+s2+s3+s4, s5], 6, 1]; }
          if (isV(s4)) return [[s0+s1+s2+s3, s4], 5, 1];
        }
      }
    }
  }

  if (isV(s0)) {
    if (isC(s1)) {
      if (isC(s2)) {
        if (isEND(s3)) return [[s0+s1+s2, s3], 4, 1];
        if (isV(s3)) return [[s0+s1, s2, s3], 4, 1];
        if (isC(s3)) {
          if (isV(s4)) {
            if (isC(s5)) return [[s0+s1+s2, s3, s4, s5], 6, 1];
            return [[s0+s1, s2, s3, s4], 5, 1];
          }
          if (isC(s4)) { if (isV(s5)) return [[s0+s1+s2, s3, s4, s5], 6, 1]; }
        }
        if (isM(s3)) { if (isEND(s4)) return [[s0+s1+s2+s3, s4], 5, 1]; }
      }
      if (isV(s2)) return [[s0, s1, s2], 3, 1];
      if (isM(s2)) {
        if (isEND(s3)) return [[s0+s1+s2, s3], 4, 1];
        if (isC(s3)) {
          if (isC(s4)) { if (isV(s5)) return [[s0+s1+s2, s3, s4, s5], 6, 1]; }
          if (isV(s4)) return [[s0+s1+s2, s3, s4], 5, 1];
        }
        if (isV(s3)) return [[s0+s1+s2, s3], 4, 1];
      }
      if (isEND(s2)) return [[s0+s1, s2], 3, 1];
      return [[s0+s1], 2, 1];
    }
    if (isEND(s1)) return [[s0, s1], 2, 1];
    if (isV(s1)) return [[s0, s1], 2, 1];
    if (isS(s1)) {
      if (isEND(s2)) return [[s0+s1, s2], 3, 1];
      if (isC(s2)) { if (isV(s3)) return [[s0+s1, s2, s3], 4, 1]; }
    }
  }

  if (isBEG(s0)) {
    if (isC(s1)) {
      if (isC(s2)) {
        if (isV(s3)) {
          if (isC(s4)) {
            if (isEND(s5)) return [[s0, s1+s2+s3+s4, s5], 6, 2];
            if (isC(s5)) {
              if (isEND(s6)) return [[s0, s1+s2+s3+s4+s5, s6], 7, 2];
              if (isM(s6)) { if (isEND(s7)) return [[s0, s1+s2+s3+s4+s5+s6, s7], 8, 2]; }
            }
          }
          if (isS(s4)) { if (isEND(s5)) return [[s0, s1+s2+s3+s4, s5], 6, 2]; }
          if (isEND(s4)) return [[s0, s1+s2+s3, s4], 5, 2];
        }
        if (isEND(s3)) return [[s0, s1+s2, s3], 4, 2];
        if (isC(s3)) {
          if (isC(s4)) {
            if (isV(s5)) {
              if (isC(s6)) { if (isEND(s7)) return [[s0, s1+s2+s3+s4+s5+s6, s7], 8, 2]; }
            }
          }
          if (isV(s4)) {
            if (isC(s5)) {
              if (isM(s6)) { if (isEND(s7)) return [[s0, s1+s2+s3+s4+s5+s6, s7], 8, 2]; }
            }
            if (isEND(s5)) return [[s0, s1+s2+s3+s4, s5], 6, 2];
          }
        }
      }
      if (isV(s2)) {
        if (isC(s3)) {
          if (isC(s4)) {
            if (isM(s5)) { if (isEND(s6)) return [[s0, s1+s2+s3+s4+s5, s6], 7, 2]; }
            if (isEND(s5)) return [[s0, s1+s2+s3+s4, s5], 6, 2];
          }
          if (isM(s4)) {
            if (isC(s5)) { if (isC(s6)) { if (isEND(s7)) return [[s0, s1+s2+s3+s4+s5+s6, s7], 8, 2]; } }
          }
        }
        if (isS(s3)) {
          if (isC(s4)) { if (isEND(s5)) return [[s0, s1+s2+s3+s4, s5], 6, 2]; }
        }
      }
      if (isEND(s2)) return [[s0, s1, s2], 3, 2];
      if (isM(s2)) {
        if (isC(s3)) {
          if (isV(s4)) {
            if (isEND(s5)) return [[s0, s1+s2+s3+s4, s5], 6, 2];
            if (isC(s5)) {
              if (isEND(s6)) return [[s0, s1+s2+s3+s4+s5, s6], 7, 2];
              if (isV(s6)) return [[s0, s1+s2+s3+s4, s5, s6], 7, 2];
            }
          }
        }
        if (isV(s3)) {
          if (isEND(s4)) return [[s0, s1+s2+s3, s4], 5, 2];
          if (isS(s4)) { if (isEND(s5)) return [[s0, s1+s2+s3+s4, s5], 6, 2]; }
          if (isC(s4)) { if (isM(s5)) { if (isEND(s6)) return [[s0, s1+s2+s3+s4+s5, s6], 7, 2]; } }
        }
      }
    }
    if (isV(s1)) {
      if (isC(s2)) {
        if (isM(s3)) { if (isEND(s4)) return [[s0, s1+s2+s3, s4], 5, 2]; }
        if (isEND(s3)) return [[s0, s1+s2, s3], 4, 2];
        if (isC(s3)) {
          if (isC(s4)) { if (isC(s5)) { if (isEND(s6)) return [[s0, s1+s2+s3+s4+s5, s6], 7, 2]; } }
        }
      }
    }
    if (isS(s1)) {
      if (isV(s2)) {
        if (isC(s3)) { if (isV(s4)) return [[s0, s1+s2, s3, s4], 5, 2]; }
      }
    }
  }

  return null;
}

/** Split a Russian word into syllables. */
export function splitWord(word: string): string[] {
  const items = ('[' + word + ']').split('');
  let curPos = 0;
  while (curPos < items.length) {
    const ctx = items.slice(curPos);
    const res = apply1(ctx);
    if (res === null) {
      curPos += 1;
    } else {
      const [replacements, consume, advance] = res;
      items.splice(curPos, consume, ...replacements);
      curPos += advance;
    }
  }
  // Remove the [ and ] markers (first and last items).
  return items.slice(1, -1);
}

/** Count vowels in a Russian word. */
export function countVowels(word: string): number {
  let n = 0;
  for (const c of word) if (isV(c)) n++;
  return n;
}

/** Get the position of the first vowel in a string (0-indexed), or -1. */
export function firstVowelPos(s: string): number {
  for (let i = 0; i < s.length; i++) if (isV(s[i])) return i;
  return -1;
}

export { isV, isC, isS, isM, VOWELS, CONSONANTS };
