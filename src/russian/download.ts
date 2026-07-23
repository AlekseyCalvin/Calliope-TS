// download.ts — on-first-use downloader for the Russian data assets.
//
// The Russian pipeline needs ~122 MB of data (SynTagRus UDPipe model +
// dictionaries) that are NOT bundled in the npm package. This module fetches
// them from a HuggingFace space into russianDataWriteDir() on first use, then
// every later call is a cheap no-op once the files are present and correctly
// sized. Dependency-free: only node: builtins + global fetch (Node 20+).

import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { russianDataFile, russianDataWriteDir } from './paths.js';

/** Static manifest: every file the Russian pipeline needs, with its exact byte size. */
export const RUSSIAN_DATA_FILES: { name: string; size: number }[] = [
  { name: 'LICENSE.txt', size: 1094 },
  { name: 'LICENSE_UDpipe_SynTagRus.txt', size: 187 },
  { name: 'accentuator.bin', size: 31960084 },
  { name: 'accentuator.json', size: 811 },
  { name: 'ambiguous_accents.json', size: 3111298 },
  { name: 'ambiguous_accents2.json', size: 373565 },
  { name: 'collocations.json', size: 29085 },
  { name: 'derivation_data.json', size: 4059886 },
  { name: 'fuzzy_rhymes.json', size: 306 },
  { name: 'rhymed_words.json', size: 77945 },
  { name: 'rhyming_dict.json', size: 8651588 },
  { name: 'russian-syntagrus-ud-2.0-170801.udpipe', size: 45014943 },
  { name: 'secondary_stress.json', size: 10260274 },
  { name: 'word_accents.tsv.gz', size: 11107564 },
  { name: 'word_freq.json', size: 1002126 },
  { name: 'word_segmentation.json', size: 5087512 },
  { name: 'yo_by_gram.json', size: 677879 },
  { name: 'yo_words.json', size: 5988934 },
];

export const RUSSIAN_DATA_BASE_URL =
  process.env.CALLIOPE_RUSSIAN_DATA_URL ??
  'https://huggingface.co/spaces/AlekseyCalvin/cts/resolve/main/src/russian/data';

const LOG_PREFIX = '[Calliope Russian]';

function formatBytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** True if `name` already resolves to a file whose size matches the manifest. */
async function isPresentAndCorrect(name: string, expectedSize: number): Promise<boolean> {
  const existing = russianDataFile(name);
  if (!existing) return false;
  try {
    const st = await stat(existing);
    return st.size === expectedSize;
  } catch {
    return false;
  }
}

async function downloadOne(name: string, expectedSize: number, targetDir: string, log: (m: string) => void): Promise<void> {
  const url = `${RUSSIAN_DATA_BASE_URL}/${name}`;
  log(`${LOG_PREFIX} downloading ${name} (${formatBytes(expectedSize)})…`);

  let buf: Buffer;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const ab = await res.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (err) {
    throw new Error(
      `${LOG_PREFIX} failed to download "${name}" from ${url}: ${err instanceof Error ? err.message : String(err)}\n` +
      `Fix options:\n` +
      `  - Check network access to huggingface.co and retry.\n` +
      `  - Set CALLIOPE_RUSSIAN_DATA to a directory that already has the Russian data/ files.\n` +
      `  - Set CALLIOPE_RUSSIAN_DATA_URL to an alternate mirror hosting the same file set.`,
    );
  }

  if (buf.length !== expectedSize) {
    throw new Error(
      `${LOG_PREFIX} downloaded "${name}" has the wrong size: expected ${expectedSize} bytes, got ${buf.length} bytes. ` +
      `The remote file may have changed or the transfer was truncated. URL: ${url}`,
    );
  }

  const finalPath = resolve(targetDir, name);
  const tmpPath = `${finalPath}.download-tmp`;
  await writeFile(tmpPath, buf);
  await rename(tmpPath, finalPath);
}

let _inFlight: Promise<{ downloaded: string[]; skipped: string[]; dir: string }> | null = null;

/**
 * Ensure the Russian data assets are present in russianDataWriteDir(),
 * downloading any missing or incorrectly-sized files from
 * RUSSIAN_DATA_BASE_URL. Safe to call repeatedly — once the files are
 * present and correctly sized, this is a cheap no-op. Concurrent callers
 * share the same in-flight run.
 */
export async function ensureRussianData(opts?: {
  force?: boolean;
  onlyFiles?: string[];
  log?: (m: string) => void;
}): Promise<{ downloaded: string[]; skipped: string[]; dir: string }> {
  const force = opts?.force ?? false;
  const log = opts?.log ?? ((m: string) => console.error(m));

  if (_inFlight && !force) return _inFlight;

  const run = (async () => {
    const targetDir = russianDataWriteDir();
    await mkdir(targetDir, { recursive: true });

    const manifest = opts?.onlyFiles
      ? RUSSIAN_DATA_FILES.filter(f => opts.onlyFiles!.includes(f.name))
      : RUSSIAN_DATA_FILES;

    const downloaded: string[] = [];
    const skipped: string[] = [];

    for (const { name, size } of manifest) {
      if (!force && (await isPresentAndCorrect(name, size))) {
        skipped.push(name);
        continue;
      }
      await downloadOne(name, size, targetDir, log);
      downloaded.push(name);
    }

    return { downloaded, skipped, dir: targetDir };
  })();

  _inFlight = run;
  try {
    return await run;
  } finally {
    _inFlight = null;
  }
}
