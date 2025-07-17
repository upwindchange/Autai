import {
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import typescript from "typescript";
import pkg from "./package.json";

// https://vitejs.dev/config/
// Custom plugin to build hintDetector.js file directly to dist
const buildHintDetectorPlugin = () => ({
  name: "build-hint-detector",
  async buildStart() {
    console.log("Building hintDetector.js...");

    const scriptsDir = path.join(__dirname, "electron/main/scripts");
    const distDir = path.join(__dirname, "dist-electron/main/scripts");
    mkdirSync(distDir, { recursive: true });

    // Check if we need to build
    const sourcePath = path.join(scriptsDir, "hintDetector.ts");
    const outputPath = path.join(distDir, "hintDetector.js");

    const shouldBuild =
      !existsSync(outputPath) ||
      (existsSync(sourcePath) &&
        existsSync(outputPath) &&
        statSync(sourcePath).mtime > statSync(outputPath).mtime);

    if (!shouldBuild) {
      console.log("hintDetector.js is up to date, skipping build");
      return;
    }

    try {
      // Read hintDetector.ts source
      if (!existsSync(sourcePath)) {
        throw new Error(`hintDetector.ts not found at: ${sourcePath}`);
      }

      const hintDetectorTsCode = readFileSync(sourcePath, "utf-8");

      // Compile TypeScript to JavaScript
      console.log("Compiling TypeScript to JavaScript...");
      const compilerOptions: typescript.CompilerOptions = {
        module: typescript.ModuleKind.None,
        target: typescript.ScriptTarget.ES2020,
        lib: ["es2020", "dom"],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: false,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true,
        removeComments: false,
        sourceMap: false,
        declaration: false,
      };

      const result = typescript.transpileModule(hintDetectorTsCode, {
        compilerOptions,
        fileName: "hintDetector.ts",
      });

      if (result.diagnostics && result.diagnostics.length > 0) {
        const diagnostics = result.diagnostics
          .map((d) =>
            typescript.flattenDiagnosticMessageText(d.messageText, "\n")
          )
          .join("\n");
        throw new Error(`TypeScript compilation errors:\n${diagnostics}`);
      }

      console.log(`✓ Built hintDetector.js`);

      // Write the compiled script
      writeFileSync(outputPath, result.outputText);
      console.log(`✓ Built hintDetector.js into electron-dist folder`);
      console.log(`  Output: ${outputPath}`);
    } catch (error) {
      console.error("Error building hintDetector:", error);
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
                plugins: [buildHintDetectorPlugin()],
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
