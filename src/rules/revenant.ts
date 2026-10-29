import type { Packument, PackumentMaintainer } from "../registry.js";
import type { Finding, InstalledPackage, Rule, ScanContext } from "../types.js";
import { oneLineUntrusted } from "../untrusted.js";

/** Silence before a new release that makes the release worth a second look. */
export const SILENCE_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRIOR_VERSION = /\bLast release before that was (\S+?)\.?(?:\s|$)/;

/** The version to pin to: the release before the silence or the handover. */
export function readPriorVersion(detail: string): string | null {
  return PRIOR_VERSION.exec(detail.trim())?.[1] ?? null;
}

export const revenantRule: Rule = {
  kind: "revenant",
  status: "active",
  description: "Abandoned package that ships again under a new maintainer or after a long silence.",
  scan(pkg, ctx) {
    return scanRevenant(pkg, ctx);
  },
};

function scanRevenant(pkg: InstalledPackage, ctx: ScanContext): Finding[] {
  // No client was supplied, or this package was never asked about. Either way
  // there is no history to read, and the scan carries on without it.
  const packument = ctx.registry?.get(pkg.name);
  if (!packument) return [];

  const releases = releaseTimeline(packument);
  const current = releases.findIndex((release) => release.version === pkg.version);
  if (current < 1) return [];

  const installed = releases[current];
  const previous = releases[current - 1];
  if (!installed || !previous) return [];

  const findings: Finding[] = [];
  const gapDays = Math.floor((installed.at - previous.at) / MS_PER_DAY);
  const timeline = buildTimeline(previous, installed, gapDays);

  if (gapDays >= SILENCE_DAYS) {
    findings.push(
      finding(
        pkg,
        `woke up after ${gapDays} days`,
        `${pkg.name}@${installed.version} was published ${gapDays} days after the release before it. Last release before that was ${previous.version}.`,
        timeline,
      ),
    );
  }

  const gained = [...installed.maintainers].filter((who) => !previous.maintainers.has(who));
  if (previous.maintainers.size > 0 && installed.maintainers.size > 0 && gained.length > 0) {
    findings.push(
      finding(
        pkg,
        "new maintainer on the installed version",
        `${pkg.name}@${installed.version} was published with a maintainer the previous release did not have: ${oneLineUntrusted(gained.join(", "), 200)}. Last release before that was ${previous.version}.`,
        timeline,
      ),
    );
  }

  return findings;
}

interface Release {
  version: string;
  at: number;
  maintainers: Set<string>;
}

/**
 * Releases in publish order. `time` also holds `created` and `modified`, and it
 * can name versions the registry has since unpublished, so both maps must agree.
 */
function releaseTimeline(packument: Packument): Release[] {
  const times = packument.time ?? {};
  const versions = packument.versions ?? {};
  const releases: Release[] = [];
  for (const [version, stamp] of Object.entries(times)) {
    if (version === "created" || version === "modified") continue;
    const entry = versions[version];
    if (!entry) continue;
    const at = Date.parse(stamp);
    if (!Number.isFinite(at)) continue;
    releases.push({ version, at, maintainers: maintainerNames(entry.maintainers) });
  }
  releases.sort((a, b) => a.at - b.at);
  return releases;
}

function maintainerNames(maintainers: readonly PackumentMaintainer[] | undefined): Set<string> {
  const names = new Set<string>();
  for (const maintainer of maintainers ?? []) {
    const name = maintainer.name?.trim();
    if (name) names.add(name);
  }
  return names;
}

/** Registry text is untrusted, the same as a package README. */
function buildTimeline(previous: Release, installed: Release, gapDays: number): string {
  return [
    `${isoDay(previous.at)}  ${previous.version}  maintainers: ${listNames(previous.maintainers)}`,
    `            ${gapDays} days`,
    `${isoDay(installed.at)}  ${installed.version}  maintainers: ${listNames(installed.maintainers)}`,
  ].join("\n");
}

function listNames(names: ReadonlySet<string>): string {
  if (names.size === 0) return "(none listed)";
  return oneLineUntrusted([...names].join(", "), 200);
}

function isoDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function finding(pkg: InstalledPackage, title: string, detail: string, evidence: string): Finding {
  return {
    rule: "revenant",
    lockKey: pkg.lockKey,
    packageName: pkg.name,
    version: pkg.version,
    // Suspicious circumstance, not proven harm. Two medium signals total 32,
    // which stays well under REMOVE_SCORE on their own.
    severity: "medium",
    title,
    detail,
    evidence,
    // The evidence is registry history, not a file in the package.
    evidencePath: null,
  };
}
