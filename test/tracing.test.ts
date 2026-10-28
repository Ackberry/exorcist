import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { haunt } from "../src/haunt.js";
import { hauntWorkflow } from "../src/workflow.js";
import { tempDir, writeJson } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("sentry tracing", () => {
  it("is a no-op when SENTRY_DSN is unset", async () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push(
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      );
      return original(input, init);
    }) as typeof fetch;
    const created = tempDir();
    cleanups.push(created.cleanup);
    cleanups.push(() => {
      globalThis.fetch = original;
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    });

    writeJson(join(created.dir, "package-lock.json"), {
      lockfileVersion: 3,
      packages: { "": {} },
    });
    const report = await haunt(created.dir, {
      model: "gemma3:4b",
      endpoint: "http://127.0.0.1:1",
      consultOracle: false,
    });

    expect(report.packageCount).toBe(0);
    expect(report.oracle.available).toBe(false);
    expect(report.oracle.message).toMatch(/--no-oracle/);
    expect(hauntWorkflow.mastra).toBeUndefined();
    expect(seen.some((url) => url.toLowerCase().includes("sentry"))).toBe(false);
  });
});
