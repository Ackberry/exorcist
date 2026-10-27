import type { Rule } from "../types.js";

/**
 * Names a typosquat is likely to imitate.
 * The scan below does not use this list yet.
 */
export const POPULAR_PACKAGES: readonly string[] = [
  "lodash",
  "react",
  "react-dom",
  "express",
  "axios",
  "chalk",
  "typescript",
  "vite",
  "vitest",
  "next",
  "vue",
  "webpack",
  "eslint",
  "prettier",
  "commander",
  "debug",
  "uuid",
  "moment",
  "request",
  "underscore",
  "async",
  "minimist",
  "glob",
  "fs-extra",
  "semver",
  "dotenv",
  "postcss",
  "tailwindcss",
  "jest",
  "mocha",
];

export const doppelgangerRule: Rule = {
  kind: "doppelganger",
  status: "stub",
  description: "Package name within a small edit distance of a popular package.",
  scan() {
    // TODO(Wed): flag a dependency whose name is a small edit of a popular package.
    // Compare pkg.name to POPULAR_PACKAGES with Damerau-Levenshtein distance.
    // Skip exact matches and names shorter than 4 characters.
    // Suggested threshold: 2. Put the nearest popular name in `detail` so the
    // scorer can keep the exorcism as "swap".
    // Fixture: demo/packages/lodasg is one substitution away from lodash (h -> g).
    // Today this rule returns no findings. test/demo.test.ts depends on that.
    return [];
  },
};
