// Faithful port of Scandroid_py_source/syllables.py's Syllabizer class (Paul
// Holzer's method, Byte Feb 1986, adapted by Hartman with regex heuristics).
// Public contract preserved exactly: Syllabize(word) returns an array of
// syllable substrings of the ORIGINAL word, with the STRESSED syllable
// UPPERCASE and all others left as given (lowercase, since callers pass
// lowercase words in).  Downstream code detects stress via `s === s.toUpperCase()
// && s !== s.toLowerCase()` (the TS equivalent of Python's `str.isupper()`).

import { SIBILANTS, MULTISUFFIX, STRESSSUFFIX, PREFIXES } from './constants.js';

function encode(ch: string): string {
  return String.fromCharCode(ch.charCodeAt(0) & 0x3f);
}
// decode() is defined in the original (chr(ord(ch) | 0x40)) but never actually
// called anywhere in Syllabize's method bodies either — dead in the source too.

function handleCiV(match: string): string {
  return encode(match[0]) + encode(match[1]) + match[2];
}
function handleCC(match: string): string {
  let ret = encode(match[0]) + encode(match[1]);
  if (match.length > 2) ret += match[2];
  return ret;
}
function handleVyV(match: string): string {
  return match[0] + encode(match[1]) + match[2];
}

function isAlpha(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z]/.test(ch);
}

// Regexes below are transliterated from syllables.py's re.VERBOSE patterns —
// VERBOSE mode only strips insignificant whitespace/comments, so the
// alternations and character classes are copied over unchanged.
const SUFFIXES_RE = /[^aeiouhr]y\b|er\b|age|est|ing|ness\b|less|ful|ment\b|time\b|[st]ion|[ia]ble\b|[ct]ial|[ctg]iou|[ctg]ious/g;
const LIQUIDTERM_RE = /[^aeiouy][rl]e\b/;
const CiV_RE = /[st]i[aeiouy]/g;
const CCPAIR_RE = /[cgprstw]h|gn|gu[aeiouy]|qu|ck/g;
const VyV_RE = /[aeiou]y[aeiou]/g;
const SYLVOWELS_RE = /[aeiu]o|[iu]a|iu/;
const SPLIT_LEFT_PAIRS_RE = /[bdfk%02][rl]|g[rln]|[tw]r|p[rlsn]s[nml]/;
// DivideCV's "unicode vowels" set: a e è i o u y (è = e-with-grave, syllabic
// per the "an aged man" note in the original docstring).
const VOWEL_GROUP_RE = /[aeèiouy]+/g;
const CONSONANT_GROUP_RE = /[^aeèiouy]+/g;

class Syllabizer {
  private wd = '';
  private sylBounds: number[] = [];
  private isPast = false;
  private isPlural = false;
  private numSuffixes = 0;
  private forceStress = 0;

  Syllabize(word: string): string[] {
    if (word.length < 3) return [word.toUpperCase()];
    this.wd = word.toLowerCase();
    this.sylBounds = [];
    this.preliminaries();
    this.specialCodes();
    this.divideCV();
    const stressed = this.stressGuesser(word);
    this.sylBounds.sort((a, b) => a - b);
    this.sylBounds.unshift(0);
    this.sylBounds.push(word.length);
    const listOfSyls: string[] = [];
    let i = 0;
    for (const s of this.sylBounds) {
      if (!s) continue; // skip the leading 0 sentinel, exactly as `if not s: continue`
      i += 1;
      const piece = word.slice(this.sylBounds[i - 1], s);
      listOfSyls.push(i === stressed ? piece.toUpperCase() : piece);
    }
    return listOfSyls;
  }

  private preliminaries(): void {
    // Python's str.find(sub, -2) searches from index len-2 onward; JS indexOf
    // clamps a negative fromIndex to 0, so the offset must be computed by hand.
    const fromIdx = Math.max(0, this.wd.length - 2);
    const apostrophe = this.wd.indexOf("'", fromIdx);
    if (apostrophe !== -1) {
      const last = this.wd[this.wd.length - 1];
      const penult = this.wd[this.wd.length - 2];
      if (last !== "'" && 'se'.includes(last) && SIBILANTS.includes(penult)) {
        this.sylBounds.push(apostrophe);
      }
      this.wd = this.wd.slice(0, apostrophe);
    }
    this.isPast = false;
    this.isPlural = false;
    if (/[^s]s\b/.test(this.wd)) this.isPlural = true;
    if (/ed\b/.test(this.wd)) this.isPast = true;
    if (this.isPast || this.isPlural) this.wd = this.wd.slice(0, -1);
    // final-syllable test does better work AFTER suffixes are cut off
    this.findSuffix();
    if (this.wd.length > 3 && LIQUIDTERM_RE.test(this.wd)) {
      // swap the final two characters (numeric bound positions are unaffected;
      // the ORIGINAL word — not this working copy — is sliced for output)
      const n = this.wd.length;
      this.wd = this.wd.slice(0, n - 2) + this.wd[n - 1] + this.wd[n - 2];
    }
  }

  private findSuffix(): void {
    this.numSuffixes = 0;
    this.forceStress = 0;
    const results: Array<[string, number]> = [];
    for (const m of this.wd.matchAll(SUFFIXES_RE)) {
      results.push([m[0], m.index ?? 0]);
    }
    if (results.length === 0) return;
    const last = results[results.length - 1];
    if (last[1] + last[0].length < this.wd.length) return; // rightmost match must reach the end
    results.reverse();
    for (const [text, start] of results) {
      if (!/[aeiouy]/.test(this.wd.slice(0, start))) break; // no vowel left before -> false suffix
      if (text === 'ing' && this.wd[start - 1] === this.wd[start - 2]) {
        this.sylBounds.push(start - 1); // absorb a doubled consonant into the suffix syllable
      } else {
        this.sylBounds.push(start);
      }
      this.wd = this.wd.slice(0, start);
      this.numSuffixes += 1;
      if (STRESSSUFFIX.includes(text)) this.forceStress = 0 - this.sylBounds.length;
      if (MULTISUFFIX.includes(text)) {
        this.sylBounds.push(start + 1);
        this.numSuffixes += 1;
      }
    }
  }

  private specialCodes(): void {
    if (/[^aeiouy]e\b/.test(this.wd)) {
      const penult = this.wd[this.wd.length - 2];
      if ((!this.isPlural || !SIBILANTS.includes(penult)) && (!this.isPast || !'dt'.includes(penult))) {
        this.wd = this.wd.slice(0, -1) + encode(this.wd[this.wd.length - 1]);
      }
      if (!/[aeiouy]/.test(this.wd)) this.wd = this.wd.slice(0, -1) + 'e'; // undo if no vowel left
    }
    this.wd = this.wd.replace(CiV_RE, handleCiV);
    this.wd = this.wd.replace(CCPAIR_RE, handleCC);
    this.wd = this.wd.replace(VyV_RE, handleVyV);
  }

  private divideCV(): void {
    const vowelMatches = [...this.wd.matchAll(VOWEL_GROUP_RE)];
    if (vowelMatches.length === 0) return; // defensive: original assumes at least one vowel group
    const firstvowel = vowelMatches[0].index ?? 0;
    let lastvowel = firstvowel;
    for (const v of vowelMatches) {
      const start = v.index ?? 0;
      lastvowel = start + v[0].length;
      const disyl = SYLVOWELS_RE.exec(v[0]);
      if (disyl) this.sylBounds.push(start + disyl.index + 1);
    }
    for (const cc of this.wd.matchAll(CONSONANT_GROUP_RE)) {
      const start = cc.index ?? 0;
      const end = start + cc[0].length;
      if (start < firstvowel || end >= lastvowel) continue;
      const numcons = cc[0].length;
      let pos: number;
      if (numcons < 3) pos = end - 1;
      else if (numcons > 3) pos = end - 2;
      else {
        const cg = cc[0];
        if (cg[cg.length - 3] === cg[cg.length - 2] || SPLIT_LEFT_PAIRS_RE.test(cg)) pos = end - 2;
        else pos = end - 1;
      }
      if (!isAlpha(this.wd[pos - 1]) && !isAlpha(this.wd[pos])) this.sylBounds.push(pos - 1);
      else this.sylBounds.push(pos);
    }
  }

  /** Nessly's Default plus suffix/prefix twists.  Returns a 1-BASED syllable index. */
  private stressGuesser(origword: string): number {
    const numsyls = this.sylBounds.length + 1;
    if (numsyls === 1) return 1;
    this.sylBounds.sort((a, b) => a - b);
    if (this.forceStress) return numsyls + this.forceStress;
    if (numsyls - this.numSuffixes === 1) return 1;
    const isprefix = PREFIXES.includes(this.wd.slice(0, this.sylBounds[0]));
    if (numsyls - this.numSuffixes === 2) return isprefix ? 2 : 1;
    if (isprefix && numsyls - this.numSuffixes === 3) return 2;
    let retstress: number;
    const lastBoundChar = origword[this.sylBounds[this.sylBounds.length - 1] - 1];
    if (!/[aeiouy]/.test(lastBoundChar ?? '')) retstress = numsyls - 1; // closed final syllable -> stress penult
    else retstress = numsyls - 2; // else antepenult
    if (this.numSuffixes === numsyls) retstress -= 1;
    return retstress;
  }
}

const shared = new Syllabizer();

/** Divide a word into syllables; the stressed syllable comes back UPPERCASE. */
export function syllabize(word: string): string[] {
  return shared.Syllabize(word);
}
