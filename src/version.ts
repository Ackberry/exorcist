import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function readOwnVersion(): string {
  try {
    const file = fileURLToPath(new URL("../package.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
