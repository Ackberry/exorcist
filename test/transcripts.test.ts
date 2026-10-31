import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildChatRequest } from "../src/oracle.js";
import type { Finding, InstalledPackage } from "../src/types.js";

/**
 * Recorded Ollama responses, not live calls. Each test names the claim its
 * fixture supports, so a fixture that stops matching the code fails here
 * instead of going stale in a doc.
 */

interface Transcript {
  ollamaVersion: string;
  model: string;
  request: Record<string, unknown>;
  response: { status: number; body: { error?: string } };
}

function transcript(name: string): Transcript {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as Transcript;
}

const pkg: InstalledPackage = {
  name: "soul-snatcher",
  version: "1.0.0",
  lockKey: "node_modules/soul-snatcher",
  path: null,
  manifest: null,
  direct: true,
  dev: false,
  linked: false,
};

const finding: Finding = {
  rule: "poltergeist",
  lockKey: pkg.lockKey,
  packageName: pkg.name,
  version: pkg.version,
  severity: "high",
  title: "uses eval or the Function constructor",
  detail: "The code calls eval.",
  evidence: "eval(atob(payload))",
  evidencePath: "index.js",
};

describe("gemma3:4b rejects tools", () => {
  const recorded = transcript("ollama-0.40.11-tools-400.json");

  it("recorded a 400 naming the model that refused", () => {
    expect(recorded.ollamaVersion).toBe("0.40.11");
    expect(recorded.response.status).toBe(400);
    expect(recorded.response.body.error).toBe(
      "registry.ollama.ai/library/gemma3:4b does not support tools",
    );
    expect(recorded.request).toHaveProperty("tools");
  });

  it("so the request the judge builds carries no tools", () => {
    const request = buildChatRequest({
      target: { endpoint: "http://127.0.0.1:9", model: recorded.model },
      pkg,
      findings: [finding],
    });

    expect(request).not.toHaveProperty("tools");
    expect(request.format).toBeTypeOf("object");
  });
});
