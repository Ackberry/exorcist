import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { InstalledPackage } from "../src/types.js";

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "exorcist-"));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function fixturePackage(
  overrides: Partial<InstalledPackage> & Pick<InstalledPackage, "name" | "lockKey">,
): InstalledPackage {
  return {
    version: "1.0.0",
    path: null,
    manifest: null,
    direct: true,
    dev: false,
    ...overrides,
  };
}
