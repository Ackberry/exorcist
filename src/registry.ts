/**
 * npm registry lookups for the revenant rule. This is the only part of a scan
 * that talks to a third party, so every failure here is survivable: a scan with
 * no network still produces a report from the other three rules.
 */

/** Per request. Between the oracle's probe (2s) and a consult (90s). */
export const PACKUMENT_TIMEOUT_MS = 10_000;

/** Wall clock for the whole prefetch. Packages still unfetched are skipped. */
export const PREFETCH_BUDGET_MS = 60_000;

/** Requests in flight at once. */
export const PREFETCH_CONCURRENCY = 8;

/**
 * A packument larger than this is dropped. Observed sizes are far under it:
 * keyv is about 286 KB and lodash about 248 KB.
 */
export const MAX_PACKUMENT_BYTES = 8 * 1024 * 1024;

/**
 * Consecutive transport failures, with nothing fetched yet, that end the
 * prefetch. Without this an unplugged network costs the whole budget.
 */
const OFFLINE_STRIKES = 3;

const REGISTRY_BASE = "https://registry.npmjs.org";

export interface PackumentMaintainer {
  name?: string;
}

export interface PackumentVersion {
  maintainers?: readonly PackumentMaintainer[];
}

/**
 * The fields revenant reads. The abbreviated packument
 * (`Accept: application/vnd.npm.install-v1+json`) carries neither `time` nor
 * `maintainers`, so this has to be the full document.
 */
export interface Packument {
  name?: string;
  /** Version to ISO date, plus the `created` and `modified` keys. */
  time?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
}

export interface RegistryClient {
  /** Null when the package is not on the registry or could not be read. */
  packument(name: string): Promise<Packument | null>;
}

export interface PrefetchResult {
  /** Name to packument. A null value means asked and not available. */
  packuments: Map<string, Packument | null>;
  /** One line for the report when the registry could not be read in full. */
  note: string | null;
}

/** A transport failure, as opposed to a registry answer of "no such package". */
export class RegistryUnreachable extends Error {}

export const npmRegistryClient: RegistryClient = {
  packument: (name) => fetchPackument(name),
};

/**
 * Packages worth a registry lookup. A `file:` or linked package has no registry
 * identity, so the demo fixtures cost no requests and the demo stays offline.
 */
export function registryCandidates(
  packages: readonly { name: string; linked: boolean }[],
): string[] {
  const names = new Set<string>();
  for (const pkg of packages) {
    if (pkg.linked) continue;
    if (pkg.name.trim() === "") continue;
    names.add(pkg.name);
  }
  return [...names].sort();
}

/**
 * Fetch every candidate before the rule loop, so revenant itself stays
 * synchronous and the scan does not make one serial request per package.
 */
export async function prefetchPackuments(
  packages: readonly { name: string; linked: boolean }[],
  client: RegistryClient,
  budgetMs = PREFETCH_BUDGET_MS,
): Promise<PrefetchResult> {
  const names = registryCandidates(packages);
  const packuments = new Map<string, Packument | null>();
  if (names.length === 0) return { packuments, note: null };

  const deadline = Date.now() + budgetMs;
  let next = 0;
  let unreachable = 0;
  let strikes = 0;
  let fetched = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    while (!stopped) {
      const index = next++;
      const name = names[index];
      if (name === undefined) return;
      if (Date.now() >= deadline) {
        stopped = true;
        return;
      }
      try {
        packuments.set(name, await client.packument(name));
        fetched++;
        strikes = 0;
      } catch (error) {
        packuments.set(name, null);
        if (error instanceof RegistryUnreachable) {
          unreachable++;
          // Only count a run of failures while nothing has succeeded. One flaky
          // package on a working connection should not end the prefetch.
          strikes = fetched === 0 ? strikes + 1 : 0;
          if (strikes >= OFFLINE_STRIKES) stopped = true;
        }
      }
    }
  };

  const workers = Math.min(PREFETCH_CONCURRENCY, names.length);
  await Promise.all(Array.from({ length: workers }, worker));

  const missed = names.length - packuments.size;
  return { packuments, note: prefetchNote(names.length, unreachable, missed) };
}

function prefetchNote(total: number, unreachable: number, missed: number): string | null {
  if (unreachable === 0 && missed === 0) return null;
  const skipped = unreachable + missed;
  if (skipped >= total) {
    return `The npm registry could not be reached. Revenant checked no package history; the other rules ran normally.`;
  }
  return `The npm registry answered for ${total - skipped} of ${total} packages. Revenant did not check history for the other ${skipped}.`;
}

async function fetchPackument(name: string): Promise<Packument | null> {
  const url = `${REGISTRY_BASE}/${encodePackageName(name)}`;
  let response = await getOrThrow(url);
  if (response.status >= 500) {
    // One retry, the same budget the oracle gives a 5xx from Ollama.
    await discardBody(response);
    response = await getOrThrow(url);
  }
  if (response.status === 404) {
    await discardBody(response);
    return null;
  }
  if (!response.ok) {
    await discardBody(response);
    throw new RegistryUnreachable(`Registry answered ${response.status} for ${name}.`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PACKUMENT_BYTES) {
    await discardBody(response);
    return null;
  }
  const text = await response.text();
  if (text.length > MAX_PACKUMENT_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Packument;
  } catch {
    return null;
  }
}

async function getOrThrow(url: string): Promise<Response> {
  try {
    return await globalThis.fetch(url, {
      // A redirect off the registry is not followed, the same rule the oracle uses.
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PACKUMENT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RegistryUnreachable(error instanceof Error ? error.message : String(error));
  }
}

/** `@scope/name` keeps its slash on the registry; the rest is percent encoded. */
function encodePackageName(name: string): string {
  return name
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // The body is being thrown away. A failure to drain it changes nothing.
  }
}
