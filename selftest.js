// Self test: builds two tiny fixture projects in a temp folder and checks the audit result.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
const write = (rel, text) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

write("clean/package.json", JSON.stringify({ name: "clean", scripts: { test: "node index.js" } }));
write("clean/index.js", 'console.log("hello");\n');
write("bad/package.json", JSON.stringify({ name: "bad", scripts: { postinstall: "node setup.js" } }));
write("bad/setup.js", [
  'const cp = require("child_process");',
  'const payload = Buffer.from("aGVsbG8=", "base64").toString();',
  'const where = "~/.ssh/id_rsa";',
  "console.log(payload, where, typeof cp);",
].join("\n"));

const run = (dir) => spawnSync(process.execPath, [path.join(__dirname, "audit.js"), dir], { encoding: "utf8" });
let ok = true;
const check = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) ok = false; };

const clean = run(path.join(tmp, "clean"));
check("clean fixture exits 0", clean.status === 0);
const bad = run(path.join(tmp, "bad"));
check("bad fixture exits 1", bad.status === 1);
check("flags postinstall hook", /postinstall hook runs/.test(bad.stdout));
check("flags shell execution", /runs shell commands/.test(bad.stdout));
check("flags base64 decoding", /decodes base64/.test(bad.stdout));
check("flags key paths", /key, wallet or browser data paths/.test(bad.stdout));
check("missing directory exits 2", run(path.join(tmp, "nope")).status === 2);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
