import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { tempDir } from "./helpers.js";

const victimDir = join(dirname(fileURLToPath(import.meta.url)), "../demo/victim");
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("cli", () => {
  it("writes a rules-only report for the demo", async () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dest = join(created.dir, "nested", "haunting-report.md");
    const code = await main([victimDir, "--no-oracle", "--report", dest]);
    expect(code).toBe(0);
    const markdown = readFileSync(dest, "utf8");
    expect(markdown).toContain("## soul-snatcher@1.0.0");
    expect(markdown).toContain("## lodasg@1.0.0");
    expect(markdown).toContain("## hexed-helper@1.0.0");
    expect(markdown).toContain("`lucky-charm@1.0.0`");
    expect(markdown).toContain("Oracle skipped (--no-oracle). Report built from rules only.");
    expect(markdown).not.toContain("## lucky-charm@1.0.0");
  });

  it("returns 1 when the target directory does not exist", async () => {
    const code = await main(["/no/such/exorcist-target", "--no-oracle"]);
    expect(code).toBe(1);
  });
});
