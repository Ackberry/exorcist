# Conventions

Exorcist is a small strict TypeScript program. Deep is learning the language and other agents will edit it. Prefer a short, obvious function over a framework.

## Language and layout

- Node.js 20 or newer. Do not use APIs added after Node 20.
- ESM only. `"type": "module"`. In `src/` and `test/`, relative imports use the `.js` extension even though the source is `.ts` (`moduleResolution: Node16`).
- `verbatimModuleSyntax` is on. Use `import type` (or an inline `type` import) for types.
- `strict` and `noUncheckedIndexedAccess` are on. Handle a missing index instead of assuming it.
- `tsc` emits `src/` to `dist/` via `tsconfig.build.json`. Tests are typechecked by the root `tsconfig.json` and are not emitted.
- The bin is `src/cli.ts`. Keep the shebang on line 1.
- Runtime dependency is `chalk`. Add another one only when the standard library cannot do the job in a readable way. Do not add a cloud LLM SDK.

## Style

Biome formats and lints (`biome.json`).

- 2-space indent, width 100, double quotes, semicolons.
- `npm run format` writes. `npm run lint` is Biome plus `tsc --noEmit`.
- Name functions for what they return or do (`resolveInstalled`, `hauntingScore`).
- Comments explain a lockfile quirk, a limit, or a stub. Do not comment the syntax.
- TODOs for the planned rules use `TODO(Wed)` or `TODO(Thu)` so they can be searched. A stub's `status` stays `"stub"` until it returns real findings.
- Do not execute code from a package under scan. Tests that mention `eval` or `fetch` put those strings in a temp file and scan the text.

## How to add or finish a rule

The four kinds already exist on `GhostKind`. You should not need a new kind for the Wednesday work.

1. Implement `scan` in `src/rules/<kind>.ts`. It is already listed in `src/rules/index.ts`.
2. Return `Finding[]`. Use the package's `lockKey`, `name`, and `version` on every finding. Put a short snippet in `evidence` and a path relative to the package (forward slashes) in `evidencePath`.
3. Set `status` to `"active"` when it can flag a real package. Until then leave it `"stub"` and return `[]`.
4. Catch network and IO problems inside the rule and return `[]` (or findings collected so far) so one bad package does not abort the scan. `revenant` must do this when the registry is unreachable.
5. Add a unit test that builds a temp package or a temp lockfile with `test/helpers.ts`. Do not commit `node_modules`.
6. If the demo should trip the rule, change the fixture and update `test/demo.test.ts`. That test names which rules flag which demo fixtures. `lucky-charm` is the package `demo/victim/src/app.js` imports. The other three fixtures are unused, so phantom flags them.
7. Update `docs/STATUS.md` and `docs/ARCHITECTURE.md` so they describe the new behavior, including any new threshold.

`ScanContext.packages` is the full install list when a rule needs to compare names. Poltergeist does not use it.

## Scoring

Weights and thresholds live in `src/scorer.ts` (`SEVERITY_WEIGHTS`, `REMOVE_SCORE`, `MALICIOUS_CONFIDENCE`, `ORACLE_NUDGE`). Change them there and in `docs/ARCHITECTURE.md` together. The scorer turns a `doppelganger` finding into `swap` unless remove wins. A `phantom` finding is `remove` even under `REMOVE_SCORE`, and it wins over `swap`. Do not special-case either in the CLI.

## Oracle

- The model that judges suspects is local Gemma through Ollama. Default `gemma3:4b`. Do not route this through a hosted chat API.
- Parse model output with `parseJudgment`. Do not trust the string without that check.
- Keep truncation in `buildSuspectExcerpt`. Raising `SUSPECT_CODE_CHAR_BUDGET` is a product change; note it in `docs/ARCHITECTURE.md`.
- Tests pass a fake `OracleClient` into `haunt`. Do not call the real network from a unit test except the existing closed-port `probe` test.

## Testing

```bash
npm test
```

`vitest` runs `test/**/*.test.ts`. A new behavior needs a test that fails if the behavior is removed. Prefer a temp directory over a snapshot of chalk output. Markdown is asserted with `toContain` on stable phrases, not the whole file.

The demo scan, with or without Ollama:

```bash
npx tsx src/cli.ts demo/victim --no-oracle
```

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), imperative subject, one concern:

```text
feat: flag postinstall scripts in poltergeist
fix: follow file: links when node_modules is missing
docs: correct the demo scores in STATUS
test: cover lockfileVersion 2
refactor: share the oracle request builder
chore: bump the typescript range
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

Every change updates `docs/STATUS.md` when the done / stubbed / next list would otherwise lie. Update `README.md`, `docs/ARCHITECTURE.md`, or this file when the change affects usage, the pipeline, the types, or these conventions.

## Docs

Write what the code does. A stub is a stub. Planned work goes under Next in `docs/STATUS.md`, not in the README's quickstart as if it already runs.
