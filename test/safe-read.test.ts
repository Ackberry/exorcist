import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { credentialRoots, isInside, isSensitiveRealPath, packageScope } from "../src/safe-read.js";
import { tempDir, writeText } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("package boundary", () => {
  it("stops at the nearest git root", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const repo = join(created.dir, "repo");
    const app = join(repo, "app");
    mkdirSync(app, { recursive: true });
    writeText(join(repo, ".git"), "gitdir: unused\n");
    expect(packageScope(app).boundary).toBe(realpathSync(repo));
  });

  it("does not use the filesystem root as the boundary", () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const app = join(created.dir, "app");
    mkdirSync(app);
    const scope = packageScope(app);
    expect(scope.boundary).not.toBe(resolve("/"));
    expect(isInside(scope.boundary, scope.scanRoot)).toBe(true);
  });
});

describe("credential paths", () => {
  it("matches home credential directories and not a normal project path", () => {
    const home = "/home/me";
    const markers = credentialRoots(home);
    expect(isSensitiveRealPath("/home/me/.ssh/id_rsa", home, markers)).toBe(true);
    expect(isSensitiveRealPath("/home/me/.aws/credentials", home, markers)).toBe(true);
    expect(isSensitiveRealPath("/home/me/.npmrc", home, markers)).toBe(true);
    expect(isSensitiveRealPath("/etc/hosts", home, markers)).toBe(true);
    expect(isSensitiveRealPath(home, home, markers)).toBe(true);
    expect(isSensitiveRealPath("/", home, markers)).toBe(true);
    expect(isSensitiveRealPath("/home/me/.ssh-backup/id_rsa", home, markers)).toBe(false);
    expect(isSensitiveRealPath("/home/me/projects/app/node_modules/left-pad", home, markers)).toBe(
      false,
    );
  });
});
