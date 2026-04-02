import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

export default defineConfig({
  main: {
    plugins: [
      bindingSqlite3(),
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
      externalizeDeps: true,
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
      alias: {
        "@": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});

// Adapted from reference/electron-vite-samples/better-sqlite3-main-process/vite.config.ts
// Copies better-sqlite3 native binding to the main process output directory
// after the build completes (closeBundle), so it won't be deleted by the build.
function bindingSqlite3(): Plugin {
  const TAG = "[vite-plugin-binding-sqlite3]";
  const OUTPUT_DIR = "out/main";
  const BINDING_FILE = "better_sqlite3.node";

  return {
    name: "binding-sqlite3",
    closeBundle() {
      const resolvedRoot = process.cwd();
      const outputDir = path.resolve(resolvedRoot, OUTPUT_DIR);

      const better_sqlite3 = require.resolve("better-sqlite3");
      const better_sqlite3_root = path.posix.join(
        better_sqlite3.slice(
          0,
          better_sqlite3.lastIndexOf("node_modules"),
        ),
        "node_modules/better-sqlite3",
      );
      const sourcePath = path.posix.join(
        better_sqlite3_root,
        "build/Release",
        BINDING_FILE,
      );
      const destPath = path.posix.join(outputDir, BINDING_FILE);

      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          `${TAG} Cannot find "${sourcePath}". ` +
            `Run "pnpm rebuild:sqlite3" to rebuild better-sqlite3 for Electron.`,
        );
      }

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.copyFileSync(sourcePath, destPath);
      console.log(`${TAG} Copied native binding to ${destPath}`);
    },
  };
}
