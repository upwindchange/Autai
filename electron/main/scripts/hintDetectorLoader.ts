import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let hintDetectorScript: string | null = null;
let cssSelectorGeneratorScript: string | null = null;
let combinedScript: string | null = null;

function getCssSelectorGeneratorScript(): string {
  if (!cssSelectorGeneratorScript) {
    // Try multiple paths to support both development and production
    const possiblePaths = [
      join(__dirname, "../../../node_modules/css-selector-generator/build/index.js"),
      join(process.cwd(), "node_modules/css-selector-generator/build/index.js"),
      join(__dirname, "../../node_modules/css-selector-generator/build/index.js"),
    ];

    let scriptPath: string | null = null;
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        scriptPath = path;
        break;
      }
    }

    if (!scriptPath) {
      throw new Error(
        `Could not find css-selector-generator in any of these paths: ${possiblePaths.join(
          ", "
        )}`
      );
    }

    cssSelectorGeneratorScript = readFileSync(scriptPath, "utf-8");
  }
  return cssSelectorGeneratorScript;
}

export function getHintDetectorScript(): string {
  if (!combinedScript) {
    // First, get css-selector-generator
    const cssSelector = getCssSelectorGeneratorScript();
    
    // Then, get hint detector
    const possiblePaths = [
      join(__dirname, "hintDetector.js"), // Production path
      join(__dirname, "../../../electron/main/scripts/hintDetector.js"), // Development path from dist-electron
      join(process.cwd(), "electron/main/scripts/hintDetector.js"), // Development path from project root
    ];

    let scriptPath: string | null = null;
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        scriptPath = path;
        break;
      }
    }

    if (!scriptPath) {
      throw new Error(
        `Could not find hintDetector.js in any of these paths: ${possiblePaths.join(
          ", "
        )}`
      );
    }

    hintDetectorScript = readFileSync(scriptPath, "utf-8");
    
    // Combine the scripts
    // The css-selector-generator UMD build exposes getCssSelector globally
    combinedScript = `
      // CSS Selector Generator Library
      ${cssSelector}
      
      // Make getCssSelector available globally for the hint detector
      window.getCssSelector = window.CssSelectorGenerator.getCssSelector;
      
      // Hint Detector Script
      ${hintDetectorScript}
    `;
  }
  return combinedScript;
}

export function getHintClickScript(index: number): string {
  return `
    (function() {
      const hints = window.detectHints ? window.detectHints() : [];
      const allElements = [];
      
      // Recreate the element list in the same order as detectHints
      const getAllElements = (root, elements = []) => {
        const children = root.querySelectorAll('*');
        for (const element of children) {
          elements.push(element);
          if (element.shadowRoot) {
            getAllElements(element.shadowRoot, elements);
          }
        }
        return elements;
      };
      
      const elements = getAllElements(document.documentElement);
      
      // Find clickable elements matching our hints
      let hintIndex = 0;
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        // Match by position and size
        const hint = hints[hintIndex];
        if (hint && 
            Math.abs(rect.top - hint.rect.top) < 1 &&
            Math.abs(rect.left - hint.rect.left) < 1 &&
            Math.abs(rect.width - hint.rect.width) < 1 &&
            Math.abs(rect.height - hint.rect.height) < 1) {
          allElements.push(element);
          hintIndex++;
        }
      }
      
      if (allElements[${index}]) {
        const element = allElements[${index}];
        // Special handling for different element types
        if (element.tagName === 'DETAILS') {
          element.open = !element.open;
        } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
          element.focus();
        } else {
          element.click();
        }
      }
    })();
  `;
}
