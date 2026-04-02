import { spawn } from "node:child_process";

// Rebuild better-sqlite3 for Electron's Node ABI version using @electron/rebuild.

const cp = spawn(
  "pnpm",
  ["exec", "electron-rebuild", "-f", "-w", "better-sqlite3"],
  {
    cwd: import.meta.dirname + "/..",
    stdio: "inherit",
  },
);

cp.on("exit", (code) => {
  if (code === 0) {
    console.log("Rebuild better-sqlite3 for Electron success.");
  } else {
    console.error(`Rebuild better-sqlite3 failed with code ${code}.`);
  }
  process.exit(code);
});
