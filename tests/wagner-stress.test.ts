// tests/wagner-stress.test.ts — Wagner (2005) / Krifka (2001) phrase-stress rebuild
// (2026-06-29).  Tests the functor/argument cyclic stress, boundary strength, and the
// relativiser refinements.  Assertions are RELATIONAL (A more prominent than B), not
// exact golden strings, because UDPipe's parse of a bare fragment is noisy — the
// theory is verified on the structure the parser actually returns, and where a parse
// defeats the rule that is the parser's limit, not the stress logic's.

import { describe, it, expect } from 'vitest';
import { parseDocument, isPunctuation } from '../src/parser.js';
import { calliopeEngine } from '../src/calliope/engine.js';
import { computeBoundaries } from '../src/calliope/boundaries.js';
import { feat } from '../src/calliope/feats.js';
import type { ClsWord, ClsSentence } from '../src/types.js';

/** Parse one line and run the Calliope per-sentence passes; return the merged words
 *  and the IU hierarchy. */
function analyse(line: string): { words: ClsWord[]; sents: ClsSentence[]; ius: ReturnType<typeof calliopeEngine.analyzeSentence> } {
  const doc = parseDocument(line);
  const ius = doc.sentences.flatMap(s => calliopeEngine.analyzeSentence(s));
  const words = doc.sentences.flatMap(s => s.words).filter(w => !isPunctuation(w.lexicalClass));
  return { words, sents: doc.sentences, ius };
}
const byWord = (words: ClsWord[], surf: string) =>
  words.find(w => w.word.toLowerCase().replace(/['’]/g, '') === surf.toLowerCase());
const contour = (w: ClsWord | undefined) => (w?.syllables ?? []).map(s => s.relativeStress).join('');
const RANK: Record<string, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const peakRel = (w: ClsWord | undefined): number =>
  Math.max(0, ...(w?.syllables ?? []).map(s => RANK[s.relativeStress ?? 'w']));

describe('Wagner/Krifka phrase stress (2026-06-29)', () => {
  it('Phase 1: FEATS are parsed onto featsMap', () => {
    const { words } = analyse('The woman wore the hat');
    const wore = byWord(words, 'wore');
    expect(wore).toBeTruthy();
    // UDPipe GUM marks a finite verb VerbForm=Fin; the parser must expose it.
    expect(feat(wore!, 'VerbForm')).toBeTruthy();
    const the = byWord(words, 'the');
    expect(feat(the!, 'PronType')).toBe('Art');
  });

  it('Phase 4: specifier restriction — a transitive subject is not crushed below the verb', () => {
    // "The woman wore the hat": the VP branches (object "hat"), so the subject "woman"
    // is NOT subordinated below the verb — it stays a co-prominence with the nuclear.
    const { words } = analyse('The woman wore the hat');
    const woman = byWord(words, 'woman')!;
    const wore = byWord(words, 'wore')!;
    const hat = byWord(words, 'hat')!;
    expect(hat.phraseStress).toBe(1);                       // object is the utterance nuclear
    expect(woman.phraseStress).toBeLessThanOrEqual(wore.phraseStress);  // subject ≥ verb in prominence
  });

  it('Phase 4: modifier-precedes gets its own accentual domain (the invisible worm)', () => {
    // Wagner §6.5.1: a pre-nominal modifier is NOT integrated — both "invisible" and
    // "worm" project (both bear a beat in the contour).
    const { words } = analyse('the invisible worm');
    const invisible = byWord(words, 'invisible')!;
    const worm = byWord(words, 'worm')!;
    expect(peakRel(invisible)).toBeGreaterThanOrEqual(RANK.m);   // modifier bears a beat
    expect(peakRel(worm)).toBeGreaterThanOrEqual(RANK.m);        // head bears a beat
  });

  it('Phase 4: unergative intransitive — the verb is the nuclear (a child cried)', () => {
    const { words } = analyse('A child cried');
    const child = byWord(words, 'child')!;
    const cried = byWord(words, 'cried')!;
    expect(cried.phraseStress).toBeLessThanOrEqual(child.phraseStress);  // verb ≥ subject
  });

  it('Phase 6: a post-posed relative clause is subordinated below its head', () => {
    // "the cat that caught the rat": the head noun "cat" outranks the clause verb.
    const { words } = analyse('the cat that caught the rat');
    const cat = byWord(words, 'cat')!;
    const caught = byWord(words, 'caught')!;
    expect(cat.phraseStress).toBeLessThan(caught.phraseStress);
  });

  it('Phase 7: a goal-argument oblique integrates (single accent on the NP)', () => {
    // "she walked to the store": the goal argument "store" is the nuclear; the verb is
    // subordinated to it (Krifka §4.5.1 argument integration).
    const { words } = analyse('She walked to the store');
    const walked = byWord(words, 'walked')!;
    const store = byWord(words, 'store')!;
    expect(store.phraseStress).toBeLessThanOrEqual(walked.phraseStress);
  });

  it('Phase 7: a low locative adjunct keeps its own accent (he smoked in the tent)', () => {
    // Larson 2005 / Wagner §6.5.1: a VP-final place oblique is NOT a functor — both
    // the verb and the locative noun bear a beat.
    const { words } = analyse('He smoked in the tent');
    const smoked = byWord(words, 'smoked')!;
    const tent = byWord(words, 'tent')!;
    expect(peakRel(smoked)).toBeGreaterThanOrEqual(RANK.m);
    expect(peakRel(tent)).toBeGreaterThanOrEqual(RANK.m);
  });

  it('Phase 9: a stranded preposition keeps a beat (what are you waiting for)', () => {
    // Wagner §6.5.5: only complement-taking (transitive) prepositions reduce to x; a
    // stranded "for" retains an overt beat (≥ w), not the zero-provision clitic tier.
    const { words } = analyse('what are you waiting for');
    const forW = byWord(words, 'for')!;
    expect(peakRel(forW)).toBeGreaterThanOrEqual(RANK.w);
  });

  it('Phase 3: a comma boundary is stronger than a phrase-internal break', () => {
    // Boundary strength scales with punctuation + clause separation (Wagner Ch.5).
    const { words, ius } = analyse('In Pakistan, Tuesday is a holiday');
    const b = computeBoundaries(words, ius);
    const maxStrength = Math.max(0, ...b.phi.map(p => p.strength));
    expect(maxStrength).toBeGreaterThan(0.5);               // a real graded break exists
    expect(b.phi.every(p => p.strength >= 0 && p.strength <= 1)).toBe(true);  // normalised 0..1
  });

  it('Lock-in: a clean line stays differentiated (not a plateau of nuclei)', () => {
    // The relativiser must keep a per-φ beat structure, not flatten every content
    // word to s.  (A degenerate noun-pile PARSE can still give one nuclear per φ;
    // this checks a cleanly-parsing pentameter keeps secondary beats below the nuclei.)
    const { words } = analyse('Rough winds do shake the darling buds of May');
    const sCount = words.filter(w => peakRel(w) === RANK.s).length;
    const contentCount = words.filter(w => w.isContent).length;
    expect(sCount).toBeGreaterThanOrEqual(1);               // at least one nuclear beat
    expect(sCount).toBeLessThan(contentCount);              // differentiated, not all-s
  });

  it('a SECONDARY stress surfaces as n, distinct from unstressed w (accelerated)', () => {
    // "accelerated" = AE0 K S EH1 L ER0 EY2 T IH0 D → lexicalStress [0,2,0,1,0]:
    // primary on "cel", a strong (EY2) secondary on "at".  The relativiser must keep
    // BOTH — primary on a beat tier, secondary on 'n' — never collapsing the secondary
    // to the unstressed 'w' run.
    const { words } = analyse('Of its accelerated grimace');
    const acc = byWord(words, 'accelerated')!;
    const rel = acc.syllables.map(s => s.relativeStress);
    const primaryIdx = acc.syllables.findIndex(s => (s.lexicalStress ?? 0) === 2);
    const secondaryIdx = acc.syllables.findIndex(s => (s.lexicalStress ?? 0) === 1);
    expect(RANK[rel[secondaryIdx]!]).toBe(RANK.n);                       // secondary → n
    expect(RANK[rel[primaryIdx]!]).toBeGreaterThan(RANK[rel[secondaryIdx]!]);  // primary > secondary
    // and the secondary must outrank the genuinely unstressed syllables
    const unstressed = acc.syllables.filter(s => (s.lexicalStress ?? 0) === 0);
    expect(unstressed.every(s => RANK[s.relativeStress!] < RANK.n)).toBe(true);
  });

  it('Givenness: an indefinite-pronoun head yields the nuclear + opens a ϕ (Something for the modern stage)', () => {
    // Wagner §6.5.1 + §7.2.3: the post-nominal PP of the LIGHT, inherently-given head
    // "Something" opens its own ϕ (a phrasing break after it), and "Something" keeps
    // its lexical contour (SOME=m) but yields the utterance nuclear to "stage".
    const { words, ius } = analyse('Something for the modern stage');
    const something = byWord(words, 'something')!;
    const stage = byWord(words, 'stage')!;
    const modern = byWord(words, 'modern')!;
    expect(peakRel(stage)).toBe(RANK.s);                       // stage is the nuclear
    expect(peakRel(something)).toBe(RANK.m);                   // given head: a beat, not the nuclear, not crushed
    expect(peakRel(modern)).toBeLessThan(peakRel(stage));      // modern < stage (tilted, not flat)
    expect(ius[0].phonologicalPhrases.length).toBeGreaterThanOrEqual(2);  // pause after "Something"
  });

  it('Negator: "no" keeps a beat, never the reduced determiner tier (with no loss of time)', () => {
    // The negative determiner is a negator (n-tier), not a reducible article (x).
    const { words } = analyse('Made with no loss of time');
    const no = byWord(words, 'no')!;
    expect(peakRel(no)).toBeGreaterThanOrEqual(RANK.n);
  });

  it('OOV secondary: a genuinely out-of-vocabulary polysyllable gets its rhythmic secondary', () => {
    // The English Stress Rule must not leave a long OOV word with one stress and a flat
    // tail — pretonic alternation gives it a real secondary ('n'-tier) beat.
    const { words } = analyse('Apalachicola flows on');
    const w = byWord(words, 'apalachicola')!;
    const primary = w.syllables.some(s => (s.lexicalStress ?? 0) === 2);
    const secondary = w.syllables.filter(s => (s.lexicalStress ?? 0) === 1).length;
    expect(primary).toBe(true);
    expect(secondary).toBeGreaterThanOrEqual(1);               // not a single lone stress
  });

  it('clash invariant holds: no two adjacent syllables share n / m / s', () => {
    for (const line of [
      'The woman wore the hat', 'the invisible worm that flies in the night',
      'old and gray and full of sleep', 'Rough winds do shake the darling buds of May',
    ]) {
      const { words } = analyse(line);
      const syls = words.flatMap(w => w.syllables.map(s => s.relativeStress ?? 'w'));
      for (let i = 0; i + 1 < syls.length; i++) {
        const a = RANK[syls[i]], b = RANK[syls[i + 1]];
        const bothBeat = a >= RANK.m && b >= RANK.m;
        const bothN = a === RANK.n && b === RANK.n;
        expect(bothBeat || bothN, `adjacent ${syls[i]}${syls[i + 1]} in "${line}"`).toBe(false);
      }
    }
  });
});
