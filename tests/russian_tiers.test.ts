// tests/russian_tiers.test.ts — Russian engine sanity checks (2026-07-17).
// Covers two things that are easy to silently break: (1) tierPattern's lexical
// overlay must never desync from stressPattern's metrical beats — wherever the
// aligner assigns a metrical stress ('S'), the tier layer must agree ('s'), and
// the lexical differential ('n' on an unstressed-but-lexically-stressed
// syllable) must actually fire somewhere; (2) the poem-global rhyme-scheme
// assembly fix in engine.ts (re-lettering + matchedLine offset, see the
// "Build rhyme entries" block) must produce a well-formed scheme string and
// in-range poem-global line indices. Detection itself (Koziev's per-stanza
// alignment) is not touched here — this only checks the display-facing shape.

import { describe, it, expect } from 'vitest';
import { analyzeRussianPoem } from '../src/russian/engine.js';

const FRAGMENT = 'Фальшивый крест на мосту сгорел\n'
  + 'Он был из бумаги, он был вчера\n'
  + 'Листва упала пустым мешком\n'
  + 'Над городом вьюга из разных мест\n'
  + '\n'
  + 'Упрямый сторож глядит вперёд\n'
  + 'Рассеяв думы о злой жене\n'
  + 'Гремит ключами дремучий лес\n'
  + 'Втирает стёкла весёлый чёрт';

const TIER_CHARS = new Set(['x', 'w', 'n', 'm', 's']);

describe('Russian engine: tier/stress consistency and poem-global rhyme scheme (2026-07-17)', () => {
  it('analyzes the two-stanza fragment with tierPattern honest to stressPattern', async () => {
    const result = await analyzeRussianPoem(FRAGMENT);
    const lines = result.stanzas.flatMap(st => st.lines);
    expect(lines.length).toBe(8);

    let sawLexicalDifferential = false;
    for (const line of lines) {
      // (i) same length as stressPattern
      expect(line.tierPattern.length).toBe(line.stressPattern.length);
      // (ii) tier chars are drawn only from the known tier set
      for (const ch of line.tierPattern) expect(TIER_CHARS.has(ch)).toBe(true);
      // (iii) beat preservation: every metrical 'S' is tier 's' at the same index
      for (let i = 0; i < line.stressPattern.length; i++) {
        if (line.stressPattern[i] === 'S') expect(line.tierPattern[i]).toBe('s');
      }
      // (iv) lexical-stress differential: an 'n' where the meter did NOT assign
      // a beat ('U') means the lexical-stress layer is doing something the
      // binary stressPattern alone cannot express.
      for (let i = 0; i < line.stressPattern.length; i++) {
        if (line.stressPattern[i] === 'U' && line.tierPattern[i] === 'n') sawLexicalDifferential = true;
      }
    }
    expect(sawLexicalDifferential).toBe(true);

    // (v) scoring sanity — the score is alive and bounded, not NaN/undefined.
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  }, 60_000);

  it('poem-global rhyme scheme: well-formed string, matchedLine in range (2026-07-17 assembly fix)', async () => {
    const result = await analyzeRussianPoem(FRAGMENT);
    const totalLines = result.stanzas.reduce((n, st) => n + st.lines.length, 0);

    expect(typeof result.rhymeScheme).toBe('string');
    for (const r of result.rhymes) {
      if (r.matchedLine == null) continue;
      // The frontend (webapp/public/app.js) indexes state.data.rhymes by
      // 0-based poem-global line number (countLinesBeforeStanza + lIdx) and
      // displays matchedLine + 1 as the human-facing line number — so the
      // stored convention here must be 0-based.
      expect(r.matchedLine).toBeGreaterThanOrEqual(0);
      expect(r.matchedLine).toBeLessThan(totalLines);
    }

    // L5 ("вперёд") and L6 ("жене") bind across the stanza break's own
    // sub-block boundary at line 4/5 (0-based) — the two must share one
    // poem-global letter (the "A-A- AA--" shape from stanza 2's own AA local
    // pattern re-lettered onto the poem-global sequence).
    const l5 = result.rhymes[4];
    const l6 = result.rhymes[5];
    expect(l5.letter).not.toBe('-');
    expect(l5.letter).toBe(l6.letter);
  }, 60_000);
});
