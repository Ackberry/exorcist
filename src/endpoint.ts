import { CliError } from "./errors.js";

/** Accept `http://host:port` or a bare `host:port`, and drop a trailing slash. */
export function normalizeEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed === "") {
    throw new CliError("Ollama endpoint is empty.");
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
