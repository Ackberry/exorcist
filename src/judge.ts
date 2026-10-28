import { Agent } from "@mastra/core/agent";
import { createOllama } from "ollama-ai-provider-v2";
import { normalizeEndpoint } from "./endpoint.js";
import { errorMessage, OracleError } from "./errors.js";
import {
  buildChatRequest,
  CONSULT_TIMEOUT_MS,
  type ConsultInput,
  JUDGMENT_SCHEMA,
  LOOKALIKE_SCHEMA,
  lookalikeOf,
  parseJudgment,
} from "./oracle.js";
import { judgeTraceContext } from "./tracing.js";
import type { OracleJudgment } from "./types.js";

/**
 * gemma3:4b on Ollama 0.40.11 answers
 * `registry.ollama.ai/library/gemma3:4b does not support tools`.
 * This agent has no tools. Structured output goes out as Ollama's `format` schema.
 */
const JUDGE_ID = "gemma-judge";

export async function generateJudgment(input: ConsultInput): Promise<OracleJudgment> {
  const drafted = buildChatRequest(input);
  const resembles = lookalikeOf(input.findings);
  const system = drafted.messages.find((message) => message.role === "system")?.content ?? "";
  const user = drafted.messages.find((message) => message.role === "user")?.content ?? "";
  const endpoint = normalizeEndpoint(input.target.endpoint);
  const ollama = createOllama({
    baseURL: `${endpoint}/api`,
    fetch: oracleFetch,
  });
  const agent = new Agent({
    id: JUDGE_ID,
    name: "Gemma judge",
    instructions: system,
    // Mastra adapts this provider model when the call runs. Its public model
    // type expects doGenerate to return a stream, which this provider does not.
    model: ollama(input.target.model) as never,
    maxRetries: 0,
  });

  let text: string;
  const tracingContext = judgeTraceContext();
  try {
    const response = await agent.generate(user, {
      structuredOutput: {
        schema: JSON.parse(JSON.stringify(resembles ? LOOKALIKE_SCHEMA : JUDGMENT_SCHEMA)),
        errorStrategy: "warn",
      },
      modelSettings: { temperature: 0, maxRetries: 0 },
      maxSteps: 1,
      toolChoice: "none",
      providerOptions: {
        ollama: { options: { temperature: 0 } },
      },
      ...(tracingContext ? { tracingContext } : {}),
    });
    const raw = typeof response.text === "string" ? response.text.trim() : "";
    text = raw.length > 0 ? response.text : JSON.stringify(response.object ?? "");
  } catch (error) {
    const oracle = findOracleError(error);
    if (oracle) throw oracle;
    throw new OracleError(errorMessage(error));
  }

  const judgment = parseJudgment(text, resembles !== null);
  return resembles ? { ...judgment, impersonationOf: resembles } : judgment;
}

function findOracleError(error: unknown): OracleError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof OracleError) return current;
    seen.add(current);
    current = current.cause;
  }
  return null;
}

interface ChatAttempt {
  response: Response;
  retried: boolean;
}

type PostResult = { ok: true; response: Response } | { ok: false; error: unknown };

/**
 * One extra attempt when the chat call throws or Ollama returns 5xx.
 * A 400 on a JSON schema is sent again once with `"format": "json"`.
 * gemma3:4b on Windows has answered a second back-to-back call with
 * HTTP 500 "llama-server process has terminated".
 */
const oracleFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  if (!url.includes("/api/chat")) return globalThis.fetch(input, init);

  let attempt = await postChatAllowingOneRetry(input, init);
  if (attempt.response.status === 400 && schemaFormat(init)) {
    await discardBody(attempt.response);
    attempt = await postChatAllowingOneRetry(input, withFormatJson(init));
  }
  if (!attempt.response.ok) throw await httpError(url, attempt.response, attempt.retried);
  return attempt.response;
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

async function postChatAllowingOneRetry(input: FetchInput, init: FetchInit): Promise<ChatAttempt> {
  const first = await tryPostChat(input, init);
  if (first.ok && first.response.status < 500) {
    return { response: first.response, retried: false };
  }
  if (first.ok) await discardBody(first.response);
  const second = await tryPostChat(input, init);
  if (second.ok) return { response: second.response, retried: true };
  throw new OracleError(`${errorMessage(second.error)} (retried once)`);
}

async function tryPostChat(input: FetchInput, init: FetchInit): Promise<PostResult> {
  try {
    return {
      ok: true,
      response: await globalThis.fetch(input, {
        ...init,
        signal: AbortSignal.timeout(CONSULT_TIMEOUT_MS),
      }),
    };
  } catch (error) {
    const endpoint = requestUrl(input).replace(/\/api\/chat$/, "");
    return {
      ok: false,
      error: new OracleError(`Could not reach Ollama at ${endpoint}: ${errorMessage(error)}`),
    };
  }
}

function schemaFormat(init: RequestInit | undefined): boolean {
  const format = readFormat(init);
  return typeof format === "object" && format !== null;
}

function withFormatJson(init: RequestInit | undefined): RequestInit {
  const raw = readBody(init?.body);
  if (!raw) return { ...init };
  const parsed = JSON.parse(raw) as { format?: unknown };
  parsed.format = "json";
  return { ...init, body: JSON.stringify(parsed) };
}

function readFormat(init: RequestInit | undefined): unknown {
  const raw = readBody(init?.body);
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw) as { format?: unknown }).format;
  } catch {
    return undefined;
  }
}

function readBody(body: RequestInit["body"]): string | null {
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return null;
}

async function httpError(url: string, response: Response, retried: boolean): Promise<OracleError> {
  const text = (await response.text()).replaceAll(/\s+/g, " ").slice(0, 300);
  const endpoint = url.replace(/\/api\/chat$/, "");
  const retryNote = retried ? " after one retry" : "";
  return new OracleError(
    `Ollama returned ${response.status} from ${endpoint}/api/chat${retryNote}: ${text}`,
  );
}

function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be closed.
  }
}
