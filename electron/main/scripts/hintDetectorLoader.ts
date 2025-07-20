import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let hintDetectorScript: string | null = null;
let indexScript: string | null = null;

export function getHintDetectorScript(): string {
  if (!hintDetectorScript) {
    // The hintDetector.js now includes css-selector-generator bundled
    const possiblePath = join(__dirname, "scripts/hintDetector.js");

    if (!existsSync(possiblePath)) {
      throw new Error(
        `Could not find hintDetector.js in path: ${possiblePath}`
      );
    }

    hintDetectorScript = readFileSync(possiblePath, "utf-8");
  }
  return hintDetectorScript;
}

export function getIndexScript(): string {
  if (!indexScript) {
    const possiblePath = join(__dirname, "scripts/index.js");

    if (!existsSync(possiblePath)) {
      throw new Error(`Could not find index.js in path: ${possiblePath}`);
    }

    indexScript = readFileSync(possiblePath, "utf-8");
  }
  return indexScript;
}
