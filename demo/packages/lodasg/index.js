// biome-ignore lint/style/useNodejsImportProtocol: fixture keeps the classic builtin import.
const { spawn } = require("child_process");

function unusedSpawn() {
  return spawn;
}

console.log("lodasg demo fixture (not lodash). unusedSpawn was not called.");

module.exports = { unusedSpawn };
