/**
 * Everything on the page is copied from a real run, not written for effect.
 *
 * The terminal lines are `exorcist demo/victim --no-oracle` with the ANSI
 * stripped and the colors re-applied as tones. The judgments are the exact
 * strings in `test/fixtures/ollama-0.40.11-judgment-200.json` and
 * `ollama-0.40.11-lookalike-200.json`. If the scanner's behavior changes,
 * this file goes stale and should be re-captured.
 */

export type Tone = "plain" | "dim" | "accent" | "crit" | "warn" | "ok";

export interface Span {
  text: string;
  tone?: Tone;
}

/** One printed line, as a run of toned spans. */
export const scanLines: Span[][] = [
  [{ text: "EXORCIST 0.1.0", tone: "accent" }],
  [{ text: "a lockfile, a candle, and a local model", tone: "dim" }],
  [],
  [{ text: "target    ", tone: "dim" }, { text: "demo/victim" }],
  [{ text: "scanned   ", tone: "dim" }, { text: "2026-10-31T19:37:04.173Z" }],
  [{ text: "packages  ", tone: "dim" }, { text: "5 installed · 3 haunted · 2 quiet" }],
  [
    { text: "oracle    ", tone: "dim" },
    { text: "Oracle skipped (--no-oracle). Report built from rules only.", tone: "warn" },
  ],
  [],
  [{ text: "  rule           status   findings", tone: "dim" }],
  [{ text: "  poltergeist    " }, { text: "active", tone: "ok" }, { text: "   5" }],
  [{ text: "  doppelganger   " }, { text: "active", tone: "ok" }, { text: "   1" }],
  [{ text: "  revenant       " }, { text: "active", tone: "ok" }, { text: "   0" }],
  [{ text: "  phantom        " }, { text: "active", tone: "ok" }, { text: "   2" }],
  [],
  [{ text: "soul-snatcher@1.0.0" }],
  [
    { text: "  █████████░    93", tone: "crit" },
    { text: "/100  " },
    { text: "remove", tone: "crit" },
    { text: "  direct" },
  ],
  [{ text: "  critical  ", tone: "crit" }, { text: "  runs a postinstall script" }],
  [{ text: "             package.json: node postinstall.js", tone: "dim" }],
  [{ text: "  medium    ", tone: "warn" }, { text: "  reads process.env" }],
  [
    {
      text: '             postinstall.js: const token = process.env[dummyName] ?? "not-a-real-secret";…',
      tone: "dim",
    },
  ],
  [{ text: "  medium    ", tone: "warn" }, { text: "  contains a base64 payload" }],
  [
    {
      text: '             postinstall.js: const pocket = Buffer.from(String(token)).toString("base64");…',
      tone: "dim",
    },
  ],
  [{ text: "  medium    ", tone: "warn" }, { text: "  installed but never imported" }],
  [
    {
      text: '             package.json: "soul-snatcher": "file:../packages/soul-snatcher"',
      tone: "dim",
    },
  ],
  [
    { text: "  exorcism  ", tone: "dim" },
    { text: "remove", tone: "crit" },
    { text: " — Haunting score 93/100 is at least 75." },
  ],
  [],
  [{ text: "hexed-helper@1.0.0" }],
  [
    { text: "  ██████░░░░    60", tone: "warn" },
    { text: "/100  " },
    { text: "remove", tone: "crit" },
    { text: "  direct" },
  ],
  [{ text: "  high      ", tone: "crit" }, { text: "  uses eval or the Function constructor" }],
  [
    {
      text: '             index.js: return eval(Buffer.from(incantation, "base64").toString("utf8"));…',
      tone: "dim",
    },
  ],
  [{ text: "  medium    ", tone: "warn" }, { text: "  contains a base64 payload" }],
  [{ text: "  medium    ", tone: "warn" }, { text: "  installed but never imported" }],
  [
    { text: "  exorcism  ", tone: "dim" },
    { text: "remove", tone: "crit" },
    { text: " — hexed-helper is installed but never imported." },
  ],
  [],
  [{ text: "lodasg@1.0.0" }],
  [
    { text: "  ███░░░░░░░    28", tone: "ok" },
    { text: "/100  " },
    { text: "swap", tone: "warn" },
    { text: "  direct" },
  ],
  [{ text: "  high      ", tone: "crit" }, { text: "  name imitates lodash" }],
  [
    {
      text: "             index.js: description: The Lodash library delivering modularity…",
      tone: "dim",
    },
  ],
  [
    { text: "  exorcism  ", tone: "dim" },
    { text: "swap", tone: "warn" },
    { text: " — Swap lodasg for lodash." },
  ],
  [],
  [{ text: "quiet", tone: "dim" }],
  [{ text: "  lucky-charm@1.0.0" }],
  [{ text: "  preact@1.0.0" }],
];

export interface Ghost {
  name: string;
  icon: "poltergeist" | "doppelganger" | "phantom" | "revenant";
  blurb: string;
  signals: string;
  severity: string;
  /** Real evidence the rule printed, shown only in the lead cell. */
  snippet?: { before: string; hit: string; after: string };
}

export const ghosts: Ghost[] = [
  {
    name: "Poltergeist",
    icon: "poltergeist",
    blurb: "Things moving on their own, at install time.",
    signals:
      "Install hooks, child_process, network modules, process.env, SSH paths, .npmrc, eval and Function, base64 blobs, and names hidden behind \\xNN escapes. It reads the package; it never runs it.",
    severity: "up to critical",
    snippet: {
      before: "postinstall.js:  const token = ",
      hit: "process.env",
      after:
        '[dummyName] ?? "not-a-real-secret";\n                 const pocket = Buffer.from(String(token)).toString("base64");',
    },
  },
  {
    name: "Doppelganger",
    icon: "doppelganger",
    blurb: "Wearing another package's face.",
    signals:
      "One edit from a popular name, a separator swap, a dropped scope, a .js suffix, a short combosquat affix. lodasg pretending to be lodash.",
    severity: "high",
  },
  {
    name: "Phantom",
    icon: "phantom",
    blurb: "Installed, paid for, never actually there.",
    signals:
      "A direct dependency the project never imports, requires, or names in a root script. Its install hooks still run.",
    severity: "medium · low for dev",
  },
  {
    name: "Revenant",
    icon: "revenant",
    blurb: "Came back after a year in the ground.",
    signals:
      "A release that landed 365+ days after the one before it, or under a maintainer the previous release did not have. The only rule that asks the npm registry anything.",
    severity: "medium",
  },
];

export interface Verdict {
  pkg: string;
  label: string;
  modelScore: number;
  ruleFloor: number;
  confidence: number;
  quote: string;
  note: string;
}

/** Captured from gemma3:4b on Ollama 0.40.11, checked into test/fixtures. */
export const verdicts: Verdict[] = [
  {
    pkg: "soul-snatcher",
    label: "suspicious",
    modelScore: 65,
    ruleFloor: 93,
    confidence: 0.75,
    quote:
      "The package runs a postinstall script that reads environment variables and encodes them in base64, despite claiming to be a harmless demo fixture.",
    note: "Its own description calls it harmless. The model read the code and did not take its word for it — package text is fenced off in the prompt as data, never instructions.",
  },
  {
    pkg: "lodasg",
    label: "impostor",
    modelScore: 42,
    ruleFloor: 28,
    confidence: 0.99,
    quote:
      "The description, README, and code all explicitly state that this package is the 'lodash' library, despite the installed name being 'lodasg'.",
    note: "Impersonation alone holds at the rule floor of 28 and the fix stays swap. The model can raise a score and never lower one, and it cannot turn a naming problem into a removal.",
  },
];

export const steps = [
  {
    title: "Clone and build",
    note: "Node 22.13 or newer.",
    cmd: "git clone https://github.com/Ackberry/exorcist && cd exorcist && npm ci && npm run build",
  },
  {
    title: "Scan without a model",
    note: "Deterministic rules only. No Ollama needed.",
    cmd: "node dist/cli.js /path/to/your/project --no-oracle",
  },
  {
    title: "Light the candle",
    note: "Pull the model once, leave Ollama running, drop the flag.",
    cmd: "ollama pull gemma3:4b && node dist/cli.js /path/to/your/project",
  },
  {
    title: "Or take the JSON",
    note: "stdout carries the report and nothing else, so it pipes.",
    cmd: "node dist/cli.js . --no-oracle --json | jq '.hauntings[]'",
  },
];

/** From a real scan of this repository's own tree. */
export const selfScan = {
  packages: 346,
  haunted: 100,
  byRule: [
    { rule: "revenant", count: 74 },
    { rule: "poltergeist", count: 69 },
    { rule: "doppelganger", count: 1 },
    { rule: "phantom", count: 1 },
  ],
};

export const REPO = "https://github.com/Ackberry/exorcist";

/** The one line that gets someone from nothing to a scan. */
export const ONELINER =
  "git clone https://github.com/Ackberry/exorcist && cd exorcist && npm ci && npm run build";
