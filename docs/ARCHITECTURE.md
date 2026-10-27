# Architecture

Exorcist is a small ESM TypeScript CLI. Rules are the cheap filter. Gemma is the reader for code a rule already flagged. The scan still finishes when Ollama is down.

## Pipeline

```text
package-lock.json
        |
        v
  resolveInstalled          src/resolver.ts
        |
        v
  runRules                  src/scanner.ts
        |                   src/rules/*
        v
  haunted packages only
        |
        +---- Ollama down or --no-oracle --> score from rules
        |
        v
  probe /api/tags, then one /api/chat per haunted package
        |                   src/oracle.ts  (model gemma3:4b by default)
        v
  haunting score + exorcism src/scorer.ts
        |
        v
  terminal + haunting-report.md
                            src/report.ts
```

`src/haunt.ts` is the function that runs those steps. `src/cli.ts` parses argv and writes the file. Library callers can use `haunt` from `src/index.ts` without the CLI.

Calls to the model are sequential, one per haunted package, so a laptop-sized Ollama is not handed the whole tree at once. Quiet packages are never sent.

## Modules

| Module                      | Role                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/types.ts`              | Shared types: packages, findings, rules, judgments, the report.                                 |
| `src/resolver.ts`           | Lockfile v2/v3 to `InstalledPackage[]`.                                                         |
| `src/rules/poltergeist.ts`  | The only rule that flags packages today.                                                        |
| `src/rules/doppelganger.ts` | Stub. Exports `POPULAR_PACKAGES` for the next implementation.                                   |
| `src/rules/revenant.ts`     | Stub. Registry lookup is not implemented.                                                       |
| `src/rules/phantom.ts`      | Stub. Import graph is not implemented.                                                          |
| `src/rules/index.ts`        | `rules` array, in the order findings are collected.                                             |
| `src/scanner.ts`            | Runs every rule. One rule throwing fails the scan, with the rule name and package in the error. |
| `src/oracle.ts`             | Ollama client, prompt, truncation, JSON validation.                                             |
| `src/scorer.ts`             | Score and exorcism.                                                                             |
| `src/report.ts`             | Terminal text and Markdown.                                                                     |
| `src/haunt.ts`              | Pipeline. Accepts an `oracleClient` so tests do not need a live model.                          |
| `src/args.ts`               | Flag and env parsing.                                                                           |
| `src/cli.ts`                | Bin entry. Shebang lives here; `tsc` keeps it.                                                  |

## Data types

`InstalledPackage` is one installed instance:

- `name`, `version`
- `lockKey` — the lockfile key, unique in that file (`node_modules/left-pad`, or a nested `node_modules/.../node_modules/...`)
- `path` — directory on disk, or `null` if the package could not be found
- `manifest` — the fields Exorcist reads from `package.json` (`name`, `version`, `description`, `main`, `scripts`, `dependencies`, `devDependencies`), or `null` if the file is missing or invalid JSON
- `direct` — top-level key whose name is in the root package's `dependencies`, `devDependencies`, or `optionalDependencies`
- `dev` — lockfile `dev: true`, or a top-level package that is only in `devDependencies`

`Finding` is one signal: `rule`, `lockKey`, `packageName`, `version`, `severity` (`critical` | `high` | `medium` | `low` | `info`), `title`, `detail`, `evidence`, `evidencePath`.

`Rule` is the interface every ghost implements:

```ts
interface Rule {
  kind: GhostKind;
  description: string;
  status: "active" | "stub";
  scan(pkg: InstalledPackage, ctx: ScanContext): Finding[] | Promise<Finding[]>;
}
```

`status` is reported as-is. A stub is not inferred from zero findings, because a finished rule can also find nothing.

`OracleJudgment` is `{ verdict, confidence, summary, explanation }`. `verdict` is `benign`, `suspicious`, or `malicious`. `confidence` is 0 to 1. `summary` is the plain-English description of the code.

`PackageHaunting` is a package with at least one finding, plus its score and exorcism. Quiet packages are `QuietPackage` rows with an implicit score of 0 and no exorcism.

## Resolver

Only lockfileVersion **2** and **3** are accepted. Both are read from the `packages` map. The legacy `dependencies` tree in a v2 file is ignored.

An installed package is a key that contains a `node_modules` path segment. The root entry `""` is not a dependency. A `file:` source such as `../packages/widget` is not a second install.

npm writes a `file:` dependency twice:

```json
"../packages/widget": { "version": "1.2.3" },
"node_modules/widget": { "resolved": "../packages/widget", "link": true }
```

The version is taken from the `node_modules` entry, then from the link target entry, then from `package.json`. The name is taken from those entries' `name`, then from the key (`@scope/pkg` included).

The path prefers `node_modules/<name>` when that directory has a `package.json` (a symlink counts). Otherwise a `link: true` or `file:` spec is resolved relative to the project, including `file://` URLs. Registry `https://` specs are not treated as directories. That fallback is why `demo/victim` can be scanned from the committed lockfile before `npm install` creates `node_modules`.

Workspaces are not special-cased. A workspace package is scanned only if it appears under a `node_modules/` key.

## Poltergeist

Install hooks `preinstall`, `install`, and `postinstall` are critical findings. The script body is also checked for the code signals below. `prepare`, `test`, and other scripts are not install hooks and are not flagged by themselves.

In `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts` files under the package (not `.d.ts`), the first match of each signal becomes one finding:

| Signal                                                                                                                              | Severity | Pattern, in short |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- |
| `child_process` import, or `execSync` / `spawnSync` / `execFileSync` / `fork(`                                                      | high     | spawn             |
| `http`, `https`, `net`, `dns`, `tls`, `axios`, `node-fetch`, `undici`, `got`, `fetch(`, `http.get` / `https.request`, `net.connect` | high     | network           |
| `process.env`                                                                                                                       | medium   | env               |
| `~/.ssh`, `.ssh/`, or `".ssh"`                                                                                                      | critical | ssh               |
| `.npmrc`                                                                                                                            | critical | npmrc             |
| `eval(` or `new Function(`                                                                                                          | high     | eval              |
| `Buffer.from(..., "base64")`, `.toString("base64")`, `atob(`, `btoa(`, or a quoted base64-looking literal of 40+ characters         | medium   | base64            |

These are heuristics. A comment that mentions `process.env` still matches. A long token that merely looks like base64 matches.

Walk limits (`POLTERGEIST_LIMITS`):

- 40 source files
- 512 KiB per file (larger files are skipped with no finding)
- directory depth 6
- directories named `node_modules`, `.git`, `dist`, `coverage`, `build`, `.next`, and any dot-directory, are not walked
- evidence starts with the matched line. When the file is at most 2,500 characters, the rest of the file follows. Longer files contribute a window around the match instead

The root project is not scanned. Only installed packages are.

## Score and exorcism

Rule weights (`SEVERITY_WEIGHTS`):

| Severity | Points |
| -------- | ------ |
| critical | 45     |
| high     | 28     |
| medium   | 16     |
| low      | 8      |
| info     | 3      |

The rule total is capped at 100. If Gemma returned a valid judgment, add `ORACLE_NUDGE[verdict] * confidence`:

| Verdict    | Nudge |
| ---------- | ----- |
| malicious  | +20   |
| suspicious | +8    |
| benign     | -18   |

The result is clamped to 0–100 and rounded. The oracle never removes a package from the report. It only moves the score, and a malicious verdict can change the exorcism.

Exorcism, in order:

1. **remove** when the verdict is `malicious` with confidence ≥ `0.5` (`MALICIOUS_CONFIDENCE`), or the score is ≥ `75` (`REMOVE_SCORE`).
2. **swap** when any finding is from `doppelganger` and remove did not win. No current rule emits that finding, so swap is unused on the demo.
3. **pin** otherwise.

On today's weights, before any oracle nudge, the demo scores are:

- `soul-snatcher`: 45 + 16 + 16 = 77, remove
- `hexed-helper`: 28 + 16 = 44, pin
- `lodasg`: 28, pin

## What Gemma does

`oracle.ts` talks to Ollama's local HTTP API.

1. `GET {endpoint}/api/tags` with a 2 second timeout (`PROBE_TIMEOUT_MS`). Connection refused, timeout, non-200, or a model list that does not contain the requested tag means the oracle is unavailable. The report says why and keeps the rule findings. Default model is `gemma3:4b` (`DEFAULT_MODEL`). Default endpoint is `http://localhost:11434` (`DEFAULT_ENDPOINT`), overridable with `--endpoint` / `OLLAMA_HOST` and `--model` / `OLLAMA_MODEL`.
2. If the tags payload has no `models` array, the client still tries the chat call.
3. For each haunted package, `POST {endpoint}/api/chat` with `stream: false`, `temperature: 0`, a system prompt, and the findings plus code. The request asks for JSON matching `JUDGMENT_SCHEMA` (`verdict`, `confidence`, `summary`, `explanation`, no extra properties). If Ollama responds `400`, the client retries once with `"format": "json"` and still validates.
4. Chat timeout is 90 seconds (`CONSULT_TIMEOUT_MS`). A failure on one package is stored on that package as `oracleNote`. The other packages are still judged. The score falls back to the rules.
5. Validation accepts a fenced block or prose around one JSON object, a case-insensitive verdict, a numeric-string confidence, and a confidence from 1 to 100 (divided by 100). Empty summary or explanation is rejected. Summary and explanation are clipped to 2,000 characters.
6. Suspect code is joined per finding and clipped to 6,000 characters (`SUSPECT_CODE_CHAR_BUDGET`), with a note that it was truncated.

Gemma does not choose which packages are suspects. It does not see quiet packages. It does not run the code. Replacing it with a cloud API would break the reason this project is local; don't.

## Report

`renderTerminal` is the spooky-but-readable stdout. `renderMarkdown` is `haunting-report.md`. Both list:

- target, time, counts
- the oracle's one-line status
- every rule, with `active` or `stub` and a finding count
- a table of every installed package (haunted ones have a score and an exorcism; quiet ones are score 0 and an em dash)
- a section per haunted package: findings, evidence, and the judgment if there was one
- quiet names

Color follows the terminal. Piped output stays plain because chalk checks whether stdout is a TTY.

## Tests and the live model

`npm test` does not start Ollama and does not pull a model. The closed-port probe test calls the real `probe()` against `127.0.0.1:1`. Judgment parsing, the chat request body, scoring, the resolver, and poltergeist have unit tests. `test/demo.test.ts` scans `demo/victim` and expects every current finding to come from poltergeist.
