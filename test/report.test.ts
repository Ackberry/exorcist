import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/report.js";
import type { HauntingReport } from "../src/types.js";

const report: HauntingReport = {
  target: "/work/demo/victim",
  scannedAt: "2026-10-27T00:00:00.000Z",
  packageCount: 2,
  rules: [
    {
      kind: "poltergeist",
      description: "Install scripts and risky APIs.",
      status: "active",
      findings: 1,
    },
    {
      kind: "doppelganger",
      description: "Typosquat.",
      status: "stub",
      findings: 0,
    },
    {
      kind: "revenant",
      description: "Abandoned package.",
      status: "stub",
      findings: 0,
    },
    {
      kind: "phantom",
      description: "Never imported.",
      status: "stub",
      findings: 0,
    },
  ],
  hauntings: [
    {
      name: "soul-snatcher",
      version: "1.0.0",
      path: "/work/demo/packages/soul-snatcher",
      direct: true,
      dev: false,
      findings: [
        {
          rule: "poltergeist",
          lockKey: "node_modules/soul-snatcher",
          packageName: "soul-snatcher",
          version: "1.0.0",
          severity: "critical",
          title: "runs a postinstall script",
          detail: "npm runs this postinstall command when the package is installed.",
          evidence: "node postinstall.js",
          evidencePath: "package.json",
        },
      ],
      judgment: {
        verdict: "suspicious",
        confidence: 0.72,
        summary: "It encodes a dummy token during install.",
        explanation: "The script does not open a socket.",
      },
      oracleNote: null,
      hauntingScore: 61,
      exorcism: "pin",
      exorcismReason: "Haunting score 61/100. Pin it.",
    },
  ],
  quiet: [{ name: "lucky-charm", version: "1.0.0", direct: true, dev: false }],
  oracle: {
    requested: true,
    available: true,
    model: "gemma3:4b",
    endpoint: "http://localhost:11434",
    message: "Oracle is listening (gemma3:4b at http://localhost:11434).",
  },
};

describe("renderMarkdown", () => {
  it("includes the score, the exorcism, the stub rules, and the oracle verdict", () => {
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("# Exorcist haunting report");
    expect(markdown).toContain("## soul-snatcher@1.0.0");
    expect(markdown).toContain("| 61 | pin |");
    expect(markdown).toContain("`lucky-charm@1.0.0`");
    expect(markdown).toContain("| 0 | — |");
    expect(markdown).toContain("| doppelganger | stub | 0 |");
    expect(markdown).toContain("**suspicious**");
    expect(markdown).toContain("It encodes a dummy token during install.");
    expect(markdown).toContain("node postinstall.js");
    expect(markdown).toContain("does not execute");
  });
});
