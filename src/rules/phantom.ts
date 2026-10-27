import type { Rule } from "../types.js";

export const phantomRule: Rule = {
  kind: "phantom",
  status: "stub",
  description: "Installed dependency that the project never imports.",
  scan() {
    // TODO(Wed): flag a direct dependency that the target project never imports.
    // Read the project source (not dependency source) for require() and import
    // specifiers. Bin packages and config-only plugins are named in package.json
    // scripts or config files; don't flag those blindly.
    // demo/victim/src/app.js imports only lucky-charm, so the other three fixtures
    // are the phantom cases once this rule exists. Update test/demo.test.ts when
    // this rule starts returning findings.
    return [];
  },
};
