import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChatRequest, consult, parseJudgment } from "../src/oracle.js";
import type { Finding, InstalledPackage } from "../src/types.js";

/**
 * Recorded Ollama responses, not live calls. Each test names the claim its
 * fixture supports, so a fixture that stops matching the code fails here
 * instead of going stale in a doc.
 */

interface Exchange {
  request: Record<string, unknown>;
  response: { status: number; body: Record<string, unknown> };
}

interface Transcript {
  ollamaVersion: string;
  model: string;
}

/** One request and what came back. */
interface SingleTranscript extends Transcript, Exchange {}

/** A rejection and the retry that recovered it. */
interface RetryTranscript extends Transcript {
  rejected: Exchange;
  retry: Exchange;
}

/** A full judgment: the request the client built and what the model answered. */
interface JudgmentTranscript extends Transcript, Exchange {
  source: { scanRoot: string; package: string; rulesFired: string[] };
}

function replay(exchange: Exchange): Response {
  return new Response(JSON.stringify(exchange.response.body), {
    status: exchange.response.status,
    headers: { "content-type": "application/json" },
  });
}

function transcript<T extends Transcript>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as T;
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
  const recorded = transcript<SingleTranscript>("ollama-0.40.11-tools-400.json");

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

describe("a rejected schema is sent again as plain json", () => {
  const recorded = transcript<RetryTranscript>("ollama-0.40.11-schema-400.json");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recorded a 400 that names the schema conversion failure", () => {
    expect(recorded.rejected.response.status).toBe(400);
    expect(String(recorded.rejected.response.body.error)).toContain(
      "JSON schema conversion failed",
    );
    expect(recorded.rejected.request.format).toBeTypeOf("object");
    expect(recorded.retry.request.format).toBe("json");
  });

  it("recovers the judgment by replaying the recorded bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(replay(recorded.rejected))
      .mockResolvedValueOnce(replay(recorded.retry));
    vi.stubGlobal("fetch", fetchMock);

    const judgment = await consult({
      target: { endpoint: "http://127.0.0.1:9", model: recorded.model },
      pkg,
      findings: [finding],
    });

    expect(judgment.verdict).toBe("benign");
    expect(judgment.score).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { format?: unknown };
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { format?: unknown };
    expect(first.format).toBeTypeOf("object");
    expect(second.format).toBe("json");
  });
});

describe("a real judgment over demo/victim suspect code", () => {
  const recorded = transcript<JudgmentTranscript>("ollama-0.40.11-judgment-200.json");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(): string {
    const message = recorded.response.body.message as { content?: string } | undefined;
    return message?.content ?? "";
  }

  it("scored on the 0 to 100 scale, not 0 to 1", () => {
    const judgment = parseJudgment(answer());

    // asScore rounds, so a 0-to-1 answer would silently collapse to 0 or 1.
    expect(judgment.score).toBe(65);
    expect(Number.isInteger(judgment.score)).toBe(true);
    expect(judgment.score).toBeGreaterThan(1);
  });

  it("did not take the untrusted text's word that the package is harmless", () => {
    const user = recorded.request.messages as { role: string; content: string }[];
    const prompt = user.find((message) => message.role === "user")?.content ?? "";

    expect(prompt).toContain("<<<UNTRUSTED DESCRIPTION>>>");
    expect(prompt).toContain("Harmless postinstall");

    const judgment = parseJudgment(answer());
    expect(judgment.verdict).toBe("suspicious");
  });

  it("replays through consult as a judgment the scorer can use", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(replay(recorded));
    vi.stubGlobal("fetch", fetchMock);

    const judgment = await consult({
      target: { endpoint: "http://127.0.0.1:9", model: recorded.model },
      pkg,
      findings: [finding],
    });

    expect(judgment.verdict).toBe("suspicious");
    expect(judgment.score).toBe(65);
    expect(judgment.confidence).toBeCloseTo(0.75);
    expect(judgment.summary).not.toBe("");
  });
});
