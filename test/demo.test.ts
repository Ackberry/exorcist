import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveInstalled } from "../src/resolver.js";
import { runRules } from "../src/scanner.js";
import { judgePackage } from "../src/scorer.js";

const victimDir = join(dirname(fileURLToPath(import.meta.url)), "../demo/victim");

describe("demo victim", () => {
  it("flags possessed fixtures, and swaps the lodasg typosquat", async () => {
    const packages = resolveInstalled(victimDir);
    const findings = await runRules(packages, victimDir);

    expect(packages.map((pkg) => pkg.name).sort()).toEqual([
      "hexed-helper",
      "lodasg",
      "lucky-charm",
      "preact",
      "soul-snatcher",
    ]);

    const haunted = [...new Set(findings.map((finding) => finding.packageName))].sort();
    expect(haunted).toEqual(["hexed-helper", "lodasg", "soul-snatcher"]);
    expect(findings.some((finding) => finding.packageName === "lucky-charm")).toBe(false);
    expect(findings.some((finding) => finding.packageName === "preact")).toBe(false);

    const phantoms = findings
      .filter((finding) => finding.rule === "phantom")
      .map((finding) => finding.packageName)
      .sort();
    expect(phantoms).toEqual(["hexed-helper", "soul-snatcher"]);
    expect(
      findings
        .filter((finding) => finding.rule === "phantom")
        .every((finding) => finding.severity === "medium"),
    ).toBe(true);
    expect(findings.some((finding) => finding.rule === "revenant")).toBe(false);

    const lodasg = findings.filter((finding) => finding.packageName === "lodasg");
    expect(lodasg.map((finding) => finding.rule)).toEqual(["doppelganger"]);
    expect(lodasg[0]).toMatchObject({
      severity: "high",
      title: "name imitates lodash",
    });
    expect(lodasg[0]?.detail).toContain("Near miss of lodash");
    expect(lodasg[0]?.evidence).toContain("Lodash");

    const lodasgPkg = packages.find((pkg) => pkg.name === "lodasg");
    expect(lodasgPkg).toBeDefined();
    if (!lodasgPkg) return;
    const decision = judgePackage(lodasgPkg, lodasg, null, null);
    expect(decision.hauntingScore).toBe(28);
    expect(decision.exorcism).toBe("swap");
    expect(decision.exorcismReason).toContain("Swap lodasg for lodash");

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
    expect(
      findings.some(
        (finding) =>
          finding.packageName === "hexed-helper" &&
          finding.title === "uses eval or the Function constructor",
      ),
    ).toBe(true);
  });
});
