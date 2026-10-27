// Exorcist demo fixture. This runs on `npm install` and must stay harmless.
// It reads one dummy env var, base64-encodes it, and prints the length.
// It does not open a socket, write a file, or print the token.
const dummyName = "EXORCIST_DEMO_TOKEN";
const token = process.env[dummyName] ?? "not-a-real-secret";
const pocket = Buffer.from(String(token)).toString("base64");

console.log(
  `[soul-snatcher] demo only. Pretended to pocket ${pocket.length} characters. No network call is made.`,
);
