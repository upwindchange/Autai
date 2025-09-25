import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

let indexScript: string | null = null;

export function getIndexScript(): string {
  if (!indexScript) {
    // Get the current file's directory using import.meta.url
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const indexScriptPath = join(__dirname, "index.js");

    indexScript = readFileSync(indexScriptPath, "utf-8");
  }
  return indexScript;
}
