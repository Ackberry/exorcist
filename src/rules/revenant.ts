import type { Rule } from "../types.js";

export const revenantRule: Rule = {
  kind: "revenant",
  status: "stub",
  description: "Abandoned package that ships again under a new maintainer or after a long silence.",
  scan() {
    // TODO(Wed): optional registry lookup. This is the one rule that needs the network.
    // GET https://registry.npmjs.org/<name> and read the `time` map plus maintainers.
    // Flag a long quiet period followed by a new release, or a maintainer change
    // on the version that is installed. If the registry cannot be reached, return
    // [] and leave the rest of the scan alone. Do not call the registry from a unit test.
    // The default scan must still work offline.
    return [];
  },
};
