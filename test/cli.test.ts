import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { tempDir } from "./helpers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    expect(markdown).toContain("`preact@1.0.0`");
    expect(markdown).toContain("Oracle skipped (--no-oracle). Report built from rules only.");
    expect(markdown).toContain("Swap lodasg for lodash");
    expect(markdown).toContain("| lodasg@1.0.0 | 28 | swap |");
    expect(markdown).not.toContain("## lucky-charm@1.0.0");
    expect(markdown).not.toContain("## preact@1.0.0");
  });

  it("returns 1 when the target directory does not exist", async () => {
    const code = await main(["/no/such/exorcist-target", "--no-oracle"]);
    expect(code).toBe(1);
  });

  it("exits 0 after a scan without calling process.exit", async () => {
    const created = tempDir();
    cleanups.push(created.cleanup);
    const dest = join(created.dir, "haunting-report.md");
    const code = await runCli([victimDir, "--no-oracle", "--report", dest]);
    expect(code).toBe(0);
    expect(readFileSync(dest, "utf8")).toContain("## soul-snatcher@1.0.0");
  }, 20_000);

  it("exits 1 when the target directory does not exist", async () => {
    const code = await runCli(["/no/such/exorcist-target", "--no-oracle"]);
    expect(code).toBe(1);
  }, 20_000);
});

function runCli(args: readonly string[]): Promise<number | null> {
  const env = { ...process.env };
  delete env.VITEST;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === null) {
        reject(new Error(`cli closed without a code: ${stderr}`));
        return;
      }
      resolve(code);
    });
  });
}
