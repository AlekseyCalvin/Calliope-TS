# Calliope TS 0.1.4

**Calliope TS** is a bilingual (English & Russian) phonological poetry-scansion toolkit for TypeScript / Node.js. Hand it a poem (or a single line), and it will tell you — and *show* you — how that verse actually moves: which syllables carry weight and how much, where the beats fall, what meter each line is in and how confidently, what rhymes with what, and what form the stanzas add up to. The English pipeline is the primary and most fully documented engine; a parallel Russian pipeline (accentology + SynTagRus dependency parsing) is described under [Russian support](#russian-support). <br>

The premise is that meter is something you *recover from pronunciation*, not something you stamp onto spelling. So Calliope reads a line roughly the way an attentive reader does: it first works out how the words would be said aloud — dictionary stress, the way phrases clump, where the voice peaks at a clause-end — and only then looks for the regular beat that saying settles into. This approach has a name in the linguistics literature, **phonological scansion**, and the bulk of this README is about what that means and how the toolkit puts it to work. Methodological lineage includes: McAleese (2008), Wagner (2005), Hayes (1982+), Parrish (2008+), Hartman et al (2005), Fabb & Halle (1967/2008), Heuser et al (2010), Koziev (2025). Constituent tools within the Calliope-TS suite consolidate further sources and inspirations. Our `Nounsing-Pro` (also available as a separate package/CLI) draws from Parrish's `Pronouncing Py`, the CMU Pronouncing Dictionary, Hayes' and Cantwell-Moore's modifications to the CMU, and other precursors. And our `UDpipe-node` is a port of Milan Straka's UDPipe. <br>

Starting from 0.1.4, in addition to its built-in WebApp, CLI, and API interfaces, `Calliope-TS` may also be leveraged or queried as a **Model Context Protocol (MCP) server**, making it usable for specialized remote or local tool calls by LLM agents (OpenRouter, OpenCode, Hermes, Claude, Cursor, various API's, etc...). <br>

---

## Contents

- [Web-App Basics](#web-app-basics)
- [Installation](#installation)
- [MCP server](#mcp-server)
- [Russian support](#russian-support)
- [Quick start (CLI)](#quick-start-cli)
- [The web app](#the-web-app-browser-interface)
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

## WEB-APP BASICS

The web app, our core interface, exposes four instruments:

| Tab | What it does |
|---|---|
| **Scansion** | The full reading view — every syllable tinted in accordance with its relative stress. Initial display features per-line meter identification tags (with fit %s), end-rhyme letters. Hover over syllables for morphological and phonological, and metrical profiles. Click on a syllable to "pin" it to a panel on the right for later reference. Click on "SCAN" to open a detailed analysis of a given line, elaborating a full phonological bracketed grid, map of UD-style syntactic relations, syllable-by-syllable chart, explication of key stresses' derivation, Scandroid & Fabb-Halle style separate scansion outputs as cross-checks, and more. The panel on the right contains a poem-level analytic synopsis as well as a Phonopoetics section (listing alliterations, head rhymes, medial/caesural rhymes, enjambments, acrostics (if identified), etc... Click on the "GUIDE" button in the top right for more info + a legend for the symbols/nomenclature. |
| **Rhyme Forge** | A module featuring a discrete rhyme search tool, plus focused analysis over input words, with morphological dossiers from our augmented CMU lexicon (the foundation for Nounsing Pro). Use this tab to search for  rhymes, identify metrical feet (and fits) within a given word, or to perform Parrish-style "Meter Matches" (define a lexical stress contour and display every dictionary word that matches it). |
| **Rewrites** | Creative transmutations with grounding: replace every word of an input with syllable-stress-pattern matches, or words starting from analogous sounds/phonemes, or with rhymes (fuzzy or precise). The rewrites may be optionally grounded closer to the inputs via various filters, such as POS-fidelity, word-frequency, certain syntactic traces, and other controls. |
| **Syntax** | The UDPipe dependency parse (with DepEdit-TS repairs) as arc diagrams and a glossed register. |

```

## INSTALLATION

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

Once installed (or built from a clone), you can drive Calliope two ways — the
**CLI** or a local **web app**:

```bash
calliope-ts "Shall I compare thee to a summer's day?"   # CLI — scan a line
calliope-ts poem.txt                                     # CLI — scan a file

npm run web        # web app → http://localhost:4321
calliope-web       # same, from a global/npx install
PORT=8080 calliope-web                                   # bind any port
```

The CLI is detailed under [Quick start](#quick-start-cli); the browser
interface, with all its instruments and controls, under
[The web app](#the-web-app-browser-interface).

---


## MCP server

## MCP Server — Use as Tool for LLM Agents

This Space now exposes **MCP endpoints** alongside the web UI, so any MCP-capable agent can call Calliope as a tool to scan poems, songs, stanzas, lines, analyze syntax, find rhymes, meter-match, rewrite, etc.

### Endpoints (port 7860, mapped to public URL)

| Endpoint | Transport | Spec | Usage |
|---|---|---|---|
| `POST /mcp` | **Streamable HTTP** (modern) | MCP 2025-03-26 | JSON-RPC over HTTP, `Accept: application/json, text/event-stream` |
| `GET /mcp` | Streamable HTTP | Same | Opens SSE stream for server-initiated notifications (if client sends `Accept: text/event-stream`) |
| `DELETE /mcp` | Streamable HTTP | Same | Session termination |
| `GET /sse` | **SSE** (legacy) | MCP 2024-11-05 | Returns `event: endpoint` with `/messages?sessionId=...` |
| `POST /messages?sessionId=...` | SSE | Same | JSON-RPC for SSE transport |
| `GET /api/mcp/info` | Discovery | — | Human-readable JSON with tool list + client configs |

All endpoints support CORS (`*`), stateless mode (no session required, each request fresh — ideal for HF Spaces), and handle both English and Russian.

### Tools exposed

| Tool | What it does |
|---|---|
| `scan_poem` | Full scansion of poem / song / stanza / verse / line (English auto-detect Russian). Returns meter, rhyme scheme, form, synopsis, per-line tags, Fabb-Halle grids, Scandroid, enjambment, phonopoetics. `detail_level: summary` (LLM-friendly) vs `full` (exhaustive). |
| `scan_line` | Deep single-line close reading: syllable stress, weight, POS, feats, dependency, feet, caesurae, hierarchy IU/PP/CP, Scandroid, Fabb-Halle. |
| `parse_syntax` | Dependency syntax via UDPipe + DepEdit-TS: tokens, UPOS, feats, deprel, governor, prosodic grouping. |
| `get_word_dossier` | Nounsing Pro deep dossier for English word: phones, syllabification, stress contour, weight, rhyme profile, edges, morphology, freq, insets, rhymes. |
| `find_rhymes` | Perfect rhymes (CMU-augmented), optional syllable filter. |
| `meter_match` | Find words matching stress pattern like `0101`, `0101010101` (iambic pentameter). |
| `rewrite_text` | Prosody-preserving transforms: `stress` / `rhyme` / `phones`, with POS precision, freq threshold, fuzzy rhyme, morph grounding, register fidelity. English+Russian auto-detect. |
| `analyze_russian_poem` | Dedicated Russian pipeline: ямб/хорей/дактиль/амфибрахий/анапест/dolnik, scores, rhyme scheme, stress variants, clausulae, yofication, Fabb-Halle with polysyllabic maxima. |
| `get_capabilities` | Returns high-level description, engines, meters, examples — use to discover how to call other tools. |

#### Client configs

##### Claude Desktop (SSE, via mcp-remote) — recommended for HF remote

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "calliope-ts": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://AlekseyCalvin-calliope.hf.space/sse"]
    }
  }
}
```

Alternative HTTP (if your Claude version supports `url`):

```json
{
  "mcpServers": {
    "calliope-ts": { "url": "https://AlekseyCalvin-calliope.hf.space/mcp" }
  }
}
```

##### Cursor / Windsurf

Settings → MCP → Add Server:

- URL: `https://AlekseyCalvin-cts.hf.space/mcp` (or `/sse` for legacy)
- Transport: `http` / `sse`

##### OpenRouter (stateful agents)

See https://openrouter.ai/docs/features/mcp

```json
{
  "model": "anthropic/claude-3.5-sonnet",
  "mcpServers": [
    { "name": "calliope-ts", "url": "https://AlekseyCalvin-calliope.hf.space/mcp" }
  ]
}
```

Then the model can call `scan_poem`, `parse_syntax`, etc. as tools.

##### Generic TypeScript client

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(new URL('https://AlekseyCalvin-calliope.hf.space/mcp'));
const client = new Client({ name: 'my-app', version: '1.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools);

const result = await client.callTool({
  name: 'scan_poem',
  arguments: { text: 'Shall I compare thee to a summer’s day?', detail_level: 'summary' }
});
console.log(result.content[0].text);
```

##### Python (via MCP SDK)

```python
# pip install mcp
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main():
    async with streamablehttp_client("https://AlekseyCalvin-calliope.hf.space/mcp") as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(tools)
            res = await session.call_tool("scan_poem", {"text": "Because I could not stop for Death\nHe kindly stopped for me", "detail_level": "summary"})
            print(res)

asyncio.run(main())
```

#### Testing locally

```bash
npm ci
npm run build
PORT=7860 node webapp/server.mjs
# In another terminal:
curl -X POST http://localhost:7860/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

curl -X POST http://localhost:7860/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scan_poem","arguments":{"text":"Shall I compare thee to a summer’s day?","detail_level":"summary"}}}'
```

Discover info: `GET /api/mcp/info` and `GET /api/health`.

### HuggingFace Space

- **Location:** There's a pre-deployed instance of the Calliope-TS MCP WebApp at [THIS LINK](https://alekseycalvin-calliope.hf.space) aka [https://huggingface.co/spaces/AlekseyCalvin/calliope](https://huggingface.co/spaces/AlekseyCalvin/calliope). If the link is dead, try going to [https://huggingface.co/AlekseyCalvin](https://huggingface.co/AlekseyCalvin) or to the [SilverAgePoets.com](https://www.silveragepoets.com) front-page.,
- **Info**: docker `sdk`; at `app_port` `7860`
- **Stack:** Node.js 22 + TypeScript, pure-WASM UDPipe (no native binaries), MCP SDK 1.29.
- **Endpoints:** Web UI + REST (`/api/analyze`, `/api/russian`, `/api/word`, `/api/meter`, `/api/rewrite`) + MCP (`/mcp` Streamable HTTP + `/sse` SSE legacy).
- **Russian data:** On-first-use downloads ~122MB from HF Hub if not bundled; Dockerfile pre-materializes LFS pointers.
- **Source:** see the main repository for full README, CLI, and programmatic API (`calliope-ts` on npm).
- **Privacy:** the app only talks to itself — paste a poem, get the scansion. Nothing is stored; nothing leaves the request that produced it. MCP calls are stateless (each request fresh).

### Development

```bash
npm ci
npm run build      # tsc → dist/
PORT=7860 node webapp/server.mjs
# MCP endpoints ready at http://localhost:7860/mcp and /sse
# Web UI at http://localhost:7860/
```

License: Apache-2.0. © Aleksey Calvin Tsukanov / [SilverAgePoets.com](https://www.SilverAgePoets.com)

---

## Russian support

Calliope's Russian pipeline (accentology + ёфикация + SynTagRus dependency parsing + Russian rhyme/meter analysis) runs on a set of large data assets — the SynTagRus UDPipe model plus stress dictionaries and neural-accentuator weights (~122 MB total). To keep the npm package small, **these assets are not bundled in the published package**; the English engine has no such dependency and works immediately after install.

The Russian assets are fetched **automatically on first Russian analysis** and written into the toolkit's `russian/data` folder, after which they are reused offline. You can also pre-fetch them explicitly:

```bash
npx calliope-fetch-russian   # from an installed package (global or local)
npm run fetch-russian        # from a clone of this repository
```

Configuration (all optional):

| Variable | Effect |
|---|---|
| `CALLIOPE_RUSSIAN_DATA` | Absolute path to a directory holding the Russian data files (skips download; use a pre-populated location). |
| `CALLIOPE_RUSSIAN_DATA_URL` | Base URL to fetch the assets from (defaults to the project's HuggingFace space). |
| `CALLIOPE_RUSSIAN_UDPIPE_MODEL` | Absolute path to just the `.udpipe` model file. |

Asset resolution searches, in order: `$CALLIOPE_RUSSIAN_DATA` → `data/` beside the running module (`src/russian/data` or `dist/russian/data`) → the sibling `src/russian/data` when running compiled code from `dist/` (the Docker / HuggingFace layout) → cwd-relative fallbacks. This means a source checkout, a compiled `dist/`, a Docker/HF deployment, and an npm-installed dependency all locate the data without any manual copying.

The Russian assets — dictionaries, methodology, and the SynTagRus UDPipe model — are redistributed here under the **MIT License** of Ilya Koziev's RussianPoetryScansionTool distribution, which is how they reached this project and which permits commercial use. A CC BY-NC-SA 4.0 reference file is also retained for the SynTagRus model, reflecting the terms under which it is distributed elsewhere; see [License and credits](#license-and-credits).

---

## QUICK START (Command-Line-Interface / CLI mode:

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

## THE WEB APP (browser interface/UI):

Everything the CLI prints — and several instruments beyond it — is also available
as a local web app: the same `dist/` build the CLI uses, wrapped in a single
**zero-dependency** Node server (`webapp/server.mjs`) plus a vanilla-JS
front-end. It only talks to `localhost`; nothing leaves your machine.

### INITIALIZATION:

```bash
# from a clone or an installed package
npm run web                 # then open http://localhost:4321

# installed globally, or via npx (no clone needed)
calliope-web
PORT=8080 calliope-web      # bind any port you like
```

(If you open `index.html` straight off disk with `file://`, the page warns you
that the analysis engine isn't running behind it — always launch through the
server above.)

### The four instruments (tabs)

Across the top: **Scansion · Rhyme Forge · Rewrites · Syntax**.

| Tab | What it does |
|---|---|
| **Scansion** | The main workspace — paste a poem, scan it, and read it back with every syllable tinted by stress; per-line meter/rhyme tags; click-through detailed scans; and a three-card side rail (synopsis, phonopoetics, word profile). |
| **Rhyme Forge** | Single-word sound dossiers from the Nounsing Pro augmented lexicon, plus a *Meter Match* that summons words fitting a cast stress contour. |
| **Rewrites** | *The Transmutation Chamber* — feature-constrained word-substitution rewrites, English or Russian (see below). |
| **Syntax** | *The Parse Observatory* — the UDPipe dependency parse (with DepEdit-TS repairs), line by line or fused. |

### THE SCANSION PIPELINE / FUNCTIONALITY:

Paste a poem into **The Scriptorium** (blank lines separate stanzas) or (optionally) pick a built-in sample to test things out, select a language-specific scansion engine via the
**Language** dropdown (current options are English or Русский/Russia, with more to come), press
**Scan the verse ▶**. Once a scan is in, an edit strip appears at the top. It includes several buttons/selectors:

- **✎ NEW SCAN** button — clear and start over.
- **⧉ COPY STRESS MAP** button — copy to the clipboard (as plain text, CLI style) the entire poem's inferred syllable stress keys, line-by-line verdicts for the likeliest footed meter, the lettered end-rhyme scheme, and some other choicely curious and/or conclusive parses.
- **SHOW FEET & CAESURAE** checkbox — whether or not to display overlaid foot boundaries (`|`) and caesurae (`||`, designating phonologically, poetically, or syntactically cued pauses).
- **TINT** dropdown selector — choose how to display the verses/lines. The options are:
* *relative stress*: with each word's constituent syllables/phonemes are colored in correspondingly with its scansion-discerned prosodic/metrical emphasis, aka its **relative stress** (*the colors here correspond to the five-tier stress gradience scale we use for our primary phonological scansion methodology*: from lightest to heaviest, these tier-colors are grey ('x' or null), blue ('w' or weak), green ('n' or neutral), yellow ('m' or moderate), red ('s' or strong/stressed)),
* *lexical stress*: tints each word in accordance with its lexical stress contours as these are listed within the version of the CMU pronounciation dictionary we use. In this case, there are only three colors: yellow for primary stress, blue for secondary or lighter stress in certain polysyllabic words (the ones where more than one syllable is emphasized) and many function words, and grey for unstressed syllables or/and words.
* *cord class*: displays each word tinted with either light or dark grey, depending on whether  it is determined to be a content word or a function word, a distinction very pertinent to our phonological scansion methodology.
* *plain ink*: raw text representation, same as input.

- **HOVER** over any word for a live tooltip profile — its stress, syllabification,
part of speech, syntactic dependency role, and phonological character. **Click** a word to *latch* its full anatomy — the deep Nounsing Pro morpho-phonological dossier — onto the
**Word Profile** board in the side rail (an *unpin* button releases it).

- **CLICK** a line's meter tag to expand that line's **detailed scan**: the
foot-by-foot division, each syllable's anatomy, the prosodic phrasing and
phonological bracketing, the weighted key stresses, the dependency-tree / syntax
view with morphology, and — as a fully independent second opinion — **Scandroid's**
own reading of the raw line.

### SIDE RAIL PANELS:

At the conclusion of a scan, the right-hand-side display rail becomes populated with three panels:
- **Poem Synopsis** — the poem-level verdict: dominant meter and form, the rhyme
  envelope, enjambment, which engine ran, and how long it took.
- **Phonopoetics** — the sound texture beyond end-rhyme: the end-rhyme scheme,
  internal / caesural / head rhymes and pairs, discerned alliteration runs, and/or any identified acrostic (word spelled out with the first letters of the lines).
- **Word Profile** — the hover/click inspector above; empty until you pin a word here for later reference.

### VISUAL MODES (in the ⚙ Settings menu):

Open **⚙ SETTINGS** pop-up menu to switch the **Display** mode between:
- **Terminal** *(default)* — a dark skin of bright inks on black, monospaced,
  echoing the CLI's `chalk` palette. Visually simpler, and it renders the five
  stress-level gradients most vividly on screen — the best skin for at-a-glance
  parsing or recitation/reading.
- **Manuscript** *(parchment)* — a light skin with a parchment-and-gilt treatment
  and prettier display fonts. Handsomer to read, if a touch (or a few) less efficient for
  scanning the prosodic gradience at a glance. Some people might prefer this visual style. It might also be better for exporting a whole poem/printing outputs.

### BUILT-IN SCANSION ENGINE VARIANTS: 
The same ⚙Settings menu enables one to switch between two substantially distinct built-in variants of the core phonological scansion/prosody parsing engine: — the choices are **Calliope** and **Clio**. <br>
- **Calliope** l
leverages the the default engine utilizing UDpipe-node, our wasm/.js/Node port of UDpipe, a fairly reliable ML-model based identifier of syntactic dependency/constituency relations, lexical morphologies, part-of-speech tags, and other features) in lieu of `Clio`'s more limited (in certain ways/domains) and underpolished older pipe. And though we do effuse a bit in the direction of her sister `Clio` down below, and throw some praise unto the alternative processing toolkit she employs, do be assured: it is not `Clio`, but `Calliope`, decisively and truly, who holds our scansion engine's freshest cleanest keys, and who displays for you the fullest, flukeless, most versatile, substantial, faithful, and refined existent pipeline of the two. That's why 'Calliop' is the default, and 'Clio' specialist or sidekick.  

- **Clio** constitutes an alternative development trajectory for our English-specific phonological scansion engine. In contrast to **Calliope**, **Clio's** parses rely on `FinNLP` a scrappy and inspired little-big npm library of hyper-specialized tools, a minimalistic and modular TypeScript-native NLP suite developed by Alex Corvi. A stark contrast to `UDpipe`, `FinNLP` represents a categorically distinct approach to NLP. Instead of ML models and internalized approximations, its architecture leveraging old-school dictionaries, rules, normalizations, repairs, and so forth, alll worked over by more traditionally programmed functions and algorithms (plus a healthy dose of heuristics here and there). And though ultimately determined to be somewhat less effective than `UDPipe` for our purposes, `FinNLP` nonetheless continues to impress, occasionally keying in with great precession onto the very phrasal structures `UDpipe` flounders past or misidentifies. As such, the `FinNLP` modules retain their place within **Calliope-TS*** – and so does, by extension, `Clio`, their proper host, the elder scansion engine named for the muse of histories like life-dipped songs, like spearing linearities of simple brutal time... And though unquestionably limited, both thru and beyond `FinNLP` as such. This engine built from dicts and rules carries a certain inherent advantage: it is thoroughly and predictably configurable towards more precise conditions, ends, or sequences. And besides this (sadly, largely theoretical) capacity to be or become whatever one might need it to, the suite provides at least a few additional advantages that are perhaps more tangible, advantages, such as its lexicon pre-annotated with some unusually fine-grained part of speech tags so differentiated that they nearly rob the Penn tree bank itself of all definitiveness. 

**✦ GUIDE** button: 
Displays a legend pop-up which explains, compiling all sorts of varied symbols, tiers, measures, nomenclatures, mechanics, and the like. **BE SURE TO READ!**

### RHYMER – aka "The Rhyme Forge" (a discrete rhyme-finder interface)

Type a **word** and, optionally, constrain **Rhymes with exactly** *N* syllables,
then **Forge ▶** for its dossier: rhymes (strict, or trimmed to the syllable
count), rime phonemes, and the word's own metrical foot. Below it, **Meter Match**
takes a stress contour in digits — `1` primary, `2` secondary, `0` unstressed
(`010` → amphibrachs, `100` → dactyls, `01` → iambs) — and **Summon ▶**s every
lexicon word that carries it.

### SYNTAX GRAPHER — aka "the Parse Observatory" (a discrete phrasal UD/NLP interface)

Paste a line or passage and **Parse ▶** to see UDPipe's neural dependency parse
as arc diagrams and a glossed register — every word's part of speech,
morphological features, and grammatical bond, with tag-repair and tree-repair
(DepEdit-TS) already applied. **fuse lines** parses the whole text as one
continuous unit, ignoring line breaks.

### REWRITER / aka "The Transmutation Chamber" (feature-type-grounded configurable input string replacement system)

Each rewrite replaces every word with a lexicon-mate — one sharing its opening
phonemes, its exact stress skeleton, or its rhyme — while a bank of filters keeps
the grammar and register from drifting. Paste text and the chamber **detects the
language automatically from the script** (Cyrillic → Russian, Latin → English);
each cast rolls fresh dice, so re-running yields new results.

**Methods** (both languages):
- **stress skeleton** — keep the meter, transform the sense (each word → one with
  the same stress pattern).
- **phoneme echo** — each word → one sharing its first two phones.
- **rhyme swap** — each word → a rhyme of itself.

**Filters:**

| Control | English casts | Russian casts |
|---|---|---|
| **Part-of-speech fidelity** *(slider: loose → exact tag)* | matches against the scansion parser's POS tags | matches against the UPOS tags from the SynTagRus parse |
| **Zipf frequency floor** *(slider: any word → common only)* | floor on Nounsing Pro's Zipf-graded lexicon | floor on a poetry-corpus frequency table standing in for Zipf |
| **Register fidelity** *(slider: off → same register)* | prefers replacements whose Zipf sits *near* the source word's — rare-for-rare, common-for-common | *(English casts only)* |
| **Morphemic grounding** *(checkbox)* | prefers replacements sharing the source's derivational morphology (suffix, morphological class) and avoids same-root casts | *(English casts only)* |
| **Dictionary tags** *(checkbox)* | revert to context-blind dictionary POS (faster); the default tags each word *in line context* via the scansion parser | *(English casts only)* |
| **Fuzzy rhymes** *(checkbox — appears in rhyme-swap mode only)* | widen beyond perfect rhymes to family / assonant tiers for words with few perfect mates | widen to *неточная рифма* (same tail length + stressed vowel) |

Perfect rhymes still win wherever they exist; the fuzzy tiers only fill in for
words that lack them.

---

## Interpreting outputs

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
- Two languages are presently supported (more will be added in due time): for now, it's only **English** (the primary engine — its dictionary and phonological rules) and **Russian** (a parallel accentological engine, see [Russian support](#russian-support)). Other languages will produce nonsense rather than errors, since the UDPipe and FinNLP backends both take them in as raw text strings, but the prosodic pipeline and the other parsers are all language-specific and won't work (unless you're just that crafty). Speaking of craftiness, if you have any specific language requests (or any other comments/critiques/thoughts), don't hesitate to write in to `alekseycalvin@gmail.com`. 
- Stress-doublet words (*rebel*, *content*, names like *Hugo*) are read with their dictionary/lexical stress; a correction is on the roadmap.
- Many rare or foreign proper names fall back to rule-based and/or morphologically-guided heuristics.

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
- Alex Corvi (FinNLP);
- the compilers of the CMU Pronouncing Dictionary; 
- the makers of Prosodic (Heuser et al, for establishing an admirable state-of-the-art to compare against, differentiate from, and hopefully surpass in due time, in select ways),
- Milan Straka and the UDPipe project (for the robust neural parsing architecture now driving the core mechanics), 
- as well as broader generative-metrics, constraint-based metrics, and OT traditions, including Kiparsky, Prince & Smolensky, Groves, Blumenfeld, Lilja, Chomsky & Halle, Fabb & Halle (rule-based grid scansion theory), Einarsson (Metremic theory), Russom (Universalist metrics), K. M. Ryan (gradient syllable weight), big daddy Jakobson who had once roped the whole world with subtle strings and often hung out with Mayakovsky, and many others. <br>
*Gareth McAleese: If you're reading this, do please email me ('alekseycalvin@gmail.com')! I've many questions...* <br>

### Russian Mode-specific Credits

Calliope's Russian side owes an especial and foundational debt to **Ilya Koziev** and the **"Natural Language Processing in Russian"** group, whose [RussianPoetryScansionTool](https://github.com/Koziev/RussianPoetryScansionTool) served as the principal blueprint for much (though not all) of Calliope's Russian accentology and scansion methodology. Koziev's tool is generously distributed under the **MIT License** (which permits commercial use), and it is through it that the **SynTagRus UDPipe model** first came to this project. With deep respect and gratitude for their excellent work, any questions concerning the SynTagRus model or the underlying Russian-scansion methodology are most appropriately directed to Ilya Koziev and the NLP-in-Russian group.

The Russian data assets bundle their license files, mirrored in the project's [HuggingFace deployment](https://huggingface.co/spaces/AlekseyCalvin/cts/tree/main/src/russian/data):
- `src/russian/data/LICENSE.txt` — the **MIT** license of the RussianPoetryScansionTool / NLP-in-Russian group. This is the license under which the Russian assets used here — dictionaries, methodology, and the SynTagRus UDPipe model — were obtained and are redistributed. It permits commercial use.
- `src/russian/data/LICENSE_UDpipe_SynTagRus.txt` — a **CC BY-NC-SA 4.0** reference file, retained because SynTagRus/UDPipe models are distributed under those terms in other (upstream) channels. It is kept for transparency around that residual ambiguity; it does not govern the copy bundled here, which came via the MIT distribution above.

**A note on commercial use:** the Calliope-TS code (Apache-2.0) and the Russian assets as obtained here (MIT, via Koziev's distribution) permit commercial use. Because SynTagRus/UDPipe models are elsewhere distributed under CC BY-NC-SA 4.0 (non-commercial), anyone with strict compliance requirements may wish to independently confirm the provenance of their model file or substitute one whose licensing they control (point `CALLIOPE_RUSSIAN_UDPIPE_MODEL` at it). The **SynTagRus** treebank and the **UDPipe** framework are the work of Milan Straka et al. (Charles University / LINDAT); the Russian stress dictionaries and neural accentuator derive from the RussianPoetryScansionTool corpus.

