#!/usr/bin/env python3
# build_ru_word_freq.py — builds src/russian/data/word_freq.json, the
# poetry-domain word-frequency table used by the Russian Transmutation
# Chamber (webapp Rewrite tab) in place of English Zipf frequencies.
#
# Sources: the scanned Russian poetry corpora shipped with RussianScan
# (ArsPoetica ~8.5k poems, Rifma ~5.1k poems, plus the Lyrical validation
# split).  Counts surface forms (lowercased, ё preserved), keeps words seen
# at least MIN_COUNT times, and stores a Zipf-style score:
#     zipf = log10(count / total_tokens * 1e9)
# so the webapp's 0–4 "frequency floor" slider can gate candidates the same
# way the English side gates by Zipf.  Being poetry-domain, the table also
# biases rewrites toward words that actually occur in verse.
#
# Usage:  python3 tools/build_ru_word_freq.py [path-to-RussianScan]

import json, math, re, sys, collections, os

HERE = os.path.dirname(os.path.abspath(__file__))
RSCAN = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'RussianScan')
CORP = os.path.join(RSCAN, 'Preprocessed_Corpuses')
OUT = os.path.join(HERE, '..', 'src', 'russian', 'data', 'word_freq.json')
MIN_COUNT = 2

WORD_RE = re.compile(r'[А-Яа-яЁё][А-Яа-яЁё\-]*')
STRESS_MARKS = dict.fromkeys(map(ord, '̀́'), None)

counts = collections.Counter()
total = 0

def feed(text):
    global total
    text = text.translate(STRESS_MARKS)
    for m in WORD_RE.finditer(text):
        w = m.group(0).lower().strip('-')
        if not w:
            continue
        counts[w] += 1
        total += 1

for rel, key in [
    ('ArsPoetica_Ru_Scanned_Poetry_Corpus/arspoetica.json', 'poem_text'),
    ('Rifma_Ru_Scanned_Rhyme_Tagged_Poetry_Corpus/rifma_dataset.json', 'poem_text'),
]:
    p = os.path.join(CORP, rel)
    if not os.path.exists(p):
        print('skip (missing):', p)
        continue
    for item in json.load(open(p)):
        t = item.get(key)
        if t:
            feed(t)

lyr = os.path.join(CORP, 'Lyrical_Small_Ru_Eng_Dataset', 'validation.scanned.txt')
if os.path.exists(lyr):
    feed(open(lyr, encoding='utf-8').read())

table = {}
for w, c in counts.items():
    if c < MIN_COUNT:
        continue
    table[w] = round(math.log10(c / total * 1e9), 2)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(table, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'tokens={total}  types={len(counts)}  kept={len(table)}  -> {OUT}')
zipfs = sorted(table.values())
for q in (0, 25, 50, 75, 90, 99, 100):
    print(f'  zipf p{q}: {zipfs[min(len(zipfs)-1, len(zipfs)*q//100)]}')
