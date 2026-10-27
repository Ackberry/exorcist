import { describe, expect, it } from "vitest";
import { normalizeEndpoint } from "../src/endpoint.js";
import { CliError, OracleError } from "../src/errors.js";
import {
  buildChatRequest,
  buildSuspectExcerpt,
  JUDGMENT_SCHEMA,
  parseJudgment,
  probe,
  SUSPECT_CODE_CHAR_BUDGET,
} from "../src/oracle.js";
import type { Finding, InstalledPackage } from "../src/types.js";

const pkg: InstalledPackage = {
  name: "soul-snatcher",
  version: "1.0.0",
  lockKey: "node_modules/soul-snatcher",
  path: "/tmp/soul-snatcher",
  manifest: null,
  direct: true,
  dev: false,
};

function finding(evidence: string): Finding {
  return {
    rule: "poltergeist",
    lockKey: pkg.lockKey,
    packageName: pkg.name,
    version: pkg.version,
    severity: "high",
    title: "uses eval or the Function constructor",
    detail: "The code calls eval.",
    evidence,
    evidencePath: "index.js",
  };
}

describe("oracle contract", () => {
  it("normalizes endpoints", () => {
    expect(normalizeEndpoint("http://localhost:11434/")).toBe("http://localhost:11434");
    expect(normalizeEndpoint("127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(normalizeEndpoint("https://example.test")).toBe("https://example.test");
    expect(() => normalizeEndpoint("   ")).toThrow(CliError);
  });

  it("asks Gemma for the judgment schema and includes the flagged code", () => {
    const request = buildChatRequest({
      target: { endpoint: "http://localhost:11434", model: "gemma3:1b" },
      pkg,
      findings: [finding('eval("1")')],
    });
    expect(request.model).toBe("gemma3:1b");
    expect(request.stream).toBe(false);
    expect(request.format).toEqual(JUDGMENT_SCHEMA);
    expect(request.options.temperature).toBe(0);
    const user = request.messages.find((message) => message.role === "user")?.content ?? "";
    expect(user).toContain("soul-snatcher@1.0.0");
    expect(user).toContain('eval("1")');
    expect(user).toContain("poltergeist/high");
  });

  it("truncates suspect code to the context budget", () => {
    const excerpt = buildSuspectExcerpt([finding("a".repeat(SUSPECT_CODE_CHAR_BUDGET + 500))]);
    expect(excerpt.length).toBeLessThan(SUSPECT_CODE_CHAR_BUDGET + 80);
    expect(excerpt).toContain("truncated");
  });

  it("validates a judgment and accepts fences, prose, and a 0-100 confidence", () => {
    expect(
      parseJudgment(
        '{"verdict":"Malicious","confidence":0.8,"summary":"Runs a hook.","explanation":"Install script."}',
      ),
    ).toEqual({
      verdict: "malicious",
      confidence: 0.8,
      summary: "Runs a hook.",
      explanation: "Install script.",
    });
    expect(
      parseJudgment(
        '```json\n{"verdict":"benign","confidence":"0.2","summary":"Prints.","explanation":"No side effects."}\n```',
      ),
    ).toMatchObject({ verdict: "benign", confidence: 0.2 });
    expect(
      parseJudgment(
        'Sure.\n{"verdict":"suspicious","confidence":80,"summary":"Obfuscated.","explanation":"eval."}',
      ),
    ).toMatchObject({ verdict: "suspicious", confidence: 0.8 });
  });

  it("fails open when nothing is listening on the endpoint", async () => {
    const result = await probe({ endpoint: "http://127.0.0.1:1", model: "gemma3:4b" });
    expect(result.available).toBe(false);
    expect(result.message).toMatch(/Report built from rules only/);
  });

  it("rejects a verdict that is not in the schema", () => {
    expect(() =>
      parseJudgment('{"verdict":"evil","confidence":1,"summary":"x","explanation":"y"}'),
    ).toThrow(OracleError);
    expect(() => parseJudgment("not json")).toThrow(OracleError);
    expect(() =>
      parseJudgment('{"verdict":"benign","confidence":1,"summary":"","explanation":"y"}'),
    ).toThrow(/schema/);
  });
});
