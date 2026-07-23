// Faithful port of scanpositions.py's Positioner: the char-grid bookkeeping
// that underlies both the classic spaced-out "x / | x" display string AND the
// FeetAtPunctBounds check that _measureComplexity relies on.  Deliberately
// omits P.promCands/P.wordbounds -- scanpositions.py's own header comment
// flags that bookkeeping as "SO-FAR UNUSED... requiring a few CPU cycles and
// not contributing anything," i.e. dead in the original too.

import { STRESS, SLACK, PROMOTED, FOOTDIV, SYLMARK, footDict } from './constants.js';
import { invertFootDict } from './utilities.js';

const SCANMARKS = 'x/%';
const footDictInverse = invertFootDict(footDict);

export class Positioner {
  charlist: string[] = [];
  sylmids: number[] = [];
  footplace: number[] = [0];
  possLexicals: string[] = [];
  punctAt: number[] = [];
  private scanMarkMoved = false;

  NewLine(linelength: number): void {
    this.charlist = new Array(linelength + 1).fill(' ');
    this.sylmids = [];
    this.footplace = [0];
    this.possLexicals = [];
    this.punctAt = [];
    this.scanMarkMoved = false;
  }

  /** Mutates `syls` in place (strips a monosyllable's trailing '*'), exactly
   *  as AddWord does; returns the advanced line-character index. */
  AddWord(syls: string[], linePosIn: number): number {
    let linePos = linePosIn;
    let ambiguous = true;
    if (syls.length === 1) {
      if (!syls[0].endsWith('*')) ambiguous = false;
      else syls[0] = syls[0].slice(0, -1);
    } else {
      for (const s of syls) {
        if (isUpperSyl(s)) { ambiguous = false; break; }
      }
    }
    if (ambiguous) {
      if (this.possLexicals.length === 0) this.possLexicals.push(this.GetMarks());
      const halfway = this.possLexicals.length;
      this.possLexicals = this.possLexicals.concat(this.possLexicals);
      for (let pL = 0; pL < halfway; pL++) {
        this.possLexicals[pL] += syls.length === 1 ? STRESS : STRESS + SLACK;
      }
      for (let pL = halfway; pL < this.possLexicals.length; pL++) {
        this.possLexicals[pL] += syls.length === 1 ? SLACK : SLACK + STRESS;
      }
    }
    for (const s of syls) {
      this.sylmids.push(linePos + Math.floor(s.length / 2));
      const newmark = isUpperSyl(s) ? STRESS : SLACK;
      this.AddScanMark(newmark, this.sylmids.length - 1);
      if (!ambiguous) {
        for (let pL = 0; pL < this.possLexicals.length; pL++) this.possLexicals[pL] += newmark;
      }
      linePos += s.length;
    }
    return linePos;
  }

  LocateFootDivPositions(): void {
    for (let syl = 0; syl < this.sylmids.length - 1; syl++) {
      this.footplace.push(this.sylmids[syl] + Math.floor((this.sylmids[syl + 1] - this.sylmids[syl]) / 2));
    }
    this.footplace.push(this.charlist.length - 1);
  }

  AddPunct(str: string, linePosIn: number): number {
    let linePos = linePosIn;
    for (const c of str) {
      if (!/\s/.test(c)) {
        this.charlist[linePos] = c;
        this.punctAt.push(linePos);
      }
      linePos += 1;
    }
    return linePos;
  }

  AddScanMark(mark: string, syllable: number): void {
    if (syllable > this.sylmids.length) return;
    this.charlist[this.sylmids[syllable]] = mark;
  }

  AddFootDivMark(syllable: number): void {
    if (syllable > this.sylmids.length) return;
    const pos = syllable === this.sylmids.length ? this.charlist.length - 1 : this.footplace[syllable];
    const empty = this.findEmptyPosForMark(pos);
    this.charlist[empty] = FOOTDIV;
  }

  EraseFootDivMark(syllable: number): void {
    this.charlist[this.footplace[syllable]] = ' ';
  }

  private findEmptyPosForMark(posIn: number): number {
    let pos = posIn;
    if (!SCANMARKS.includes(this.charlist[pos])) return pos;
    if (pos === 0 && SCANMARKS.includes(this.charlist[0])) {
      this.charlist[1] = this.charlist[0];
      this.scanMarkMoved = true;
      return pos;
    }
    if (pos < this.charlist.length - 1 && !SCANMARKS.includes(this.charlist[pos + 1])) return pos + 1;
    let blank = pos;
    while (blank > 0 && SCANMARKS.includes(this.charlist[blank])) blank -= 1;
    for (let s = blank; s < pos; s++) this.charlist[s] = this.charlist[s + 1];
    return pos;
  }

  GetAmbiguities(): string[] {
    return this.possLexicals.length > 0 ? this.possLexicals : [this.GetMarks()];
  }

  GetMarks(includeFeet = false): string {
    return this.GetScanString(includeFeet).replace(/\s+/g, '');
  }

  GetScanString(feet = true, punct = false, sylsOnly = false): string {
    let s = this.charlist.join('');
    if (!feet || sylsOnly) s = s.replace(/\|/g, ' ');
    if (!punct || sylsOnly) s = s.replace(/[-.,;:?!()"']/g, ' ');
    if (sylsOnly) s = s.replace(/[^ ]/g, SYLMARK);
    return s;
  }

  /** Correct charlist's x/% marks to match a chosen ambiguity-resolution string. */
  AdjustMarks(scansion: string): void {
    let i = 0;
    for (let c = 0; c < this.charlist.length; c++) {
      if (this.charlist[c] === 'x' || this.charlist[c] === '/') {
        this.charlist[c] = scansion[i];
        i += 1;
      }
      if (i >= scansion.length) break;
    }
  }

  RemoveEndFootMarks(): void {
    this.removeTailFootMark();
    this.removeHeadFootMark();
  }

  private removeTailFootMark(): void {
    const joined = this.charlist.join('');
    const lastfootdiv = joined.lastIndexOf(FOOTDIV);
    if (lastfootdiv === -1) return;
    let islastmark = true;
    for (let i = lastfootdiv; i < this.charlist.length; i++) {
      if (SCANMARKS.includes(this.charlist[i])) { islastmark = false; break; }
    }
    if (islastmark) this.charlist[lastfootdiv] = ' ';
  }

  private removeHeadFootMark(): void {
    if (this.charlist[0] === FOOTDIV) {
      if (this.scanMarkMoved) {
        this.charlist[0] = this.charlist[1];
        this.charlist[1] = ' ';
        this.scanMarkMoved = false;
      } else {
        this.charlist[0] = ' ';
      }
    }
  }

  /** Per completed foot, was its END at (or immediately after) a punctuation
   *  mark, with no intervening scan mark on the way back?  Always keyed by the
   *  IAMBIC footDict (as in the original -- this check is never invoked for
   *  the anapestic path). */
  FeetAtPunctBounds(footlist: string[]): boolean[] {
    const retlist: boolean[] = [true];
    let i = 0;
    for (const f of footlist) {
      const pattern = footDictInverse[f];
      i += pattern.length;
      if (i >= this.footplace.length) return retlist;
      let ip = this.footplace[i];
      while (ip) {
        if (this.punctAt.includes(ip)) { retlist.push(true); break; }
        else if (SCANMARKS.includes(this.charlist[ip])) { retlist.push(false); break; }
        ip -= 1;
      }
    }
    return retlist;
  }
}

function isUpperSyl(s: string): boolean {
  return /[A-Z]/.test(s) && s === s.toUpperCase();
}
