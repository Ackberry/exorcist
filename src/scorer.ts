import type {
  Exorcism,
  Finding,
  InstalledPackage,
  OracleJudgment,
  PackageHaunting,
  Severity,
} from "./types.js";

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 45,
  high: 28,
  medium: 16,
  low: 8,
  info: 3,
};

/** Rule points at or above this become a remove exorcism. */
export const REMOVE_SCORE = 75;

/** A malicious verdict at or above this confidence also removes, even if the rule score is lower. */
export const MALICIOUS_CONFIDENCE = 0.5;

export const ORACLE_NUDGE: Record<OracleJudgment["verdict"], number> = {
  malicious: 20,
  suspicious: 8,
  benign: -18,
};

export function hauntingScore(
  findings: readonly Finding[],
  judgment: OracleJudgment | null,
): number {
  const fromRules = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHTS[finding.severity], 0);
  let score = Math.min(100, fromRules);
  if (judgment) {
    score += ORACLE_NUDGE[judgment.verdict] * judgment.confidence;
  }
  return Math.round(Math.min(100, Math.max(0, score)));
}

export function judgePackage(
  pkg: InstalledPackage,
  findings: readonly Finding[],
  judgment: OracleJudgment | null,
  oracleNote: string | null,
): PackageHaunting {
  const score = hauntingScore(findings, judgment);
  const decision = exorcismFor(pkg, findings, score, judgment);
  return {
    name: pkg.name,
    version: pkg.version,
    path: pkg.path,
    direct: pkg.direct,
    dev: pkg.dev,
    findings,
    judgment,
    oracleNote,
    hauntingScore: score,
    exorcism: decision.exorcism,
    exorcismReason: decision.exorcismReason,
  };
}

function exorcismFor(
  pkg: InstalledPackage,
  findings: readonly Finding[],
  score: number,
  judgment: OracleJudgment | null,
): { exorcism: Exorcism; exorcismReason: string } {
  const top = strongest(findings);
  if (judgment && judgment.verdict === "malicious" && judgment.confidence >= MALICIOUS_CONFIDENCE) {
    return {
      exorcism: "remove",
      exorcismReason: `The oracle called it malicious (${judgment.confidence.toFixed(2)}). Strongest signal: ${top.title}.`,
    };
  }
  if (score >= REMOVE_SCORE) {
    return {
      exorcism: "remove",
      exorcismReason: `Haunting score ${score}/100 is at least ${REMOVE_SCORE}. Strongest signal: ${top.title}.`,
    };
  }
  // Unused on its own stays a modest score. The action is still remove: the
  // dependency is attack surface the project does not call. Its points stack
  // with poltergeist, so an install script on an unused package scores higher.
  if (findings.some((finding) => finding.rule === "phantom")) {
    return {
      exorcism: "remove",
      exorcismReason: `Haunting score ${score}/100. ${pkg.name} is installed but never imported. Remove it. Strongest signal: ${top.title}.`,
    };
  }
  if (findings.some((finding) => finding.rule === "doppelganger")) {
    return {
      exorcism: "swap",
      exorcismReason: `Haunting score ${score}/100. The name looks like a typosquat. Swap it for the popular package it imitates. Strongest signal: ${top.title}.`,
    };
  }
  return {
    exorcism: "pin",
    exorcismReason: `Haunting score ${score}/100. Pin ${pkg.name}@${pkg.version} and read the flagged code before upgrading. Strongest signal: ${top.title}.`,
  };
}

function strongest(findings: readonly Finding[]): Finding {
  const rank: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const ordered = [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const top = ordered[0];
  if (!top) throw new Error("Cannot score a package with no findings.");
  return top;
}
