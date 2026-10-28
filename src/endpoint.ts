import { CliError } from "./errors.js";
import { hasControlChar } from "./untrusted.js";

/**
 * Accept `http://host:port` or a bare `host:port`.
 * The result is an origin: path, query, hash, and userinfo are not kept.
 * `http://127.0.0.1:11434@evil.example` is a different host, so it is rejected.
 */
export function normalizeEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed === "") {
    throw new CliError("Ollama endpoint is empty.");
  }
  if (hasControlChar(trimmed) || trimmed.includes(" ")) {
    throw new CliError("Ollama endpoint contains whitespace or control characters.");
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CliError("Ollama endpoint is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("Ollama endpoint must be http or https.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new CliError("Ollama endpoint must not include a username or password.");
  }
  if (url.hostname === "") {
    throw new CliError("Ollama endpoint is missing a host.");
  }
  return url.origin;
}
