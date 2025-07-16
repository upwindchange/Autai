import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let hintDetectorScript: string | null = null;

export function getHintDetectorScript(): string {
  if (!hintDetectorScript) {
    // The hintDetector.js now includes css-selector-generator bundled
    const possiblePaths = [join(__dirname, "scripts/hintDetector.js")];

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
  }
  return hintDetectorScript;
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
