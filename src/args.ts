import { normalizeEndpoint } from "./endpoint.js";
import { CliError } from "./errors.js";
import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from "./oracle.js";

export interface CliOptions {
  help: boolean;
  targetPath: string;
  model: string;
  endpoint: string;
  consultOracle: boolean;
  reportPath: string;
}

export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  let targetPath = ".";
  let model = env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  let endpoint = normalizeEndpoint(env.OLLAMA_HOST?.trim() || DEFAULT_ENDPOINT);
  let consultOracle = true;
  let reportPath = "haunting-report.md";
  let help = false;
  let sawTarget = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--no-oracle") {
      consultOracle = false;
      continue;
    }
    if (arg === "--model" || arg === "--endpoint" || arg === "--report") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliError(`Missing value for ${arg}.`);
      }
      index += 1;
      if (arg === "--model") model = value;
      if (arg === "--endpoint") endpoint = normalizeEndpoint(value);
      if (arg === "--report") reportPath = value;
      continue;
    }
    if (arg.startsWith("--model=")) {
      model = inlineValue(arg);
      continue;
    }
    if (arg.startsWith("--endpoint=")) {
      endpoint = normalizeEndpoint(inlineValue(arg));
      continue;
    }
    if (arg.startsWith("--report=")) {
      reportPath = inlineValue(arg);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliError(`Unknown flag: ${arg}`);
    }
    if (sawTarget) throw new CliError(`Unexpected argument: ${arg}`);
    sawTarget = true;
    targetPath = arg;
  }

  if (model.trim() === "") throw new CliError("Model name is empty.");
  return { help, targetPath, model, endpoint, consultOracle, reportPath };
}

export function helpText(): string {
  return `Exorcist — scan installed npm packages for poltergeists and other ghosts.

Usage:
  exorcist [path] [options]

The path defaults to the current directory. Exorcist reads package-lock.json
(lockfileVersion 2 or 3) there. It does not execute the packages it scans.

Options:
  --model <name>       Ollama model (default: ${DEFAULT_MODEL}, or $OLLAMA_MODEL)
  --endpoint <url>     Ollama API (default: ${DEFAULT_ENDPOINT}, or $OLLAMA_HOST)
  --no-oracle          Do not call Gemma. Rules still run.
  --report <file>      Markdown report path (default: ./haunting-report.md)
  -h, --help           Show this help.

Examples:
  npx tsx src/cli.ts demo/victim
  npx tsx src/cli.ts demo/victim --model gemma3:1b
  node dist/cli.js demo/victim --no-oracle
`;
}

function inlineValue(arg: string): string {
  const equals = arg.indexOf("=");
  const value = arg.slice(equals + 1);
  if (value === "") throw new CliError(`Missing value for ${arg.slice(0, equals)}.`);
  return value;
}
