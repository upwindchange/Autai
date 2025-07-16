import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let hintDetectorScript: string | null = null;

export function getHintDetectorScript(): string {
  if (!hintDetectorScript) {
    // The hintDetector.js now includes css-selector-generator bundled
    const possiblePath = join(__dirname, "scripts/hintDetector.js");

    let scriptPath: string | null = null;
    if (existsSync(possiblePath)) {
      scriptPath = possiblePath;
    }

    if (!scriptPath) {
      throw new Error(
        `Could not find hintDetector.js in path: ${possiblePath}`
      );
    }

    hintDetectorScript = readFileSync(scriptPath, "utf-8");
  }
  return hintDetectorScript;
}
