import {
  rmSync,
  mkdirSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import pkg from "./package.json";

// https://vitejs.dev/config/
// Custom plugin to copy index.js file directly to dist
const copyIndexScriptPlugin = () => ({
  name: "copy-index-script",
  async buildStart() {
    console.log("Copying index.js...");

    const scriptsDir = path.join(__dirname, "electron/main/scripts");
    const distDir = path.join(__dirname, "dist-electron/main/scripts");
    mkdirSync(distDir, { recursive: true });

    try {
      // Copy index.js file
      const indexSourcePath = path.join(scriptsDir, "index.js");
      const indexOutputPath = path.join(distDir, "index.js");
      
      if (existsSync(indexSourcePath)) {
        copyFileSync(indexSourcePath, indexOutputPath);
        console.log(`✓ Copied index.js to electron-dist folder`);
        console.log(`  Output: ${indexOutputPath}`);
      } else {
        console.warn(`Warning: index.js not found at: ${indexSourcePath}`);
      }
    } catch (error) {
      console.error("Error copying index.js:", error);
      throw error;
    }
  },
});

export default defineConfig(({ command }) => {
  rmSync("dist-electron", { recursive: true, force: true });

  const isServe = command === "serve";
  const isBuild = command === "build";
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG;

  return {
    resolve: {
      alias: {
        "@": path.join(__dirname, "src"),
      },
    },
    plugins: [
      react(),
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: "electron/main/index.ts",
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log(
                /* For `.vscode/.debug.script.mjs` */ "[startup] Electron App"
              );
            } else {
              args.startup();
            }
          },
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: "dist-electron/main",
              rollupOptions: {
                external: Object.keys(
                  "dependencies" in pkg ? pkg.dependencies : {}
                ),
                plugins: [copyIndexScriptPlugin()],
              },
            },
          },
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: "electron/preload/index.ts",
          vite: {
            build: {
              sourcemap: sourcemap ? "inline" : undefined, // #332
              minify: isBuild,
              outDir: "dist-electron/preload",
              rollupOptions: {
                external: Object.keys(
                  "dependencies" in pkg ? pkg.dependencies : {}
                ),
              },
            },
          },
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        renderer: {},
      }),
      tailwindcss(),
    ],
    server:
      process.env.VSCODE_DEBUG &&
      (() => {
        const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL);
        return {
          host: url.hostname,
          port: +url.port,
        };
      })(),
    clearScreen: false,
  };
});
