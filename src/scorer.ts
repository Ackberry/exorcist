import { readNearMiss } from "./rules/doppelganger.js";
import { readPriorVersion } from "./rules/revenant.js";
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

/**
 * Sum of rule weights, capped at 100. This is the haunting score when Gemma
 * is not consulted, and the lowest haunting score a judgment can produce.
 */
export function ruleFloor(findings: readonly Finding[]): number {
  const total = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHTS[finding.severity], 0);
  return Math.min(100, total);
}

export function hauntingScore(
  findings: readonly Finding[],
  judgment: OracleJudgment | null,
): number {
  const floor = ruleFloor(findings);
  if (!judgment) return floor;
  // Impersonation alone stays on the rule floor. A model score of 90 must not
  // turn a typosquat into a remove. Other rules can still raise the score.
  if (impersonationOnly(findings, judgment)) return floor;
  // The model may raise the score. It cannot talk it down past the rule floor.
  return Math.round(Math.min(100, Math.max(floor, judgment.score)));
}

export function judgePackage(
  pkg: InstalledPackage,
  findings: readonly Finding[],
  judgment: OracleJudgment | null,
  oracleNote: string | null,
): PackageHaunting {
  const usable = withImpostorReason(pkg, findings, judgment);
  const score = hauntingScore(findings, usable);
  const decision = exorcismFor(pkg, findings, score, usable);
  return {
    name: pkg.name,
    version: pkg.version,
    path: pkg.path,
    direct: pkg.direct,
    dev: pkg.dev,
    findings,
    judgment: usable,
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
  // A name impersonation is a swap. Malicious/remove applies when another rule
  // already found harmful behavior, such as a poltergeist signal.
  if (
    !impersonationOnly(findings, judgment) &&
    judgment &&
    judgment.verdict === "malicious" &&
    judgment.confidence >= MALICIOUS_CONFIDENCE
  ) {
    return {
      exorcism: "remove",
      exorcismReason: `The oracle called it malicious (${judgment.confidence.toFixed(2)}). Strongest signal: ${top.title}.`,
    };
  }
  if (!impersonationOnly(findings, judgment) && score >= REMOVE_SCORE) {
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
  // History, not code: the useful action is to go back to the release before
  // the silence or the handover, not to pin the version already installed.
  const priorVersion = revenantPriorVersion(findings);
  if (priorVersion) {
    return {
      exorcism: "pin",
      exorcismReason: `Haunting score ${score}/100. Pin ${pkg.name}@${priorVersion}, the release before the break, and read the changes since. Strongest signal: ${top.title}.`,
    };
  }

  const swapFor = nearMissTarget(findings);
  if (swapFor) {
    return {
      exorcism: "swap",
      exorcismReason: `Haunting score ${score}/100. Swap ${pkg.name} for ${swapFor}. Strongest signal: ${top.title}.`,
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

function impersonationOnly(findings: readonly Finding[], judgment: OracleJudgment | null): boolean {
  return (
    judgment?.impersonating === true && findings.every((finding) => finding.rule === "doppelganger")
  );
}

/** A reason that is empty or only the target name is not a sentence. */
function usableReason(text: string, realName: string, installedName: string): boolean {
  const bare = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  if (bare.length < 12) return false;
  const names = new Set([realName.trim().toLowerCase(), installedName.trim().toLowerCase()]);
  if (names.has(bare)) return false;
  if (/^(not an )?impostor of \S+$/.test(bare)) return false;
  return true;
}

function withImpostorReason(
  pkg: InstalledPackage,
  findings: readonly Finding[],
  judgment: OracleJudgment | null,
): OracleJudgment | null {
  if (judgment?.impersonating !== true) return judgment;
  const realName = judgment.impersonationOf ?? nearMissTarget(findings);
  if (!realName) return judgment;
  const fallback = `${pkg.name} claims to be ${realName} under a different name.`;
  return {
    ...judgment,
    summary: usableReason(judgment.summary, realName, pkg.name) ? judgment.summary : fallback,
    explanation: usableReason(judgment.explanation, realName, pkg.name)
      ? judgment.explanation
      : fallback,
  };
}

function revenantPriorVersion(findings: readonly Finding[]): string | null {
  for (const finding of findings) {
    if (finding.rule !== "revenant") continue;
    const version = readPriorVersion(finding.detail);
    if (version) return version;
  }
  return null;
}

function nearMissTarget(findings: readonly Finding[]): string | null {
  for (const finding of findings) {
    if (finding.rule !== "doppelganger") continue;
    const target = readNearMiss(finding.detail);
    if (target) return target;
  }
  return null;
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
