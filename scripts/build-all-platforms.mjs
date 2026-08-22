// Local cross-platform packaging: all OS/arch targets from one host.
//
// This is trivial now that better-sqlite3 v13 ships Node-API prebuilts in
// node_modules: the vite build runs once (host binding in out/main/ is
// irrelevant), and electron-builder's afterPack hook (scripts/after-pack.mjs)
// stamps the correct prebuilds/<platform>-<arch>.node into every package.
// No electron-rebuild, no GitHub-release downloads, no NATIVE_BINDING_TARGET.
// Full CI builds remain the source of truth (.github/workflows/build.yml);
// this is for local one-shot packaging.
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// Arch lists come from electron-builder.json (win/linux build both arches;
// mac config doesn't pin arch, so pass it per invocation).
const targets = [
  { name: "linux", flag: "--linux" },
  { name: "win32", flag: "--win" },
  { name: "darwin-x64", flag: "--mac --x64" },
  { name: "darwin-arm64", flag: "--mac --arm64" },
];

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

console.log("=== Building with electron-vite ===");
run("electron-vite build");

const built = [];
const failed = [];
for (const { name, flag } of targets) {
  console.log(`\n=== Packaging ${name} ===`);
  try {
    run(`electron-builder ${flag} --publish never`);
    built.push(name);
  } catch {
    console.error(`!! ${name} packaging failed — skipping (see output above)`);
    failed.push(name);
  }
}

console.log(`\nPackaged: ${built.join(", ") || "none"}`);
if (failed.length > 0) {
  console.error(`Failed:  ${failed.join(", ")}`);
  process.exitCode = 1;
}
