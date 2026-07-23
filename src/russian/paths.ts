/**
 * Russian data-file resolution.
 *
 * The Russian modules load large data assets (dictionaries, the accentuator
 * blob, the SynTagRus UDPipe model). Historically each module resolved them at
 * exactly ONE location — `resolve(__dirname, 'data')` — which silently assumed
 * the process runs from a `dist/russian/` that has a populated `data/` beside
 * it. That assumption breaks in perfectly valid layouts:
 *
 *   - Docker / HuggingFace Spaces: `tsc` compiles src→dist but never copies
 *     the (non-TS) `data/` folder, so `dist/russian/data` is empty. The real
 *     data still sits in `src/russian/data`, but the loader never looked there.
 *   - Running compiled code from `dist/` while data lives only in `src/`.
 *   - A consumer that installs the package and stores the data elsewhere.
 *
 * This module resolves each asset against an ORDERED list of candidate roots,
 * returning the first root that actually contains the requested file. That way
 * a src-only layout, a dist-only layout, a split layout, or an explicit
 * override all work without anyone having to hand-copy folders.
 *
 * Override precedence (highest first):
 *   1. $CALLIOPE_RUSSIAN_DATA  — absolute path to a data directory
 *   2. data/ beside this module (dist/russian/data or src/russian/data)
 *   3. the sibling src/russian/data when running from dist/russian  ← HF/Docker
 *   4. cwd-relative src/ and dist/ layouts
 */

import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Ordered data-directory roots; first existing / first containing wins. */
export function russianDataRoots(): string[] {
  const roots: string[] = [];
  const env = process.env.CALLIOPE_RUSSIAN_DATA;
  if (env) roots.push(resolve(env));
  roots.push(
    // Canonical: data/ beside the running module (src via tsx, OR dist if the
    // build step copied data into it).
    resolve(__dirname, 'data'),
    // Running from dist/russian/ but data only lives in src/russian/ — the
    // HuggingFace/Docker case where `tsc` didn't copy the assets.
    resolve(__dirname, '..', '..', 'src', 'russian', 'data'),
    resolve(__dirname, '..', '..', '..', 'src', 'russian', 'data'),
    // Symmetric: running from src/ but only a populated dist/ exists.
    resolve(__dirname, '..', '..', 'dist', 'russian', 'data'),
    // cwd-anchored fallbacks (process launched from the repo root).
    resolve(process.cwd(), 'src', 'russian', 'data'),
    resolve(process.cwd(), 'dist', 'russian', 'data'),
  );
  return roots;
}

/**
 * Resolve one data file by name across the candidate roots.
 * Returns the first existing absolute path, or `undefined` if none carries it.
 * Resolution is per-file, so mixed layouts (some assets in src, some in dist)
 * still resolve correctly.
 */
export function russianDataFile(filename: string): string | undefined {
  for (const root of russianDataRoots()) {
    const p = resolve(root, filename);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Like {@link russianDataFile} but throws a descriptive error when the file is
 * absent — for required assets whose absence should fail loudly.
 */
export function requireRussianDataFile(filename: string): string {
  const p = russianDataFile(filename);
  if (p) return p;
  throw new Error(
    `Calliope Russian data file "${filename}" not found. Searched:\n` +
    russianDataRoots().map(r => `  - ${resolve(r, filename)}`).join('\n') +
    `\nPlace the Russian data/ folder in src/russian/ or dist/russian/, ` +
    `or set CALLIOPE_RUSSIAN_DATA to its directory.`,
  );
}

/** First data root that exists on disk (for callers that only need the dir). */
export function russianDataDir(): string {
  for (const root of russianDataRoots()) {
    if (existsSync(root)) return root;
  }
  // Fall back to the canonical location for error messages.
  return resolve(__dirname, 'data');
}

/**
 * The directory the on-first-use downloader should WRITE into.
 *
 * Unlike {@link russianDataRoots} (a read-side search list), this is a single
 * target: populate `src/russian/data` when a source tree exists alongside
 * the running module (dev, or the repo/Docker/HF layout where `tsc` compiles
 * src→dist but doesn't copy the data/ folder), so the fetched assets land
 * where the rest of the resolvers already expect to find them. Only when no
 * src/ tree is present at all (an npm-installed dependency shipping just
 * dist/) does it fall back to writing beside the running module itself.
 */
export function russianDataWriteDir(): string {
  const env = process.env.CALLIOPE_RUSSIAN_DATA;
  if (env) return resolve(env);

  // Running from src/russian directly (ts-node/tsx dev mode) — write here.
  if (basename(__dirname) === 'russian' && basename(dirname(__dirname)) === 'src') {
    return resolve(__dirname, 'data');
  }

  // Running from dist/russian/ with a sibling src/russian/ present — the
  // repo/Docker/HF layout where compiled code runs from dist/ but the
  // source tree (and thus the canonical data/ home) still exists.
  const siblingSrcRussian = resolve(__dirname, '..', '..', 'src', 'russian');
  if (existsSync(siblingSrcRussian)) {
    return resolve(siblingSrcRussian, 'data');
  }

  // npm-installed dependency: only dist/ ships, so write beside it.
  return resolve(__dirname, 'data');
}
