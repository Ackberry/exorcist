# Architecture

Exorcist is a small ESM TypeScript CLI. Rules are the cheap filter. Gemma reads code a rule already flagged and sets the risk score, which cannot fall below the rule total. The scan still finishes when Ollama is down.

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
        +---- Ollama down or --no-oracle --> score is the rule floor
        |
        v
  probe /api/tags, then one /api/chat per haunted package
        |                   src/oracle.ts  (model gemma3:4b by default)
        v
  model score, not below the rule floor
        |                   src/scorer.ts
        v
  exorcism
        |
        v
  terminal + haunting-report.md
                            src/report.ts
```

`src/haunt.ts` is the function that runs those steps. `src/cli.ts` parses argv and writes the file. Library callers can use `haunt` from `src/index.ts` without the CLI.

Phantom is the rule that reads the target project's own source. The other rules only see installed packages.

Calls to the model are sequential, one per haunted package, so a laptop-sized Ollama is not handed the whole tree at once. Quiet packages are never sent.

## Modules

| Module                      | Role                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/types.ts`              | Shared types: packages, findings, rules, judgments, the report.                                 |
| `src/resolver.ts`           | Lockfile v2/v3 to `InstalledPackage[]`.                                                         |
| `src/rules/poltergeist.ts`  | Install scripts and risky APIs inside installed packages.                                       |
| `src/rules/doppelganger.ts` | Typosquat and impersonation names against `POPULAR_PACKAGES`.                                  |
| `src/rules/revenant.ts`     | Stub. Registry lookup is not implemented.                                                       |
| `src/rules/phantom.ts`      | Direct dependency the project never imports or names in a script.                               |
| `src/rules/index.ts`        | `rules` array, in the order findings are collected.                                             |
| `src/scanner.ts`            | Runs every rule. One rule throwing fails the scan, with the rule name and package in the error. |
| `src/oracle.ts`             | Ollama client, prompt, stated purpose, truncation, JSON validation, one retry.                  |
| `src/scorer.ts`             | Rule floor, model score, and exorcism.                                                          |
| `src/report.ts`             | Terminal text and Markdown.                                                                     |
| `src/haunt.ts`              | Pipeline. Accepts an `oracleClient` so tests do not need a live model.                          |
| `src/args.ts`               | Flag and env parsing.                                                                           |
| `src/cli.ts`                | Bin entry. Shebang lives here; `tsc` keeps it. Sets `process.exitCode` and does not call `process.exit`. |

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

`OracleJudgment` is `{ verdict, confidence, score, summary, explanation }`. `verdict` is `benign`, `suspicious`, or `malicious`. `confidence` is 0 to 1. `score` is Gemma's risk score from 0 to 100, before the rule floor is applied. `summary` is the plain-English description of the code. A doppelganger call also sets `impersonating` (boolean) and `impersonationOf` (the popular name). Those two fields are absent on a harm-only judgment.

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

## Phantom

Phantom flags a **direct** dependency the project declares and installs but never references. Transitive packages are ignored. The walk reads the target project, not dependency source.

A package is referenced when any of these is true:

- Project source has `import` / `export ... from`, a dynamic `import()`, `require()`, or `require.resolve()` whose specifier is that package. `pkg/sub` and `@scope/pkg/sub` count as `pkg` and `@scope/pkg`. Relative paths and `node:` built-ins do not.
- The root `package.json` `scripts` values contain the package name as a shell token (`name`, `name/sub`, or `name@version`), or a path under `node_modules/<name>`.
- Those scripts invoke a `bin` from the installed package's `package.json`. A string `bin` uses the unscoped package name. Shell words such as `node` and `npm` are not bins.

`dependencies` and `optionalDependencies` are severity `medium` (16 points). `devDependencies` are severity `low` (8). A dev tool is lower confidence because a config file this rule does not parse can still load it. The title is `installed but never imported`. Evidence is the declaration line from the project `package.json` (`"name": "spec"`), with `evidencePath` `package.json`.

Source files are `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.mts`, `.cts`, including `.d.ts` and dotfiles such as `.eslintrc.js`. The walk skips `node_modules`, `dist`, `coverage`, `build`, and any dot-directory (so `.git` and `.next` are skipped). Caps (`PHANTOM_LIMITS`): 300 files, 512 KiB each, depth 8. The usage walk is memoized on the `ScanContext` for one `runRules` pass.

This is a lexer, not a JavaScript parser. Comments and ordinary strings are not uses. A `require()` or `import()` inside a template `${...}` is a use; the same text sitting in the template as characters is not. Known misses and false alarms:

- `require(someVariable)` and `import(someVariable)` are not resolved, so a real use can look unused.
- `obj.require("pkg")` is ignored.
- A regex literal containing `//` or `/*` can swallow later source.
- The `from` clause is searched for about 800 characters.
- `.vue`, `.svelte`, JSON, and YAML are not read, except root `package.json` scripts. A plugin named only in `.eslintrc.json` can be flagged.
- TypeScript path aliases are treated as package names. An alias equal to a dependency name counts as a use.
- An import that lives only in a skipped directory, a file over 512 KiB, or past the 300-file cap is invisible, so that dependency is flagged.
- Symlinked source files are not followed. If the package directory is missing, `bin` names are unknown.

On the demo, `demo/victim/src/app.js` imports `lucky-charm`, `lodasg`, and `preact`. It does not reference `soul-snatcher` or `hexed-helper`. Those two get a phantom finding.

## Doppelganger

Doppelganger flags an installed name that imitates a popular package. The popular names are the static list in `src/rules/popular-packages.ts` (a few hundred, re-exported as `POPULAR_PACKAGES`). It is a snapshot of the 2025-01-13 most-depended-upon dump ([dasfreak/npm-most-depended-upon](https://github.com/dasfreak/npm-most-depended-upon)), with ranking spam removed, plus historical typosquat targets such as `cross-env`, `electron`, and `mongoose`. The scan does not contact the registry.

An exact member of that list is never flagged. SpellBound's rule is the reason: a popular package is not treated as the perpetrator ([Taylor et al., arXiv:2003.03471](https://arxiv.org/abs/2003.03471)). That is why `preact` stays quiet even though it is one character from `react`, and why `lodash-es` and `babel-core` are on the list. Names shorter than 4 characters are not compared. Targets shorter than 4 (`ms`, `qs`, `zod`) stay on the list only so an exact install is recognized.

The signals are the ones that showed up in real campaigns, not a raw edit-distance cutoff. A 2017 proposal to reject any name within Levenshtein distance 3 would have caught `crossenv` (one deletion of `-` from `cross-env`), but Scott Logic measured that 46% of npm names already sit within distance 2 of some other name ([Hunting typosquatters on npm](https://blog.scottlogic.com/2018/02/27/hunting-typosquatters-on-npm.html)). SpellBound dropped raw Levenshtein for the same reason. Socket's bar is about 1–2 edits from a much more popular package ([Socket FAQ](https://docs.socket.dev/docs/faq), [glossary](https://socket.dev/glossary/typosquatting)). The same incidents are `crossenv` wrapping the real package and posting `process.env` ([Snyk](https://snyk.io/blog/typosquatting-attacks/)), `electorn` ([Sonatype](https://www.sonatype.com/blog/sonatype-spots-malicious-npm-packages)), one-edit names such as `raect` for `react` ([Phylum](https://blog.phylum.io/malicious-packages-typosquatting-and-other-attacks-against-open-source-dependencies/)), and scope, delimiter, and suffix confusion ([Neupane et al., USENIX Security 2023](https://www.usenix.org/system/files/usenixsecurity23-neupane.pdf)). This rule compares only against the bundled list, and only with the signals below.

| Signal | Example | Severity |
| --- | --- | --- |
| One edit (omit, add, substitute, or adjacent transposition) | `lodasg` / `lodash`, `loadsh` / `lodash`, `electorn` / `electron`, `mongose` / `mongoose` | high |
| Two edits, both names length ≥ 8 | `typscrpt` / `typescript` | medium |
| Separator `-` / `_` / `.` removed or swapped | `crossenv` / `cross-env` ([npm, 2017](https://blog.npmjs.org/post/163723642530/crossenv-malware-on-the-npm-registry)) | high |
| Scope one edit from a popular scope, same package name | `@typos/node` / `@types/node` | high |
| Dropped scope, joined with or without a separator | `ethersproject-wallet` / `@ethersproject/wallet` | high |
| `.js` suffix | `typescriptjs` / `typescript` | medium |
| Combosquat: the popular name plus one affix from `utils`, `util`, `js`, `node`, `npm`, `lib`, `api`, `official`, `helper`, `helpers`, `tool`, `tools`, `package`, `pkg`, `module`, `modules` | `lodash-utils` | medium |

`@types/lodash` is not flagged: the scope is not one edit from a popular scope of `lodash`, and DefinitelyTyped is not treated as a dropped scope. A bare name such as `wallet` is not flagged for `@ethersproject/wallet`. Distance 2 is not used for shorter names, because Scott Logic found that cutoff noisy on short strings.

The nearest popular name is the one with the smallest distance, then the more specific signal. The finding `detail` starts `Near miss of <name>` so the scorer can say `Swap <installed> for <name>`. Evidence is the `package.json` description (300 characters) and the entry file (`main`, else `index.js` / `index.mjs` / `index.cjs` / `index.ts`, 800 characters). A missing file does not drop the finding. `..` in `main` is not followed. Files over 512 KiB are skipped.

On the demo, `lodasg` is the only doppelganger hit. `preact` is the quiet near-name.

## Score and exorcism

Rule weights (`SEVERITY_WEIGHTS`):

| Severity | Points |
| -------- | ------ |
| critical | 45     |
| high     | 28     |
| medium   | 16     |
| low      | 8      |
| info     | 3      |

`ruleFloor` is that total capped at 100. With no judgment (`--no-oracle`, Ollama down, or a failed call), `hauntingScore` is the floor. That is the same number the scorer reported before Gemma supplied a score.

When Gemma returns a valid judgment, the haunting score is the higher of `ruleFloor` and the model's `score`. The model can raise the score. It cannot talk it down. A comment in the package that says the code is safe does not reduce the floor: the floor is computed from the findings, and the package text is only data in the prompt.

The oracle never removes a package from the report. A higher model score can cross `REMOVE_SCORE` and change the exorcism. A malicious verdict still can, too.

Exorcism, in order:

1. **remove** when the verdict is `malicious` with confidence ≥ `0.5` (`MALICIOUS_CONFIDENCE`), or the score is ≥ `75` (`REMOVE_SCORE`).
2. **remove** when any finding is from `phantom`. An unused dependency is attack surface, so the action is remove even when the score is still low or moderate. Its severity points still add into the score, which is why an install script on an unused package scores higher than the script alone. This wins over swap.
3. **swap** when any finding is from `doppelganger` and remove did not win. The reason names the popular package from the finding detail (`Near miss of lodash` → swap `lodasg` for `lodash`).
4. **pin** otherwise.

On today's weights, with `--no-oracle` or when Gemma does not return a judgment, the demo scores are:

- `soul-snatcher`: 45 + 16 + 16 + 16 = 93, remove (the score is already at least 75; phantom adds the last 16)
- `hexed-helper`: 28 + 16 + 16 = 60, remove (phantom; the score alone would pin)
- `lodasg`: 28, swap (one high doppelganger finding; the app imports it, so phantom stays quiet)

Those numbers are the floors. A live Gemma judgment can score a package higher. It cannot score one lower. Impersonation by itself does not raise the score and does not remove: `lodasg` stays at 28 and the exorcism stays swap, even when the model returns `verdict: malicious`, confidence 0.95, and score 90. The exorcism text does not call that malicious. A harmful rule on the same package, such as poltergeist, still allows a malicious verdict or a score of at least 75 to remove. `soul-snatcher` and `hexed-helper` stay `remove` because phantom already says remove, and `soul-snatcher`'s floor is already at least 75.

`lucky-charm` and `preact` have no findings.

## What Gemma does

`oracle.ts` talks to Ollama's local HTTP API.

1. `GET {endpoint}/api/tags` with a 2 second timeout (`PROBE_TIMEOUT_MS`). Connection refused, timeout, non-200, or a model list that does not contain the requested tag means the oracle is unavailable. The report says why and keeps the rule findings. Default model is `gemma3:4b` (`DEFAULT_MODEL`). Default endpoint is `http://localhost:11434` (`DEFAULT_ENDPOINT`), overridable with `--endpoint` / `OLLAMA_HOST` and `--model` / `OLLAMA_MODEL`.
2. If the tags payload has no `models` array, the client still tries the chat call.
3. For each haunted package, `POST {endpoint}/api/chat` with `stream: false`, `temperature: 0`, a system prompt, and one user message. The user message has the package name, the `package.json` description, and a README excerpt when one of `README.md`, `README.markdown`, `README.txt`, `README`, or `readme.md` sits in the package directory, plus the flagged code. Description is clipped to 500 characters (`DESCRIPTION_EXCERPT_CHARS`). The README excerpt is clipped to 1,500 characters (`README_EXCERPT_CHARS`). A README over 512 KiB is skipped. Name, description, README, and code are untrusted data: `<<<` inside them is escaped, and description, README, and code are wrapped in `<<<UNTRUSTED …>>>` markers. A harm-only package (no doppelganger finding) uses the system prompt that compares the code with the stated purpose. A color helper that reads environment variables or opens network connections is not benign. A doppelganger finding uses a different prompt and `LOOKALIKE_SCHEMA`. That prompt names the popular package and asks whether the untrusted description, README, or code claims that package's identity under the installed name. A harmless copy of the tagline or functions is still an impostor. Gemma is not given the real package's files. Ollama's structured-output guide asks for a JSON schema in `format` and, ideally, the same schema in the prompt ([Structured outputs](https://docs.ollama.com/capabilities/structured-outputs)). A 400 retries once with `"format": "json"`. Gemma 3 folds a system message into the first user turn ([prompt structure](https://ai.google.dev/gemma/docs/core/prompt-structure)), so the lookalike question and the JSON shape also sit in the user message next to the package text.
4. A harm-only request asks for JSON matching `JUDGMENT_SCHEMA` (`verdict`, `confidence`, `score`, `summary`, `explanation`, no extra properties). A lookalike request asks for `LOOKALIKE_SCHEMA`. `explanation` is required first and described as one sentence, with an example in the prompt. `impersonating` is a boolean. `score` is 0 to 100. A lookalike response without `impersonating` is rejected and the package stays on the rule floor. The report prints `impostor of <name> (0.90)` when `impersonating` is true. If `summary` or `explanation` is empty or only the target name, Exorcist substitutes `name claims to be <popular> under a different name.`
5. A transport error, or an HTTP status of 500 or higher, is retried once with the same body. That covers the Windows failure where the second back-to-back `gemma3:4b` call returned HTTP 500 `llama-server process has terminated`. If the retry fails, the error is stored on that package as `oracleNote` and the score stays the rule floor. Other packages are still judged.
6. Chat timeout is 90 seconds (`CONSULT_TIMEOUT_MS`) on each attempt.
7. Validation accepts a fenced block or prose around one JSON object, a case-insensitive verdict, a numeric-string confidence, and a confidence from 1 to 100 (divided by 100). `score` may be a number or a numeric string; it is rounded and clamped to 0–100. A missing score rejects the judgment. Empty summary or explanation is rejected. Summary and explanation are clipped to 2,000 characters.
8. Suspect code is joined per finding and clipped to 6,000 characters (`SUSPECT_CODE_CHAR_BUDGET`), with a note that it was truncated.

Gemma does not choose which packages are suspects. It does not see quiet packages. It does not run the code. Replacing it with a cloud API would break the reason this project is local; don't.

## Build and exit

`npm run build` compiles with `tsc` and then runs `scripts/mark-executable.js`, which calls `chmodSync` on `dist/cli.js`. The shell `chmod` command is not used, because it is missing on Windows.

The CLI sets `process.exitCode` from `main()` and does not call `process.exit()`. On Windows, `process.exit()` during a scan has crashed Node with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in `src/win/async.c` while fetch or stdout handles were still closing. Letting the event loop drain keeps the same exit codes: `0` when the scan finished, `1` when it could not run.

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

`npm test` does not start Ollama and does not pull a model. The closed-port probe test calls the real `probe()` against `127.0.0.1:1`. Judgment parsing, the chat request body, scoring, the resolver, poltergeist, phantom, and doppelganger have unit tests. `consult` is tested by stubbing `fetch`: the score comes from the model JSON, the rule floor holds when that score is lower, and an HTTP 500 is retried once. A doppelganger test stubs the oracle client and checks that the prompt names the popular package and that the explanation is in the report. `test/demo.test.ts` scans `demo/victim` and expects poltergeist and phantom on `soul-snatcher` and `hexed-helper`, doppelganger swap on `lodasg`, and no findings on `lucky-charm` or `preact`.
