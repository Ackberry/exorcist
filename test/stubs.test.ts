import { describe, expect, it } from "vitest";
import { revenantRule } from "../src/rules/index.js";
import { fixturePackage } from "./helpers.js";

describe("stub rules", () => {
  it("revenant returns no findings", () => {
    const pkg = fixturePackage({ name: "lodasg", lockKey: "node_modules/lodasg" });
    const ctx = { rootDir: "/", packages: [pkg] };
    expect(revenantRule.status).toBe("stub");
    expect(revenantRule.scan(pkg, ctx)).toEqual([]);
  });
});
