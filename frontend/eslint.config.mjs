import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // QA workbench (git-ignored): 20.10/17.13/3.11 sweep + measurement scripts
    // are evidence tooling, not app code — not part of the lint surface.
    ".playwright/**",
  ]),
]);

export default eslintConfig;
