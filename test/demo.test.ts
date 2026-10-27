import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveInstalled } from "../src/resolver.js";
import { runRules } from "../src/scanner.js";

const victimDir = join(dirname(fileURLToPath(import.meta.url)), "../demo/victim");

describe("demo victim", () => {
  it("flags the possessed fixtures from poltergeist and leaves lucky-charm quiet", async () => {
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
    // Tripwire for Wednesday: doppelganger, revenant, and phantom are stubs.
    // When one of them starts flagging these fixtures, update this assertion.
    expect(findings.every((finding) => finding.rule === "poltergeist")).toBe(true);
    expect(
      findings.some(
        (finding) =>
          finding.packageName === "soul-snatcher" && finding.title === "runs a postinstall script",
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
