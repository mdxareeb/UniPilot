#!/usr/bin/env node
/**
 * Task 25.11 — the retrieval quality harness.
 *
 * Runs real queries against the real search function and measures what comes
 * back. Fixtures live in `backend/worker/search-fixtures/` as JSON:
 *
 *     {
 *       "query": "thermodynamics entropy",
 *       "expected": [
 *         { "documentName": "Thermo notes.pdf", "page": 3 }
 *       ]
 *     }
 *
 * Usage:
 *     npm run search-benchmark -w backend
 *     node backend/worker/searchBenchmark.mjs [--dir=DIR] [--k=5] [--min=1]
 *
 * Metrics, per fixture and aggregated: recall@k (expected references found in
 * the top-k) and reciprocal rank of the first expected hit. `--min` is the
 * aggregate recall gate (default 1.0).
 *
 * Honesty rules (25.11 stays `[~]` until a real, human-checked sample set
 * exists): this harness never invents a metric — it measures exactly the
 * fixtures it is given. No fixtures means it reports that and exits non-zero,
 * because a benchmark that ran nothing must not read as success. No accuracy
 * numbers from this harness are recorded in TASK.md/DATABASE.md until the
 * fixture set is real. Semantic recall is not measurable here: it requires an
 * embedding provider (25.3/25.6, blocked).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(HERE, "search-fixtures");

function parseArgs(argv) {
  const options = { dir: DEFAULT_DIR, k: 5, min: 1 };
  for (const arg of argv) {
    if (arg.startsWith("--dir=")) options.dir = path.resolve(arg.slice(6));
    else if (arg.startsWith("--k=")) {
      const value = Number.parseInt(arg.slice(4), 10);
      if (Number.isFinite(value) && value > 0) options.k = value;
    } else if (arg.startsWith("--min=")) {
      const value = Number.parseFloat(arg.slice(6));
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        options.min = value;
      }
    }
  }
  return options;
}

function readEnvironment() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (url === "" || key === "") {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Locally: `npm run search-benchmark -w backend` loads frontend/.env.development.local.",
    );
  }
  return { url, key };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let entries = [];
  try {
    entries = await readdir(options.dir);
  } catch {
    entries = [];
  }
  const fixtureNames = entries.filter((entry) => entry.endsWith(".json"));

  if (fixtureNames.length === 0) {
    console.error(
      `No fixtures found in ${options.dir}. Add <name>.json files shaped ` +
        `{ "query": "...", "expected": [{ "documentName": "...", "page": N }] } ` +
        `(25.11 is [~] until a real human-checked set exists).`,
    );
    process.exitCode = 1;
    return;
  }

  const { url, key } = readEnvironment();
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let recallTotal = 0;
  let reciprocalTotal = 0;

  for (const fixtureName of fixtureNames) {
    const fixture = JSON.parse(
      await readFile(path.join(options.dir, fixtureName), "utf8"),
    );
    const expected = Array.isArray(fixture.expected) ? fixture.expected : [];

    const { data, error } = await service.rpc("search_document_chunks", {
      p_query: String(fixture.query ?? ""),
      p_limit: options.k,
      p_document_id: null,
      p_page: null,
      p_embedding: null,
    });
    if (error) throw new Error(`${fixtureName}: ${error.message}`);

    const hits = data ?? [];
    const isExpected = (hit) =>
      expected.some(
        (reference) =>
          reference.documentName === hit.document_name &&
          (reference.page === undefined ||
            reference.page === null ||
            reference.page === hit.page),
      );
    const found = hits.filter(isExpected).length;
    const recall = expected.length === 0 ? (hits.length === 0 ? 1 : 0) : found / expected.length;
    const firstIndex = hits.findIndex(isExpected);
    const reciprocalRank = firstIndex === -1 ? 0 : 1 / (firstIndex + 1);

    recallTotal += recall;
    reciprocalTotal += reciprocalRank;
    console.log(
      `${fixtureName}: recall@${options.k}=${recall.toFixed(4)} rr=${reciprocalRank.toFixed(4)} hits=${hits.length}`,
    );
  }

  const meanRecall = recallTotal / fixtureNames.length;
  const meanReciprocalRank = reciprocalTotal / fixtureNames.length;
  console.log(
    `fixtures=${fixtureNames.length} k=${options.k} meanRecall=${meanRecall.toFixed(4)} mrr=${meanReciprocalRank.toFixed(4)} min=${options.min}`,
  );
  process.exitCode = meanRecall >= options.min ? 0 : 1;
}

main().catch((error) => {
  console.error(`search-benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
