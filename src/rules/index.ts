import type { Rule } from "../types.js";
import { doppelgangerRule } from "./doppelganger.js";
import { phantomRule } from "./phantom.js";
import { poltergeistRule } from "./poltergeist.js";
import { revenantRule } from "./revenant.js";

export { doppelgangerRule, POPULAR_PACKAGES } from "./doppelganger.js";
export { phantomRule } from "./phantom.js";
export { poltergeistRule } from "./poltergeist.js";
export { revenantRule } from "./revenant.js";

/** Rule order is the order findings are collected. Poltergeist, doppelganger, and phantom are active. */
export const rules: readonly Rule[] = [
  poltergeistRule,
  doppelgangerRule,
  revenantRule,
  phantomRule,
];
