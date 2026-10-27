import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ResolverError } from "../src/errors.js";
import { resolveInstalled } from "../src/resolver.js";
import { tempDir, writeJson, writeText } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function makeTemp(): string {
  const created = tempDir();
  cleanups.push(created.cleanup);
  return created.dir;
}

describe("resolveInstalled", () => {
  it("reads a lockfileVersion 3 packages map", () => {
    const root = makeTemp();
    writeJson(join(root, "package-lock.json"), {
      name: "app",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "app",
          dependencies: { "left-pad": "1.2.3" },
        },
        "node_modules/left-pad": { version: "1.2.3" },
        "node_modules/@haunted/bell": { version: "2.0.0" },
        "node_modules/left-pad/node_modules/nested": { version: "9.9.9", dev: true },
      },
    });
    writeJson(join(root, "node_modules/left-pad/package.json"), {
      name: "left-pad",
      version: "1.2.3",
      scripts: { postinstall: "node evil.js" },
    });
    writeText(join(root, "node_modules/left-pad/index.js"), "module.exports = {};\n");
    writeJson(join(root, "node_modules/@haunted/bell/package.json"), {
      name: "@haunted/bell",
      version: "2.0.0",
    });
    writeJson(join(root, "node_modules/left-pad/node_modules/nested/package.json"), {
      name: "nested",
      version: "9.9.9",
    });

    const packages = resolveInstalled(root);
    expect(packages.map((pkg) => pkg.name)).toEqual(["left-pad", "@haunted/bell", "nested"]);

    const leftPad = packages[0];
    expect(leftPad).toMatchObject({
      name: "left-pad",
      version: "1.2.3",
      lockKey: "node_modules/left-pad",
      direct: true,
      dev: false,
    });
    expect(leftPad?.path).toBe(join(root, "node_modules/left-pad"));
    expect(leftPad?.manifest?.scripts?.postinstall).toBe("node evil.js");

    expect(packages[1]).toMatchObject({
      name: "@haunted/bell",
      version: "2.0.0",
      direct: false,
    });
    expect(packages[2]).toMatchObject({
      name: "nested",
      version: "9.9.9",
      lockKey: "node_modules/left-pad/node_modules/nested",
      direct: false,
      dev: true,
    });
  });

  it("ignores the legacy dependencies tree and keeps lockfileVersion 2", () => {
    const root = makeTemp();
    writeJson(join(root, "package-lock.json"), {
      lockfileVersion: 2,
      packages: {
        "": { dependencies: { "left-pad": "1.0.0" } },
        "node_modules/left-pad": { version: "1.0.0" },
      },
      dependencies: {
        "only-in-the-v1-tree": { version: "9.9.9" },
      },
    });
    writeJson(join(root, "node_modules/left-pad/package.json"), {
      name: "left-pad",
      version: "1.0.0",
    });

    const packages = resolveInstalled(root);
    expect(packages.map((pkg) => pkg.name)).toEqual(["left-pad"]);
  });

  it("follows an npm file: link and does not list the source path twice", () => {
    const root = join(makeTemp(), "app");
    const source = join(root, "../packages/widget");
    writeJson(join(source, "package.json"), {
      name: "widget",
      version: "1.2.3",
      scripts: { postinstall: "node postinstall.js" },
    });
    writeJson(join(root, "package-lock.json"), {
      name: "app",
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { widget: "file:../packages/widget" } },
        "../packages/widget": { version: "1.2.3" },
        "node_modules/widget": { resolved: "../packages/widget", link: true },
      },
    });

    const packages = resolveInstalled(root);
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      name: "widget",
      version: "1.2.3",
      lockKey: "node_modules/widget",
      direct: true,
    });
    expect(packages[0]?.path).toBe(source);
    expect(packages[0]?.manifest?.scripts?.postinstall).toBe("node postinstall.js");
  });

  it("resolves a file: URL when node_modules is absent", () => {
    const root = makeTemp();
    const outside = mkdtempSync(join(tmpdir(), "exorcist-file-"));
    cleanups.push(() => {
      rmSync(outside, { recursive: true, force: true });
    });
    writeJson(join(outside, "package.json"), { name: "outside", version: "4.0.0" });
    writeJson(join(root, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { outside: "file:outside" } },
        "node_modules/outside": { resolved: pathToFileURL(outside).href, link: true },
      },
    });

    const packages = resolveInstalled(root);
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({ name: "outside", version: "4.0.0", direct: true });
    expect(packages[0]?.path).toBe(outside);
  });

  it("marks devDependencies and still lists a package with a broken package.json", () => {
    const root = makeTemp();
    writeJson(join(root, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": { devDependencies: { types: "1.0.0" } },
        "node_modules/types": { version: "1.0.0" },
        "node_modules/broken": { version: "0.1.0" },
      },
    });
    writeJson(join(root, "node_modules/types/package.json"), { name: "types", version: "1.0.0" });
    writeText(join(root, "node_modules/broken/package.json"), "{");

    const packages = resolveInstalled(root);
    expect(packages.find((pkg) => pkg.name === "types")).toMatchObject({ dev: true, direct: true });
    expect(packages.find((pkg) => pkg.name === "broken")).toMatchObject({
      version: "0.1.0",
      manifest: null,
    });
  });

  it("accepts a UTF-8 BOM in the lockfile", () => {
    const root = makeTemp();
    writeFileSync(
      join(root, "package-lock.json"),
      `\uFEFF${JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/bom": { version: "1.0.0", name: "bom" },
        },
      })}`,
    );
    expect(resolveInstalled(root).map((pkg) => pkg.name)).toEqual(["bom"]);
  });

  it("rejects a missing directory, a missing lockfile, bad JSON, and lockfileVersion 1", () => {
    const root = makeTemp();
    expect(() => resolveInstalled(join(root, "missing"))).toThrow(ResolverError);
    expect(() => resolveInstalled(root)).toThrow(/package-lock\.json/);

    writeText(join(root, "package-lock.json"), "{");
    expect(() => resolveInstalled(root)).toThrow(/not valid JSON/);

    writeJson(join(root, "package-lock.json"), { lockfileVersion: 1, dependencies: {} });
    expect(() => resolveInstalled(root)).toThrow(/lockfileVersion 1/);
  });
});
