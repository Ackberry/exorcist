import { AsyncLocalStorage } from "node:async_hooks";
import type {
  SpanOutputProcessor,
  TracingContext,
  TracingOptions,
} from "@mastra/core/observability";
import type { AnyWorkflow } from "@mastra/core/workflows";
import { errorMessage } from "./errors.js";

const judgeTrace = new AsyncLocalStorage<TracingContext>();

function sentryDsn(): string | undefined {
  const dsn = process.env.SENTRY_DSN?.trim();
  return dsn ? dsn : undefined;
}

/** Package text and prompts stay off the trace unless this is `1` or `true`. */
function recordTraceContent(): boolean {
  const flag = process.env.SENTRY_TRACE_CONTENT?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function withJudgeTrace<T>(
  tracing: TracingContext | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!tracing?.currentSpan) return run();
  return judgeTrace.run(tracing, run);
}

export function judgeTraceContext(): TracingContext | undefined {
  return judgeTrace.getStore();
}

/** The exporter copies agent instructions even when span input is hidden. */
const metadataOnly: SpanOutputProcessor = {
  name: "exorcist-metadata-only",
  process(span) {
    const attributes = span?.attributes as { instructions?: unknown; prompt?: unknown } | undefined;
    if (attributes) {
      delete attributes.instructions;
      delete attributes.prompt;
    }
    return span;
  },
  async shutdown() {},
};

export interface SentryTracing {
  options: TracingOptions;
  flush: () => Promise<void>;
}

/**
 * Mastra's Sentry exporter, only when SENTRY_DSN is set.
 * https://mastra.ai/docs/observability/tracing/exporters/sentry
 */
export async function enableSentryTracing(
  workflow: AnyWorkflow,
): Promise<SentryTracing | undefined> {
  const dsn = sentryDsn();
  if (!dsn) return undefined;
  try {
    const { Mastra } = await import("@mastra/core/mastra");
    const { Observability } = await import("@mastra/observability");
    const { SentryExporter } = await import("@mastra/sentry");
    const recordContent = recordTraceContent();
    const exporter = new SentryExporter({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || "local",
      tracesSampleRate: 1,
      options: {
        sendDefaultPii: false,
        dataCollection: {
          genAI: { inputs: recordContent, outputs: recordContent },
          httpBodies: [],
        },
      },
    });
    const observability = new Observability({
      configs: {
        sentry: {
          serviceName: "exorcist",
          exporters: [exporter],
          ...(recordContent ? {} : { spanOutputProcessors: [metadataOnly] }),
        },
      },
    });
    const mastra = new Mastra({
      workflows: { haunt: workflow },
      observability,
      logger: false,
      workers: false,
    });
    return {
      options: { hideInput: !recordContent, hideOutput: !recordContent },
      flush: async () => {
        try {
          await mastra.observability.flush();
          await mastra.observability.shutdown();
        } catch (error) {
          console.error(`Sentry tracing flush failed: ${errorMessage(error)}`);
        }
      },
    };
  } catch (error) {
    console.error(`Sentry tracing disabled: ${errorMessage(error)}`);
    return undefined;
  }
}
