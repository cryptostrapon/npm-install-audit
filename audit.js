#!/usr/bin/env node
// npm-install-audit: look before you run.
// Usage: node audit.js ./some-repo
// Read only, no network, no dependencies. A clean result is not proof of safety.
const fs = require("fs");
const path = require("path");

const target = process.argv[2] || ".";
let root;
try {
  root = path.resolve(target);
  if (!fs.statSync(root).isDirectory()) throw new Error("not a directory");
} catch (e) {
  console.error("Cannot read directory: " + target);
  process.exit(2);
}

const HOOKS = ["preinstall", "install", "postinstall", "prepare"];
const SKIP_DIRS = new Set([".git", "node_modules"]);
const RISKY = [
  [/child_process|execSync|execFileSync|spawnSync|\bspawn\(/, "runs shell commands"],
  [/\beval\(|new Function\(/, "evaluates code at runtime"],
  [/\batob\(|Buffer\.from\([^)]*base64/, "decodes base64 at runtime"],
  [/(curl|wget)\s[^\n]*\|\s*(sh|bash)/, "pipes a download into a shell"],
  [/Login Data|keystore|wallet\.dat|\.ssh[\/\\]|id_rsa|\.aws[\/\\]credentials|Local Storage[\/\\]leveldb/i, "touches key, wallet or browser data paths"],
];

let findings = 0;
const flag = (file, msg) => {
  findings++;
  console.log("! " + path.relative(root, file) + ": " + msg);
};

function checkPackage(file) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { flag(file, "package.json could not be parsed, read it by hand"); return; }
  for (const h of HOOKS) {
    if (pkg.scripts && pkg.scripts[h]) flag(file, h + " hook runs: " + pkg.scripts[h]);
  }
}

function checkSource(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return; }
  for (const [re, why] of RISKY) if (re.test(text)) flag(file, why);
  if (!/\.min\.js$/.test(file)) {
    const blob = text.match(/[A-Za-z0-9+\/=]{300,}/);
    if (blob) flag(file, "long encoded string (" + blob[0].length + " chars)");
  }
}

function walk(dir, depth) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { walk(p, depth + 1); continue; }
    if (!e.isFile()) continue;
    if (e.name === "package.json") { checkPackage(p); continue; }
    if (/\.(js|cjs|mjs|sh)$/.test(e.name)) {
      let size = 0;
      try { size = fs.statSync(p).size; } catch { continue; }
      if (size < 2e6) checkSource(p);
    }
  }
}

walk(root, 0);
if (findings) {
  console.log("\n" + findings + " finding(s). Read them before you run npm install.");
  process.exit(1);
}
console.log("No obvious install hooks or risky patterns found. Still read the code.");
