import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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
      copyMigrations(),
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
});

// Adapted from reference/electron-vite-samples/better-sqlite3-main-process/vite.config.ts
// Copies better-sqlite3 native binding to the main process output directory
// after the build completes (closeBundle), so it won't be deleted by the build.
//
// Cross-platform builds: set NATIVE_BINDING_TARGET env var (e.g. "win32-x64").
// The plugin will download the matching prebuilt binary from better-sqlite3's
// GitHub releases (cached in native/) and copy it instead of the host binary.
// Without the env var, the host binary from electron-rebuild is used (dev mode).
function bindingSqlite3(): Plugin {
  const TAG = "[vite-plugin-binding-sqlite3]";
  const OUTPUT_DIR = "out/main";
  const BINDING_FILE = "better_sqlite3.node";
  const NATIVE_CACHE_DIR = "native";

  function getHostBindingPath(): string {
    const better_sqlite3 = require.resolve("better-sqlite3");
    const better_sqlite3_root = path.posix.join(
      better_sqlite3.slice(
        0,
        better_sqlite3.lastIndexOf("node_modules"),
      ),
      "node_modules/better-sqlite3",
    );
    return path.posix.join(
      better_sqlite3_root,
      "build/Release",
      BINDING_FILE,
    );
  }

  // Download a prebuilt binary from GitHub releases to the cache directory.
  // Uses curl + tar (no side effects on node_modules/).
  function downloadPrebuilt(
    platform: string,
    arch: string,
    cacheDir: string,
    destPath: string,
  ): void {
    const electronVersion = require("electron/package.json").version;
    const sqlite3Version = require("better-sqlite3/package.json").version;

    // Determine Electron ABI version from prebuild-install's debug output
    const debugOutput = execSync(
      `npx prebuild-install --runtime=electron --target=${electronVersion} ` +
        `--platform=${process.platform} --arch=${process.arch} -d 2>&1 || true`,
      { encoding: "utf-8" },
    );
    const abiMatch = debugOutput
      .split("\n")
      .filter((l: string) => l.includes("prebuild-install http request GET"))
      .pop()
      ?.match(/electron-v(\d+)-/);

    if (!abiMatch) {
      throw new Error(
        `${TAG} Could not determine Electron ABI version for electron@${electronVersion}`,
      );
    }
    const abiVersion = abiMatch[1];

    const url =
      `https://github.com/WiseLibs/better-sqlite3/releases/download/` +
      `v${sqlite3Version}/better-sqlite3-v${sqlite3Version}-electron-v${abiVersion}-${platform}-${arch}.tar.gz`;

    console.log(
      `${TAG} Downloading electron@${electronVersion} ${platform}-${arch} (ABI v${abiVersion})...`,
    );

    fs.mkdirSync(cacheDir, { recursive: true });
    const tmpTar = path.join(cacheDir, "download.tar.gz");

    try {
      execSync(`curl -fsSL -o "${tmpTar}" "${url}"`, { stdio: "inherit" });
      execSync(`tar xzf "${tmpTar}" -C "${cacheDir}" --strip-components=2`, {
        stdio: "inherit",
      });
    } finally {
      if (fs.existsSync(tmpTar)) fs.unlinkSync(tmpTar);
    }

    if (!fs.existsSync(destPath)) {
      throw new Error(
        `${TAG} Download failed: ${destPath} not found after extraction`,
      );
    }
  }

  return {
    name: "binding-sqlite3",
    closeBundle() {
      const resolvedRoot = process.cwd();
      const outputDir = path.resolve(resolvedRoot, OUTPUT_DIR);
      const destPath = path.join(outputDir, BINDING_FILE);

      // Check for cross-platform target: NATIVE_BINDING_TARGET=win32-x64
      const target = process.env.NATIVE_BINDING_TARGET; // e.g. "win32-x64"
      let sourcePath: string;

      if (target) {
        const cacheDir = path.resolve(
          resolvedRoot,
          NATIVE_CACHE_DIR,
          target,
        );
        const cachedPath = path.join(cacheDir, BINDING_FILE);

        if (!fs.existsSync(cachedPath)) {
          const [platform, arch] = target.split("-");
          downloadPrebuilt(platform, arch, cacheDir, cachedPath);
        }

        sourcePath = cachedPath;
        console.log(
          `${TAG} Using cached ${target} binding: ${cachedPath}`,
        );
      } else {
        // Dev / same-platform build: use the host binary
        sourcePath = getHostBindingPath();
      }

      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          `${TAG} Cannot find "${sourcePath}". ` +
            `Run "pnpm exec electron-rebuild -f -w better-sqlite3" to rebuild.`,
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
