#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import typescript from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));

function compileTSToJS(tsCode, fileName) {
  const compilerOptions = {
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

  const result = typescript.transpileModule(tsCode, {
    compilerOptions,
    fileName,
  });

  if (result.diagnostics && result.diagnostics.length > 0) {
    const diagnostics = result.diagnostics
      .map((d) => typescript.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    throw new Error(`TypeScript compilation errors:\n${diagnostics}`);
  }

  return result.outputText;
}

async function buildHintDetector() {
  console.log("Building hintDetector.js...");

  const scriptsDir = __dirname;
  const projectRoot = join(__dirname, "../../../");
  const distDir = join(projectRoot, "dist-electron/main/scripts");
  mkdirSync(distDir, { recursive: true });

  // Check if we need to build
  const sourcePath = join(scriptsDir, "hintDetector.ts");
  const outputPath = join(distDir, "hintDetector.js");

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
    const hintDetectorTsPath = join(scriptsDir, "hintDetector.ts");
    if (!existsSync(hintDetectorTsPath)) {
      throw new Error(`hintDetector.ts not found at: ${hintDetectorTsPath}`);
    }

    const hintDetectorTsCode = readFileSync(hintDetectorTsPath, "utf-8");

    // Compile TypeScript to JavaScript
    console.log("Compiling TypeScript to JavaScript...");
    let hintDetectorCode = compileTSToJS(hintDetectorTsCode, "hintDetector.ts");

    console.log(`✓ Built hintDetector.js`);

    // Write the compiled script
    writeFileSync(outputPath, hintDetectorCode);
    console.log(`✓ Built hintDetector.js into electron-dist folder`);
    console.log(`  Output: ${outputPath}`);
  } catch (error) {
    console.error("Error building hintDetector:", error);
    process.exit(1);
  }
}

// Run the build
buildHintDetector();
