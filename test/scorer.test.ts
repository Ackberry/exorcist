import { describe, expect, it } from "vitest";
import {
  hauntingScore,
  judgePackage,
  MALICIOUS_CONFIDENCE,
  REMOVE_SCORE,
  SEVERITY_WEIGHTS,
} from "../src/scorer.js";
import type { Finding, InstalledPackage, OracleJudgment } from "../src/types.js";

const pkg: InstalledPackage = {
  name: "lodasg",
  version: "1.0.0",
  lockKey: "node_modules/lodasg",
  path: null,
  manifest: null,
  direct: true,
  dev: false,
};

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    rule: "poltergeist",
    lockKey: pkg.lockKey,
    packageName: pkg.name,
    version: pkg.version,
    severity: "high",
    title: "spawns child processes",
    detail: "child_process",
    evidence: null,
    evidencePath: null,
    ...overrides,
  };
}

function judgment(overrides: Partial<OracleJudgment> = {}): OracleJudgment {
  return {
    verdict: "suspicious",
    confidence: 1,
    summary: "It reaches for a shell.",
    explanation: "child_process is unused.",
    ...overrides,
  };
}

describe("scorer", () => {
  it("sums rule weights and caps them at 100 before the oracle nudge", () => {
    const high = finding();
    expect(hauntingScore([high], null)).toBe(SEVERITY_WEIGHTS.high);
    const criticals = Array.from({ length: 4 }, () =>
      finding({ severity: "critical", title: "runs a postinstall script" }),
    );
    expect(hauntingScore(criticals, null)).toBe(100);
    expect(hauntingScore(criticals, judgment({ verdict: "benign", confidence: 1 }))).toBe(82);
  });

  it("pins, swaps, or removes from the score and the verdict", () => {
    expect(judgePackage(pkg, [finding()], null, null)).toMatchObject({
      hauntingScore: 28,
      exorcism: "pin",
    });

    const severe = [
      finding({ severity: "critical", title: "runs a postinstall script" }),
      finding({ severity: "medium", title: "reads process.env" }),
      finding({ severity: "medium", title: "contains a base64 payload" }),
    ];
    expect(SEVERITY_WEIGHTS.critical + SEVERITY_WEIGHTS.medium * 2).toBeGreaterThanOrEqual(
      REMOVE_SCORE,
    );
    expect(judgePackage(pkg, severe, null, null).exorcism).toBe("remove");

    const doppel = finding({
      rule: "doppelganger",
      title: "name is close to lodash",
      severity: "high",
    });
    expect(judgePackage(pkg, [doppel], null, null).exorcism).toBe("swap");
    expect(judgePackage(pkg, [doppel, ...severe], null, null).exorcism).toBe("remove");

    const mild = [finding()];
    expect(
      judgePackage(
        pkg,
        mild,
        judgment({ verdict: "malicious", confidence: MALICIOUS_CONFIDENCE }),
        null,
      ).exorcism,
    ).toBe("remove");
    expect(
      judgePackage(pkg, mild, judgment({ verdict: "malicious", confidence: 0.4 }), null).exorcism,
    ).toBe("pin");
  });
});
