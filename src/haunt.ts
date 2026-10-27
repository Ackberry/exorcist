import { resolve } from "node:path";
import { errorMessage } from "./errors.js";
import { type OracleClient, ollamaClient } from "./oracle.js";
import { resolveInstalled } from "./resolver.js";
import { groupFindings, runRules, summarizeRules } from "./scanner.js";
import { judgePackage } from "./scorer.js";
import type { HauntingReport, OracleJudgment, PackageHaunting, QuietPackage } from "./types.js";

export interface HauntOptions {
  model: string;
  endpoint: string;
  /** When false, rules still run and the oracle is not contacted. */
  consultOracle: boolean;
  /** Test seam. Defaults to the local Ollama client. */
  oracleClient?: OracleClient;
}

/**
 * Resolve the lockfile, run every rule, and ask Gemma about haunted packages only.
 * A silent oracle still produces a report from the rules.
 */
export async function haunt(targetPath: string, options: HauntOptions): Promise<HauntingReport> {
  const rootDir = resolve(targetPath);
  const packages = resolveInstalled(rootDir);
  const findings = await runRules(packages, rootDir);
  const grouped = groupFindings(findings);
  const client = options.oracleClient ?? ollamaClient;

  const probed = options.consultOracle
    ? await client.probe({ endpoint: options.endpoint, model: options.model })
    : {
        available: false,
        model: options.model,
        endpoint: options.endpoint,
        message: "Oracle skipped (--no-oracle). Report built from rules only.",
      };

  const hauntings: PackageHaunting[] = [];
  const quiet: QuietPackage[] = [];

  for (const pkg of packages) {
    const mine = grouped.get(pkg.lockKey) ?? [];
    if (mine.length === 0) {
      quiet.push({ name: pkg.name, version: pkg.version, direct: pkg.direct, dev: pkg.dev });
      continue;
    }

    let judgment: OracleJudgment | null = null;
    let oracleNote: string | null = null;
    if (probed.available) {
      try {
        judgment = await client.consult({
          target: { endpoint: options.endpoint, model: options.model },
          pkg,
          findings: mine,
        });
      } catch (error) {
        oracleNote = errorMessage(error);
      }
    }

    hauntings.push(judgePackage(pkg, mine, judgment, oracleNote));
  }

  hauntings.sort((a, b) => b.hauntingScore - a.hauntingScore || a.name.localeCompare(b.name));

  return {
    target: rootDir,
    scannedAt: new Date().toISOString(),
    packageCount: packages.length,
    rules: summarizeRules(findings),
    hauntings,
    quiet,
    oracle: { requested: options.consultOracle, ...probed },
  };
}
