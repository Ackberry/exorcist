import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POLTERGEIST_LIMITS, poltergeistRule } from "../src/rules/poltergeist.js";
import type { Finding } from "../src/types.js";
import { fixturePackage, tempDir, writeJson, writeText } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function titles(findings: Finding[]): string[] {
  return findings.map((finding) => finding.title);
}

describe("poltergeist", () => {
  it("flags preinstall, install, and postinstall scripts", () => {
    const findings = poltergeistRule.scan(
      fixturePackage({
        name: "hooked",
        lockKey: "node_modules/hooked",
        manifest: {
          scripts: {
            preinstall: "node pre.js",
            install: "node install.js",
            postinstall: "node post.js",
            test: 'node -e "process.env.NOPE"',
            prepare: "node prepare.js",
          },
        },
      }),
      { rootDir: "/", packages: [] },
    );
    const found = Array.isArray(findings) ? findings : [];
    expect(titles(found)).toEqual([
      "runs a preinstall script",
      "runs an install script",
      "runs a postinstall script",
    ]);
    expect(found.every((finding) => finding.severity === "critical")).toBe(true);
    expect(found.every((finding) => finding.rule === "poltergeist")).toBe(true);
    expect(found[2]?.evidence).toBe("node post.js");
    expect(found[2]?.evidencePath).toBe("package.json");
  });

  it("flags risky APIs in package source", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dir = join(created.dir, "node_modules/cursed");
    writeJson(join(dir, "package.json"), { name: "cursed", version: "1.0.0" });
    writeText(
      join(dir, "index.js"),
      [
        'const { execSync } = require("child_process");',
        'const http = require("node:http");',
        "fetch('https://example.test/demo');",
        "const token = process.env.TOKEN;",
        'const key = "~/.ssh/id_rsa";',
        'const rc = ".npmrc";',
        'eval("1");',
        'const blob = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
        "execSync('echo demo');",
        "http.get();",
        "",
      ].join("\n"),
    );

    const findings = poltergeistRule.scan(
      fixturePackage({
        name: "cursed",
        lockKey: "node_modules/cursed",
        path: dir,
        manifest: { name: "cursed", version: "1.0.0" },
      }),
      { rootDir: created.dir, packages: [] },
    );
    const found = Array.isArray(findings) ? findings : [];
    expect(titles(found)).toEqual([
      "spawns child processes",
      "makes a network call",
      "reads process.env",
      "touches an SSH path",
      "touches an npmrc",
      "uses eval or the Function constructor",
      "contains a base64 payload",
    ]);
    expect(found.find((finding) => finding.title === "touches an SSH path")?.severity).toBe(
      "critical",
    );
    expect(found[0]?.evidencePath).toBe("index.js");
    expect(found[0]?.evidence).toContain("child_process");
  });

  it("flags a TypeScript import and keeps a single finding when two files match", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dir = join(created.dir, "pkg");
    writeJson(join(dir, "package.json"), { name: "twice", version: "1.0.0" });
    writeText(
      join(dir, "b.ts"),
      'import { execSync } from "node:child_process";\nexecSync("echo");\n',
    );
    writeText(join(dir, "a.js"), 'require("child_process");\n');

    const findings = poltergeistRule.scan(
      fixturePackage({ name: "twice", lockKey: "node_modules/twice", path: dir }),
      { rootDir: created.dir, packages: [] },
    );
    const found = Array.isArray(findings) ? findings : [];
    expect(found).toHaveLength(1);
    expect(found[0]?.evidencePath).toBe("a.js");
  });

  it("does not flag a clean package, a short token, declaration files, or nested dependencies", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dir = join(created.dir, "pkg");
    writeJson(join(dir, "package.json"), {
      name: "clean",
      version: "1.0.0",
      scripts: { test: "node test.js" },
    });
    writeText(
      join(dir, "index.js"),
      'const short = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";\nconsole.log("ok");\n',
    );
    writeText(join(dir, "index.d.ts"), "export const env: typeof process.env;\n");
    writeText(join(dir, "node_modules/hidden/index.js"), 'eval("1");\n');
    writeText(join(dir, "lib/also-clean.js"), "module.exports = 1;\n");

    const findings = poltergeistRule.scan(
      fixturePackage({
        name: "clean",
        lockKey: "node_modules/clean",
        path: dir,
        manifest: { name: "clean", version: "1.0.0", scripts: { test: "node test.js" } },
      }),
      { rootDir: created.dir, packages: [] },
    );
    expect(findings).toEqual([]);
  });

  it("skips source files over the size cap", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dir = join(created.dir, "pkg");
    writeJson(join(dir, "package.json"), { name: "huge", version: "1.0.0" });
    writeText(
      join(dir, "big.js"),
      `${"x".repeat(POLTERGEIST_LIMITS.maxFileBytes + 50)}\neval("nope");\n`,
    );

    const findings = poltergeistRule.scan(
      fixturePackage({ name: "huge", lockKey: "node_modules/huge", path: dir }),
      { rootDir: created.dir, packages: [] },
    );
    expect(findings).toEqual([]);
  });

  it("flags base64 helpers that are not long literals", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dir = join(created.dir, "pkg");
    writeJson(join(dir, "package.json"), { name: "codec", version: "1.0.0" });
    writeText(
      join(dir, "index.js"),
      'const pocket = Buffer.from(String(token)).toString("base64");\n',
    );

    const findings = poltergeistRule.scan(
      fixturePackage({ name: "codec", lockKey: "node_modules/codec", path: dir }),
      { rootDir: created.dir, packages: [] },
    );
    const found = Array.isArray(findings) ? findings : [];
    expect(titles(found)).toEqual(["contains a base64 payload"]);
    expect(found[0]?.severity).toBe("medium");
  });

  it("does not follow a source symlink out of the package", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dir = join(created.dir, "pkg");
    const outside = join(created.dir, "outside.js");
    writeJson(join(dir, "package.json"), { name: "linked", version: "1.0.0" });
    writeText(outside, 'eval("SECRET-EVAL");\n');
    symlinkSync(outside, join(dir, "index.js"));
    const nest = join(created.dir, "nested");
    writeText(join(nest, "index.js"), 'eval("SECRET-DIR");\n');
    symlinkSync(nest, join(dir, "lib"));

    const findings = poltergeistRule.scan(
      fixturePackage({ name: "linked", lockKey: "node_modules/linked", path: dir }),
      { rootDir: created.dir, packages: [] },
    );
    expect(findings).toEqual([]);
  });
});
