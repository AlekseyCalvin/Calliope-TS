import { describe, it, expect } from 'vitest';
import { parseDocument, isPunctuation } from '../src/parser.js';
import {
  assignLexicalStress,
  applyCompoundStress,
  applyNuclearStress,
  assignRelativeStresses,
} from '../src/stress.js';
import { computePhraseStress } from '../src/phrasestress.js';
import { buildPhonologicalHierarchy } from '../src/phonological.js';
import { extractKeyStresses, scoreMeters } from '../src/scansion.js';
import { ScansionMachine } from '../src/scandroidNative/machine.js';
import { scanLineNatively } from '../src/scandroidNative/engine.js';
import { analyzeText, feedMultilineEvent, newMLState, ML_IDLE_MS, type MLEvent } from '../src/index.js';
import type { PhonologicalScansionDetail } from '../src/types.js';
import { classifyRhymePair, detectScheme, summarizePoem, analyzePhonopoetics, rhymeKey } from '../src/rhyme.js';
import { metricalityVerdict } from '../src/scansion.js';
import { analyzeStanzas } from '../src/index.js';
import { computeCaesurae } from '../src/caesura.js';

/** Drive the multi-line input reducer with a synthetic event sequence. */
function runMultiline(events: MLEvent[]): { result: string; lines: string[] } {
  const st = newMLState();
  let result = 'continue';
  for (const ev of events) {
    result = feedMultilineEvent(st, ev);
    if (result !== 'continue') break;
  }
  return { result, lines: st.lines };
}
const FAST = ML_IDLE_MS - 50;   // burst-speed (paste)
const SLOW = ML_IDLE_MS + 400;  // deliberate keystroke
/** A whole line of pasted text: its chars (burst), then a burst-speed newline. */
function pasteLine(text: string, firstGap = FAST): MLEvent[] {
  const evs: MLEvent[] = [];
  [...text].forEach((c, i) => evs.push({ kind: 'char', str: c, gap: i === 0 ? firstGap : FAST }));
  evs.push({ kind: 'return', gap: FAST });
  return evs;
}

function scanLine(line: string): PhonologicalScansionDetail {
  const results = analyzeText(line, false);
  return results[0].phonologicalScansion;
}

function runPipeline(line: string) {
  const doc = parseDocument(line);
  const sent = doc.sentences[0];
  assignLexicalStress(sent.words);
  const ius = buildPhonologicalHierarchy(sent);
  applyCompoundStress(ius);
  applyNuclearStress(ius);
  computePhraseStress(sent.words);   // McAleese's Phrase-Stress phase (matches the production pipeline)
  assignRelativeStresses(sent.words, ius);
  const keys = extractKeyStresses(ius, sent.words);
  const result = scoreMeters(keys, sent.words, ius);
  return { result, sent, ius, keys };
}

function hasEmptyFeet(s: string): boolean {
  return s.includes('||') || s.startsWith('|') || s.endsWith('|');
}

describe('parser', () => {
  it('parses a simple sentence into ClsDocument', () => {
    const doc = parseDocument('I love you');
    expect(doc.sentences).toHaveLength(1);
    const sent = doc.sentences[0];
    expect(sent.words).toHaveLength(3);
    expect(sent.words[0].word).toBe('i');
    expect(sent.words[0].lexicalClass).toBeTruthy();
    expect(sent.dependencies).toHaveLength(3);
    const rootDep = sent.dependencies.find(d => d.governorIndex === 0);
    expect(rootDep).toBeTruthy();
  });
});

describe('contraction handling', () => {
  it("merges we'll into a single word", () => {
    const r = scanLine("In Petersburg once more we'll be united");
    expect(r).toBeDefined();
    expect(r.meterName).toBeDefined();
  });
  it("merges we've into a single word", () => {
    const r = scanLine("Like in a place where we've entombed the sun");
    expect(r).toBeDefined();
  });
  it("merges I've into a single word", () => {
    const doc = parseDocument("I've returned to my city, I know it to tears");
    const w = doc.sentences[0].words.find(x => x.word === "i've");
    expect(w).toBeDefined();
  });
  it("merges don't into a single word", () => {
    const doc = parseDocument("don't you think the sun is brighter now");
    const w = doc.sentences[0].words.find(x => x.word === "don't");
    expect(w).toBeDefined();
  });
  it("merges it's into a single word", () => {
    const doc = parseDocument("it's a nice day");
    const w = doc.sentences[0].words.find(x => x.word === "it's");
    expect(w).toBeDefined();
    expect(doc.sentences[0].words.length).toBe(4);
  });
  it("merges can't into a single word", () => {
    const doc = parseDocument("I can't do it");
    const w = doc.sentences[0].words.find(x => x.word === "can't");
    expect(w).toBeDefined();
  });
  it("merges I'm into a single word", () => {
    const doc = parseDocument("I'm here now");
    const w = doc.sentences[0].words.find(x => x.word === "i'm");
    expect(w).toBeDefined();
    expect(doc.sentences[0].words.length).toBe(3);
  });
  it("merges might've into a single word", () => {
    const doc = parseDocument("I might've done that");
    const w = doc.sentences[0].words.find(x => x.word === "might've");
    expect(w).toBeDefined();
  });
  it('does not merge non-contraction host+clitic sequences', () => {
    const doc = parseDocument('we will go');
    const sent = doc.sentences[0];
    expect(sent.words[0].word).toBe('we');
    expect(sent.words[1].word).toBe('will');
  });
  it('a contraction line has correct syllable count', () => {
    const doc = parseDocument("In Petersburg once more we'll be united");
    assignLexicalStress(doc.sentences[0].words);
    const sylCount = doc.sentences[0].words.reduce((a, w) => a + w.syllables.length, 0);
    expect(sylCount).toBe(11);
  });
});

describe('stress', () => {
  function makeWords() {
    return [
      { text: 'city', pos: 'NN', isContent: true },
      { text: 'hall', pos: 'NN', isContent: true },
      { text: 'without', pos: 'IN', isContent: false },
      { text: 'permission', pos: 'NN', isContent: true },
      { text: 'the', pos: 'DT', isContent: false },
    ].map((w, i) => ({
      index: i + 1,
      lexicalClass: w.pos,
      lexicalDetails: '',
      lexicalPlural: false,
      position: '',
      word: w.text,
      absoluteIndex: i,
      isContent: w.isContent,
      syllables: [],
      phraseStress: 0,
    }));
  }

  function mockIus(words: any[]): any {
    return [{ phonologicalPhrases: [{ cliticGroups: [{ tokens: words }] }] }];
  }

  it('assignLexicalStress sets syllables with stress numbers', () => {
    const words = makeWords();
    assignLexicalStress(words);
    for (const w of words) {
      expect(w.syllables.length).toBeGreaterThan(0);
    }
    expect(words[0].syllables.some(s => s.stress === 2)).toBe(true);
    expect(words[4].syllables.some(s => s.stress === 2)).toBe(false);
  });

  it('applyCompoundStress adjusts adjacent noun-noun compounds', () => {
    const words = makeWords();
    assignLexicalStress(words);
    applyCompoundStress(mockIus(words));
    const cityMax = Math.max(...words[0].syllables.map(s => s.stress));
    const hallMax = Math.max(...words[1].syllables.map(s => s.stress));
    expect(cityMax).toBe(2);
    expect(hallMax).toBe(1);
  });

  it('applyNuclearStress boosts rightmost content word', () => {
    const words = makeWords();
    assignLexicalStress(words);
    applyNuclearStress(mockIus(words));
    const rightStress = words[3].syllables.reduce((a, b) => Math.max(a, b.stress), 0);
    const leftStress = words[0].syllables.reduce((a, b) => Math.max(a, b.stress), 0);
    expect(rightStress).toBeGreaterThanOrEqual(leftStress);
  });

  it('assignRelativeStresses converts numeric to symbolic levels', () => {
    const words = makeWords();
    assignLexicalStress(words);
    if (words[1] && words[4]) {
      const dep = {
        governor: words[1], dependent: words[4],
        governorIndex: 2, dependentIndex: 5, dependentType: 'det',
        governorName: 'hall', dependentName: 'the', index: 5,
      };
      words[1].dependency = dep as any;
      words[4].dependency = dep as any;
    }
    assignRelativeStresses(words, mockIus(words));
    for (const w of words) {
      for (const s of w.syllables) {
        expect(['x', 'w', 'n', 'm', 's']).toContain(s.relativeStress);
      }
    }
  });
});

describe('phonological', () => {
  it('builds IU/PP/CP hierarchy for a simple sentence', () => {
    const doc = parseDocument('The planet orbits a star');
    const sent = doc.sentences[0];
    assignLexicalStress(sent.words);
    const ius = buildPhonologicalHierarchy(sent);
    expect(ius.length).toBeGreaterThan(0);
    expect(ius[0].phonologicalPhrases.length).toBeGreaterThan(0);
    expect(ius[0].phonologicalPhrases[0].cliticGroups.length).toBeGreaterThan(0);
  });
});

describe('scansion', () => {
  it('Shall I compare thee? — iambic', () => {
    const { result } = runPipeline("Shall I compare thee to a summer's day?");
    expect(result.meterName).toBe('iambic');
    // Honest baseline: "Shall" (MD) and "I" (PRP) floor to overt-weak 'w' (the old
    // key's leading 'n·n' was itself a clash); "to" and the article "a" read 'x'
    // (zero-provision clitics).  Clash-free.
    expect(result.scansion).toBe('ww|ws|wx|xm|ws');
    expect(result.footCount).toBeGreaterThan(0);
  });

  it('The Assyrian came down — anapestic', () => {
    const { result } = runPipeline('The Assyrian came down like the wolf on the fold');
    expect(result.meterName).toBe('anapestic');
    // The three "the" plus the prepositions "like"/"on" (IN) all read 'x'
    // (zero-provision clitics), so the anapestic upbeats "like·the·WOLF /
    // on·the·FOLD" read x·x·s — textbook anapests.
    expect(result.scansion).toBe('xws|wsm|xxs|xxs');
  });

  it('I\'ve returned to my city — anapestic', () => {
    const { result } = runPipeline("I've returned to my city, I know it to tears");
    expect(result.meterName).toBe('anapestic');
    // "to"/"it" and the possessive "my" (PRP$) all read 'x' (zero-provision);
    // "I've"/"I"/"know" floor as their classes dictate.  "to·my·CIT(y)" = x·x·s.
    expect(result.scansion).toBe('wwm|xxs|wws|xxs');
  });

  it('through Eden took — iambic', () => {
    const { result } = runPipeline('Through Eden took their solitary way');
    expect(result.meterName).toBe('iambic');
    // "Through" (IN) and "their" (PRP$) read 'x' (zero-provision clitics),
    // giving clean rising feet "through·E / …their·SOL".
    expect(result.scansion).toBe('xm|ws|xm|wn|ws');
  });

  it('free verse for nonsensical empty input', () => {
    const result = scoreMeters([], []);
    expect(result.meterName).toBe('free verse');
    expect(result.scansion).toBe('');
  });

  it("You've returned here — anapestic (Mandelstam, 'Leningrad')", () => {
    // Translation of Mandelstam's anapestic-tetrameter "Ты вернулся сюда…":
    // you've·re·TURNED | here·so·SWAL | low·then·FAST | as·you·MIGHT.  Resolved by
    // (1) treating the line-final modal "might" as the final beat ("endings
    // strict"), (2) the trailing-function-run rule that keeps "as you" as upbeat,
    // (3) the coarse rising-onset cue, and (4) the project's slight ternary bias.
    const { result } = runPipeline("You've returned here, so swallow then, fast as you might");
    expect(result.meterName).toBe('anapestic');
  });

  it('And onto shores — iambic', () => {
    const { result } = runPipeline('And onto shores, with scorching fishes');
    expect(result.meterName).toBe('iambic');
  });

  it('We all live — anapestic', () => {
    const { result } = runPipeline('We all live, underneath us no country we sense');
    expect(result.meterName).toBe('anapestic');
  });

  it('Woolen gray hat — dactylic', () => {
    const { result } = runPipeline('Woolen gray hat and the crimson stars shining');
    expect(result.meterName).toBe('dactylic');
  });

  it('keeps making blue holes — amphibrachic', () => {
    const { result } = runPipeline('keeps making blue holes in the waterproof gloss');
    expect(result.meterName).toBe('amphibrachic');
  });

  it('This ivy resembles — amphibrachic', () => {
    const { result } = runPipeline('This ivy resembles the eyes of the deaf.');
    expect(result.meterName).toBe('amphibrachic');
  });

  it('We charged at the foe — anapestic', () => {
    const { result } = runPipeline('We charged at the foe, and we camped on the heath,');
    expect(result.meterName).toBe('anapestic');
  });

  it('All this time — trochaic', () => {
    const { result } = runPipeline("All this time, you'd softly utter, years on end");
    expect(result.meterName).toBe('trochaic');
  });

  it('The strong wine flows down fast — bacchic', () => {
    const { result } = runPipeline('The strong wine flows down fast');
    expect(result.meterName).toBe('bacchic');
  });

  it('But he gave no one else — maximally modulated (Tarlinskaja)', () => {
    const { result } = runPipeline("But he gave no one else a laugher's license.");
    // Tarlinskaja's textbook *maximally-modulated* iambic pentameter — iambic ONLY
    // by its poem's metre.  With the function words at honest weak prominence
    // ("But"→x, "he"→w, "a"→x) the line opens "but·he·GAVE" (a bare anapest) and
    // standalone it scans anapestic; unlike "What had I given" (below) it fits
    // iambic too poorly for stanza-consensus to recover.  We assert the honest
    // standalone reading and the clash-free invariant rather than forcing iambic by
    // over-stressing the clitics (the gaming the old 'n·n'-laden key relied on).
    // FLAGGED in AGENTS.md (2026-06-16) as the one meter-call casualty of honest
    // function-word weakening — a candidate for a context/scorer follow-up.
    expect(result.meterName).toBe('anapestic');
    expect(result.scansion).toBe('xws|ns|mxm|wsw');
    expect(hasEmptyFeet(result.scansion)).toBe(false);
  });
});

describe('expert baseline', () => {
  it('If hairs be wires — iambic', () => {
    const { result } = runPipeline('If hairs be wires, black wires grow on her head');
    expect(result.meterName).toBe('iambic');
    // "If"/"on" (IN) and the possessive "her" (PRP$) read 'x'; "be" (BE) → 'w'.
    // The OLD key carried a *black·wires = m·m clash* (`mm|sw`); the clash filter
    // now resolves it to gradient "black(n)·wires(m)" → `nm|sx`.  Clash-free.
    expect(result.scansion).toBe('xm|ws|nm|sx|xs');
  });

  it('Through Eden took — iambic', () => {
    const { result } = runPipeline('Through Eden took their solitary way');
    expect(result.meterName).toBe('iambic');
    // "Through" (IN) and "their" (PRP$) read 'x' (zero-provision clitics).
    expect(result.scansion).toBe('xm|ws|xm|wn|ws');
  });

  it('There they are my fifty men — trochaic', () => {
    const { result } = runPipeline('There they are my fifty men and women');
    expect(result.meterName).toBe('trochaic');
  });

  it('What had I given — iambic (recovered by stanza context)', () => {
    // Standalone, with honest weak function words, this maximally-modulated line
    // scans amphibrachic; embedded in its iambic poem the stanza-consensus layer
    // correctly recovers iambic (Tarlinskaja: a line's iambicity can be contextual).
    // We test that real mechanism — the line among plain iambic neighbours.
    const lines = analyzeText(
      'I sat alone and watched the embers leap\n' +
      'What had I given to hear the soft sweep\n' +
      'Of wings that crossed the cold and silent deep', false);
    expect(lines[1].phonologicalScansion.meterName).toBe('iambic');
  });

  it('Lies the subject of all verse — trochaic', () => {
    const { result } = runPipeline('Lies the subject of all verse');
    expect(result.meterName).toBe('trochaic');
    // 'x' = reduced clitics "the" (DT) and "of" (IN); "all" (PDT) stays content 'n'.
    expect(result.scansion).toBe('sx|sw|xn|s');
  });

});

describe('scansion quality', () => {
  const lines = [
    'If hairs be wires, black wires grow on her head',
    'Through Eden took their solitary way',
    'What had I given to hear the soft sweep',
    "Shall I compare thee to a summer's day?",
    'Gone were but the Winter, come were but the Spring',
    'The Assyrian came down like the wolf on the fold',
  ];

  it('no metered scansion has empty feet', () => {
    for (const line of lines) {
      const { result } = runPipeline(line);
      if (result.meterName !== 'free verse') {
        expect(hasEmptyFeet(result.scansion)).toBe(false);
      }
    }
  });

  it('metered scansions contain foot breaks', () => {
    for (const line of lines) {
      const { result } = runPipeline(line);
      expect(result.scansion).toContain('|');
    }
  });
});

describe('phonological notation', () => {
  it('includes CP, PP, IU boundary brackets', () => {
    const r = scanLine('The planet orbits a star');
    expect(r.all).toMatch(/\[/);
    expect(r.all).toMatch(/\{/);
    expect(r.all).toMatch(/</);
    expect(r.keyStresses).toMatch(/\[/);
  });

  it('includes stress symbols w m s n', () => {
    const r = scanLine('The planet orbits a star');
    expect(r.all).toMatch(/[wmsn]/);
    expect(r.keyStresses).toMatch(/[wmsn]/);
  });
});

describe('multi-line input (paste-friendly)', () => {
  it('paste WITH trailing newline + one Enter submits, keeping stanza breaks', () => {
    // Two stanzas of two lines, paste ends in a newline, then a deliberate Enter.
    const evs: MLEvent[] = [
      ...pasteLine('line one', SLOW),   // first char gap is large (since reader just opened)
      ...pasteLine('line two'),
      { kind: 'return', gap: FAST },    // blank line within the burst = stanza break
      ...pasteLine('line three'),
      ...pasteLine('line four'),        // burst ends with a trailing newline
      { kind: 'return', gap: SLOW },    // the user's single deliberate Enter → submit
    ];
    const { result, lines } = runMultiline(evs);
    expect(result).toBe('submit');
    // The blank stanza break is preserved between the two couplets.
    expect(lines.filter(l => l.trim() === '').length).toBe(1);
    expect(lines.filter(l => l.trim() !== '')).toEqual(['line one', 'line two', 'line three', 'line four']);
  });

  it('paste WITHOUT trailing newline + one Enter submits, flushing the last line', () => {
    const evs: MLEvent[] = [
      ...pasteLine('first line', SLOW),
      // last line has no burst newline; the user just presses Enter once:
      ...[...'last line'].map((c, i) => ({ kind: 'char', str: c, gap: i === 0 ? FAST : FAST } as MLEvent)),
      { kind: 'return', gap: SLOW },    // deliberate Enter after the paste burst → submit + flush
    ];
    const { result, lines } = runMultiline(evs);
    expect(result).toBe('submit');
    expect(lines.filter(l => l.trim() !== '')).toEqual(['first line', 'last line']);
  });

  it('Esc cancels (returns to menu)', () => {
    const { result } = runMultiline([...pasteLine('something'), { kind: 'escape' }]);
    expect(result).toBe('cancel');
  });

  it('slow hand-typing: a blank line finishes', () => {
    const evs: MLEvent[] = [
      ...[...'typed line'].map((c) => ({ kind: 'char', str: c, gap: SLOW } as MLEvent)),
      { kind: 'return', gap: SLOW },    // end of the typed line (no burst seen) → line break
      { kind: 'return', gap: SLOW },    // blank line → submit
    ];
    const { result, lines } = runMultiline(evs);
    expect(result).toBe('submit');
    expect(lines.filter(l => l.trim() !== '')).toEqual(['typed line']);
  });
});

describe('scandroid (independent second opinion)', () => {
  it('Corral the Weird (algorithm 1) scans regular iambic', () => {
    const m = new ScansionMachine();
    m.SetLineFeet(5, true);
    const { footlist, ok } = m.DoAlgorithm(1, 'x/x/x/x/x/');
    expect(ok).toBe(true);
    expect(footlist.length).toBe(5);
    expect(footlist.every(f => f === 'iamb')).toBe(true);
  });

  it('Maximize the Normal (algorithm 2) scans regular iambic', () => {
    const m = new ScansionMachine();
    m.SetLineFeet(5, true);
    const { footlist, ok } = m.DoAlgorithm(2, 'x/x/x/x/x/');
    expect(ok).toBe(true);
    expect(footlist.length).toBe(5);
  });

  it('scanLineNatively reads a canonical iambic pentameter line as its own verdict', () => {
    const result = scanLineNatively("Shall I compare thee to a summer's day?", { metron: 'iambic', lineFeet: 5, lineFeetSet: true });
    expect(result.metron).toBe('iambic');
    expect(result.verdict?.ok).toBe(true);
    expect(result.verdict?.footlist.length).toBe(5);
  });

  it('scanLineNatively reads a canonical anapestic line as its own verdict', () => {
    // Hartman's own syllabizer (unrelated to Calliope's) scans "Assyrian" as
    // 4 syllables, so this line is 13 syllables under Scandroid's own count --
    // a legitimate divergence from Calliope's own syllabification, not a bug.
    const result = scanLineNatively('And the sheen of their spears was like stars on the sea', { metron: 'anapestic', lineFeet: 4, lineFeetSet: true });
    expect(result.metron).toBe('anapestic');
    expect(result.verdict?.ok).toBe(true);
    expect(result.verdict?.footlist).toEqual(['anapest', 'anapest', 'anapest', 'anapest']);
  });
});

describe('end‑to‑end', () => {
  const poem = `Shall I compare thee to a summer's day?
Thou art more lovely and more temperate.
Rough winds do shake the darling buds of May,
And summer's lease hath all too short a date.`;

  it('analyzeText returns results for each line', () => {
    const results = analyzeText(poem, false);
    expect(results.length).toBe(4);
    expect(results[0].phonologicalScansion.meterName).toBe('iambic');
    expect(results[1].phonologicalScansion.meterName).toBe('iambic');
    expect(results[2].phonologicalScansion.meterName).toBe('iambic');
    expect(results[3].phonologicalScansion.meterName).toBe('iambic');
  });

  it('analyzeText with Scandroid includes Scandroid results', () => {
    const results = analyzeText(poem, true);
    for (const r of results) {
      expect(r.phonologicalScansion.meterName).toBeDefined();
      expect(r.scandroidNative).toBeDefined();
      expect(r.scandroidNative?.metron).toBe('iambic');
    }
  });

  it('useScandroid=false skips the independent Scandroid pass entirely', () => {
    const results = analyzeText(poem, false);
    for (const r of results) expect(r.scandroidNative).toBeUndefined();
  });

  it('handles free verse line gracefully', () => {
    // A famously free-verse line (Williams): there is no canonical scansion, so we
    // assert graceful handling — a defined meter and a non-empty, foot-delimited
    // scansion covering every syllable — rather than a brittle exact string.
    const results = analyzeText('so much depends upon a red wheel barrow', false);
    const d = results[0].phonologicalScansion;
    expect(d.meter).toBeDefined();
    expect(d.scansion.length).toBeGreaterThan(0);
    expect(d.scansion).toContain('|');
    // syllable letters in the scansion must equal the line's syllable count
    const sylLetters = (d.scansion.match(/[xwnms]/g) || []).length;
    const totalSyls = results[0].sentence.words.reduce((a, w) => a + w.syllables.length, 0);
    expect(sylLetters).toBe(totalSyls);
  });
});

describe('structural fixes (2026-06-10 audit)', () => {
  it('quotation marks are not prosodic breaks: quoted word scans like unquoted', () => {
    // Quotes fragmented the IU hierarchy and flipped this line to "trochaic
    // hexameter"; quoted and unquoted twins must scan identically.
    const quoted = analyzeText('I wonder why we call them "wisdom" teeth.', false)[0].phonologicalScansion;
    const plain = analyzeText('I wonder why we call them wisdom teeth.', false)[0].phonologicalScansion;
    expect(quoted.meterName).toBe('iambic');
    expect(quoted.footCount).toBe(5);
    expect(quoted.meterName).toBe(plain.meterName);
    expect(quoted.footCount).toBe(plain.footCount);
  });

  it('the LINE is the scansion domain: internal stops do not fragment the meter', () => {
    // Three grammatical sentences, one verse line (Woolley) — one iambic pentameter,
    // not trimeter + monometer + monometer fragments.
    const results = analyzeText("You'll slurp potato soup. No straws! Suck gauze.", false);
    expect(results.length).toBe(1);
    expect(results[0].phonologicalScansion.meterName).toBe('iambic');
    expect(results[0].phonologicalScansion.footCount).toBe(5);
  });

  it('mid-line exclamation keeps the line whole (Stallings-aligned)', () => {
    const results = analyzeText('Oh, bloody day! Extractions take their toll;', false);
    expect(results.length).toBe(1);
    expect(results[0].phonologicalScansion.meterName).toBe('iambic');
    expect(results[0].phonologicalScansion.footCount).toBe(5);
  });

  it('single anacrusis upbeat does not inflate the foot count', () => {
    // 10 syllables with a leading extrametrical upbeat: pentameter, never hexameter.
    const d = analyzeText('The woods around it have it--it is theirs.', false)[0].phonologicalScansion;
    expect(d.footCount).toBe(5);
    expect(d.meter).not.toContain('hexameter');
  });

  it('double upbeat fills a foot slot: Hiawatha stays tetrameter', () => {
    const d = analyzeText('By the shores of Gitche Gumee,', false)[0].phonologicalScansion;
    expect(d.meterName).toBe('trochaic');
    expect(d.footCount).toBe(4);
  });
});

describe('syllable-count integrity (2026-06-10 audit)', () => {
  const sylCount = (line: string) => {
    const r = analyzeText(line, false)[0];
    return r.sentence.words.reduce((a, w) => a + w.syllables.length, 0);
  };

  it('"am" is one syllable (not the letter-name A.M. anomaly)', () => {
    expect(sylCount('I am too absent-spirited to count;')).toBe(10);
  });

  it('"us" is one syllable (not the letter-name U.S. anomaly)', () => {
    expect(sylCount('Just for a handful of silver he left us,')).toBe(11);
  });

  it("who'll / there's / she's re-merge to one syllable each", () => {
    expect(sylCount("who'll barely recognize your puffy face.")).toBe(10);
    expect(sylCount("and there's a light she's seen")).toBe(6);
  });

  it("archaic -'d preterite does not swallow the next word", () => {
    const r = analyzeText("And heav'n knows wand'ring ev'ry fix'd star", false)[0];
    const words = r.sentence.words.map(w => w.word.toLowerCase());
    expect(words).toContain("fix'd");
    expect(words).toContain('star');
    expect(words).not.toContain('would');
    expect(sylCount("And heav'n knows wand'ring ev'ry fix'd star")).toBe(9);
  });

  it("hyphenated archaic -'d (hen-peck'd) stays one 2-syllable word, not compound+would", () => {
    const r = analyzeText("Inform us truly, have they not hen-peck'd you all?", false)[0];
    const words = r.sentence.words.map(w => w.word.toLowerCase());
    expect(words).toContain("hen-peck'd");
    expect(words).not.toContain('would');
    const hp = r.sentence.words.find(w => w.word.toLowerCase() === "hen-peck'd")!;
    expect(hp.syllables.length).toBe(2);                 // hen·peckt (the -'d is silent)
  });

  it("th'-elision keeps the host's stress (th'ex-PENSE, not TH'EX-pense)", () => {
    const r = analyzeText("Th'expense of spirit in a waste of shame", false)[0];
    const w = r.sentence.words.find(x => x.word.toLowerCase().startsWith("th'"))!;
    expect(w.syllables.length).toBe(2);
    const rank: Record<string, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
    expect(rank[w.syllables[1].relativeStress!]).toBeGreaterThan(rank[w.syllables[0].relativeStress!]);
  });

  it("'tis / 'twas are weak aphaeresis clitics, not stressed proper nouns", () => {
    const r = analyzeText("'Tis true, 'twas night", false)[0];
    const tis = r.sentence.words.find(w => w.word.toLowerCase().includes('tis'))!;
    const twas = r.sentence.words.find(w => w.word.toLowerCase().includes('twas'))!;
    expect(['x', 'w']).toContain(tis.syllables[0].relativeStress);
    expect(['x', 'w']).toContain(twas.syllables[0].relativeStress);
  });
});

describe('caesura foot-alignment (2026-06-14)', () => {
  // Foot edges = cumulative syllable counts after each foot of the scansion string.
  const footEdges = (scan: string) => {
    const set = new Set<number>(); let c = 0;
    for (const foot of scan.split('|')) { for (const ch of foot) if ('xwnms'.includes(ch)) c++; set.add(c); }
    return set;
  };

  it('"But—Oh! ye lords…" breaks after the foot, never fragmenting the monosyllable "But"', () => {
    const l = analyzeStanzas('But—Oh! ye lords of ladies intellectual,').flat()[0];
    const d = l.phonologicalScansion;
    const caes = computeCaesurae(l.sentence.words, l.phonologicalHierarchy, d.scansion);
    const edges = footEdges(d.scansion);
    expect(caes.size).toBeGreaterThan(0);
    for (const pos of caes.keys()) expect(edges.has(pos)).toBe(true); // every caesura on a foot edge
    expect(caes.has(1)).toBe(false);                                   // not after "But" alone
  });

  it('Poe gets one medial caesura at the comma (trochaic octameter midpoint)', () => {
    const l = analyzeStanzas('Once upon a midnight dreary, while I pondered weak and weary').flat()[0];
    const d = l.phonologicalScansion;
    const caes = computeCaesurae(l.sentence.words, l.phonologicalHierarchy, d.scansion);
    for (const pos of caes.keys()) expect(footEdges(d.scansion).has(pos)).toBe(true);
    expect([...caes.keys()]).toContain(8);   // after "dreary," — the line's medial break
  });
});

describe('rising function words & copula reduction (2026-06-14)', () => {
  const rank: Record<string, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
  const wordOf = (line: string, w: string) =>
    analyzeText(line, false)[0].sentence.words.find(x => x.word.toLowerCase() === w)!;

  // "because" is recorded fully-reduced ("00") in the augmented dictionary; the
  // all-zero re-stamp must rise (be·CAUSE), not take the disyllabic forestress
  // default (which mis-read it as BE·cause).
  it('"because" rises (be·CAUSE): the final syllable outranks the first', () => {
    const because = wordOf('Because at least the past were passed away,', 'because');
    expect(because.syllables.length).toBe(2);
    expect(rank[because.syllables[1].relativeStress!])
      .toBeGreaterThan(rank[because.syllables[0].relativeStress!]);
  });

  // The 1sg copula "am" reduces — it must not surface as a metrical beat ('m')
  // the way the letter-name A.M. data once forced it ("As I am BLOOD…").
  it('the copula "am" reduces — no spurious beat in "As I am blood…"', () => {
    const am = wordOf('As I am blood, bone, marrow, passion, feeling', 'am');
    expect(am.syllables.length).toBe(1);
    expect(rank[am.syllables[0].relativeStress!]).toBeLessThanOrEqual(rank['w']);
  });

  // An interjection immediately before "!" is an emphatic peak — it must stand out
  // from the flat function-word run around it ("But—Oh! ye…" was a monotone n·n·n).
  it('an exclaimed interjection (Oh!) outranks the conjunction/pronoun beside it', () => {
    const words = analyzeText('But—Oh! ye lords of ladies intellectual,', false)[0].sentence.words;
    const peak = (w: string) => {
      const word = words.find(x => x.word.toLowerCase() === w)!;
      return Math.max(...word.syllables.map(s => rank[s.relativeStress!]));
    };
    expect(peak('oh')).toBeGreaterThan(peak('but'));
    expect(peak('oh')).toBeGreaterThan(peak('ye'));
  });
});

describe('rhyme & form layer (2026-06-12)', () => {
  it('classifies canonical rhyme pairs (LYRICAL typology)', () => {
    expect(classifyRhymePair('grace', 'face')).toMatchObject({ type: 'perfect', structure: 'masculine' });
    expect(classifyRhymePair('picky', 'tricky')).toMatchObject({ type: 'perfect', structure: 'feminine' });
    expect(classifyRhymePair('belief', 'leaf')).toMatchObject({ type: 'rich' });     // homophone tails
    expect(classifyRhymePair('dame', 'grain')).toMatchObject({ type: 'family' });    // M/N nasals
    expect(classifyRhymePair('love', 'move')).toMatchObject({ type: 'consonant' });  // para-rhyme
    expect(classifyRhymePair('shaken', 'shaken')).toMatchObject({ type: 'identical' });
  });

  it('detects ABCB with unrhymed lines marked', () => {
    const rs = detectScheme(['Mariner', 'three', 'eye', 'me']);
    expect(rs.map(r => r.letter).join('')).toBe('\u00b7A\u00b7A');
  });

  it('Coleridge quatrain \u2192 ballad stanza (rhyme + 4\u00b73 gate)', () => {
    const r = analyzeStanzas('It is an ancient Mariner,\nAnd he stoppeth one of three.\nBy thy long grey beard and glittering eye,\nNow wherefore stopp\u2019st thou me?');
    expect(r[0][0].phonologicalScansion.formNote).toBe('ballad stanza (ABCB, 4\u00b73)');
  });

  it('Pope couplet \u2192 couplet', () => {
    const r = analyzeStanzas('True wit is nature to advantage dressed,\nWhat oft was thought, but ne\u2019er so well expressed.');
    expect(r[0][0].phonologicalScansion.formNote).toBe('couplet');
  });

  it('Frost (Mending Wall opening) \u2192 blank verse', () => {
    const r = analyzeStanzas("Something there is that doesn't love a wall,\nThat sends the frozen-ground-swell under it,\nAnd spills the upper boulders in the sun;\nAnd makes gaps even two can pass abreast.");
    expect(r[0][0].phonologicalScansion.formNote).toBe('blank verse');
  });

  it('Sonnet 130 \u2192 Shakespearean Sonnet, full scheme', () => {
    const text = "My mistress' eyes are nothing like the sun;\nCoral is far more red than her lips' red;\nIf snow be white, why then her breasts are dun;\nIf hairs be wires, black wires grow on her head.\nI have seen roses damask'd, red and white,\nBut no such roses see I in her cheeks;\nAnd in some perfumes is there more delight\nThan in the breath that from my mistress reeks.\nI love to hear her speak, yet well I know\nThat music hath a far more pleasing sound;\nI grant I never saw a goddess go;\nMy mistress, when she treads, walks on the ground.\nAnd yet, by heaven, I think my love as rare\nAs any she belied with false compare.";
    const r = analyzeStanzas(text);
    expect(r[0][0].phonologicalScansion.formNote).toBe('Shakespearean Sonnet');
    expect(r[0].map(l => l.phonologicalScansion.rhyme!.letter).join('')).toBe('ABABCDCDEFEFGG');
  });

  it('Lear limerick \u2192 limerick (AABBA, ternary)', () => {
    const r = analyzeStanzas('There was an Old Man with a beard,\nWho said, It is just as I feared!\nTwo Owls and a Hen,\nFour Larks and a Wren,\nHave all built their nests in my beard!');
    expect(r[0][0].phonologicalScansion.formNote).toMatch(/^limerick/);
  });
});

describe('continuity rename (2026-06-14)', () => {
  it('near-tie line adopts the stanza-dominant meter; standalone kept as note', () => {
    // Exile opening: L2 standalone reads dactylic (spondaic "book-" anacrusis
    // seizes a beat), but the stanza is amphibrachic — continuity renames it.
    const r = analyzeStanzas(
      'He happens to be a French poet, that thin,\n' +
      'book-carrying man with a bristly gray chin;\n' +
      'you meet him whenever you go');
    const d = r[0][1].phonologicalScansion;
    expect(d.meterName).toBe('amphibrachic');
    expect(d.standaloneMeter).toMatch(/dactylic/);
    expect(d.consensusMeter).toBeUndefined();
  });

  it('accentual stanzas are exempt: Wyatt keeps 4-beat accentual, no renames', () => {
    const wyatt =
      'They fle from me that sometyme did me seke\n' +
      'With naked fote stalking in my chambre.\n' +
      'I have sene theim gentill tame and meke\n' +
      'That nowe are wyld and do not remembre\n' +
      'That sometyme they put theimself in daunger\n' +
      'To take bred at my hand; and nowe they raunge\n' +
      'Besely seking with a continuell chaunge.';
    const r = analyzeStanzas(wyatt);
    for (const l of r[0]) {
      expect(l.phonologicalScansion.rhythmNote).toBe('4-beat accentual');
      expect(l.phonologicalScansion.standaloneMeter).toBeUndefined();
    }
  });
});

describe('parse-correction layer (2026-06-14)', () => {
  it('staged pipeline repairs "I had quit the programming paradigm"', () => {
    const doc = parseDocument('I had quit the programming paradigm');
    const words = doc.sentences[0].words;
    expect(words.find(w => w.word === 'i')!.lexicalClass).toBe('PRP');
    expect(words.find(w => w.word === 'quit')!.lexicalClass).toBe('VBN');
    const deps = doc.sentences[0].dependencies;
    const prog = deps.find(d => d.dependentName === 'programming')!;
    // Re-baselined 2026-07-02 (UDPIPE_MIGRATION.md Group B): the old golden 'amod'
    // encoded the depfix repair of en-parse's broken reading ("programming ←DOBJ←
    // quit").  UDPipe parses the gerund-noun pair directly as `compound` — the
    // standard UD treatment, and the one that feeds the correct CSR forestress
    // ("PROgramming paradigm").
    expect(prog.dependentType).toBe('compound');
    expect(prog.governorName).toBe('paradigm');
    const det = deps.find(d => d.dependentName === 'the')!;
    expect(det.dependentType).toBe('det');
    expect(det.governorName).toBe('paradigm');
  });

  it('archaic forms get verse-correct tags (thy/PRP$ floors at w)', () => {
    const doc = parseDocument('By thy long grey beard and glittering eye,');
    const thy = doc.sentences[0].words.find(w => w.word === 'thy')!;
    expect(thy.lexicalClass).toBe('PRP$');
  });

  it('context-guarded gerund fix: "they bicycle through" keeps the verb', () => {
    const doc = parseDocument('young beauties, all legs, as they bicycle through');
    const bike = doc.sentences[0].words.find(w => w.word === 'bicycle')!;
    expect(bike.lexicalClass).toBe('VBP');
  });
});

describe('metricality, foot names, beats & poem-wide rhyme (2026-06-13)', () => {
  it('extends foot-count nomenclature through icosameter', () => {
    // A long run of clean "the cat" iambs names the line all the way up.
    const feet14 = analyzeText(Array.from({ length: 14 }, () => 'the cat').join(' '))[0]
      .phonologicalScansion;
    expect(feet14.footCount).toBe(14);
    expect(feet14.meter).toBe('iambic tetradecameter');
    const feet20 = analyzeText(Array.from({ length: 20 }, () => 'the cat').join(' '))[0]
      .phonologicalScansion;
    expect(feet20.meter).toBe('iambic icosameter');
  });

  it('prose-likeness hedge fires on long un-lineated prose', () => {
    const d = analyzeText(
      "Another thing I've noticed more generally is that the current engine's caesural mechanics may be disruptive",
    )[0].phonologicalScansion;
    expect(d.metricalityNote).toBeDefined();
    expect(d.metricalityNote).toContain('plausible prose');
    expect(d.metricalityNote).toContain(d.meter);          // closest-fit name echoed
    expect(d.meter).toMatch(/decameter$/);                 // long foot-name in use
  });

  it('hedge spares short verse, incl. low-certainty / ambiguous lines', () => {
    // Real verse below the 9-foot length gate is never flagged — not even
    // V6 ("Half a league", certainty ~40) or L2 (Prufrock, an iamb/troch tie).
    for (const v of [
      "Shall I compare thee to a summer's day?",
      'Half a league, half a league, half a league onward',
      'Let us go then, you and I',
      'This is the forest primeval, the murmuring pines and the hemlocks',
    ]) {
      expect(analyzeText(v)[0].phonologicalScansion.metricalityNote).toBeUndefined();
    }
  });

  it('metricalityVerdict is purely a function of the detail fields', () => {
    // No straddle (top-3 all one polarity/size) ⇒ never prose, even if long.
    const committed: PhonologicalScansionDetail = {
      all: '', keyStresses: '', meter: 'iambic dodecameter', meterName: 'iambic',
      footCount: 12, summary: '', scansion: '', certainty: 40,
      weightScore: 0, maxPossibleWeight: 0,
      ranking: [{ meter: 'iambic', score: 1.0 }, { meter: 'trochaic', score: 0.95 }],
    };
    expect(metricalityVerdict(committed)).toBeUndefined();
  });

  it('end-rhyme types are preserved; lettering is poem-wide (not per-stanza)', () => {
    // The rhyme TYPE rides on the line that completes the rhyme (dressed/expressed → rich).
    const c = analyzeStanzas('True wit is nature to advantage dressed,\nWhat oft was thought, but ne’er so well expressed.');
    expect(c.flat()[1].phonologicalScansion.rhyme!.type).toBe('rich');
    // Two couplets of UNRELATED sounds, in separate stanzas: each stanza still
    // reads AA on its own, but the two A's must be DIFFERENT poem-wide keys —
    // lettering runs once over the whole poem, so an unrelated stanza never
    // reuses an earlier stanza's letter.
    const two = analyzeStanzas('The cat sat on the mat,\nbeside a sleeping rat.\n\nThe sun was in the sky,\nas clouds went drifting by.');
    expect(two.map(st => st.map(l => l.phonologicalScansion.rhyme!.letter).join(''))).toEqual(['AA', 'BB']);
  });

  it('a stanza-1 line rhyming ONLY with a stanza-2 line still shares one poem-wide key', () => {
    // L1 "still" and L4 "chill" bind ACROSS the stanza break; L2 "wall" and
    // L3 "light" are each unrhymed on their own.  The end-rhyme letter must
    // be identical on both lines, matchedLine must be the POEM-GLOBAL index
    // of L1 (0, not stanza-local), and the synopsis' End-Rhyme Scheme row
    // must read off exactly the same per-line letters (single source of truth).
    const text = 'The house was calm and still,\nbeyond the garden wall,\n\n'
      + 'we watched the fading light,\nuntil the coming chill.';
    const r = analyzeStanzas(text);
    const l1 = r[0][0].phonologicalScansion.rhyme!;
    const l4 = r[1][1].phonologicalScansion.rhyme!;
    expect(l1.letter).not.toBe('·');
    expect(l1.letter).toBe(l4.letter);                        // (i) same poem-wide letter
    expect(l4.matchedLine).toBe(0);                           // (iii) poem-global index of L1
    const perLine = r.flatMap(st => st.map(l => l.phonologicalScansion.rhyme!.letter)).join('');
    const row = summarizePoem(r).find(row => row.label === 'End-Rhyme Scheme')!.value;
    expect(row).toBe(perLine);                                // (ii) synopsis matches per-line letters
  });

  it('rhymeKey: unbounded bijective base-26 (A…Z, then AA, AB, …)', () => {
    expect(rhymeKey(0)).toBe('A');
    expect(rhymeKey(25)).toBe('Z');
    expect(rhymeKey(26)).toBe('AA');
    expect(rhymeKey(27)).toBe('AB');
    expect(rhymeKey(51)).toBe('AZ');
    expect(rhymeKey(52)).toBe('BA');
  });

  it('pre-caesural internal rhyme is additive (own letter + type), end rhyme intact', () => {
    // end beam/dream → A (perfect); internal night/bright form their own class → B.
    const r = analyzeStanzas('The stars at night, a silver beam,\nshine ever bright as in a dream.');
    const lines = r.flat();
    expect(lines.map(l => l.phonologicalScansion.rhyme!.notation)).toEqual(['(B)A', '(B)A']);
    expect(lines[0].phonologicalScansion.rhyme!.letter).toBe('A');               // end letter untouched
    expect(lines[0].phonologicalScansion.rhyme!.internal)
      .toEqual([{ word: 'night', letter: 'B', type: 'perfect' }]);
  });

  it('heterometric is an advisory only — never stamped on per-line rhythmNote', () => {
    const song = 'If each wire looks barbed, it actually is\nBlessed are they lounged at cemeteries\n' +
      'Not quite enough for all, but we still don’t care\nNo shit exists so noxious, we don’t binge and share\n' +
      'But it looks like, it’s for the long haul\nLooks like it is habitual\n' +
      'Looks like it’s quite a catch-all\nLooks like it’s just a lack of\nSOMEBODY MORE\nOF SOMEBODY MORE';
    const r = analyzeStanzas(song);
    for (const l of r.flat()) {
      expect(l.phonologicalScansion.rhythmNote ?? '').not.toContain('heterometric');
      expect(l.phonologicalScansion.meterName).not.toBe('free verse'); // lines keep a real meter
    }
    // The line-length-variation observation lives in the synopsis instead
    // ("heterometric" wording dropped 2026-06-16 per the maintainer).
    const note = summarizePoem(r).find(row => row.label === 'Note')?.value ?? '';
    expect(note).toContain('line lengths vary');
  });

  it('poem synopsis: accentual reported in beats; sonnet form + meter', () => {
    const wyatt = 'They fle from me that sometyme did me seke\n' +
      'With naked fote stalking in my chambre.\nI have sene theim gentill tame and meke\n' +
      'That nowe are wyld and do not remembre\nThat sometyme they put theimself in daunger\n' +
      'To take bred at my hand; and nowe they raunge\nBesely seking with a continuell chaunge.';
    // The metre make-up lives in the "Rhythm" row (relabelled 2026-06-16).
    const wMeter = summarizePoem(analyzeStanzas(wyatt)).find(r => r.label === 'Rhythm')!.value;
    expect(wMeter).toContain('accentual');         // beats, not feet
    expect(wMeter).not.toMatch(/meter\b/);         // no classical foot-length name

    const sonnet = "My mistress' eyes are nothing like the sun;\nCoral is far more red than her lips' red;\n" +
      "If snow be white, why then her breasts are dun;\nIf hairs be wires, black wires grow on her head.\n" +
      "I have seen roses damask'd, red and white,\nBut no such roses see I in her cheeks;\n" +
      'And in some perfumes is there more delight\nThan in the breath that from my mistress reeks.\n' +
      "I love to hear her speak, yet well I know\nThat music hath a far more pleasing sound;\n" +
      'I grant I never saw a goddess go;\nMy mistress, when she treads, walks on the ground.\n' +
      'And yet, by heaven, I think my love as rare\nAs any she belied with false compare.';
    const rows = summarizePoem(analyzeStanzas(sonnet));
    expect(rows.find(r => r.label === 'Form')!.value).toContain('Shakespearean Sonnet');
    // Metre make-up now in "Rhythm", abbreviated ("iamb penta") 2026-06-16.
    expect(rows.find(r => r.label === 'Rhythm')!.value).toContain('iamb penta');
  });
});

describe('phonopoetics (2026-06-16)', () => {
  it('end-rhyme pair + alliteration + head rhyme (three-phase lettering)', () => {
    const p = analyzePhonopoetics(analyzeStanzas(
      'Here were fond climates and sweet singers suddenly\n' +
      'Nap on the hill and gap in the rolling cloud\n' +
      'Come in the morning where I wandered and rhyme\n' +
      'Gap on the crest where weary wanderers time'));
    // END: rhyme/time bind to one letter
    expect(p.end.some(r => (r.fromWord === 'rhyme' && r.toWord === 'time') || (r.fromWord === 'time' && r.toWord === 'rhyme'))).toBe(true);
    // HEAD: Nap/Gap, lettered AFTER the end letters (continue the alphabet), once
    expect(p.head.length).toBe(1);
    expect(new Set([p.head[0].fromWord, p.head[0].toWord])).toEqual(new Set(['Gap', 'Nap']));
    // ALLITERATION carries no letters; "sweet singers suddenly" is one run
    expect(p.alliteration.some(a => a.words.join(' ').toLowerCase() === 'sweet singers suddenly')).toBe(true);
  });

  it('caesural rhyme reuses the exact end-pair letter it echoes', () => {
    const p = analyzePhonopoetics(analyzeStanzas(
      'In the silent night, I saw a gleaming light\n' +
      'With all of my might, I walked the path of sight'));
    const c = p.caesural.find(r => r.fromWord === 'night');
    expect(c).toBeTruthy();
    const e = p.end.find(r => r.fromWord === 'light' || r.toWord === 'light');
    expect(e).toBeTruthy();
    expect(c!.letter).toBe(e!.letter);   // night (pre-caesural) reused light's letter
  });

  it('acrostic spells a dictionary word from line initials', () => {
    const p = analyzePhonopoetics(analyzeStanzas(
      'Bright was the morning sun\nIn the cold and dawn\nNever a cloud above\nGone is the silent night\nOver the hills it came'));
    expect(p.acrostics.some(a => a.word === 'BINGO')).toBe(true);
  });
});

describe('stress-clash invariant (2026-06-16)', () => {
  // The maintainer's categorical, input-independent rule (generalising McAleese's
  // "stress clashes (ss,ms) > s-s" and Liberman & Prince's grid alternation):
  // on the STRESSED tier {n,m,s} NO two adjacent syllables may share a level — that
  // is a clash (two equal prominences with no gradation).  Gradient pairs
  // (sm/ms/sn/ns/mn/nm) are fine; the unstressed tiers {w,x} MAY repeat.  This must
  // hold for ANY input — it is enforced by the clash filter (resolveLinearClashes).
  // "It's kind of a crime it's not a test already." — so here it is.
  const STRESSED = new Set(['n', 'm', 's']);

  function clashesIn(text: string): string[] {
    const bad: string[] = [];
    for (const lr of analyzeText(text, false)) {
      // A clash is two equal stressed syllables CONTIGUOUS in pronunciation.
      // Punctuation is a prosodic break, so syllables either side of it are not
      // contiguous (a '|' sentinel, not in STRESSED, breaks the adjacency scan).
      const seq: { lvl: string; word: string }[] = [];
      for (const w of lr.sentence.words) {
        if (isPunctuation(w.lexicalClass)) { seq.push({ lvl: '|', word: '' }); continue; }
        for (const s of w.syllables) seq.push({ lvl: s.relativeStress ?? '?', word: w.word });
      }
      const line = lr.sentence.words.filter(w => !isPunctuation(w.lexicalClass)).map(w => w.word).join(' ');
      for (let i = 0; i < seq.length - 1; i++) {
        if (seq[i].lvl === seq[i + 1].lvl && STRESSED.has(seq[i].lvl)) {
          bad.push(`${seq[i].lvl}${seq[i + 1].lvl} ("${seq[i].word}"+"${seq[i + 1].word}") in "${line}"`);
        }
      }
    }
    return bad;
  }

  // The maintainer's own example battery (the regression set that exposed the
  // clashes), plus canonical verse of every metre.
  const battery: Record<string, string> = {
    'Thomas — There could I marvel': 'There could I marvel my birthday',
    'Thomas — Poem in October (st.1)':
      'My birthday began with the water-\nBirds and the birds of the winged trees flying my name\n' +
      'Above the farms and the white horses\nAnd I rose\nIn rainy autumn\n' +
      'And walked abroad in a shower of all my days.',
    'Gypsies — bachelor / gypsies':
      "O, I am a bachelor, I live by myself\n" +
      "And the only, only thing that I ever did was wrong\n" +
      "So all night long I held her in my arms\n" +
      "One night she came to my bedside\n" +
      "I fear you have had some ill sickness\n" +
      "One sang high and the other sang low\n" +
      "The ragged, ragged rags about our door\n" +
      "It was late last night when my lord came home",
    'Byron — intellectual / hen-peck\'d':
      "But—Oh! ye lords of ladies intellectual,\nInform us truly, have they not hen-peck'd you all?",
    'Byron — vaunt / Don Juan':
      'Of such as these I should not care to vaunt,\nI\'ll therefore take our ancient friend Don Juan',
    'Shakespeare — Sonnet 130 (q.1)':
      "My mistress' eyes are nothing like the sun;\nCoral is far more red than her lips' red;\n" +
      "If snow be white, why then her breasts are dun;\nIf hairs be wires, black wires grow on her head.",
    'Poe — The Raven (opening)':
      'Once upon a midnight dreary, while I pondered weak and weary,\n' +
      'Over many a quaint and curious volume of forgotten lore',
    'Milton — Paradise Lost (opening)':
      'Of Mans First Disobedience, and the Fruit\nOf that Forbidden Tree, whose mortal tast',
  };

  for (const [name, text] of Object.entries(battery)) {
    it(`no adjacent equal stress on {n,m,s} — ${name}`, () => {
      const bad = clashesIn(text);
      expect(bad, bad.join(' ; ')).toEqual([]);
    });
  }
});

// Stress-level tuning from the Sosnora-translation review (2026-06-21).
describe('stress-level tuning (Sosnora review, 2026-06-21)', () => {
  it('curly-apostrophe contractions tokenise like straight ones (won’t = 1 modal)', () => {
    // A curly ’ bypassed the contraction path and en-norm dehiscised "won’t"
    // into "will not" (2 syllables); the apostrophe is now normalised first.
    const curly = parseDocument('I won’t tell anyone').sentences[0].words.map(w => w.word);
    const straight = parseDocument("I won't tell anyone").sentences[0].words.map(w => w.word);
    expect(curly).toEqual(straight);
    expect(curly).toContain("won't");
    expect(curly).not.toContain('will');           // not expanded to "will not"
  });

  it('aren’t / Nature’s with curly apostrophe tokenise correctly', () => {
    const w = parseDocument('boats aren’t tears').sentences[0].words.map(x => x.word);
    expect(w).toContain("aren't");
    const poss = parseDocument('Nature’s first green').sentences[0].words.map(x => x.word);
    expect(poss).toContain("'s");                  // possessive clitic split off
  });

  it('N+N compound fore-stresses even when en-parse inverts the dependency arrow', () => {
    // "slate roof"/"clay jar" parse as roof→slate / jar→clay (head on the LEFT),
    // the inverse of "ice cream"; the left noun must still fore-stress (CSR).
    for (const np of ['a slate roof', 'a clay jar']) {
      const d = analyzeText(np, false)[0].phonologicalScansion;
      expect(d.scansion, np).toBe('xsn');          // a·SLATE·roof  (beat on the modifier)
    }
    // the canonical NOMD case is unchanged
    expect(analyzeText('ice cream', false)[0].phonologicalScansion.scansion).toBe('sn');
  });

  it('a reduced copula after a function word floors below it (it·is gradient)', () => {
    // "it is" was a flat w·w; the copula now reduces to x, restoring the gradient.
    // Re-derived 2026-06-29 (Wagner/Krifka rebuild): the assertion verifies the
    // copula reduction it(w)·is(x) at the head; the foot boundary after it is no
    // longer pinned, because deictic "here" now carries a light content beat
    // (it·is·GOLD·here → wxsn), a defensible differentiation that re-segments the
    // feet without touching the is→x reduction the test exists to check.
    expect(analyzeText('it is gold here', false)[0].phonologicalScansion.scansion).toMatch(/^wx/);
  });
});


// ─── UDPipe feature leverage & challenging constructions (2026-06-23) ─────────
// These exercise the PRODUCTION (Calliope) engine — `analyzeText` — not the
// legacy runPipeline path, and lean on UDPipe features en-parse never produced:
// the `compound` relation (genuine N+N fore-stress) and the model-agnostic
// UPOS+FEATS POS derivation.  See AGENTS.md log 2026-06-23.
describe('UDPipe feature leverage & challenging constructions (2026-06-23)', () => {
  const RANK: Record<string, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
  const lineResult = (line: string) => analyzeText(line, false)[0];
  const peakRel = (w: any) =>
    Math.max(...w.syllables.map((s: any) => RANK[s.relativeStress ?? 'w']));
  const wordByText = (lr: any, t: string) =>
    lr.sentence.words.find((w: any) => w.word === t);
  const phiCount = (lr: any) =>
    lr.phonologicalHierarchy.reduce((n: number, iu: any) => n + iu.phonologicalPhrases.length, 0);

  it('N+N compounds fore-stress via the UD `compound` relation (ICE cream, DOOR man, STONE wall)', () => {
    for (const [phrase, a, b] of [
      ['ice cream', 'ice', 'cream'],
      ['the door man', 'door', 'man'],
      ['a stone wall', 'stone', 'wall'],
    ]) {
      const lr = lineResult(phrase);
      expect(peakRel(wordByText(lr, a)), `${phrase}: ${a} should fore-stress over ${b}`)
        .toBeGreaterThan(peakRel(wordByText(lr, b)));
    }
  });

  it('canonical iambic lines read iambic on the production engine', () => {
    // Milton, Paradise Lost 1.1 (iambic pentameter); Kilmer, Trees (iambic tetrameter).
    expect(scanLine("Of Man's first disobedience, and the fruit").meterName).toBe('iambic');
    expect(scanLine('I think that I shall never see').meterName).toBe('iambic');
  });

  it('ϕ-grouping is not over-segmented: a verb + light oblique PP stay one phrase', () => {
    // Selkirk: "{[More than fifteen][carpenters]}{[are working][in the house]}" = 2 ϕ.
    // Before the OBL fix this shattered into 5 ϕ, washing out the key stresses.
    const lr = lineResult('More than fifteen carpenters are working in the house');
    expect(phiCount(lr)).toBeLessThanOrEqual(3);
  });

  it('carpenters line: subject NP is ONE ϕ, "in the house" its own ϕ (3 ϕ total)', () => {
    // Expert/Gee&Grosjean gold (McAleese p.213):
    //   <{[More than fifteen carpenters]}{[are working]}{[in the house]}>  — 3 ϕ.
    // The subject NP must NOT shatter ("more" is not its own ϕ) and the verbal
    // oblique "in the house" IS its own ϕ.  (A prior build gave 5 ϕ — every
    // argument a phrase — which made every spurious ϕ-end a key stress.)
    const lr = lineResult('More than fifteen carpenters are working in the house');
    expect(phiCount(lr)).toBe(3);
    // "more" sits in the subject ϕ with "carpenters" (not its own singleton ϕ), so
    // it is a SECONDARY beat under the ϕ nuclear "carpenters", never an 's'.
    expect(peakRel(wordByText(lr, 'more'))).toBeLessThan(peakRel(wordByText(lr, 'carpenters')));
    expect(peakRel(wordByText(lr, 'more'))).toBeGreaterThan(RANK.w);   // a real beat (m), not flattened
    // The ϕ-initial preposition "in" carries the subtle left-edge beat the maintainer
    // hears — above the reduced article "the".
    expect(peakRel(wordByText(lr, 'in'))).toBeGreaterThan(peakRel(wordByText(lr, 'the')));
  });

  it('phrase-initial preposition outranks an interior determiner (Blake: through > each)', () => {
    // "I wander through each chartered street": the ϕ-initial "through" takes a beat,
    // the interior determiner-slot "each" reduces — so through > each, not "through EACH".
    const lr = lineResult('I wander through each chartered street');
    expect(peakRel(wordByText(lr, 'through'))).toBeGreaterThan(peakRel(wordByText(lr, 'each')));
  });
});
