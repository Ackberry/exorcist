import { type OracleClient, ollamaClient } from "./oracle.js";
import type { HauntingReport } from "./types.js";
import { runHauntWorkflow } from "./workflow.js";

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
  return runHauntWorkflow(
    {
      targetPath,
      model: options.model,
      endpoint: options.endpoint,
      consultOracle: options.consultOracle,
    },
    options.oracleClient ?? ollamaClient,
  );
}
