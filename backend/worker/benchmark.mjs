#!/usr/bin/env node
/**
 * Task 24.14 — the extraction accuracy benchmark harness.
 *
 * Pairs a fixture file with its expected text and reports how closely the
 * pipeline's extraction matches:
 *
 *     backend/worker/benchmark-fixtures/
 *       lecture-01.pdf
 *       lecture-01.expected.txt
 *       handout.docx
 *       handout.expected.txt
 *
 * Usage:
 *     npm run benchmark -w backend
 *     node backend/worker/benchmark.mjs [--dir=DIR] [--min=0.9]
 *
 * The metric is the Dice coefficient over normalized character bigrams — a
 * cheap, deterministic, language-agnostic similarity in [0, 1] (1 = the
 * extracted, normalized text equals the expected, normalized text). Both
 * sides go through the same `normalizeText` the pipeline stores with, so the
 * score measures what actually lands in `document_chunks`.
 *
 * Honesty rules (24.14 stays `[~]` until a real, human-checked test set
 * exists): this harness never invents a number — it measures exactly the
 * fixtures present. No fixtures means it reports that and exits non-zero,
 * because a benchmark that ran nothing must not read as success. No accuracy
 * figures from this harness are recorded in TASK.md/DATABASE.md until the
 * fixture set is real.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { extractDocx } from "./extract/docx.mjs";
import { extractPdf } from "./extract/pdf.mjs";
import { normalizeText } from "./extract/text.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(HERE, "benchmark-fixtures");

function parseArgs(argv) {
  const options = { dir: DEFAULT_DIR, min: 0.9 };
  for (const arg of argv) {
    if (arg.startsWith("--dir=")) options.dir = path.resolve(arg.slice(6));
    else if (arg.startsWith("--min=")) {
      const value = Number.parseFloat(arg.slice(6));
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        options.min = value;
      }
    }
  }
  return options;
}

function bigrams(text) {
  const counts = new Map();
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** Dice coefficient over character bigrams, in [0, 1]. */
export function similarity(expected, actual) {
  if (expected === actual) return 1;
  if (expected.length < 2 || actual.length < 2) return 0;

  const expectedGrams = bigrams(expected);
  const actualGrams = bigrams(actual);
  let intersection = 0;
  let expectedTotal = 0;
  let actualTotal = 0;

  for (const [gram, count] of expectedGrams) {
    expectedTotal += count;
    intersection += Math.min(count, actualGrams.get(gram) ?? 0);
  }
  for (const count of actualGrams.values()) actualTotal += count;

  return (2 * intersection) / (expectedTotal + actualTotal);
}

async function extractText(filePath) {
  const buffer = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".pdf") {
    const { pages } = await extractPdf(buffer);
    return normalizeText(pages.join("\n\n"));
  }
  if (extension === ".docx") {
    const { pages } = await extractDocx(buffer);
    return normalizeText(pages.join("\n\n"));
  }
  throw new Error(`Unsupported fixture extension: ${extension}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let entries;
  try {
    entries = await readdir(options.dir);
  } catch {
    entries = [];
  }

  const pairs = [];
  for (const entry of entries) {
    const extension = path.extname(entry).toLowerCase();
    if (extension !== ".pdf" && extension !== ".docx") continue;
    const expectedPath = path.join(
      options.dir,
      `${path.basename(entry, extension)}.expected.txt`,
    );
    try {
      await stat(expectedPath);
      pairs.push({ name: entry, filePath: path.join(options.dir, entry), expectedPath });
    } catch {
      console.warn(`skip ${entry}: no matching .expected.txt`);
    }
  }

  if (pairs.length === 0) {
    console.error(
      `No fixtures found in ${options.dir}. Add <name>.pdf|.docx + <name>.expected.txt pairs (24.14 is [~] until a real test set exists).`,
    );
    process.exitCode = 1;
    return;
  }

  let total = 0;
  let belowMin = 0;
  for (const pair of pairs) {
    const expected = normalizeText(await readFile(pair.expectedPath, "utf8"));
    const actual = await extractText(pair.filePath);
    const score = similarity(expected, actual);
    total += score;
    if (score < options.min) belowMin += 1;
    console.log(
      `${pair.name}: ${score.toFixed(4)} ${score >= options.min ? "ok" : "below-min"}`,
    );
  }

  const mean = total / pairs.length;
  console.log(
    `pairs=${pairs.length} mean=${mean.toFixed(4)} min=${options.min} belowMin=${belowMin}`,
  );
  process.exitCode = belowMin === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
