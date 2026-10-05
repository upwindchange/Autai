// Enforces version-named drizzle migrations (see CLAUDE.md "Database").
// drizzle-kit's --name is optional; without it the CLI silently generates
// random hero-name folders (e.g. 20260605_flashy_wendigo). This wrapper
// refuses to run unless --name is the intended next release version,
// optionally suffixed for custom migrations (1.0.1, 1.0.1-rc.1, 1.0.1_fts5).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:_[\w-]+)?$/;

const nameIdx = args.indexOf("--name");
const name =
  nameIdx !== -1
    ? args[nameIdx + 1]
    : args.find((a) => a.startsWith("--name="))?.slice("--name=".length);

if (!name || !VERSION_RE.test(name)) {
  console.error(
    [
      "[db:generate] --name <version> is required and must be the intended next",
      "release version, optionally suffixed for custom migrations.",
      "  e.g. pnpm db:generate --name 1.0.1",
      "       pnpm db:generate:custom --name 1.0.1_fts5",
      "The timestamp folder prefix is added by drizzle-kit automatically.",
    ].join("\n"),
  );
  process.exit(1);
}

const kitBin = fileURLToPath(new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url));
const result = spawnSync(process.execPath, [kitBin, "generate", ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
