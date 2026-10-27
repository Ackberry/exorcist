# Status

Day 1 skeleton. Updated 2026-10-27. If you change behavior, update this file in the same commit so it still describes the code.

## Done

- Node 20+, TypeScript strict, ESM (`Node16`), `tsx`, `vitest`, Biome, and a `bin` entry of `exorcist` → `dist/cli.js`. Runtime dependency is `chalk` only.
- Resolver for `package-lock.json` lockfileVersion 2 and 3, including npm's `file:` link shape and a fallback when `node_modules` is not installed.
- Poltergeist rule: install hooks plus child process, network, `process.env`, SSH path, `.npmrc`, eval / `new Function`, and base64 signals.
- Shared `Rule` interface. Doppelganger, revenant, and phantom are registered and return `[]`. Their `status` is `"stub"`.
- Ollama client (`src/oracle.ts`) for local Gemma. Default model `gemma3:4b`, flag `--model` (for example `gemma3:1b`). Default endpoint `http://localhost:11434`. Structured JSON is requested and validated. If Ollama is down, the model is missing, or one call fails, the report is still written from the rules and the message says why.
- Scorer (0–100) and exorcism (`pin`, `remove`, `swap`). Terminal report and `haunting-report.md`.
- `demo/victim` with three possessed fixtures and one quiet control, installed from `file:` paths. `npm test` covers the resolver, poltergeist, the oracle's parser and request, the scorer, the stub return values, the pipeline with a fake client, and the demo.

## Stubbed

| Rule         | File                        | What it does today                                                                                                                                                                    |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| doppelganger | `src/rules/doppelganger.ts` | Returns `[]`. `POPULAR_PACKAGES` is the list to compare against. `lodasg` is the fixture (one substitution from `lodash`, h to g) but it is flagged only because it imports `child_process`. |
| revenant     | `src/rules/revenant.ts`     | Returns `[]`. No registry request is made.                                                                                                                                            |
| phantom      | `src/rules/phantom.ts`      | Returns `[]`. `demo/victim/src/app.js` imports only `lucky-charm` and is not read by the scanner.                                                                                     |

`test/demo.test.ts` asserts that every finding on the demo is from poltergeist. Update that test when a stub starts flagging fixtures.

## Not built

- pnpm and yarn lockfiles. LockfileVersion 1 is rejected.
- Workspace packages, except where they already show up under `node_modules/` in the lockfile.
- Scanning the root project's own source. Poltergeist only walks installed packages.
- A non-zero exit code when the score is high. A finished scan exits 0. A GitHub Action will need a threshold flag.
- `exorcist check <pkg>` for one package directory or tarball, without a lockfile.
- Live Gemma in CI. The suite never pulls a model. Day 1 was checked with Ollama not installed: a closed-port `probe` and a full `demo/victim` scan both produce the rules-only report. A real `gemma3:4b` judgment is not recorded in this repo.
- Retry of a schema `400` is implemented; there is no recorded fixture of a real Ollama 400 body.

## Limits worth knowing

- Poltergeist is a regex. Minified code is not decoded. It is clipped and, when the oracle is up, handed to Gemma.
- One signal id fires once per package (the first file in sorted order).
- Files over 512 KiB are skipped. At most 40 source files are read, down to depth 6. Nested `node_modules` inside a package are not walked.
- Oracle calls are sequential. Suspect code sent to the model is capped at 6,000 characters.
- `--endpoint` can be pointed off the machine. The default is local. Do not send private source to a host you do not trust.
- The scanner does not execute package code. `npm install` in `demo/victim` does run `soul-snatcher`'s postinstall, because npm does that. The script only prints a length.

## Next

Wednesday — the other three rules, in this order:

1. **Doppelganger.** Damerau-Levenshtein distance against `POPULAR_PACKAGES`. Skip exact matches and names shorter than 4 characters. Threshold 2. Put the nearest popular name in `detail` so the existing scorer emits `swap`. `demo/packages/lodasg` should then be a swap, not only a pin for `child_process`. Set `status` to `"active"` and update `test/demo.test.ts`.
2. **Phantom.** From the target project (not from dependency source), collect `require()` and `import` specifiers, plus package names that appear in the root `package.json` scripts. Flag a direct dependency that never appears. `demo/victim/src/app.js` imports `lucky-charm` only, so the other three fixtures are the cases. Do not flag `lucky-charm`. A bin-only package named in a script should not be flagged. Update the demo test.
3. **Revenant.** Optional `GET https://registry.npmjs.org/<name>`. Use the `time` map and maintainers. Flag a long gap then a new release, or a maintainer change on the installed version. On any network failure, return `[]` for that package and let the scan continue. The default path must stay usable offline. Do not call the registry from unit tests; inject a fetch or a fixture. The demo packages are not on the registry; they should not become hard failures.

Thursday — oracle, report, and a single-package command:

1. Tighten the prompt against minified and obfuscated code. Keep a fixture of bad model JSON (already rejected by `parseJudgment`) and, if you can, a real `gemma3:4b` transcript checked into `test/fixtures/` so the prompt can be compared without a live call every time.
2. If a local Ollama rejects `JUDGMENT_SCHEMA` with 400, confirm the one retry with `"format": "json"` is enough. Document the Ollama version you tried.
3. Richer report: group by ghost, and consider `--json` for the same `HauntingReport` object. Do not drop the Markdown file.
4. `exorcist check <pkg>` to judge one package directory (or a name in the local tree) without a lockfile. Reuse poltergeist and the oracle. Do not invent a second scanner.

Stretch — GitHub Action:

- A workflow that runs Exorcist on the repo (or on `demo/victim`) and fails above a score threshold. That needs an explicit flag such as `--fail-on <score>`, because exit code 0 is correct for a human scan today. Document that the action cannot assume Gemma is installed on the runner; rules-only mode has to be the default in CI.

## Design notes the code already committed to

- Suspects are chosen by rules. Gemma does not see the rest of the tree.
- `Rule.status` is how the report tells a stub from a quiet rule.
- File-link packages are one row, not two.
- Swap is implemented in the scorer and waiting on doppelganger findings.
- Tests construct temp lockfiles and temp packages. The demo is the end-to-end fixture. Do not commit `node_modules` or `haunting-report.md`.
