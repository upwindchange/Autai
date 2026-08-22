import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig(async () => ({
  main: {
    plugins: [
      bindingSqlite3(),
      copyMigrations(),
      // Built separately via esbuild (see buildDecodeWorker) — NOT as a second
      // rollupOptions.input, which disables externalizeDeps and breaks the app.
      await buildDecodeWorker(),
      {
        name: "watch-main-reload",
        closeBundle() {
          if (process.env.NODE_ENV !== "production") {
            process.send?.("rebuild");
          }
        },
      },
    ],
    build: {
      sourcemap: true,
      watch: process.env.NODE_ENV !== "production" ? {} : null,
      externalizeDeps: {
        exclude: ["drizzle-orm"],
      },
    },
    resolve: {
      alias: {
        "@": resolve("src/main"),
        "@agents": resolve("src/main/agents"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    resolve: {
      dedupe: [
        "@assistant-ui/core",
        "@assistant-ui/react",
        "@assistant-ui/react-ai-sdk",
        "@assistant-ui/store",
        "@assistant-ui/tap",
        "react",
        "react-dom",
      ],
      alias: {
        "@": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
}));

// better-sqlite3 v13 is Node-API: prebuilt binaries ship inside the npm
// package (prebuilds/<platform>-<arch>.node) and load under any Node/Electron
// ABI — no electron-rebuild, no GitHub-release download. This plugin just
// copies the host platform's prebuilt binary next to the main bundle so the
// runtime can load it via `nativeBinding` (see src/main/db/index.ts).
// Cross-arch packaging is handled at electron-builder time (afterPack hook),
// which stamps the correct per-arch prebuild into each package.
function bindingSqlite3(): Plugin {
  const TAG = "[vite-plugin-binding-sqlite3]";
  const OUTPUT_DIR = "out/main";
  const BINDING_FILE = "better_sqlite3.node";

  return {
    name: "binding-sqlite3",
    closeBundle() {
      const resolvedRoot = process.cwd();
      const outputDir = path.resolve(resolvedRoot, OUTPUT_DIR);
      const destPath = path.join(outputDir, BINDING_FILE);

      const prebuildsDir = path.join(
        path.dirname(require.resolve("better-sqlite3/package.json")),
        "prebuilds",
      );
      const sourcePath = path.join(
        prebuildsDir,
        `${process.platform}-${process.arch}.node`,
      );

      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          `${TAG} Prebuilt binary not found: ${sourcePath}. ` +
            `better-sqlite3@13 ships prebuilds for linux/darwin/win32 ` +
            `(x64, arm64; linux also musl) — your platform/arch has none, ` +
            `so node-gyp would need to compile it during install.`,
        );
      }

      fs.mkdirSync(outputDir, { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
      console.log(`${TAG} Copied native binding to ${destPath}`);
    },
  };
}

// Copies drizzle migration files to out/main/drizzle/
// so the runtime migrator can apply them in production
function copyMigrations(): Plugin {
  const TAG = "[vite-plugin-copy-migrations]";
  const OUTPUT_DIR = "out/main/drizzle";
  const SOURCE_DIR = "drizzle";

  return {
    name: "copy-migrations",
    closeBundle() {
      const resolvedRoot = process.cwd();
      const sourceDir = path.resolve(resolvedRoot, SOURCE_DIR);
      const outputDir = path.resolve(resolvedRoot, OUTPUT_DIR);

      if (!fs.existsSync(sourceDir)) {
        console.warn(`${TAG} Source directory not found: ${sourceDir}`);
        return;
      }

      fs.cpSync(sourceDir, outputDir, { recursive: true });
      console.log(`${TAG} Copied migrations to ${outputDir}`);
    },
  };
}

// Builds the novel-decode `worker_threads` worker as a STANDALONE bundle and
// drops it at out/main/decodeWorker.cjs, a sibling of the main index.js. The
// main build can't take a second rollupOptions.input — that path disables
// electron-vite's externalizeDeps and inlines electron (which then crashes on
// __dirname under ESM), so the worker is compiled out-of-band with esbuild
// instead. esbuild is a transitive dep of Vite (no new dependency) and runs in
// the closeBundle hook alongside bindingSqlite3/copyMigrations.
//
// The worker is pure CPU work (jschardet + iconv + normalize) with no Electron
// or DB access, so it bundles cleanly: iconv-lite/jschardet are inlined, only
// node: builtins stay external, and the result is a single self-contained file.
// CJS (`.cjs`) not ESM: package.json has "type": "module" so `.js` would be
// treated as ESM, but iconv-lite is CommonJS and its `require("buffer")` calls
// can't be satisfied under ESM (esbuild's __require shim throws). The `.cjs`
// extension forces Node to treat it as CommonJS, where native require works.
// fileDecoder.ts spawns it by absolute path; no asarUnpack needed.
async function buildDecodeWorker(): Promise<Plugin> {
  // esbuild is a transitive dep of Vite, not a direct one, so under pnpm's
  // strict hoisting a bare `import "esbuild"` won't resolve from this file.
  // Anchor a require at Vite's location (Vite depends on esbuild) and resolve
  // through it. Avoids adding esbuild as a direct dependency.
  const viteRequire = createRequire(require.resolve("vite"));
  const esbuild = viteRequire("esbuild");
  const TAG = "[vite-plugin-build-decode-worker]";
  const ENTRY =
    "src/main/agents/workers/entertainmentWorker/pipeline1ChapteredFile/decodeWorker.ts";
  const OUT_FILE = "out/main/decodeWorker.cjs";

  return {
    name: "build-decode-worker",
    async closeBundle() {
      const resolvedRoot = process.cwd();
      const entryPath = path.resolve(resolvedRoot, ENTRY);
      const outPath = path.resolve(resolvedRoot, OUT_FILE);

      if (!fs.existsSync(entryPath)) {
        console.warn(`${TAG} Worker entry not found: ${entryPath}`);
        return;
      }

      await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        outfile: outPath,
        platform: "node",
        format: "cjs",
        // Inline everything except node: builtins so the file is self-
        // contained. iconv-lite + jschardet together are ~400KB — fine inline.
        external: ["node:*"],
        target: "esnext",
        sourcemap: true,
        logLevel: "silent",
      });
      console.log(`${TAG} Built worker → ${outPath}`);
    },
  };
}
