import fs from "node:fs";
import path from "node:path";
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

export default defineConfig({
  main: {
    plugins: [
      copyProviders(),
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

// Copies src/main/agents/providers/data/ to out/main/agents/providers/data/
// so the runtime TOML registry can read provider configs in production
function copyProviders(): Plugin {
  const TAG = "[vite-plugin-copy-providers]";
  const OUTPUT_DIR = "out/main/agents/providers/data";
  const SOURCE_DIR = "src/main/agents/providers/data";

  return {
    name: "copy-providers",
    closeBundle() {
      const resolvedRoot = process.cwd();
      const sourceDir = path.resolve(resolvedRoot, SOURCE_DIR);
      const outputDir = path.resolve(resolvedRoot, OUTPUT_DIR);

      if (!fs.existsSync(sourceDir)) {
        console.warn(`${TAG} Source directory not found: ${sourceDir}`);
        return;
      }

      fs.cpSync(sourceDir, outputDir, { recursive: true });
      console.log(`${TAG} Copied providers to ${outputDir}`);
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
