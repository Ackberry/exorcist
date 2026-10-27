// incantation decodes to console.log("boo"). mutter() is exported and never called.
const incantation = "Y29uc29sZS5sb2coImJvbyIp";
const dust = "VGhpcyBpcyBhIGhhcm1sZXNzIEV4b3JjaXN0IGRlbW8gYmxvYiB3aXRoIG5vIHBheWxvYWQu";

function mutter() {
  // biome-ignore lint/security/noGlobalEval: fixture for the scanner. mutter() is never called.
  return eval(Buffer.from(incantation, "base64").toString("utf8"));
}

console.log(`hexed-helper demo fixture. dust length ${dust.length}. mutter was not called.`);

module.exports = { mutter, dust };
