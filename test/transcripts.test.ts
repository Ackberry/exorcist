import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OracleError } from "../src/errors.js";
import { buildChatRequest, consult, LOOKALIKE_SCHEMA, parseJudgment } from "../src/oracle.js";
import { hauntingScore, judgePackage, ruleFloor } from "../src/scorer.js";
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

/** A lookalike judgment also names the popular package the suspect imitates. */
interface LookalikeTranscript extends JudgmentTranscript {
  source: JudgmentTranscript["source"] & { resembles: string };
}

/** An answer the client cannot use, and the message parseJudgment raises for it. */
interface Rejection extends Exchange {
  why: string;
  provoked: string;
  rejectedWith: string;
}

/** Two rejected answers, one per parseJudgment error message. */
interface BadJsonTranscript extends Transcript {
  emptyObject: Rejection;
  truncated: Rejection;
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

describe("a real lookalike judgment over demo/victim's lodasg", () => {
  const recorded = transcript<LookalikeTranscript>("ollama-0.40.11-lookalike-200.json");

  const lodasg: InstalledPackage = {
    name: "lodasg",
    version: "1.0.0",
    lockKey: "node_modules/lodasg",
    path: null,
    manifest: null,
    direct: true,
    dev: false,
    linked: true,
  };

  const nearMiss: Finding = {
    rule: "doppelganger",
    lockKey: lodasg.lockKey,
    packageName: lodasg.name,
    version: lodasg.version,
    severity: "high",
    title: "name imitates lodash",
    detail: "Near miss of lodash (one substitution). Swap lodasg for lodash.",
    evidence: "description: The Lodash library delivering modularity, performance, and extras.",
    evidencePath: "index.js",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(): string {
    const message = recorded.response.body.message as { content?: string } | undefined;
    return message?.content ?? "";
  }

  it("sent the lookalike schema because the only finding is a doppelganger", () => {
    const request = buildChatRequest({
      target: { endpoint: "http://127.0.0.1:9", model: recorded.model },
      pkg: lodasg,
      findings: [nearMiss],
    });

    expect(request.format).toEqual(LOOKALIKE_SCHEMA);
    expect(recorded.request.format).toEqual(LOOKALIKE_SCHEMA);
    expect(recorded.source.resembles).toBe("lodash");
  });

  it("answered impersonating as a real boolean", () => {
    const judgment = parseJudgment(answer(), true);

    expect(judgment.impersonating).toBe(true);
    expect(judgment.verdict).toBe("suspicious");
    expect(judgment.confidence).toBeCloseTo(0.99);
  });

  it("returned a score above the ceiling the prompt asks for", () => {
    const system = recorded.request.messages as { role: string; content: string }[];
    const instruction = system.find((message) => message.role === "system")?.content ?? "";

    // The prompt says 40 or below. gemma3:4b answered 42. Nothing in the
    // oracle enforces the ceiling, so the scorer has to be the one that holds.
    expect(instruction).toContain("score stays at 40 or below");
    expect(parseJudgment(answer(), true).score).toBe(42);
  });

  it("stays on the rule floor, so the overshoot never reaches the report", () => {
    const judgment = parseJudgment(answer(), true);
    const floor = ruleFloor([nearMiss]);

    expect(judgment.score).toBeGreaterThan(floor);
    expect(hauntingScore([nearMiss], judgment)).toBe(floor);
  });

  it("replays through consult with the imitated name attached", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(replay(recorded));
    vi.stubGlobal("fetch", fetchMock);

    const judgment = await consult({
      target: { endpoint: "http://127.0.0.1:9", model: recorded.model },
      pkg: lodasg,
      findings: [nearMiss],
    });

    expect(judgment.impersonating).toBe(true);
    expect(judgment.impersonationOf).toBe("lodash");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("model JSON that parseJudgment rejects", () => {
  const recorded = transcript<BadJsonTranscript>("ollama-0.40.11-bad-json.json");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function content(exchange: Exchange): string {
    const message = exchange.response.body.message as { content?: string } | undefined;
    return message?.content ?? "";
  }

  it("both rejections arrived as HTTP 200", () => {
    // A judgment the client cannot use is not an HTTP failure. Nothing in the
    // status code says the answer is unusable.
    expect(recorded.emptyObject.response.status).toBe(200);
    expect(recorded.truncated.response.status).toBe(200);
  });

  it("rejects an empty object, because it carries no verdict", () => {
    const answer = content(recorded.emptyObject);

    expect(JSON.parse(answer)).toEqual({});
    expect(() => parseJudgment(answer)).toThrow(OracleError);
    expect(() => parseJudgment(answer)).toThrow(recorded.emptyObject.rejectedWith);
  });

  it("rejects an answer the token cap cut in half", () => {
    const answer = content(recorded.truncated);

    expect(recorded.truncated.response.body.done_reason).toBe("length");
    expect(answer).not.toContain("}");
    expect(() => parseJudgment(answer)).toThrow(OracleError);
    expect(() => parseJudgment(answer)).toThrow(recorded.truncated.rejectedWith);
  });

  it("rejects the truncated answer under the lookalike schema too", () => {
    // The shape check runs after the parse, so a lookalike call fails the
    // same way rather than reporting a missing impersonating field.
    expect(() => parseJudgment(content(recorded.truncated), true)).toThrow(
      "Oracle returned text that was not JSON.",
    );
  });

  it("leaves the package on its rule floor, with the reason in oracleNote", () => {
    // What the workflow does with the throw: no judgment, the message kept,
    // and the score still the rule total.
    let note: string | null = null;
    try {
      parseJudgment(content(recorded.emptyObject));
    } catch (error) {
      note = (error as Error).message;
    }

    const haunting = judgePackage(pkg, [finding], null, note);

    expect(haunting.judgment).toBeNull();
    expect(haunting.hauntingScore).toBe(ruleFloor([finding]));
    expect(haunting.oracleNote).toBe(recorded.emptyObject.rejectedWith);
  });

  it("surfaces through consult as an OracleError, not a silent benign verdict", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(replay(recorded.truncated));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      consult({
        target: { endpoint: "http://127.0.0.1:9", model: recorded.model },
        pkg,
        findings: [finding],
      }),
    ).rejects.toThrow(OracleError);
  });
});
