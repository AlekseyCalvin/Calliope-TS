#!/usr/bin/env node
// fetch-russian-data.mjs — CLI wrapper around ensureRussianData(), so
// `npm run fetch-russian` can pre-populate the Russian data/ assets instead
// of paying the download cost on first real use.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const downloadModulePath = resolve(__dirname, '..', 'dist', 'russian', 'download.js');

if (!existsSync(downloadModulePath)) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}

const { ensureRussianData } = await import(downloadModulePath);

try {
  const { downloaded, skipped, dir } = await ensureRussianData({
    log: (m) => console.error(m),
  });
  console.error(
    `[Calliope Russian] done: ${downloaded.length} downloaded, ${skipped.length} already present, dir=${dir}`,
  );
} catch (err) {
  console.error(`[Calliope Russian] fetch failed: ${err?.message ?? err}`);
  process.exit(1);
}
