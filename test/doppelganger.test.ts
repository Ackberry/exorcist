import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { haunt } from "../src/haunt.js";
import type { OracleClient, OracleProbeResult } from "../src/oracle.js";
import { buildChatRequest } from "../src/oracle.js";
import { renderMarkdown } from "../src/report.js";
import {
  damerauLevenshtein,
  doppelgangerRule,
  matchPopularName,
  POPULAR_PACKAGES,
  readNearMiss,
} from "../src/rules/doppelganger.js";
import type { InstalledPackage } from "../src/types.js";
import { fixturePackage, tempDir, writeJson, writeText } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("popular package list", () => {
  it("is a static snapshot of a few hundred names", () => {
    expect(POPULAR_PACKAGES.length).toBeGreaterThanOrEqual(250);
    expect(POPULAR_PACKAGES.length).toBeLessThanOrEqual(500);
    expect(new Set(POPULAR_PACKAGES).size).toBe(POPULAR_PACKAGES.length);
    for (const name of [
      "lodash",
      "cross-env",
      "electron",
      "mongoose",
      "preact",
      "lodash-es",
      "react",
      "react-dom",
      "@types/node",
      "@ethersproject/wallet",
      "express-session",
      "babel-core",
    ]) {
      expect(POPULAR_PACKAGES).toContain(name);
    }
  });
});

describe("matchPopularName", () => {
  it("measures an adjacent transposition as one edit", () => {
    expect(damerauLevenshtein("lodash", "loadsh")).toBe(1);
    expect(damerauLevenshtein("electron", "electorn")).toBe(1);
    expect(damerauLevenshtein("lodash", "lodasg")).toBe(1);
  });

  it("flags classic typos and does not flag exact or short names", () => {
    expect(matchPopularName("lodasg")).toMatchObject({
      target: "lodash",
      signal: "one substitution",
      severity: "high",
    });
    expect(matchPopularName("loadsh")).toMatchObject({
      target: "lodash",
      signal: "adjacent transposition",
    });
    expect(matchPopularName("electorn")).toMatchObject({
      target: "electron",
      signal: "adjacent transposition",
    });
    expect(matchPopularName("mongose")).toMatchObject({
      target: "mongoose",
      signal: "one omitted character",
    });
    expect(matchPopularName("reequest")).toMatchObject({
      target: "request",
      signal: "one extra character",
    });
    expect(matchPopularName("lodash")).toBeNull();
    expect(matchPopularName("LODASH")).toBeNull();
    expect(matchPopularName("preact")).toBeNull();
    expect(matchPopularName("express-session")).toBeNull();
    expect(matchPopularName("ab")).toBeNull();
    expect(matchPopularName("ms")).toBeNull();
  });

  it("flags separator, homoglyph, scope, and combosquat tricks", () => {
    expect(matchPopularName("crossenv")).toMatchObject({
      target: "cross-env",
      signal: "separator swap",
      severity: "high",
    });
    expect(matchPopularName("cross_env")).toMatchObject({
      target: "cross-env",
      signal: "separator swap",
    });
    expect(matchPopularName("l0dash")).toMatchObject({
      target: "lodash",
      signal: "homoglyph",
      severity: "high",
    });
    expect(matchPopularName("l\u043edash")).toMatchObject({
      target: "lodash",
      signal: "homoglyph",
    });
    expect(matchPopularName("@typos/node")).toMatchObject({
      target: "@types/node",
      signal: "scope typo",
      severity: "high",
    });
    expect(matchPopularName("@types/node")).toBeNull();
    expect(matchPopularName("@types/lodash")).toBeNull();
    expect(matchPopularName("@evil/lodash")).toMatchObject({
      target: "lodash",
      signal: "added scope",
      severity: "medium",
    });
    expect(matchPopularName("ethersproject-wallet")).toMatchObject({
      target: "@ethersproject/wallet",
      signal: "dropped scope",
      severity: "high",
    });
    expect(matchPopularName("wallet", ["@ethersproject/wallet"])).toBeNull();
    expect(matchPopularName("typescriptjs")).toMatchObject({
      target: "typescript",
      signal: "js suffix",
      severity: "medium",
    });
    expect(matchPopularName("lodash-utils")).toMatchObject({
      target: "lodash",
      signal: "combosquat suffix",
      severity: "medium",
    });
    expect(matchPopularName("node-lodash", ["lodash"])).toMatchObject({
      signal: "combosquat prefix",
    });
  });

  it("leaves legitimate similar names alone", () => {
    expect(matchPopularName("express-session", ["express", "lodash"])).toBeNull();
    expect(matchPopularName("lodash-es", ["lodash"])).toBeNull();
    expect(matchPopularName("requost", ["request"])).toBeNull();
    expect(matchPopularName("nest", ["next"])).toBeNull();
    expect(matchPopularName("ones", ["once"])).toBeNull();
    expect(matchPopularName("preact", ["react"])).toMatchObject({
      target: "react",
      signal: "one extra character",
    });
    expect(matchPopularName("dom-react", ["react-dom"])).toMatchObject({
      signal: "swapped words",
    });
    expect(matchPopularName("chalk-2", ["chalk"])).toMatchObject({
      signal: "version suffix",
    });
    expect(matchPopularName("typscrpt", ["typescript"])).toMatchObject({
      signal: "two omitted characters",
      severity: "medium",
    });
    expect(matchPopularName("commando", ["commander"])).toBeNull();
    expect(matchPopularName("fastify")).toBeNull();
    expect(
      readNearMiss("Near miss of @types/node (scope typo). Swap @typos/node for @types/node."),
    ).toBe("@types/node");
  });
});

describe("doppelganger rule", () => {
  it("puts the popular name and a code summary on the finding", async () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    writeJson(join(created.dir, "package.json"), {
      name: "lodasg",
      version: "1.2.3",
      description: "The Lodash library delivering modularity, performance, and extras.",
      main: "index.js",
    });
    writeText(
      join(created.dir, "index.js"),
      "function get(object, key) {\n  return object[key];\n}\nmodule.exports = { get };\n",
    );
    const pkg: InstalledPackage = fixturePackage({
      name: "lodasg",
      version: "1.2.3",
      lockKey: "node_modules/lodasg",
      path: created.dir,
      manifest: {
        name: "lodasg",
        version: "1.2.3",
        description: "The Lodash library delivering modularity, performance, and extras.",
        main: "index.js",
      },
    });
    const findings = await doppelgangerRule.scan(pkg, { rootDir: "/", packages: [pkg] });
    expect(doppelgangerRule.status).toBe("active");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "doppelganger",
      packageName: "lodasg",
      version: "1.2.3",
      severity: "high",
      title: "name imitates lodash",
      evidencePath: "index.js",
    });
    expect(findings[0]?.detail).toContain("Near miss of lodash");
    expect(findings[0]?.detail).toContain("Swap lodasg for lodash");
    expect(findings[0]?.evidence).toContain("The Lodash library");
    expect(findings[0]?.evidence).toContain("function get");
  });

  it("recommends swap and asks Gemma whether the package is impersonating", async () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const root = created.dir;
    const pkgDir = join(root, "node_modules", "lodasg");
    writeJson(join(root, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": { name: "app", dependencies: { lodasg: "1.0.0" } },
        "node_modules/lodasg": { version: "1.0.0" },
      },
    });
    writeJson(join(root, "package.json"), {
      name: "app",
      dependencies: { lodasg: "1.0.0" },
    });
    writeJson(join(pkgDir, "package.json"), {
      name: "lodasg",
      version: "1.0.0",
      description: "The Lodash library delivering modularity, performance, and extras.",
      main: "index.js",
    });
    writeText(join(pkgDir, "README.md"), "# lodash\n\nA modern JavaScript utility library.\n");
    writeText(
      join(pkgDir, "index.js"),
      "function get(object, key) {\n  return object[key];\n}\nmodule.exports = { get };\n",
    );
    writeText(
      join(root, "src", "app.js"),
      'const { get } = require("lodasg");\nconsole.log(get);\n',
    );

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
        const request = buildChatRequest(input);
        const user = request.messages.find((message) => message.role === "user")?.content ?? "";
        expect(user).toContain("Near miss of lodash");
        expect(user).toContain("impersonating lodash");
        expect(user).toContain("<<<UNTRUSTED DESCRIPTION>>>");
        expect(user).toContain("The Lodash library");
        expect(user).toContain("<<<UNTRUSTED README>>>");
        expect(user).toContain("A modern JavaScript utility library");
        expect(user).toContain("function get");
        expect(user).toContain("<<<END UNTRUSTED CODE>>>");
        return {
          verdict: "suspicious",
          confidence: 0.8,
          score: 40,
          summary: "It exports a get helper and describes itself as Lodash.",
          explanation: "The package is impersonating lodash. The code has no payload.",
        };
      },
    };

    const report = await haunt(root, {
      model: "gemma3:4b",
      endpoint: "http://localhost:11434",
      consultOracle: true,
      oracleClient: client,
    });
    expect(report.hauntings.map((row) => row.name)).toEqual(["lodasg"]);
    const haunting = report.hauntings[0];
    expect(haunting?.exorcism).toBe("swap");
    expect(haunting?.exorcismReason).toContain("Swap lodasg for lodash");
    expect(haunting?.hauntingScore).toBe(40);
    expect(haunting?.judgment?.explanation).toContain("impersonating lodash");
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("impersonating lodash");
    expect(markdown).toContain("**swap**");
  });
});
