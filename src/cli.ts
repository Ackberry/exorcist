#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { type CliOptions, helpText, parseArgs } from "./args.js";
import { errorMessage } from "./errors.js";
import { haunt } from "./haunt.js";
import { printTerminal, renderMarkdown } from "./report.js";

export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(errorMessage(error));
    return 1;
  }

  if (options.help) {
    console.log(helpText());
    return 0;
  }

  if (!nodeSupportsMastra()) {
    console.error("Exorcist needs Node.js 22.13 or newer.");
    return 1;
  }

  try {
    const report = await haunt(options.targetPath, {
      model: options.model,
      endpoint: options.endpoint,
      consultOracle: options.consultOracle,
    });
    printTerminal(report);
    const reportFile = resolve(options.reportPath);
    mkdirSync(dirname(reportFile), { recursive: true });
    writeFileSync(reportFile, renderMarkdown(report), "utf8");
    console.log("");
    console.log(chalk.dim(`wrote ${reportFile}`));
    return 0;
  } catch (error) {
    console.error(chalk.red(errorMessage(error)));
    return 1;
  }
}

/** @mastra/core declares engines.node >=22.13.0. */
function nodeSupportsMastra(): boolean {
  const parts = process.versions.node.split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 22) return true;
  return major === 22 && minor >= 13;
}

function isEntrypoint(): boolean {
  if (process.env.VITEST) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  const file = fileURLToPath(import.meta.url);
  try {
    if (realpathSync(entry) === realpathSync(file)) return true;
  } catch {
    // argv[1] can be a path that does not exist yet.
  }
  return resolve(entry) === file;
}

if (isEntrypoint()) {
  // Set the code and let the event loop drain. process.exit() on Windows can
  // trip a libuv assertion while fetch or stdout handles are still closing
  // (UV_HANDLE_CLOSING in src/win/async.c). Exit codes stay 0 and 1.
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    });
}
