import indexScriptPath from "./index.js?asset";
import { readFileSync } from "fs";

let indexScript: string | null = null;

export function getIndexScript(): string {
  if (!indexScript) {
    indexScript = readFileSync(indexScriptPath, "utf-8");
  }
  return indexScript;
}
