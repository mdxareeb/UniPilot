import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEnvFile, resolveSetting } from "./env.mjs";

test("parseEnvFile ignores comments, blanks and padding", () => {
  const parsed = parseEnvFile("# a comment\n\nA=1\n  B = 2  \n");
  assert.deepEqual(parsed, { A: "1", B: "2" });
});

test("parseEnvFile strips export prefixes and surrounding quotes", () => {
  const parsed = parseEnvFile("export A=one\nB=\"two words\"\nC='three'\n");
  assert.deepEqual(parsed, { A: "one", B: "two words", C: "three" });
});

test("parseEnvFile keeps equals signs in values and lets the last duplicate win", () => {
  const parsed = parseEnvFile("URL=http://x/rest/v1/\nURL=http://y\n");
  assert.deepEqual(parsed, { URL: "http://y" });
});

test("parseEnvFile tolerates CRLF line endings", () => {
  const parsed = parseEnvFile("A=1\r\nB=2\r\n");
  assert.deepEqual(parsed, { A: "1", B: "2" });
});

test("resolveSetting prefers process env, then file env, then the fallback", () => {
  assert.equal(
    resolveSetting("X", { processEnv: { X: "p" }, fileEnv: { X: "f" }, fallback: "d" }),
    "p",
  );
  assert.equal(
    resolveSetting("X", { processEnv: {}, fileEnv: { X: "f" }, fallback: "d" }),
    "f",
  );
  assert.equal(
    resolveSetting("X", { processEnv: { X: "  " }, fileEnv: { X: "f" }, fallback: "d" }),
    "f",
  );
  assert.equal(
    resolveSetting("X", { processEnv: {}, fileEnv: {}, fallback: "d" }),
    "d",
  );
});
