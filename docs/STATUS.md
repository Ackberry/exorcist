# Status

Updated 2026-10-28. The Day 1 skeleton is in place, phantom and doppelganger are active, and Gemma sets the haunting score above a rule floor. If you change behavior, update this file in the same commit so it still describes the code.

## Done

- Node 22.13+ (required by `@mastra/core`), TypeScript strict, ESM (`Node16`), `tsx`, `vitest`, Biome, and a `bin` entry of `exorcist` → `dist/cli.js`. Runtime dependencies are `chalk`, `@mastra/core`, `zod`, `ollama-ai-provider-v2`, `@mastra/observability`, and `@mastra/sentry`. There is no Mastra server, playground, or storage package. Sentry tracing is off unless `SENTRY_DSN` is set (`src/tracing.ts`). Default traces are metadata only (step names, model, latency, tokens, verdict). `SENTRY_TRACE_CONTENT=1` adds prompts and model text. The exporter is flushed before the CLI sets `process.exitCode`.
- Resolver for `package-lock.json` lockfileVersion 2 and 3, including npm's `file:` link shape and a fallback when `node_modules` is not installed.
- Poltergeist rule: install hooks plus child process, network, `process.env`, SSH path, `.npmrc`, eval / `new Function`, and base64 signals.
- Shared `Rule` interface. Revenant is registered and returns `[]`. Its `status` is `"stub"`.
- Phantom rule (`src/rules/phantom.ts`, `status` `"active"`). A direct dependency the project never imports, requires, or names from a root `package.json` script (including a `bin` the script runs). Production and optional dependencies are `medium`. DevDependencies are `low`. The finding's exorcism is `remove`, and its points stack with other rules.
- Doppelganger rule (`src/rules/doppelganger.ts`, `status` `"active"`). Compares each installed name to the static list in `src/rules/popular-packages.ts`. Exact popular names and names shorter than 4 characters are not flagged. Signals are one edit (including a transposition), two edits when both names are at least 8 characters, a separator swap, a one-edit scope (`@typos` / `@types`), a dropped scope, a `.js` suffix, and a short combosquat affix. The finding names the popular package. The scorer says swap for that package unless remove wins. A doppelganger suspect is sent to Gemma with `LOOKALIKE_SCHEMA`. Gemma must set `impersonating` from the untrusted description, README, and code. The report shows `impostor of <name>` when that is true. Impersonation alone stays on the rule floor and the exorcism stays swap, even if Gemma returns malicious with a high score and a reason that is only the target name. That name-only reason is replaced with a sentence. A harmful rule on the same package can still remove.
- Ollama client for local Gemma, orchestrated by the Mastra workflow `haunt` (`src/workflow.ts`: resolve, rules, prepare, judge, score). The judge is a Mastra agent with structured output and no tools (`src/judge.ts`). Ollama 0.40.11 returns HTTP 400 `registry.ollama.ai/library/gemma3:4b does not support tools` when `gemma3:4b` is given a tools array, so the agent does not call tools. The schema is still Ollama's `format` field on `/api/chat`. Default model `gemma3:4b`, flag `--model` (for example `gemma3:1b`). Default endpoint `http://localhost:11434`. The prompt sends rule findings, flagged code, package name, `package.json` description, and a README excerpt when a README is in the package directory. That text is untrusted data. Structured JSON is requested and validated, including a `score` from 0 to 100. A transport error or HTTP 5xx on `/api/chat` is retried once (the Windows `llama-server process has terminated` 500). If Ollama is down, the model is missing, or the retry still fails, the report is still written from the rules and the message says why.
- Scorer (0–100) and exorcism (`pin`, `remove`, `swap`). With no judgment, the score is `ruleFloor` (the severity total, capped at 100). Gemma's score is used only when it is higher than that floor. `--no-oracle` stays on the floor. A phantom finding is `remove` even when the score is under 75, unless a malicious verdict or the score threshold already removed it. That beats `swap`. Terminal report and `haunting-report.md`.
- `npm run build` marks `dist/cli.js` executable with Node's `chmodSync` (`scripts/mark-executable.js`), so the build does not call the shell `chmod` command. The CLI sets `process.exitCode` and does not call `process.exit()`. Exit codes are unchanged: 0 when the scan finished, 1 when it could not run.
- `demo/victim` with three possessed fixtures and two quiet controls, installed from `file:` paths. `src/app.js` imports `lucky-charm`, `lodasg`, and `preact`. `npm test` covers the resolver, poltergeist, phantom, doppelganger (including a mocked Ollama swap), the oracle's parser, request, model score, and one Ollama retry, the scorer's rule floor, the revenant stub, the pipeline with a fake client, the demo, and that Sentry tracing does nothing when `SENTRY_DSN` is unset.
- GitHub Actions CI (`.github/workflows/ci.yml`) on every push to `main` and every pull request. One job per cell of ubuntu-latest and windows-latest times Node 22.13 and 24: `npm ci`, `npm run lint`, `npm test`, `npm run build`, then `node dist/cli.js demo/victim --no-oracle`. Windows is in the matrix because `scripts/mark-executable.js` replaces the shell `chmod`. The runner has no Ollama and no `SENTRY_DSN`, so CI exercises the rules-only path.

## Stubbed

| Rule     | File                    | What it does today                          |
| -------- | ----------------------- | ------------------------------------------- |
| revenant | `src/rules/revenant.ts` | Returns `[]`. No registry request is made. |

`test/demo.test.ts` expects poltergeist and phantom on `soul-snatcher` and `hexed-helper`, doppelganger on `lodasg`, and no findings on `lucky-charm` or `preact`. Update that test when revenant starts flagging fixtures.

## Not built

- pnpm and yarn lockfiles. LockfileVersion 1 is rejected.
- Workspace packages, except where they already show up under `node_modules/` in the lockfile. Phantom does walk source files under the scan root, so a workspace package's imports count when you scan the repository root. It only reads scripts from the root `package.json`.
- Poltergeist still does not read the target project's own source. Only installed packages.
- A non-zero exit code when the score is high. A finished scan exits 0. A GitHub Action will need a threshold flag.
- `exorcist check <pkg>` for one package directory or tarball, without a lockfile.
- Live Gemma in CI. CI runs the suite and a rules-only scan; it never installs Ollama or pulls a model. Day 1 was checked with Ollama not installed: a closed-port `probe` and a full `demo/victim` scan both produce the rules-only report. A local Ollama 0.40.11 check confirmed `gemma3:4b` rejects tools and accepts the JSON schema `format`. A real `gemma3:4b` transcript is not recorded in this repo.
- Retry of a schema `400` is implemented; there is no recorded fixture of a real Ollama 400 body. A 5xx or dropped chat connection retries once; the unit test mocks the 500 body and does not record a live Ollama transcript.

## Limits worth knowing

- Poltergeist is a regex. Minified code is not decoded. It is clipped and, when the oracle is up, handed to Gemma.
- One signal id fires once per package (the first file in sorted order).
- Poltergeist files over 512 KiB are skipped. At most 40 source files are read, down to depth 6. Nested `node_modules` inside a package are not walked.
- Phantom is a lexer, not a parser. Comments and ordinary strings are not uses. A regex literal that contains `//` or `/*` can hide a later import. `require(variable)` and `import(variable)` are not resolved. `obj.require("pkg")` is ignored. The `from` keyword is only searched for about 800 characters. `.vue`, `.svelte`, JSON, and YAML (other than root `package.json` scripts) are not read. Path aliases are treated as package names.
- Phantom skips `node_modules`, `dist`, `coverage`, `build`, and any dot-directory. Dotfiles such as `.eslintrc.js` are read. At most 300 files, 512 KiB each, depth 8. A file past the cap can hide a real import, and the dependency is then flagged. Symlinked source files are not followed.
- A dev tool named only in a config file Phantom does not read is flagged at `low` and the exorcism is still `remove`. A package on disk is required to read `bin`; if the directory is missing, a script that invokes only the bin name can look unused. Shell words such as `node` and `npm` are not treated as bins.
- Transitive dependencies are not phantom candidates. Optional dependencies are direct and use the production severity (`medium`) unless they are dev-only.
- Oracle calls are sequential. Suspect code sent to the model is capped at 6,000 characters. The description excerpt is 500 characters. The README excerpt is 1,500 characters, and a README over 512 KiB is skipped.
- Doppelganger does not flag an exact popular name or a name shorter than 4 characters. Two edits require both names to be at least 8 characters. Combosquat uses a fixed affix list (`utils`, `js`, `node`, and the rest named in `docs/ARCHITECTURE.md`), so `express-session` is not a hit. `@types/lodash` is not a hit. The entry-file excerpt is 800 characters. A `main` path that leaves the package directory is not read. A live `gemma3:4b` run is not recorded here; the lookalike schema is covered with a mocked Ollama response.
- Gemma cannot score a package below `ruleFloor`. A judgment that fails validation, including one with no `score`, leaves that package on the floor.
- `--endpoint` can be pointed off the machine. The default is local. Do not send private source to a host you do not trust.
- The scanner does not execute package code. `npm install` in `demo/victim` does run `soul-snatcher`'s postinstall, because npm does that. The script only prints a length.

## Next

Wednesday — the rule still stubbed:

1. **Revenant.** Optional `GET https://registry.npmjs.org/<name>`. Use the `time` map and maintainers. Flag a long gap then a new release, or a maintainer change on the installed version. On any network failure, return `[]` for that package and let the scan continue. The default path must stay usable offline. Do not call the registry from unit tests; inject a fetch or a fixture. The demo packages are not on the registry; they should not become hard failures.

Thursday — oracle, report, and a single-package command:

1. Tighten the prompt against minified and obfuscated code. The score, the stated purpose, and the untrusted-data fence are already in the prompt. Keep a fixture of bad model JSON (already rejected by `parseJudgment`) and, if you can, a real `gemma3:4b` transcript checked into `test/fixtures/` so the prompt can be compared without a live call every time.
2. If a local Ollama rejects `JUDGMENT_SCHEMA` with 400, confirm the one retry with `"format": "json"` is enough. Document the Ollama version you tried.
3. Richer report: group by ghost, and consider `--json` for the same `HauntingReport` object. Do not drop the Markdown file.
4. `exorcist check <pkg>` to judge one package directory (or a name in the local tree) without a lockfile. Reuse poltergeist and the oracle. Do not invent a second scanner.

Stretch — GitHub Action:

- A workflow that runs Exorcist on the repo (or on `demo/victim`) and fails above a score threshold. That needs an explicit flag such as `--fail-on <score>`, because exit code 0 is correct for a human scan today. Document that the action cannot assume Gemma is installed on the runner; rules-only mode has to be the default in CI.

## Design notes the code already committed to

- Suspects are chosen by rules. Gemma does not see the rest of the tree.
- `Rule.status` is how the report tells a stub from a quiet rule.
- File-link packages are one row, not two.
- Swap is the doppelganger exorcism unless remove wins. A phantom finding is `remove` and wins over `swap`. The swap names the popular package from `Near miss of <name>` in the finding detail.
- Tests construct temp lockfiles and temp packages. The demo is the end-to-end fixture. Do not commit `node_modules` or `haunting-report.md`.
