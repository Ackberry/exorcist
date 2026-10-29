import { errorMessage } from "./errors.js";
import type { Packument } from "./registry.js";
import { rules } from "./rules/index.js";
import type { Finding, InstalledPackage, RuleRun, ScanContext } from "./types.js";

export async function runRules(
  packages: readonly InstalledPackage[],
  rootDir: string,
  registry?: ReadonlyMap<string, Packument | null>,
): Promise<Finding[]> {
  const ctx: ScanContext = registry ? { rootDir, packages, registry } : { rootDir, packages };
  const findings: Finding[] = [];

  for (const rule of rules) {
    for (const pkg of packages) {
      try {
        const found = await rule.scan(pkg, ctx);
        findings.push(...found);
      } catch (error) {
        throw new Error(
          `${rule.kind} failed on ${pkg.name}@${pkg.version}: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    }
  }

  return findings;
}

export function groupFindings(findings: readonly Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = grouped.get(finding.lockKey);
    if (list) list.push(finding);
    else grouped.set(finding.lockKey, [finding]);
  }
  return grouped;
}

export function summarizeRules(findings: readonly Finding[]): RuleRun[] {
  return rules.map((rule) => ({
    kind: rule.kind,
    description: rule.description,
    status: rule.status,
    findings: findings.filter((finding) => finding.rule === rule.kind).length,
  }));
}
