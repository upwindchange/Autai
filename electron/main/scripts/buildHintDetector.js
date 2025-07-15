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
import { execSync } from "child_process";
import typescript from "typescript";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../../../package.json");

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

async function buildHintDetector(targetPath = null) {
  console.log("Building hintDetector.js...");

  const scriptsDir = __dirname;
  const projectRoot = join(__dirname, "../../../");
  const distDir = targetPath || join(projectRoot, "dist-electron/main/scripts");

  // Check if we need to build
  const sourcePath = join(scriptsDir, "hintDetector.ts");
  let outputPath;

  if (targetPath) {
    // When target path is provided, check against the target output
    outputPath = join(distDir, "hintDetector.js");
  } else {
    // Otherwise check against the local output
    outputPath = join(scriptsDir, "hintDetector.js");
  }

  const shouldBuild =
    !existsSync(outputPath) ||
    (existsSync(sourcePath) &&
      existsSync(outputPath) &&
      statSync(sourcePath).mtime > statSync(outputPath).mtime);

  if (!shouldBuild) {
    console.log("hintDetector.js is up to date, skipping build");
    return;
  }

  // Ensure the output directory exists if a target path is provided
  if (targetPath) {
    mkdirSync(distDir, { recursive: true });
  }

  try {
    // Get css-selector-generator version from imported package.json
    const cssSelectorVersion = pkg.devDependencies["css-selector-generator"];

    if (!cssSelectorVersion) {
      throw new Error(
        "css-selector-generator not found in package.json devDependencies"
      );
    }

    // Extract version number (remove ^ or ~ if present)
    const versionMatch = cssSelectorVersion.match(/[\d.]+/);
    const version = versionMatch ? versionMatch[0] : "3.6.9";

    console.log(`Using css-selector-generator version: ${version}`);

    // Read hintDetector.ts source
    const hintDetectorTsPath = join(scriptsDir, "hintDetector.ts");
    if (!existsSync(hintDetectorTsPath)) {
      throw new Error(`hintDetector.ts not found at: ${hintDetectorTsPath}`);
    }

    const hintDetectorTsCode = readFileSync(hintDetectorTsPath, "utf-8");

    // Compile TypeScript to JavaScript
    console.log("Compiling TypeScript to JavaScript...");
    let hintDetectorCode = compileTSToJS(hintDetectorTsCode, "hintDetector.ts");

    // Always download css-selector-generator from CDN
    console.log("Downloading css-selector-generator from CDN...");

    let cssSelectorCode = null;

    // Try jsDelivr first (usually faster and more reliable)
    try {
      console.log("Trying jsDelivr CDN...");
      const jsDelivrResponse = await fetch(
        `https://cdn.jsdelivr.net/npm/css-selector-generator@${version}/build/index.js`
      );
      if (jsDelivrResponse.ok) {
        cssSelectorCode = await jsDelivrResponse.text();
        console.log("Successfully downloaded from jsDelivr");
      }
    } catch (jsDelivrError) {
      console.warn("jsDelivr failed:", jsDelivrError.message);
    }

    // Fall back to unpkg if jsDelivr fails
    if (!cssSelectorCode) {
      try {
        console.log("Trying unpkg CDN as fallback...");
        const unpkgResponse = await fetch(
          `https://unpkg.com/css-selector-generator@${version}/build/index.js`
        );
        if (unpkgResponse.ok) {
          cssSelectorCode = await unpkgResponse.text();
          console.log("Successfully downloaded from unpkg");
        }
      } catch (unpkgError) {
        console.warn("unpkg failed:", unpkgError.message);
      }
    }

    // If CDN downloads failed, try local installation as last resort
    if (!cssSelectorCode) {
      console.log("CDN downloads failed, checking local files...");

      // Define paths to check
      const cssSelectorPaths = [
        join(projectRoot, "node_modules/css-selector-generator/build/index.js"),
        join(projectRoot, "node_modules/css-selector-generator/dist/index.js"),
        join(
          projectRoot,
          `node_modules/.pnpm/css-selector-generator@${version}/node_modules/css-selector-generator/build/index.js`
        ),
      ];

      // First check if files already exist locally
      for (const path of cssSelectorPaths) {
        if (existsSync(path)) {
          cssSelectorCode = readFileSync(path, "utf-8");
          console.log(`Found existing css-selector-generator at: ${path}`);
          break;
        }
      }

      // Only run npm install if files don't exist
      if (!cssSelectorCode) {
        console.log("Local files not found, running npm install...");

        // Check if we're in CI/CD environment
        const isCI = process.env.CI || process.env.GITHUB_ACTIONS;

        try {
          // Use npm ci if in CI, otherwise npm install
          const installCmd = isCI
            ? "npm ci --include=dev"
            : `npm install css-selector-generator@${cssSelectorVersion} --no-save`;

          execSync(installCmd, {
            cwd: projectRoot,
            stdio: "inherit",
          });

          // Try to find the installed package
          for (const path of cssSelectorPaths) {
            if (existsSync(path)) {
              cssSelectorCode = readFileSync(path, "utf-8");
              console.log(`Found css-selector-generator at: ${path}`);
              break;
            }
          }
        } catch (installError) {
          console.error("Failed to install via npm:", installError.message);
        }
      }
    }

    if (!cssSelectorCode) {
      throw new Error("Failed to find or download css-selector-generator");
    }

    // Create the combined script
    const combinedScript = `
// Combined HintDetector with CSS Selector Generator
// Generated by buildHintDetector.js
(function() {
  "use strict";
  
  // CSS Selector Generator Library (UMD build)
  ${cssSelectorCode}
  
  // Make getCssSelector available in the current scope
  const getCssSelector = (typeof window !== 'undefined' && window.CssSelectorGenerator) 
    ? window.CssSelectorGenerator.getCssSelector 
    : (typeof globalThis !== 'undefined' && globalThis.CssSelectorGenerator)
    ? globalThis.CssSelectorGenerator.getCssSelector
    : undefined;
  
  // Hint Detector Script (compiled from TypeScript)
  ${hintDetectorCode}
})();
`;
    console.log(`✓ Built hintDetector.js with css-selector-generator bundled`);

    // Write the combined script
    const devPath = join(scriptsDir, "hintDetector.js");
    writeFileSync(devPath, combinedScript);
    console.log(`✓ Built hintDetector.js into electron folder`);
    console.log(`  Output: ${devPath}`);
    if (targetPath) {
      // If target path is provided, write to both target and source directory
      const targetOutputPath = join(distDir, "hintDetector.js");
      writeFileSync(targetOutputPath, combinedScript);
      console.log(`✓ Built hintDetector.js into electron-dist folder`);
      console.log(`  Output: ${targetOutputPath}`);
    }
  } catch (error) {
    console.error("Error building hintDetector:", error);
    process.exit(1);
  }
}

// Run the build with optional target path from command line
const targetPath = process.argv[2] || null;
buildHintDetector(targetPath);
