import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let indexScript: string | null = null;

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
