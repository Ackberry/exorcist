// lucky-charm is a quiet control: imported, and no risky API.
// preact is a quiet control: one letter from react, and itself a popular name.
// lodasg is imported so phantom does not turn the typosquat into a remove.
// soul-snatcher and hexed-helper are installed and never referenced.
const { charm } = require("lucky-charm");
const { get } = require("lodasg");
const { h } = require("preact");

console.log(charm(), get({ ok: h() }, "ok"));
