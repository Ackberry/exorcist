import { normalizeEndpoint } from "./endpoint.js";
import { errorMessage, OracleError } from "./errors.js";
import type { Finding, InstalledPackage, OracleJudgment, Verdict } from "./types.js";

export const DEFAULT_MODEL = "gemma3:4b";
export const DEFAULT_ENDPOINT = "http://localhost:11434";
export const PROBE_TIMEOUT_MS = 2_000;
export const CONSULT_TIMEOUT_MS = 90_000;
export const SUSPECT_CODE_CHAR_BUDGET = 6_000;

const VERDICTS: readonly Verdict[] = ["benign", "suspicious", "malicious"];

export const JUDGMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["benign", "suspicious", "malicious"] },
    confidence: { type: "number" },
    summary: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["verdict", "confidence", "summary", "explanation"],
} as const;

const SYSTEM_PROMPT = `You are the oracle in Exorcist, a local scanner for risky npm packages.
A rule already flagged the code below. Read it and answer in JSON only.
Use this shape:
{"verdict":"benign"|"suspicious"|"malicious","confidence":0.0,"summary":"what the code does, in plain English","explanation":"why this verdict"}
confidence is a number from 0 to 1.
verdict is malicious only when the code would steal data, run a payload, or harm a machine.
verdict is suspicious when the code is obfuscated or reaches for install hooks, shells, the network, or secrets, but the harm is incomplete or unclear.
verdict is benign when the flagged pattern is harmless in context.
Demo fixtures and code that only pretends to misbehave are not malicious.
Do not wrap the JSON in markdown.`;

export interface OracleTarget {
  endpoint: string;
  model: string;
}

export interface ConsultInput {
  target: OracleTarget;
  pkg: InstalledPackage;
  findings: readonly Finding[];
}

export interface OracleProbeResult {
  available: boolean;
  model: string;
  endpoint: string;
  message: string;
}

export interface OracleClient {
  probe(target: OracleTarget): Promise<OracleProbeResult>;
  consult(input: ConsultInput): Promise<OracleJudgment>;
}

export interface ChatRequest {
  model: string;
  stream: false;
  format: typeof JUDGMENT_SCHEMA | "json";
  messages: { role: "system" | "user"; content: string }[];
  options: { temperature: number };
}

export function buildSuspectExcerpt(findings: readonly Finding[]): string {
  const blocks = findings.map((finding) => {
    const where = finding.evidencePath ? ` (${finding.evidencePath})` : "";
    const body = finding.evidence?.trim() || "(no code snippet)";
    return `// ${finding.rule}: ${finding.title}${where}\n${body}`;
  });
  const combined = blocks.join("\n\n");
  if (combined.length <= SUSPECT_CODE_CHAR_BUDGET) return combined;
  const omitted = combined.length - SUSPECT_CODE_CHAR_BUDGET;
  return `${combined.slice(0, SUSPECT_CODE_CHAR_BUDGET)}\n\n/* truncated ${omitted} characters to fit the model context */`;
}

export function buildChatRequest(
  input: ConsultInput,
  format: ChatRequest["format"] = JUDGMENT_SCHEMA,
): ChatRequest {
  const excerpt = buildSuspectExcerpt(input.findings);
  const lines = [
    `Package: ${input.pkg.name}@${input.pkg.version}`,
    input.pkg.path ? `Path: ${input.pkg.path}` : "Path: not on disk",
    "",
    "Rule findings:",
    ...input.findings.map(
      (finding) => `- [${finding.rule}/${finding.severity}] ${finding.title}. ${finding.detail}`,
    ),
    "",
    "Flagged code (may be truncated):",
    excerpt,
  ];
  return {
    model: input.target.model,
    stream: false,
    format,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: lines.join("\n") },
    ],
    options: { temperature: 0 },
  };
}

export async function probe(target: OracleTarget): Promise<OracleProbeResult> {
  const endpoint = normalizeEndpoint(target.endpoint);
  const base = { model: target.model, endpoint };
  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ...base,
        available: false,
        message: `Ollama at ${endpoint} returned ${response.status} from /api/tags. Report built from rules only.`,
      };
    }
    const names = await readModelNames(response);
    if (names === null) {
      return {
        ...base,
        available: true,
        message: `Ollama responded at ${endpoint}, but the model list was unreadable. Consultation will try ${target.model} anyway.`,
      };
    }
    if (!names.includes(target.model)) {
      const preview = names.slice(0, 8).join(", ") || "(none)";
      return {
        ...base,
        available: false,
        message: `Ollama is running at ${endpoint}, but ${target.model} is not pulled. Installed: ${preview}. Run: ollama pull ${target.model}. Report built from rules only.`,
      };
    }
    return {
      ...base,
      available: true,
      message: `Oracle is listening (${target.model} at ${endpoint}).`,
    };
  } catch (error) {
    return {
      ...base,
      available: false,
      message: describeProbeFailure(error, endpoint, target.model),
    };
  }
}

export async function consult(input: ConsultInput): Promise<OracleJudgment> {
  const endpoint = normalizeEndpoint(input.target.endpoint);
  const first = await postChat(endpoint, buildChatRequest(input, JUDGMENT_SCHEMA));
  const response =
    first.status === 400 ? await postChat(endpoint, buildChatRequest(input, "json")) : first;
  if (!response.ok) {
    const text = (await response.text()).replaceAll(/\s+/g, " ").slice(0, 300);
    throw new OracleError(`Ollama returned ${response.status} from ${endpoint}/api/chat: ${text}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OracleError("Ollama returned a chat response that was not JSON.");
  }
  const content = readChatContent(body);
  if (content === null) {
    throw new OracleError("Ollama returned a chat response with no message content.");
  }
  return parseJudgment(content);
}

export const ollamaClient: OracleClient = { probe, consult };

/** Parse and validate the model's JSON. Throws OracleError when it does not match. */
export function parseJudgment(content: string): OracleJudgment {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(content)) as unknown;
  } catch {
    throw new OracleError("Oracle returned text that was not JSON.");
  }
  const judgment = validateJudgment(value);
  if (!judgment) {
    throw new OracleError(
      "Oracle JSON did not match the verdict schema (verdict, confidence, summary, explanation).",
    );
  }
  return judgment;
}

export function validateJudgment(value: unknown): OracleJudgment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const verdict = typeof record.verdict === "string" ? record.verdict.trim().toLowerCase() : "";
  if (!VERDICTS.includes(verdict as Verdict)) return null;
  const confidence = asConfidence(record.confidence);
  const summary = asText(record.summary);
  const explanation = asText(record.explanation);
  if (confidence === null || summary === null || explanation === null) return null;
  return {
    verdict: verdict as Verdict,
    confidence,
    summary: summary.slice(0, 2_000),
    explanation: explanation.slice(0, 2_000),
  };
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start !== -1 && end > start) return body.slice(start, end + 1);
  return body;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asConfidence(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  const scaled = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  if (scaled < 0 || scaled > 1) return null;
  return scaled;
}

async function postChat(endpoint: string, body: ChatRequest): Promise<Response> {
  try {
    return await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONSULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OracleError(`Could not reach Ollama at ${endpoint}: ${errorMessage(error)}`);
  }
}

function readChatContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

async function readModelNames(response: Response): Promise<string[] | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;
  const names: string[] = [];
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { name?: unknown; model?: unknown };
    if (typeof record.name === "string") names.push(record.name);
    else if (typeof record.model === "string") names.push(record.model);
  }
  return names;
}

function describeProbeFailure(error: unknown, endpoint: string, model: string): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `Timed out contacting Ollama at ${endpoint}. Report built from rules only.`;
  }
  const code = readCauseCode(error);
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNRESET"
  ) {
    return `Ollama is not running at ${endpoint}. Start it and run \`ollama pull ${model}\`. Report built from rules only.`;
  }
  return `Could not reach Ollama at ${endpoint} (${errorMessage(error)}). Report built from rules only.`;
}

function readCauseCode(error: unknown): string {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null)
    return "";
  const code = (error.cause as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}
