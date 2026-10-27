import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveInstalled } from "../src/resolver.js";
import { runRules } from "../src/scanner.js";

const victimDir = join(dirname(fileURLToPath(import.meta.url)), "../demo/victim");

describe("demo victim", () => {
  it("flags possessed fixtures from poltergeist, and unused ones from phantom", async () => {
    const packages = resolveInstalled(victimDir);
    const findings = await runRules(packages, victimDir);

    expect(packages.map((pkg) => pkg.name).sort()).toEqual([
      "hexed-helper",
      "lodasg",
      "lucky-charm",
      "soul-snatcher",
    ]);

    const haunted = [...new Set(findings.map((finding) => finding.packageName))].sort();
    expect(haunted).toEqual(["hexed-helper", "lodasg", "soul-snatcher"]);
    // lucky-charm is imported by demo/victim/src/app.js. The other three are not.
    expect(findings.some((finding) => finding.packageName === "lucky-charm")).toBe(false);

    const phantoms = findings
      .filter((finding) => finding.rule === "phantom")
      .map((finding) => finding.packageName)
      .sort();
    expect(phantoms).toEqual(["hexed-helper", "lodasg", "soul-snatcher"]);
    expect(
      findings
        .filter((finding) => finding.rule === "phantom")
        .every((finding) => finding.severity === "medium"),
    ).toBe(true);
    expect(findings.some((finding) => finding.rule === "doppelganger")).toBe(false);
    expect(findings.some((finding) => finding.rule === "revenant")).toBe(false);

    expect(
      findings.some(
        (finding) =>
          finding.packageName === "soul-snatcher" && finding.title === "runs a postinstall script",
      ),
    ).toBe(true);
    expect(
      findings.some(
        (finding) => finding.packageName === "soul-snatcher" && finding.rule === "phantom",
      ),
    ).toBe(true);
    expect(findings.some((finding) => finding.packageName === "lodasg")).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.packageName === "hexed-helper" &&
          finding.title === "uses eval or the Function constructor",
      ),
    ).toBe(true);
  });
});
