import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import { CliError } from "../src/errors.js";

describe("parseArgs", () => {
  it("defaults to the local Gemma model and the current directory", () => {
    expect(parseArgs([], {})).toMatchObject({
      targetPath: ".",
      model: "gemma3:4b",
      endpoint: "http://localhost:11434",
      consultOracle: true,
      reportPath: "haunting-report.md",
      json: false,
      failOn: null,
      help: false,
    });
  });

  it("reads --fail-on in both forms", () => {
    expect(parseArgs(["--fail-on", "75"], {})).toMatchObject({ failOn: 75 });
    expect(parseArgs(["--fail-on=0"], {})).toMatchObject({ failOn: 0 });
    expect(parseArgs(["--fail-on", "100"], {})).toMatchObject({ failOn: 100 });
  });

  it("rejects a --fail-on that is not a score", () => {
    expect(() => parseArgs(["--fail-on", "abc"], {})).toThrow(CliError);
    expect(() => parseArgs(["--fail-on", "101"], {})).toThrow(/above 100/);
    expect(() => parseArgs(["--fail-on", "7.5"], {})).toThrow(/whole number/);
    expect(() => parseArgs(["--fail-on"], {})).toThrow(/Missing value/);
  });

  it("reads --json", () => {
    expect(parseArgs(["demo/victim", "--json"], {})).toMatchObject({
      targetPath: "demo/victim",
      json: true,
    });
  });

  it("reads flags and Ollama env vars", () => {
    expect(
      parseArgs(["demo/victim", "--model", "gemma3:1b", "--no-oracle", "--report", "out.md"], {
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_MODEL: "ignored-because-flag-wins",
      }),
    ).toMatchObject({
      targetPath: "demo/victim",
      model: "gemma3:1b",
      endpoint: "http://127.0.0.1:11434",
      consultOracle: false,
      reportPath: "out.md",
    });

    expect(parseArgs(["--model=gemma3:1b"], { OLLAMA_MODEL: "from-env" }).model).toBe("gemma3:1b");
    expect(parseArgs([], { OLLAMA_MODEL: "from-env" }).model).toBe("from-env");
  });

  it("rejects an unknown flag and a missing value", () => {
    expect(() => parseArgs(["--wat"])).toThrow(CliError);
    expect(() => parseArgs(["--model"])).toThrow(/Missing value/);
    expect(() => parseArgs(["one", "two"])).toThrow(/Unexpected argument/);
    expect(() => parseArgs(["--endpoint", "http://user:pass@evil.test"])).toThrow(/username/);
    expect(() => parseArgs(["--model", "gemma3:4b\n"])).toThrow(/control characters/);
  });
});
