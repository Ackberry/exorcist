import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Node's chmod works on Windows. The shell `chmod` command does not, and
// `npm run build` used to fail there before `dist/cli.js` was written.
const cli = join(dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
chmodSync(cli, 0o755);
