# Exorcist

Exorcist scans an npm project's **installed** dependencies for malicious or risky packages. Cheap rules flag suspects. Only those suspects are shown to **Gemma**, running locally through **Ollama**, which reads the flagged code and returns a verdict: benign, suspicious, or malicious.

It is a Day 1 skeleton for the DEV Hacktoberfest Open-Source AI Challenge, "Ghost in the Machine" (deadline Sat Oct 31, 2026).

The code it reads may be private. The model runs on your machine, the scan works with the network unplugged, and nothing here calls a cloud LLM API.

## Quickstart

Node.js 20 or newer.

```bash
npm install
npm run build
npm install --prefix demo/victim
npx tsx src/cli.ts demo/victim
```

`npm install` inside `demo/victim` only links the local fixtures under `demo/packages/`. It does not download them from the registry. `soul-snatcher` has a postinstall script. The script prints one line and does not open a socket, write a file, or print a token. That line during install is expected.

You do not need Ollama for the command above. If it is not running, Exorcist says so and writes the report from the rules alone.

To let Gemma judge the flagged snippets:

```bash
# https://ollama.com
ollama pull gemma3:4b
npx tsx src/cli.ts demo/victim
```

A smaller model works too:

```bash
ollama pull gemma3:1b
npx tsx src/cli.ts demo/victim --model gemma3:1b
```

After `npm run build`, the same scan is `node dist/cli.js demo/victim`.

What you should see on `demo/victim`:

| Package         | Why it shows up today                                | Exorcism without Gemma |
| --------------- | ---------------------------------------------------- | ---------------------- |
| `soul-snatcher` | `postinstall` plus `process.env` and a base64 encode | remove (score 77)      |
| `hexed-helper`  | `eval` of a base64 blob, and a long base64 literal   | pin (score 44)         |
| `lodasg`        | imports `child_process` and never calls it           | pin (score 28)         |
| `lucky-charm`   | nothing                                              | quiet (score 0)        |

`lodasg` is a typosquat of `lodash` (the final `h` changed to `g`). The doppelganger rule is still a stub, so the name is **not** why it is flagged. See [docs/STATUS.md](docs/STATUS.md).

The command writes `haunting-report.md` in the current directory (gitignored) and prints the same findings in the terminal.

## Usage

```text
exorcist [path] [options]
```

`path` defaults to the current directory. Exorcist reads `package-lock.json` there (lockfileVersion 2 or 3). It does not execute dependency code. It does not read `pnpm-lock.yaml` or `yarn.lock`.

| Flag               | Meaning                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `--model <name>`   | Ollama model. Default `gemma3:4b`.                                            |
| `--endpoint <url>` | Ollama API. Default `http://localhost:11434`. A bare `host:port` is accepted. |
| `--no-oracle`      | Do not call Gemma. Rules still run.                                           |
| `--report <file>`  | Markdown report. Default `./haunting-report.md`.                              |
| `-h`, `--help`     | Help.                                                                         |

Environment overrides, used when the matching flag is absent:

| Variable       | Meaning                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `OLLAMA_MODEL` | Same as `--model`.                                                            |
| `OLLAMA_HOST`  | Same as `--endpoint`. Ollama's own variable. `127.0.0.1:11434` or a full URL. |

Exit code `0` means the scan finished, even if packages are haunted. Exit code `1` means the scan could not run (bad arguments, missing directory, unreadable or unsupported lockfile).

Inside this repository, run `npx tsx src/cli.ts` or `node dist/cli.js`. `package.json` has a `bin` entry named `exorcist`, so `npx exorcist` works **after this package is installed** (`npm install -g .` from a clone, or as a dependency of another project). Running `npx exorcist` here, before that, asks the npm registry for a different package named `exorcist`.

Point `--endpoint` at a machine you trust. The default is your local Ollama. A remote endpoint would send flagged source there.

## Demo fixtures

Everything under `demo/packages/` is a private fixture. None of it phones home.

- `soul-snatcher` — postinstall reads `EXORCIST_DEMO_TOKEN` (or the literal `not-a-real-secret`), base64-encodes it, and logs the length.
- `lodasg` — typosquat name, plus an unused `child_process` import so today's rule still flags it.
- `hexed-helper` — `mutter()` would `eval` a base64 string that decodes to `console.log("boo")`. Nothing calls `mutter()`. A second literal is a long harmless base64 blob.
- `lucky-charm` — returns `"horseshoe"`. The quiet control.
- `demo/victim/src/app.js` — imports only `lucky-charm`. That file is for the future phantom rule. Exorcist does not scan the victim's own source today.

If you skip `npm install` in `demo/victim`, the committed lockfile still points at the fixtures with `link: true`, and the resolver follows those paths. Install once if you want `node_modules` populated.

## How a scan runs

1. Read `package-lock.json` and list installed packages (name, version, path, `package.json`).
2. Run every rule. Only **poltergeist** flags anything today. The other three return no findings.
3. If Ollama is up and the model is pulled, send each haunted package's snippets to Gemma and validate the JSON verdict.
4. Score each haunted package from 0 to 100 and pick an exorcism: `pin`, `remove`, or `swap`.
5. Print the terminal report and write `haunting-report.md`.

Quiet packages stay out of the oracle. Details, types, and the score formula are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What is stubbed, and what to build next, is in [docs/STATUS.md](docs/STATUS.md).

## Scripts

| Script                       | What it does                                    |
| ---------------------------- | ----------------------------------------------- |
| `npm run build`              | Compile `src/` to `dist/` with `tsc`.           |
| `npm test`                   | Unit tests (`vitest`). They do not need Ollama. |
| `npm run dev -- demo/victim` | Same as `tsx src/cli.ts demo/victim`.           |
| `npm run lint`               | Biome, then `tsc --noEmit`.                     |
| `npm run format`             | Biome format, write.                            |

## License

MIT.
