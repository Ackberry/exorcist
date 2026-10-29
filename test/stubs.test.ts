import { describe, expect, it } from "vitest";
import { rules } from "../src/rules/index.js";

describe("rule registry", () => {
  it("every registered rule reports an active status", () => {
    expect(rules.map((rule) => rule.kind)).toEqual([
      "poltergeist",
      "doppelganger",
      "revenant",
      "phantom",
    ]);
    expect(rules.filter((rule) => rule.status === "stub")).toEqual([]);
  });
});
