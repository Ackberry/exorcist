# Agents

Exorcist is a small TypeScript CLI. Read these before editing, and treat them as the source of truth for what already runs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — pipeline, modules, data types, scoring, and the oracle
- [docs/STATUS.md](docs/STATUS.md) — what is done, what is stubbed, what to build next
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — style, tests, commits, and how to add a rule
- [docs/submission-checklist.md](docs/submission-checklist.md) — Week 4 submission checklist
- [README.md](README.md) — how to run the demo

## Required with every change

Update `docs/STATUS.md` so it still matches the code. Update `README.md`, `docs/ARCHITECTURE.md`, and `docs/CONVENTIONS.md` when the change affects behavior, usage, architecture, or the conventions they describe.

Do not describe a plan as a working feature. A rule returns no findings while its `status` is `"stub"`. Revenant is a stub. Poltergeist, doppelganger, and phantom are active.

## The model

Gemma running locally through Ollama judges suspect code and sets the risk score (default model `gemma3:4b`). A Mastra workflow (`src/workflow.ts`) runs resolve, rules, the judge, and the score. The judge is a Mastra agent with structured output and no tools (`src/judge.ts`): `gemma3:4b` through Ollama does not support tool calls. Rules decide who is a suspect. The rule total is a floor: Gemma can raise the score and cannot lower it. Do not replace Gemma with a cloud API. The scan must still write a report when Ollama is not running. With `--no-oracle`, the score is the rule total only.

Exorcist reads package source. It does not execute it.
