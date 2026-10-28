import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { haunt } from "../src/haunt.js";
import type { OracleClient, OracleProbeResult } from "../src/oracle.js";
import { tempDir, writeJson, writeText } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function project(): string {
  const created = tempDir();
  cleanups.push(created.cleanup);
  const root = created.dir;
  writeJson(join(root, "package-lock.json"), {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { hooked: "1.0.0", calm: "1.0.0" } },
      "node_modules/hooked": { version: "1.0.0" },
      "node_modules/calm": { version: "1.0.0" },
    },
  });
  writeJson(join(root, "node_modules/hooked/package.json"), {
    name: "hooked",
    version: "1.0.0",
    scripts: { postinstall: "node post.js" },
  });
  writeText(
    join(root, "node_modules/hooked/post.js"),
    "console.log(process.env.EXORCIST_DEMO_TOKEN);\n",
  );
  writeJson(join(root, "node_modules/calm/package.json"), { name: "calm", version: "1.0.0" });
  writeText(join(root, "node_modules/calm/index.js"), "module.exports = 1;\n");
  writeText(join(root, "src/app.js"), 'const calm = require("calm");\nconsole.log(calm);\n');
  return root;
}

describe("haunt", () => {
  it("builds a rules-only report when the oracle is silent", async () => {
    const client: OracleClient = {
      async probe(): Promise<OracleProbeResult> {
        return {
          available: false,
          model: "gemma3:4b",
          endpoint: "http://localhost:11434",
          message: "Ollama is not running at http://localhost:11434. Report built from rules only.",
        };
      },
      async consult() {
        throw new Error("consult should not be called");
      },
    };

    const report = await haunt(project(), {
      model: "gemma3:4b",
      endpoint: "http://localhost:11434",
      consultOracle: true,
      oracleClient: client,
    });

    expect(report.oracle.available).toBe(false);
    expect(report.oracle.message).toMatch(/rules only/);
    expect(report.packageCount).toBe(2);
    expect(report.hauntings.map((row) => row.name)).toEqual(["hooked"]);
    expect(report.hauntings[0]?.judgment).toBeNull();
    expect(report.hauntings[0]?.hauntingScore).toBeGreaterThan(0);
    expect(report.quiet.map((row) => row.name)).toEqual(["calm"]);
    expect(report.rules.find((rule) => rule.kind === "poltergeist")?.status).toBe("active");
    expect(report.rules.find((rule) => rule.kind === "doppelganger")?.findings).toBe(0);
  });

  it("asks the oracle only about haunted packages", async () => {
    const consulted: string[] = [];
    const client: OracleClient = {
      async probe(): Promise<OracleProbeResult> {
        return {
          available: true,
          model: "gemma3:4b",
          endpoint: "http://localhost:11434",
          message: "Oracle is listening.",
        };
      },
      async consult(input) {
        consulted.push(input.pkg.name);
        return {
          verdict: "malicious",
          confidence: 0.9,
          score: 90,
          summary: "It prints an env var from an install script.",
          explanation: "postinstall plus process.env.",
        };
      },
    };

    const report = await haunt(project(), {
      model: "gemma3:4b",
      endpoint: "http://localhost:11434",
      consultOracle: true,
      oracleClient: client,
    });

    expect(consulted).toEqual(["hooked"]);
    expect(report.hauntings[0]?.judgment?.verdict).toBe("malicious");
    expect(report.hauntings[0]?.exorcism).toBe("remove");
  });

  it("does not call the oracle when consultOracle is false", async () => {
    const client: OracleClient = {
      async probe() {
        throw new Error("probe should not be called");
      },
      async consult() {
        throw new Error("consult should not be called");
      },
    };
    const report = await haunt(project(), {
      model: "gemma3:4b",
      endpoint: "http://localhost:11434",
      consultOracle: false,
      oracleClient: client,
    });
    expect(report.oracle.requested).toBe(false);
    expect(report.oracle.message).toMatch(/--no-oracle/);
  });
});
