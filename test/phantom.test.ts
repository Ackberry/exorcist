import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectSpecifiers,
  PHANTOM_LIMITS,
  packageNameFromSpecifier,
  phantomRule,
} from "../src/rules/phantom.js";
import type { Finding, InstalledPackage, ScanContext } from "../src/types.js";
import { fixturePackage, tempDir, writeJson, writeText } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function project(files: Record<string, string>): string {
  const created = tempDir();
  cleanups.push(created.cleanup);
  for (const [rel, text] of Object.entries(files)) {
    writeText(join(created.dir, rel), text);
  }
  return created.dir;
}

async function scan(pkg: InstalledPackage, ctx: ScanContext): Promise<Finding[]> {
  return phantomRule.scan(pkg, ctx);
}

describe("package names", () => {
  it("keeps scoped names and drops subpaths, relatives, and node built-ins", () => {
    expect(packageNameFromSpecifier("@scope/pkg")).toBe("@scope/pkg");
    expect(packageNameFromSpecifier("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(packageNameFromSpecifier("pkg/sub")).toBe("pkg");
    expect(packageNameFromSpecifier("pkg/sub?query")).toBe("pkg");
    expect(packageNameFromSpecifier("pkg#hash")).toBe("pkg");
    expect(packageNameFromSpecifier("./local")).toBeNull();
    expect(packageNameFromSpecifier("../local")).toBeNull();
    expect(packageNameFromSpecifier("/abs")).toBeNull();
    expect(packageNameFromSpecifier("node:fs")).toBeNull();
    expect(packageNameFromSpecifier("@scope")).toBeNull();
  });
});

describe("import detection", () => {
  it("reads import, export, require, and dynamic import specifiers", () => {
    const source = [
      'import def, { named } from "pkg";',
      'import * as ns from "@scope/pkg/sub";',
      'import "side-effect";',
      'export { thing } from "reexport/path";',
      'export * from "@scope/again";',
      'const loaded = import("dynamic");',
      'const common = require("common/lib");',
      'const resolved = require.resolve("@tools/cli");',
      'import type { Kind } from "types-only";',
      "import {",
      "  value,",
      '} from "multiline";',
      "const also = require(",
      '  "wrapped"',
      ");",
      "module.exports = { def, ns, loaded, common, resolved, value, also };",
      "",
    ].join("\n");
    expect(collectSpecifiers(source).sort()).toEqual(
      [
        "@scope/again",
        "@scope/pkg/sub",
        "@tools/cli",
        "common/lib",
        "dynamic",
        "multiline",
        "pkg",
        "reexport/path",
        "side-effect",
        "types-only",
        "wrapped",
      ].sort(),
    );
  });

  it("ignores comments, ordinary strings, and non-literal calls", () => {
    const source = [
      'const label = "ghost";',
      'const mentioned = "require(\\"ghost\\")";',
      '// require("ghost");',
      '/* import "ghost"; export { x } from "ghost"; */',
      "const name = ghostName;",
      "require(name);",
      "import(name);",
      'obj.require("ghost");',
      "const untouched = 1;",
      "void untouched;",
      "",
    ].join("\n");
    expect(collectSpecifiers(source)).toEqual([]);
  });

  it("sees a require inside a template expression and not one in template text", () => {
    const expr = "${";
    const source = [
      `const used = \`prefix ${expr}require("inside")} suffix\`;`,
      'const text = `require("not-a-call")`;',
      "",
    ].join("\n");
    expect(collectSpecifiers(source)).toEqual(["inside"]);
  });

  it("still reads an import when a binding is named from", () => {
    expect(collectSpecifiers('import * as from from "renamed";\n')).toEqual(["renamed"]);
  });
});

describe("phantom rule", () => {
  it("flags an unused direct dependency and keeps an imported one quiet", async () => {
    const root = project({
      "package.json": `${JSON.stringify(
        {
          dependencies: {
            "used-pkg": "1.0.0",
            "soul-snatcher": "file:../soul-snatcher",
          },
        },
        null,
        2,
      )}\n`,
      "src/app.js": 'import { charm } from "used-pkg";\nconsole.log(charm);\n',
      "src/extra.tsx": 'export { charm as again } from "used-pkg/sub";\n',
    });
    const ctx: ScanContext = { rootDir: root, packages: [] };
    const used = fixturePackage({
      name: "used-pkg",
      lockKey: "node_modules/used-pkg",
      direct: true,
    });
    const unused = fixturePackage({
      name: "soul-snatcher",
      lockKey: "node_modules/soul-snatcher",
      direct: true,
    });
    expect(await scan(used, ctx)).toEqual([]);
    const findings = await scan(unused, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "phantom",
      lockKey: "node_modules/soul-snatcher",
      packageName: "soul-snatcher",
      version: "1.0.0",
      severity: "medium",
      title: "installed but never imported",
      evidence: '"soul-snatcher": "file:../soul-snatcher"',
      evidencePath: "package.json",
    });
  });

  it("counts scoped subpaths, require, and dynamic import as uses", async () => {
    const root = project({
      "src/app.js": [
        'const scoped = require("@scope/pkg/sub");',
        'const loaded = import("dynamic-pkg");',
        "console.log(scoped, loaded);",
        "",
      ].join("\n"),
    });
    const ctx: ScanContext = { rootDir: root, packages: [] };
    expect(
      await scan(
        fixturePackage({ name: "@scope/pkg", lockKey: "node_modules/@scope/pkg", direct: true }),
        ctx,
      ),
    ).toEqual([]);
    expect(
      await scan(
        fixturePackage({ name: "dynamic-pkg", lockKey: "node_modules/dynamic-pkg", direct: true }),
        ctx,
      ),
    ).toEqual([]);
    const unused = await scan(
      fixturePackage({ name: "ghost", lockKey: "node_modules/ghost", direct: true }),
      ctx,
    );
    expect(unused.map((finding) => finding.packageName)).toEqual(["ghost"]);
  });

  it("does not treat a comment or a string as a use", async () => {
    const root = project({
      "src/app.js": [
        '// require("ghost");',
        '/* import "ghost"; */',
        'const label = "ghost";',
        "console.log(label);",
        "",
      ].join("\n"),
    });
    const findings = await scan(
      fixturePackage({ name: "ghost", lockKey: "node_modules/ghost", direct: true }),
      { rootDir: root, packages: [] },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("medium");
  });

  it("does not flag a transitive dependency", async () => {
    const root = project({ "src/app.js": "console.log(1);\n" });
    const findings = await scan(
      fixturePackage({
        name: "nested",
        lockKey: "node_modules/parent/node_modules/nested",
        direct: false,
      }),
      { rootDir: root, packages: [] },
    );
    expect(findings).toEqual([]);
  });

  it("flags an unused devDependency at low severity", async () => {
    const root = project({
      "package.json": `${JSON.stringify({ devDependencies: { eslint: "^9.0.0" } })}\n`,
      "src/app.js": "console.log(1);\n",
    });
    const findings = await scan(
      fixturePackage({
        name: "eslint",
        lockKey: "node_modules/eslint",
        direct: true,
        dev: true,
      }),
      { rootDir: root, packages: [] },
    );
    expect(findings[0]).toMatchObject({
      severity: "low",
      evidence: '"eslint": "^9.0.0"',
    });
    expect(findings[0]?.detail).toContain("devDependency");
  });

  it("treats a package.json script and a bin command as uses", async () => {
    const root = project({
      "package.json": `${JSON.stringify({
        scripts: {
          snatch: "soul-snatcher --dry-run",
          lint: "biome check .",
        },
      })}\n`,
      "src/app.js": "console.log(1);\n",
    });
    const biomeDir = join(root, "node_modules/@biomejs/biome");
    writeJson(join(biomeDir, "package.json"), {
      name: "@biomejs/biome",
      bin: { biome: "bin/biome" },
    });
    const ctx: ScanContext = { rootDir: root, packages: [] };
    expect(
      await scan(
        fixturePackage({
          name: "soul-snatcher",
          lockKey: "node_modules/soul-snatcher",
          direct: true,
        }),
        ctx,
      ),
    ).toEqual([]);
    expect(
      await scan(
        fixturePackage({
          name: "@biomejs/biome",
          lockKey: "node_modules/@biomejs/biome",
          path: biomeDir,
          direct: true,
          dev: true,
        }),
        ctx,
      ),
    ).toEqual([]);
  });

  it("uses a string bin's unscoped name", async () => {
    const root = project({
      "package.json": `${JSON.stringify({ scripts: { check: "tidy src" } })}\n`,
      "src/app.js": "console.log(1);\n",
    });
    const tidyDir = join(root, "node_modules/@tools/tidy");
    writeJson(join(tidyDir, "package.json"), {
      name: "@tools/tidy",
      bin: "./cli.js",
    });
    const findings = await scan(
      fixturePackage({
        name: "@tools/tidy",
        lockKey: "node_modules/@tools/tidy",
        path: tidyDir,
        direct: true,
        dev: true,
      }),
      { rootDir: root, packages: [] },
    );
    expect(findings).toEqual([]);
  });

  it("ignores imports that live in node_modules, build output, or dotfolders", async () => {
    const root = project({
      "src/app.js": "console.log(1);\n",
      "node_modules/decoy/index.js": 'require("ghost");\n',
      "dist/bundle.js": 'require("ghost");\n',
      "coverage/lcov.js": 'require("ghost");\n',
      "build/out.js": 'require("ghost");\n',
      ".hidden/app.js": 'import "ghost";\n',
    });
    const findings = await scan(
      fixturePackage({ name: "ghost", lockKey: "node_modules/ghost", direct: true }),
      { rootDir: root, packages: [] },
    );
    expect(findings).toHaveLength(1);
  });

  it("reads dotfiles and jsx, and skips a file over the size cap", async () => {
    const root = project({
      ".eslintrc.js": 'module.exports = { plugins: [require("eslint-plugin-demo")] };\n',
      "src/view.jsx": 'import "view-lib";\n',
    });
    writeText(
      join(root, "src/huge.js"),
      `require("capped");\n${"a".repeat(PHANTOM_LIMITS.maxFileBytes)}`,
    );
    const ctx: ScanContext = { rootDir: root, packages: [] };
    expect(
      await scan(
        fixturePackage({
          name: "eslint-plugin-demo",
          lockKey: "node_modules/eslint-plugin-demo",
          direct: true,
          dev: true,
        }),
        ctx,
      ),
    ).toEqual([]);
    expect(
      await scan(
        fixturePackage({ name: "view-lib", lockKey: "node_modules/view-lib", direct: true }),
        ctx,
      ),
    ).toEqual([]);
    const capped = await scan(
      fixturePackage({ name: "capped", lockKey: "node_modules/capped", direct: true }),
      ctx,
    );
    expect(capped).toHaveLength(1);
  });
});
