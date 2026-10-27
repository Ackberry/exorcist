import { describe, expect, it } from "vitest";
import { doppelgangerRule, phantomRule, revenantRule } from "../src/rules/index.js";
import { fixturePackage } from "./helpers.js";

describe("stub rules", () => {
  it("return no findings", () => {
    const pkg = fixturePackage({ name: "lodasg", lockKey: "node_modules/lodasg" });
    const ctx = { rootDir: "/", packages: [pkg] };
    expect(doppelgangerRule.status).toBe("stub");
    expect(revenantRule.status).toBe("stub");
    expect(phantomRule.status).toBe("stub");
    expect(doppelgangerRule.scan(pkg, ctx)).toEqual([]);
    expect(revenantRule.scan(pkg, ctx)).toEqual([]);
    expect(phantomRule.scan(pkg, ctx)).toEqual([]);
  });
});
