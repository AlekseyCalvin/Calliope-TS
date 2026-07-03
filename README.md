# Calliope TS 0.0.4

**Calliope TS** is a phonological poetry-scansion toolkit for TypeScript / Node.js. Hand it a poem (or a single line), and it will tell you — and *show* you — how that verse actually moves: which syllables carry weight and how much, where the beats fall, what meter each line is in and how confidently, what rhymes with what, and what form the stanzas add up to.

The premise is that meter is something you *recover from pronunciation*, not something you stamp onto spelling. So Calliope reads a line roughly the way an attentive reader does: it first works out how the words would be said aloud — dictionary stress, the way phrases clump, where the voice peaks at a clause-end — and only then looks for the regular beat that saying settles into. This approach has a name in the linguistics literature, **phonological scansion**, and the bulk of this README is about what that means and how the toolkit puts it to work.

```
$ calliope-ts --reading exile.txt

Reading View  — stress gradient over the original text

He happens to be a French poet, that thin,     ← each syllable is tinted by how
book-carrying man with a bristly gray chin;        much stress it carries (see below)
...

Stress Maps & Meter  — top-3 candidate meters per line
  S1L1   nsw|xwx|msw ‖ xs    amphibrachic tetrameter  (amph 1.20 · iamb 1.14 · anap 1.13)  A
  S1L2   m-mw|wsx|xmw|ms     amphibrachic tetrameter  ≈ continuity; standalone: dactylic tetrameter  A
  ...
```

---

## Contents

- [Installation](#installation)
- [Quick start (CLI)](#quick-start-cli)
- [Reading the output](#reading-the-output)
- [What "phonological scansion" means](#what-phonological-scansion-means)
- [The pipeline, stage by stage](#the-pipeline-stage-by-stage)
- [A note on rules vs. constraints](#a-note-on-rules-vs-constraints)
- [Programmatic usage (API)](#programmatic-usage-api)
- [Examples](#examples)
- [How it compares to other scanners](#how-it-compares-to-other-scanners)
- [Background and lineage](#background-and-lineage)
- [Scope, strengths, and honest limitations](#scope-strengths-and-honest-limitations)
- [Development](#development)
- [License and credits](#license-and-credits)

---

## Installation

Requires **Node.js ≥ 20** (≥ 22 recommended — one optional stage, the dependency-tree repair, uses Node's `require(esm)` support and simply switches itself off on older runtimes).

```bash
# As a global CLI tool
npm install -g calliope-ts

# Or as a library inside your own project
npm install calliope-ts
```

From a clone of the repository:

```bash
npm install
npm run build      # compiles src/ → dist/
npm test           # vitest suite
```

---

## Quick start (CLI)

```bash
# 1. Scan a line directly
calliope-ts "Shall I compare thee to a summer's day?"

# 2. Scan a whole poem from a file (blank lines separate stanzas)
calliope-ts poem.txt

# 3. Reading view — the poem itself, syllables tinted by stress
#    (the nicest way to read a whole poem; first option in the CLI; 
or add -r or --reading)

# 4. Pipe text in
cat poem.txt | calliope-ts --reading

# 5. Interactive menu (run without typing arguments in a terminal each time)
calliope-ts

# 6. Run the alternative "Clio" parse (powered by the legacy FinNLP suite)
calliope-ts --clio poem.txt
```

The interactive menu offers: multi-line paste-and-scan (reading view),
single-line detailed analysis, line-by-line analysis, file input in either
view, a **legend** explaining every symbol and colour, and an option to 
"Ask Clio instead" for the alternative parse.

There are two display modes:

| Mode | Flag | What you get |
|---|---|---|
| **Detailed view** | *(default)* | Per line: the tagged text, the phrase structure, lexical and relative stress maps, phonological bracketing, the foot-by-foot scansion, the dependency tree, and a summary (meter, fit %, scansion string). |
| **Reading view** | `--reading` / `-r` | The poem in its original formatting with every syllable coloured by stress, followed by one compact line per verse-line: stress map, meter, top-3 candidate scores, rhyme-scheme letter, and any rhythm/continuity notes. |

---

## Reading the output

### The five stress levels

Calliope TS grades every syllable on a five-tier *relative* scale (this is the
core representation everything else is built on):

| Symbol | Name | Typical bearer |
|---|---|---|
| `x` | zero-provision | maximally reduced function words: *the, a, of, and, to* |
| `w` | weak | unstressed syllables of content words; unreduced function words (*be, just, here*) |
| `n` | low | lightly stressed syllables; pronouns and modals with citation stress (*he, might*) |
| `m` | moderate | secondary stresses; stressed syllables demoted by a neighbouring stronger one |
| `s` | strong | primary stresses, phrase peaks, line-final nuclei |

A line's **stress map** is simply its syllables in order, e.g.
`xs|wxm|wxs|xws` — with: 
`|` marking foot boundaries;
`‖` a strong caesura (aka syntactic pause) at major phonological/clausal or punctuation breaks;
`¦` a lighter phrase break;
`-` a "silent beat" inserted to neutralize a stress clash wherever two strongly-stressed syllables would otherwise collide, it forces the second to await its turn.

### Meter lines

In the reading view each verse-line gets a single summary line. 
Reading one such line left to right:

```
S1L2   m|-mww|sxx|mwm|s   amphibrachic tetrameter   (dact 1.21 · amph 1.17 ·
       anap 1.16)  ≈ continuity; standalone: dactylic tetrameter  A(perfect)
```

- **`amphibrachic tetrameter`** — the line's meter: foot type + count.
- **`(dact 1.21 · amph 1.17 · anap 1.16)`** — the top three candidate meters
  with their raw fit scores. The named meter need not be the numerically
  first candidate: ties between sibling meters are resolved by principled
  criteria (word integrity, caesura alignment, stanza context — see below).
- **`≈ continuity; standalone: dactylic tetrameter`** — this line, taken
  alone, fits dactylic a hair better; but if most of the other lines in the same stanza are amphibrachic and the line fits amphibrachic nearly as well as it fits dactylic, the primary reading is promoted to the stanza-dominant base meter, while the line-prevalent meter is co-registered as the "standalone" top fit via an added note.
- **`↔ aligns w/ stanza …`** — a weaker version of the same: the line stays
  with its own meter but is flagged as compatible with the stanza's.
- **`♪ 4-beat accentual`** / `♪ 3-ictus dolnik` — a *rhythm note*: if the stanza
  does not appear to be accentual-syllabic, but keeps a constant count of strong beats
  with varying syllable counts (see "Beyond classical meters" below), it is marked as acentual.
- **`A`, `B(perfect)`, `·`** — the rhyme-scheme letter for the line's end
  word, with the rhyme type when the line rhymes with an earlier one
  (`perfect`, `rich`, `family`, `assonant`, `consonant`, `augmented`,
  `diminished`, `wrenched`, `eye`, `identical`). `·` = unrhymed.
- **`❡ ballad stanza (ABCB, 4·3)`** — a stanza-level *form* verdict (shown in
  the stanza header): ballad stanza, blank verse, couplet, limerick,
  Shakespearean/Petrarchan sonnet, terza rima, etc.
- **Certainty / fit %** (detailed view) — the share of the line realized by
  clean, unsubstituted feet, tempered by phrase-edge agreement. A perfectly
  regular line reads 100%; real verse usually lands between 50 and 90.

---

## How it works: the scansion pipeline

Most automatic scanners pattern-match syllable counts against meter templates, or "from the outside in": count syllables, then match the count and a guessed stress pattern against a list of meter templates. Calliope TS instead follows the **phonological scansion** method. Phonological scansion works "from the inside out": it derives the line's normative spoken prominence first, then fits meters to it.

Two simple principles carry a lot of the work here, both articulated in Bruce Hayes and Abigail Kaun's study of how words are set to music (*The Role of Phonological Phrasing in Sung and Chanted Verse*, 1996):

1. **The ends of phonological units is what matters the most (in English, at least).**: Stresses at the *right edges* of prosodic units are more reliable metrical evidence. Generative metrics has long summarized this as **"beginnings free, endings strict."**

2. **Bigger units matter more.**
So, a stress at the end of a whole intonational unit is stronger evidence than one at the end of a phonological phrase, which is stronger evidence than the distribution of a given clitic phrase, which is more significant than the pattern of an individual word (however longer polysyllabic words may likewise hold more "weight" here). And in English as a whole, the pattern generally leans to the right (with certain significant exceptions, like numerous classes of compound expressions). But this bias as such aligns with the infamous iambic inclination.

Bruce Hayes himself (2005) and Gareth McAleese (2007/2008) built the first faithful algorithmic/computational implementations of a verse scansion procedure around those two ideas. Calliope TS re-implements that architecture on a modern JavaScript/TypeScript stack, while attempting to push it into distinctive directions. Among these: deliberately looser pre-attunement to standard iamb-centered English canons (while preserving and seeking to refine English phonological alignment accuracy); better accommodation of World poetry in meter-matching English translation (in other words, English canon levels of iambic base meter predominance should not be pre-assumed for Englished World (aka "Worldish") poetry canons); likewise, the mechanics of Calliope TS proceed from a choice not to essentialize ternary meters as inherently rare solely from English canon distributions (statistical fatalism); we, furthermore, aim to extend scansion accuracy over accentual verse forms; and, beyond scansion itself, hope to gradually incorporate nuanced and diversified identification of a broad range of poetic forms and devices (currently supported: rhyme types; in the future: alliterations, anaphoras, trope/cliche identifications, and more). 


The current pipeline has eight stages.

**1. Grammatical parsing.** 
The line is tokenized, part-of-speech tagged, and dependency-parsed — that is, the engine works out which word grammatically governs which (subject of what verb, object of what preposition) — using `udpipe-node` (our Node/JS/WASM port of UDPipe), now generating Universal Dependencies (UD) trees and morphological features. (For legacy comparison, the toolkit's built-in "Clio" alternate mechanics persist in using the FinNLP family of libraries (`lexed`, `en-pos`, `en-parse`) instead). A conversion layer seamlessly translates UD tags into the Penn Treebank tags our prosody expects. Two correction layers sit inside this stage,
First, because poetry tends to break part-of-speech and grammatical dependency taggers in predictable ways, a *tag-repair* pass fixes systematic errors before the dependency tree is built (this appropriately accounts for rare exotics and awkward/shifty commonplaces alike: from archaic forms like *thou/thy/doth/wherefore*, to the pronoun *I*, to perfect-tense participles like *had quit*).
Then we leverage a *tree-repair* pass (using the [depedits](https://www.npmjs.com/package/depedits) rule engine, our TypeScript port of the DepEdit library, originally in Python), which fixes systematic phrasal role attachment errors (e.g. noun compounds parsed as double objects, and the like). Hyphenated compounds and contractions (like *we'll*, *don't*, archaic *fix'd*, etc) are re-merged into single metrical words.

**2. Lexical stress.** 
Every word is looked up for its pronunciation — syllable count, primary/secondary/unstressed pattern, syllable weights, vowel quantities — via our [nounsing-pro](https://www.npmjs.com/package/nounsing-pro) NLP toolkit, build over a full-scope CMU dictionary augmented with phonological and morphological data: syllable count, stress pattern (primary / secondary / unstressed), syllable weights, consonant types, morphological complexity and
vowel quantities. Words not in the dictionary go through a morphological fallback (strip a productive suffix, look up the stem, restore) coupled with a quantity-sensitive English Stress Rule. Poetic elisions are honored: *heav'n* is parsed as one syllable, so is *o'er*, *th'expense* as two, *'tis/'twas* reduces, while archaic *-'d* / *-'st* forms (*fix'd*, *stopp'st*) retain their elided syllable counts.

**3. The prosodic hierarchy.**
Words are grouped the way speech groups them, in the nested structure linguists call the prosodic hierarchy (Selkirk 1978; Hayes 1989):
Each content word attracts its function-word satellites into a **clitic group** (CP); clitic groups are joined into **phonological phrases** (PP) in accordance with syntactic inter-dependencies and primacies parsed earlier; phrases are organized into **intonational units** (IU) bounded by major punctuation or/and delineation. Crucially, the **line is the scansion domain**: a verse line containing several grammatical sentences is still parsed as a singular metrical unit (the internal full stops are treated as strong caesurae).

**4. Phrase-level stress rules.**
Several well-established rules of *English stress* mediate dictionary-derived lexical stresses within the consolidated phonological/phrasal context: primarily, the **compound stress rule** (left element generally stressed, *CITY hall*, with various exceptions), the **nuclear stress rule** (the last content word of an intonational unit receives a stress boost), and a set of **clash resolutions** (two adjacent strong syllables cannot both keep full prominence — one yields, chosen by syntactic direction). The result is mapped onto the five-tier `x w n m s` scale.

**5. Key stresses.**
Following generative metrics, the stresses at the *right edges* of prosodic units are treated as more reliable — speakers may start a phrase loosely but they land its ending. Each unit contributes its right-edge "key stress" with a weight (intonational unit > phrase > long word / clitic group > short word ), and meters that place beats on those key stresses are promoted.

**6. Meter fitting.**
For each of seven candidate metrical foot types — iambic, trochaic, anapestic, dactylic, amphibrachic, bacchic, spondaic — the engine finds the optimal division of the line into feet, using that meter's inventory of most plausible variations/divergences: inversions at line-start or after a caesura, pyrrhic and spondaic foot substitutions, catalexis (truncated final foot), anacrusis (extrametrical upbeat), feminine endings, acephalous openings, and so forth. Each syllable is scored against the metrical position it lands in (a strong syllable in a beat slot
is ideal; while a reduced clitic forced onto a beat is perhaps the heaviest cardinal violation). An additional **promotion** rule (drawn from Derik Attridge) lets a weak syllable carry a beat when it is flanked by even weaker ones (*"happens to BE a French poet"*).

**7. Arbitration and context.**
The winning meter is not simply the top raw score:
- **Ternary siblings** (anapest / amphibrach / dactyl meters) may sometimes fit a line via an *identical* distribution of beats — the difference being only where one might draw the foot boundaries. In such a situation, the base meter determination is decided by which foot division avoids slicing through words and best aligns with the line's pauses.
- **Stanza consensus**: each stanza's dominant meter is identified. An additional consideration is taken into account for ternary meters at this point: *anacrusis profile* — how many unstressed syllables are found at the beginning of a given line, and the stanza as a whole (a sensible heuristic suggested by Russian metrics).

**8. Beyond classical meters.**
If a stanza's syllable counts vary significantly while its strong-beat count stays constant, the stanza is read as **accentual verse** , rather than classically footed accentual-syllabic (aka syllabotonic), and labeled as (`n-beat accentual`).

Alongside this, a **rhyme layer** classifies every line-end pair (perfect / rich / family / slant /eye / … rhymes, in masculine / feminine / dactylic shapes), detects the poem's rhyme scheme (if discernible), as well as its apparent **poetic form** (if documented by us). For now, the range of supported forms is very limited and the mechanics of discernment leave much to be desired. As of this version, the engine may (when particularly inspired) identify a ballad stanza, blank verse (unrhymed iambic pentameter), couplets, quatrains, limericks, rhyme royal, Shakespearean or Petrarchan sonnets, and Dante-style terza rima.

---

## Programmatic usage (API)

```ts
import {
  analyzeStanzas,          // poem text → LineResult[][]  (per stanza, per line)
  analyzeText,             // poem text → LineResult[]    (flat)
  analyzeReadingDocument,  // poem text → ReadingStanza[] (keeps verbatim lines)
  // The legacy/alternate "Clio" engine equivalents (using FinNLP):
  analyzeStanzasClio,
  analyzeTextClio,
  analyzeReadingDocumentClio,
} from 'calliope-ts';
```

### Scan a poem

```ts
import { analyzeStanzas } from 'calliope-ts';

const poem = `He happens to be a French poet, that thin,
book-carrying man with a bristly gray chin;
you meet him whenever you go`;

const stanzas = analyzeStanzas(poem);

for (const stanza of stanzas) {
  for (const line of stanza) {
    const d = line.phonologicalScansion;
    console.log(d.meter);          // "amphibrachic tetrameter"
    console.log(d.scansion);       // "nsw|xwx|msw|xs"
    console.log(d.footCount);      // 4
    console.log(d.certainty);      // 0–100
    console.log(d.ranking);        // [{ meter: 'amphibrachic', score: 1.20 }, …]
    console.log(d.standaloneMeter);// set when stanza continuity renamed the line
    console.log(d.rhythmNote);     // "4-beat accentual", "3-ictus dolnik", …
    console.log(d.rhyme);          // { endWord, letter: 'A', type: 'perfect', … }
    console.log(d.formNote);       // "ballad stanza (ABCB, 4·3)", "blank verse", …
  }
}
```

### Inspect the linguistic analysis

Each `LineResult` also carries the full intermediate analysis:

```ts
const line = stanzas[0][0];

// Words with POS tags, content/function status, and per-syllable stress
for (const w of line.sentence.words) {
  console.log(w.word, w.lexicalClass, w.isContent,
              w.syllables.map(s => s.relativeStress).join(''));
}

// The dependency tree
for (const dep of line.sentence.dependencies) {
  console.log(`${dep.dependentName} ←${dep.dependentType}← ${dep.governorName}`);
}

// The prosodic hierarchy: IU → PP → clitic groups
console.log(line.phonologicalHierarchy);

// The weighted key stresses extracted from unit right-edges
console.log(line.keyStresses);
```

### Rhyme utilities

The rhyme classifier is exported on its own:

```ts
import { classifyRhymePair, detectScheme } from 'calliope-ts/dist/rhyme.js';

classifyRhymePair('grace', 'face');
// → { type: 'perfect', structure: 'masculine' }

classifyRhymePair('picky', 'tricky');
// → { type: 'perfect', structure: 'feminine' }

detectScheme(['Mariner', 'three', 'eye', 'me']).map(r => r.letter).join('');
// → "·A·A"   (i.e. ABCB with unrhymed lines marked ·)
```

### Key result types

```ts
interface PhonologicalScansionDetail {
  meter: string;             // "iambic pentameter"
  meterName: MetreName | 'free verse';
  footCount: number;
  scansion: string;          // "xs|wxm|wxs|xws"
  certainty: number;         // 0–100
  ranking?: MeterScore[];    // all candidate meters, best first
  consensusMeter?: string;   // "aligns with stanza X" annotation
  standaloneMeter?: string;  // pre-continuity-rename reading
  rhythmNote?: string;       // dolnik / taktovik / accentual verdicts
  rhyme?: { endWord: string; letter: string; type?: string; matchedLine?: number };
  formNote?: string;         // stanza/poem form verdict
  // … plus the raw weighted-score fields
}
```

Lower-level functions (`parseDocument`, `assignLexicalStress`, `buildPhonologicalHierarchy`, `scoreMeters`, …) are exported from their modules under `calliope-ts/dist/*` for users who want to run or modify individual pipeline stages. 

The optional Scandroid comparison engines (Charles Hartman's "Corral the Weird" and "Maximize the Normal") are exported from `calliope-ts/dist/scandroid.js`.

---

## Examples

**A Shakespeare sonnet** (`calliope-ts --reading sonnet130.txt`) — every line identified as iambic pentameter; the scheme letters spell ABAB CDCD EFEF GG; the stanza header reads `❡ Shakespearean Sonnet`.

**A ballad quatrain:**

```
It is an ancient Mariner,
And he stoppeth one of three.
"By thy long grey beard and glittering eye,
Now wherefore stopp'st thou me?
```

→ lines of iambic tetrameter / trimeter, scheme `·A·A`, and the form verdict `❡ ballad stanza (ABCB, 4·3)` — the rhyme scheme *and* the alternating 4-beat/3-beat design both check out.

**Accentual verse** (Wyatt, *They flee from me*) — no classical meter dominates and syllable counts vary, but every line carries four strong beats: each line is annotated `♪ 4-beat accentual`.

**Amphibrachic verse** (Nabokov wrote his poem "Exile" as a demonstration of English amphibrachs — the `x S x` foot): stanza consensus reads the poem's constant one-syllable anacrusis as amphibrachic, names near-tie lines accordingly with `≈ continuity` notes, and reports the `aabccb` rhyme envelope.

**Blank verse** (Frost, *Mending Wall*) — unrhymed lines, dominant iambic pentameter: `❡ blank verse`.

---

## Background and lineage

The method implemented here substantially follows the example set by Gareth McAleese's *Calliope* (2007.2008), developed for his M.Sc. at the Open University (*"Improving Scansion with Syntax: an Investigation into the Effectiveness of a Syntactic Analysis of Poetry by Computer using Phonological Scansion Theory"*, Technical Report 2007/26, submitted 2008). For it, McAleese devises a computational scansion framework substantially grounded in the phonological scansion methodologies of UCLA's renowned linguist and phonologist **Bruce Hayes**, developed by him across the 1980s, 90s, and 2000s — most relevantly in *Extrametricality and English Stress* (1982), *The Phonology of Rhythm in English* (1984), *The Prosodic Hierarchy in Meter* (1989), the *Metrical Stress Theory* (1995), and *The Role of Phonological Phrasing in Sung and Chanted Verse* with Abigail Kaun (1996). Hayes in turn built on the groundwork laid by Halle & Chomsky, Liberman & Prince, and Kiparsky (some of the seminal Generative Metrics, Optimality Theory, and related domains. Most pertinent to approach taken up by McAleese (as well as ourselves presently) is Hayes's   work from the early 1990s onward, in which he drew increasingly on the nascent **Optimality Theory** (OT) (much credit to Prince & Smolensky, whose *Optimality Theory: Constraint Interaction in Generative Grammar*, 1993/2002, much enriched the empirical toolkit of generative grammar-adjacent theory domains). In the 2000s Hayes would contribute to placing OT onto the more precise rails of **MaxEnt** (Maximum Entropy) methods. McAleese's work, however, preceded this turn. Backing up somewhat to peruse the field, it is worth acknowledging the remarkable breadth of synthesis McAleese draws on, which beyond those above-named, harnesses the influence of Paul Kiparsky (e.g. *The Rhythmic Structure of English Verse*, 1977), Kristin Hanson (*A Parametric Theory of Poetic Meter*, 1996), the prosodic-phrasing and stress-shift related work of Elisabeth Selkirk (1978), as well as studies by Richard Cureton (1992), Peter Groves (1998), and many others (see McAleese's paper at https://oro.open.ac.uk/90197/ for a full bibliography).

| Source | What it grounds in Calliope |
|---|---|
| Hayes & Kaun (1996) | the core method: right-edge key stresses, weighted by prosodic-unit size (stage 5) |
| Hayes (1989), *Prosodic Hierarchy in Meter* | the CP → PP → IU phrasing (stage 3) |
| Hayes (1982), *Extrametricality* | extrametrical syllables and the OOV English Stress Rule (stage 2) |
| Chomsky & Halle (1968); Liberman & Prince (1977); Hayes (1984) | the lexical and phrasal stress rules — compound, nuclear, clash (stage 4) |
| Prince & Smolensky (1993/2002); Hayes et al., MaxEnt | the constraint-based, weighted meter fitter (stages 5–7) |
| Selkirk (1978) | the phonological phrase as a prosodic constituent (stage 3) |
| Attridge, *The Rhythms of English Poetry* / *The Rhythms of the English Dolnik* | beat/offbeat promotion (stage 6) and the dolnik (stage 8) |
| Gasparov, *A History of European Versification* | the dolnik / taktovik / accentual taxonomy (stage 8) |
| McAleese (2008) | the core outline for the scansion procedure, with further solutions drawn by us from Hayes 2008 & Prosodic (MaxEnt weighing), as well as original extrapolations |

**Scandroid (1996/2005).** Charles O. Hartman's Scandroid, a classic foot-by-foot scanner (GNU GPL), is included as an optional comparison engine: its "Corral the Weird" and "Maximize the Normal" algorithms can be run side by side with the phonological scansion.

Calliope TS is developed by **Aleksey Calvin** / [SilverAgePoets.com](https://www.SilverAgePoets.com)

---

**Limitations to know about.**
- English only (the dictionary and phonological rules are English; while the UDPipe backend natively supports multilingual parsing, other languages will produce nonsense rather than errors).
- Stress-doublet words (*rebel*, *content*, names like *Hugo*) are read with their dictionary stress; a correction is on the roadmap.
- Rare or foreign proper names fall back to rule-based stress guesses.

---

## Development

```bash
npm run build     # tsc → dist/
npm test          # vitest (73 tests: pipeline, stress, meters, rhyme, forms)
npm run dev       # ts-node

# Benchmark harnesses (require the annotated corpora in tests/)
node trials/mcaleese_benchmark.mjs    # McAleese's own trial poems + expert keys
node trials/corpus_benchmark.mjs      # litlab / prosodic / epg64 meter corpora
```

---

## License and credits

Apache-2.0. © Aleksey Calvin Tsukanov / SilverAgePoets.com. <br>
My email: alekseycalvin@gmail.com <br>

Methodological and conceptual debts: 
- Michael Wagner (Prosody and Recursion, MIT, 2005) (for further clarifying the inter-relational nuances of prosody and syntax).
- Manfred Krifka (2001/2002) (for so poignantly elucidating NSR and CSR beyond SPE).
- Bruce Hayes (1982/1984/1995/1996 with Abigail Kaun/2005) (the phonological scansion procedure as such, extrametricality insights, text-setting methodologies, MaxEnt OT, and who knows what else);
- Gareth McAleese (for a single 2008 paper, for detailing the original Calliope implementation, for exhibiting a remarkable field-spanning purview, an uncanny industriousness, and an uncommon – perhaps a tad obsessive – dedication to testing, refining, fusing, and extending all sorts of methodologies in a single-minded pursuit of bringing constraint-based computational scansion far beyond the best documented practices and results at that time; and for so obviously succeeding, if only to seemingly vanish from the field as abruptly and unreservedly as he entered and absorbed it*); 
- Charles O. Hartman (Scandroid); 
- Claire Moore Cantwell (morphological/phonological tagging algorithms), 
- Austin Pursley (implementing finer-grained rhyme-matching heuristics over a corpus), 
- Allison Parrish (Pronouncing-py and being a real life computational poet hero), 
- Derek Attridge (beat/offbeat rhythm theory and insightful writings on the English dolnik); 
- M. L. Gasparov (dolnik/taktovik taxonomy); 
- the compilers of the CMU Pronouncing Dictionary; 
- the makers of Prosodic (Heuser et al, for establishing an admirable state-of-the-art to compare against, differentiate from, and hopefully surpass in due time, in select ways),
- Milan Straka and the UDPipe project (for the robust neural parsing architecture now driving the core mechanics), 
- as well as broader generative-metrics, constraint-based metrics, and OT traditions, including Kiparsky, Prince & Smolensky, Groves, Blumenfeld, Lilja, Chomsky & Halle, Fabb & Halle (rule-based grid scansion theory), Einarsson (Metremic theory), Russom (Universalist metrics), K. M. Ryan (gradient syllable weight), big daddy Jakobson who had once roped the whole world with subtle strings and often hung out with Mayakovsky, and many others. <br>
*Gareth McAleese: If you're reading this, please do email me!