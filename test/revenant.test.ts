import { describe, expect, it } from "vitest";
import type { Packument, RegistryClient } from "../src/registry.js";
import { prefetchPackuments, RegistryUnreachable } from "../src/registry.js";
import { readPriorVersion, revenantRule } from "../src/rules/revenant.js";
import { judgePackage } from "../src/scorer.js";
import type { Finding, InstalledPackage, ScanContext } from "../src/types.js";
import { fixturePackage } from "./helpers.js";

function packument(
  releases: readonly { version: string; at: string; maintainers: string[] }[],
): Packument {
  const time: Record<string, string> = { created: releases[0]?.at ?? "2019-01-01T00:00:00.000Z" };
  const versions: Record<string, { maintainers: { name: string }[] }> = {};
  for (const release of releases) {
    time[release.version] = release.at;
    versions[release.version] = { maintainers: release.maintainers.map((name) => ({ name })) };
  }
  return { name: "left-pad", time, versions };
}

function contextFor(packument: Packument | null): ScanContext {
  return {
    rootDir: "/work",
    packages: [],
    registry: new Map([["left-pad", packument]]),
  };
}

const installed: InstalledPackage = fixturePackage({
  name: "left-pad",
  lockKey: "node_modules/left-pad",
  version: "1.4.0",
});

describe("revenant", () => {
  it("is active", () => {
    expect(revenantRule.status).toBe("active");
  });

  it("flags a release that lands after a long silence", () => {
    const doc = packument([
      { version: "1.3.0", at: "2019-04-02T00:00:00.000Z", maintainers: ["foo"] },
      { version: "1.4.0", at: "2022-10-11T00:00:00.000Z", maintainers: ["foo"] },
    ]);
    const findings = revenantRule.scan(installed, contextFor(doc)) as Finding[];
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain("woke up after");
    expect(findings[0]?.severity).toBe("medium");
    expect(findings[0]?.evidencePath).toBeNull();
    expect(findings[0]?.evidence).toContain("1.3.0");
    expect(readPriorVersion(findings[0]?.detail ?? "")).toBe("1.3.0");
  });

  it("flags a maintainer the previous release did not have", () => {
    const doc = packument([
      { version: "1.3.0", at: "2022-09-01T00:00:00.000Z", maintainers: ["foo"] },
      { version: "1.4.0", at: "2022-10-11T00:00:00.000Z", maintainers: ["foo", "bar"] },
    ]);
    const findings = revenantRule.scan(installed, contextFor(doc)) as Finding[];
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe("new maintainer on the installed version");
    expect(findings[0]?.detail).toContain("bar");
  });

  it("stays quiet on a steadily released package", () => {
    const doc = packument([
      { version: "1.3.0", at: "2022-09-01T00:00:00.000Z", maintainers: ["foo"] },
      { version: "1.4.0", at: "2022-10-11T00:00:00.000Z", maintainers: ["foo"] },
    ]);
    expect(revenantRule.scan(installed, contextFor(doc))).toEqual([]);
  });

  it("returns nothing without a registry, so an offline scan is unchanged", () => {
    const doc = packument([
      { version: "1.3.0", at: "2019-04-02T00:00:00.000Z", maintainers: ["foo"] },
      { version: "1.4.0", at: "2022-10-11T00:00:00.000Z", maintainers: ["foo"] },
    ]);
    expect(revenantRule.scan(installed, { rootDir: "/work", packages: [] })).toEqual([]);
    expect(revenantRule.scan(installed, contextFor(null))).toEqual([]);
    void doc;
  });

  it("strips terminal escapes out of a maintainer name", () => {
    const doc = packument([
      { version: "1.3.0", at: "2022-09-01T00:00:00.000Z", maintainers: ["foo"] },
      { version: "1.4.0", at: "2022-10-11T00:00:00.000Z", maintainers: ["foo", "[31mbar"] },
    ]);
    const findings = revenantRule.scan(installed, contextFor(doc)) as Finding[];
    expect(findings[0]?.detail).not.toContain("");
    expect(findings[0]?.evidence).not.toContain("");
  });

  it("pins the release before the break rather than the installed one", () => {
    const doc = packument([
      { version: "1.3.0", at: "2019-04-02T00:00:00.000Z", maintainers: ["foo"] },
      { version: "1.4.0", at: "2022-10-11T00:00:00.000Z", maintainers: ["foo"] },
    ]);
    const findings = revenantRule.scan(installed, contextFor(doc)) as Finding[];
    const haunting = judgePackage(installed, findings, null, null);
    expect(haunting.exorcism).toBe("pin");
    expect(haunting.exorcismReason).toContain("left-pad@1.3.0");
    expect(haunting.exorcismReason).not.toContain("read the flagged code");
  });
});

describe("prefetch", () => {
  it("asks for nothing when every package is a file: link", async () => {
    const asked: string[] = [];
    const client: RegistryClient = {
      packument: async (name) => {
        asked.push(name);
        return null;
      },
    };
    const result = await prefetchPackuments(
      [
        { name: "lodasg", linked: true },
        { name: "soul-snatcher", linked: true },
      ],
      client,
    );
    expect(asked).toEqual([]);
    expect(result.note).toBeNull();
    expect(result.packuments.size).toBe(0);
  });

  it("gives up early and notes it when the registry is unreachable", async () => {
    let calls = 0;
    const client: RegistryClient = {
      packument: async () => {
        calls++;
        throw new RegistryUnreachable("getaddrinfo ENOTFOUND registry.npmjs.org");
      },
    };
    const names = Array.from({ length: 40 }, (_, i) => ({ name: `pkg-${i}`, linked: false }));
    const result = await prefetchPackuments(names, client);
    // Workers already in flight when the third strike lands still finish, so the
    // exact count is not fixed. What matters is that it stops well short of 40.
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThan(names.length / 2);
    expect(result.note).toContain("could not be reached");
  });

  it("asks once for a name that appears under several lock keys", async () => {
    const asked: string[] = [];
    const client: RegistryClient = {
      packument: async (name) => {
        asked.push(name);
        return { name };
      },
    };
    const result = await prefetchPackuments(
      [
        { name: "left-pad", linked: false },
        { name: "left-pad", linked: false },
      ],
      client,
    );
    expect(asked).toEqual(["left-pad"]);
    expect(result.note).toBeNull();
    expect(result.packuments.get("left-pad")).toEqual({ name: "left-pad" });
  });
});
