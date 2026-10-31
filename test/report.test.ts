import { describe, expect, it } from "vitest";
import { renderJson, renderMarkdown, renderTerminal } from "../src/report.js";
import type { HauntingReport } from "../src/types.js";

const report: HauntingReport = {
  registryNote: null,
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
        score: 61,
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
    expect(markdown).toContain("Model score: 61");
    expect(markdown).toContain("It encodes a dummy token during install.");
    expect(markdown).toContain("node postinstall.js");
    expect(markdown).toContain("does not execute");
  });

  it("strips terminal controls and extra headings from package text", () => {
    const haunting = report.hauntings[0];
    const finding = haunting?.findings[0];
    const judgment = haunting?.judgment;
    if (!haunting || !finding || !judgment) throw new Error("fixture");
    const hostile: HauntingReport = {
      ...report,
      hauntings: [
        {
          ...haunting,
          name: "soul-snatcher\n## pwned\u001B[2J\u202E",
          version: "1.0.0",
          findings: [
            {
              ...finding,
              title: "runs a postinstall\u001B[2J",
              evidence: "node postinstall.js\u001B[2J\u202E",
            },
          ],
          judgment: {
            ...judgment,
            summary: "It encodes a token.\u001B[2J",
            explanation: "No socket.\u202E",
          },
        },
      ],
    };
    const markdown = renderMarkdown(hostile);
    const terminal = renderTerminal(hostile);
    expect(markdown).toContain("## soul-snatcher ## pwned@1.0.0");
    expect(markdown).not.toMatch(/^## pwned/m);
    expect(markdown).not.toContain("\u001B");
    expect(markdown).not.toContain("\u202E");
    expect(markdown).toContain("node postinstall.js");
    expect(terminal).not.toContain("\u001B[2J");
    expect(terminal).not.toContain("\u202E");
  });
});

describe("renderJson", () => {
  it("round-trips the report object a caller would consume", () => {
    const parsed = JSON.parse(renderJson(report)) as HauntingReport;

    expect(parsed.target).toBe(report.target);
    expect(parsed.packageCount).toBe(report.packageCount);
    expect(parsed.hauntings.map((h) => h.name)).toEqual(report.hauntings.map((h) => h.name));
    expect(parsed.quiet.map((q) => q.name)).toEqual(report.quiet.map((q) => q.name));
    expect(parsed.rules.map((r) => r.kind)).toEqual(report.rules.map((r) => r.kind));
    expect(parsed.registryNote).toBe(report.registryNote);
  });

  it("ends with a newline so it appends cleanly", () => {
    expect(renderJson(report).endsWith("}\n")).toBe(true);
  });

  it("strips ANSI, C0 controls, and bidi overrides from package text", () => {
    const haunting = report.hauntings[0];
    const finding = haunting?.findings[0];
    if (!haunting || !finding) throw new Error("fixture");
    const hostile: HauntingReport = {
      ...report,
      target: "/work/\u001B[31mred\u001B[0m",
      registryNote: "note\u202Ereversed",
      hauntings: [
        {
          ...haunting,
          name: "evil\u001B[2Kname",
          exorcismReason: "reason\u0007bell",
          findings: [{ ...finding, detail: "detail\u2066flip", evidence: "a\u0000b" }],
        },
      ],
    };

    const text = renderJson(hostile);
    expect(text).not.toContain("\u001B");
    expect(text).not.toContain("\u202E");
    expect(text).not.toContain("\u2066");

    const parsed = JSON.parse(text) as HauntingReport;
    expect(parsed.target).toBe("/work/red");
    expect(parsed.registryNote).toBe("notereversed");
    expect(parsed.hauntings[0]?.name).toBe("evilname");
    expect(parsed.hauntings[0]?.exorcismReason).toBe("reasonbell");
    expect(parsed.hauntings[0]?.findings[0]?.detail).toBe("detailflip");
    expect(parsed.hauntings[0]?.findings[0]?.evidence).toBe("ab");
  });

  it("keeps newlines in evidence, which the line-based reports flatten", () => {
    const haunting = report.hauntings[0];
    const finding = haunting?.findings[0];
    if (!haunting || !finding) throw new Error("fixture");
    const multiline: HauntingReport = {
      ...report,
      hauntings: [{ ...haunting, findings: [{ ...finding, evidence: "line one\nline two" }] }],
    };

    const parsed = JSON.parse(renderJson(multiline)) as HauntingReport;
    expect(parsed.hauntings[0]?.findings[0]?.evidence).toBe("line one\nline two");
  });
});
