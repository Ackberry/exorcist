import { resolve } from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { errorMessage } from "./errors.js";
import { type OracleClient, ollamaClient } from "./oracle.js";
import { resolveInstalled } from "./resolver.js";
import { groupFindings, runRules, summarizeRules } from "./scanner.js";
import { judgePackage } from "./scorer.js";
import type {
  Finding,
  HauntingReport,
  InstalledPackage,
  OracleJudgment,
  QuietPackage,
} from "./types.js";

const ORACLE_CLIENT = "exorcist.oracleClient";

const inputSchema = z.object({
  targetPath: z.string(),
  model: z.string(),
  endpoint: z.string(),
  consultOracle: z.boolean(),
});

const resolvedSchema = inputSchema.extend({
  rootDir: z.string(),
  packages: z.array(z.custom<InstalledPackage>()),
});

const ruledSchema = resolvedSchema.extend({
  findings: z.array(z.custom<Finding>()),
});

const preparedSchema = ruledSchema.extend({
  haunted: z.array(
    z.object({
      pkg: z.custom<InstalledPackage>(),
      findings: z.array(z.custom<Finding>()),
    }),
  ),
  quiet: z.array(z.custom<QuietPackage>()),
  oracleAvailable: z.boolean(),
  oracleMessage: z.string(),
});

const judgedSchema = preparedSchema.extend({
  judged: z.array(
    z.object({
      pkg: z.custom<InstalledPackage>(),
      findings: z.array(z.custom<Finding>()),
      judgment: z.custom<OracleJudgment>().nullable(),
      oracleNote: z.string().nullable(),
    }),
  ),
});

const reportSchema = z.custom<HauntingReport>();

const resolveStep = createStep({
  id: "resolve",
  description: "Read package-lock.json into installed packages.",
  inputSchema,
  outputSchema: resolvedSchema,
  retries: 0,
  execute: async ({ inputData }) => {
    const rootDir = resolve(inputData.targetPath);
    return {
      ...inputData,
      rootDir,
      packages: resolveInstalled(rootDir),
    };
  },
});

const rulesStep = createStep({
  id: "rules",
  description: "Run every ghost rule. Rules choose who is a suspect.",
  inputSchema: resolvedSchema,
  outputSchema: ruledSchema,
  retries: 0,
  execute: async ({ inputData }) => {
    const packages = inputData.packages as InstalledPackage[];
    const findings = await runRules(packages, inputData.rootDir);
    return { ...inputData, packages, findings };
  },
});

const prepareStep = createStep({
  id: "prepare",
  description: "Probe Ollama, unless --no-oracle, and drop quiet packages.",
  inputSchema: ruledSchema,
  outputSchema: preparedSchema,
  retries: 0,
  execute: async ({ inputData, requestContext }) => {
    const packages = inputData.packages as InstalledPackage[];
    const findings = inputData.findings as Finding[];
    const client = readClient(requestContext);
    const probed = inputData.consultOracle
      ? await client.probe({ endpoint: inputData.endpoint, model: inputData.model })
      : {
          available: false,
          model: inputData.model,
          endpoint: inputData.endpoint,
          message: "Oracle skipped (--no-oracle). Report built from rules only.",
        };
    const grouped = groupFindings(findings);
    const haunted: { pkg: InstalledPackage; findings: Finding[] }[] = [];
    const quiet: QuietPackage[] = [];
    for (const pkg of packages) {
      const mine = grouped.get(pkg.lockKey) ?? [];
      if (mine.length === 0) {
        quiet.push({ name: pkg.name, version: pkg.version, direct: pkg.direct, dev: pkg.dev });
        continue;
      }
      haunted.push({ pkg, findings: mine });
    }
    return {
      ...inputData,
      packages,
      findings,
      haunted,
      quiet,
      oracleAvailable: probed.available,
      oracleMessage: probed.message,
    };
  },
});

const judgeStep = createStep({
  id: "judge",
  description:
    "Gemma judge. Structured output, no tools: gemma3:4b through Ollama does not support tools.",
  inputSchema: preparedSchema,
  outputSchema: judgedSchema,
  retries: 0,
  execute: async ({ inputData, requestContext }) => {
    const client = readClient(requestContext);
    const haunted = inputData.haunted as { pkg: InstalledPackage; findings: Finding[] }[];
    const judged: {
      pkg: InstalledPackage;
      findings: Finding[];
      judgment: OracleJudgment | null;
      oracleNote: string | null;
    }[] = [];
    for (const row of haunted) {
      if (!inputData.oracleAvailable) {
        judged.push({ ...row, judgment: null, oracleNote: null });
        continue;
      }
      try {
        const judgment = await client.consult({
          target: { endpoint: inputData.endpoint, model: inputData.model },
          pkg: row.pkg,
          findings: row.findings,
        });
        judged.push({ ...row, judgment, oracleNote: null });
      } catch (error) {
        judged.push({ ...row, judgment: null, oracleNote: errorMessage(error) });
      }
    }
    return { ...inputData, judged };
  },
});

const scoreStep = createStep({
  id: "score",
  description: "Apply the rule floor. Gemma can raise a score and cannot lower it.",
  inputSchema: judgedSchema,
  outputSchema: reportSchema,
  retries: 0,
  execute: async ({ inputData }) => {
    const packages = inputData.packages as InstalledPackage[];
    const findings = inputData.findings as Finding[];
    const judged = inputData.judged as {
      pkg: InstalledPackage;
      findings: Finding[];
      judgment: OracleJudgment | null;
      oracleNote: string | null;
    }[];
    const hauntings = judged.map((row) =>
      judgePackage(row.pkg, row.findings, row.judgment, row.oracleNote),
    );
    hauntings.sort((a, b) => b.hauntingScore - a.hauntingScore || a.name.localeCompare(b.name));
    return {
      target: inputData.rootDir,
      scannedAt: new Date().toISOString(),
      packageCount: packages.length,
      rules: summarizeRules(findings),
      hauntings,
      quiet: inputData.quiet as QuietPackage[],
      oracle: {
        requested: inputData.consultOracle,
        available: inputData.oracleAvailable,
        model: inputData.model,
        endpoint: inputData.endpoint,
        message: inputData.oracleMessage,
      },
    } satisfies HauntingReport;
  },
});

export const hauntWorkflow = createWorkflow({
  id: "haunt",
  description: "Resolve, run rules, judge haunted packages with Gemma, then score.",
  inputSchema,
  outputSchema: reportSchema,
  options: {
    validateInputs: false,
    shouldPersistSnapshot: () => false,
  },
})
  .then(resolveStep)
  .then(rulesStep)
  .then(prepareStep)
  .then(judgeStep)
  .then(scoreStep)
  .commit();

export async function runHauntWorkflow(
  input: z.infer<typeof inputSchema>,
  client: OracleClient,
): Promise<HauntingReport> {
  const requestContext = new RequestContext();
  requestContext.set(ORACLE_CLIENT, client);
  const run = await hauntWorkflow.createRun();
  const result = await run.start({ inputData: input, requestContext });
  if (result.status === "success") return result.result as HauntingReport;
  if (result.status === "failed") throw new Error(result.error.message);
  throw new Error(`Haunt workflow ended with status ${result.status}.`);
}

function readClient(requestContext: RequestContext): OracleClient {
  const client = requestContext.get(ORACLE_CLIENT);
  if (isOracleClient(client)) return client;
  return ollamaClient;
}

function isOracleClient(value: unknown): value is OracleClient {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { probe?: unknown; consult?: unknown };
  return typeof record.probe === "function" && typeof record.consult === "function";
}
