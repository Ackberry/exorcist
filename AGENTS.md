# Agents

Exorcist is a small TypeScript CLI. Read these before editing, and treat them as the source of truth for what already runs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — pipeline, modules, data types, scoring, and the oracle
- [docs/STATUS.md](docs/STATUS.md) — what is done, what is stubbed, what to build next
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — style, tests, commits, and how to add a rule
- [README.md](README.md) — how to run the demo

## Required with every change

Update `docs/STATUS.md` so it still matches the code. Update `README.md`, `docs/ARCHITECTURE.md`, and `docs/CONVENTIONS.md` when the change affects behavior, usage, architecture, or the conventions they describe.

Do not describe a plan as a working feature. Doppelganger, revenant, and phantom return no findings until their `status` is `"active"`.

## The model

Gemma running locally through Ollama is what judges suspect code (`src/oracle.ts`, default model `gemma3:4b`). Rules decide who is a suspect. Do not replace that with a cloud API. The scan must still write a report when Ollama is not running.

Exorcist reads package source. It does not execute it.
