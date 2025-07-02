import { app, BrowserWindow, WebContentsView, shell, ipcMain } from "electron";
import { agentService } from "./agent";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { update } from "./update";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, "../..");

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
const views = new Map<string, WebContentsView>(); // Store views by composite key (taskIndex + pageIndex)
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");

async function createWindow() {
  win = new BrowserWindow({
    title: "Main window",
    icon: path.join(process.env.VITE_PUBLIC, "favicon.ico"),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
      // Enable context isolation for security
      contextIsolation: true,
      // Disable webview tag support
      webviewTag: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    // #298
    win.loadURL(VITE_DEV_SERVER_URL);
    // Open devTool if the app is not packaged
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  ipcMain.handle("view:create", async (_, key: string, options) => {
    if (!win) throw new Error("Main window not available");

    // Remove existing view if any
    const existingView = views.get(key);
    if (existingView) {
      win.contentView.removeChildView(existingView);
      views.delete(key);
    }

    const view = new WebContentsView({
      webPreferences: {
        ...options.webPreferences,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    view.setBackgroundColor("#00000000");

    // Inject hint detection script when page loads
    view.webContents.on("did-finish-load", () => {
      console.log(`Page loaded for view: ${key}, injecting hint detection script`);
      const hintDetectorScript = `
        // Hint detection script to be injected into WebContentsView
        (function() {
          // Helper functions
          const isVisible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            
            return rect.width > 0 && 
                   rect.height > 0 &&
                   rect.top < window.innerHeight &&
                   rect.bottom > 0 &&
                   rect.left < window.innerWidth &&
                   rect.right > 0 &&
                   style.visibility !== 'hidden' &&
                   style.display !== 'none' &&
                   parseFloat(style.opacity) > 0;
          };

          // Get all elements including shadow DOM
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

          // Check if element is scrollable
          const isScrollableElement = (element) => {
            const style = window.getComputedStyle(element);
            const overflowY = style.overflowY;
            const overflowX = style.overflowX;
            return (element.scrollHeight > element.clientHeight && ['auto', 'scroll'].includes(overflowY)) ||
                   (element.scrollWidth > element.clientWidth && ['auto', 'scroll'].includes(overflowX));
          };

          const hasAngularClickHandler = (element) => {
            const ngAttributes = ['ng-click', 'data-ng-click', 'x-ng-click', 
                                 'ng:click', 'data-ng:click', 'x-ng:click',
                                 'ng_click', 'data-ng_click', 'x-ng_click'];
            
            return ngAttributes.some(attr => element.hasAttribute(attr));
          };

          const hasJsAction = (element) => {
            if (!element.hasAttribute('jsaction')) return false;
            
            const jsaction = element.getAttribute('jsaction') || '';
            const rules = jsaction.split(';');
            
            for (const rule of rules) {
              const parts = rule.trim().split(':');
              if (parts.length === 1 || (parts.length === 2 && parts[0] === 'click')) {
                const actionParts = (parts.length === 1 ? parts[0] : parts[1]).trim().split('.');
                if (actionParts[0] !== 'none' && actionParts[actionParts.length - 1] !== '_') {
                  return true;
                }
              }
            }
            
            return false;
          };

          const isInteractable = (element) => {
            const tagName = element.tagName.toLowerCase();
            let clickable = false;
            let reason = null;
            let possibleFalsePositive = false;
            let secondClassCitizen = false;

            // Check aria-disabled
            const ariaDisabled = element.getAttribute('aria-disabled');
            if (ariaDisabled && ['', 'true'].includes(ariaDisabled.toLowerCase())) {
              return { clickable: false };
            }

            // Native clickable elements
            switch (tagName) {
              case 'a':
                clickable = true;
                break;
              case 'button':
                clickable = !element.disabled;
                break;
              case 'textarea':
                clickable = !element.disabled && !element.readOnly;
                break;
              case 'input':
                clickable = element.type !== 'hidden' && 
                            !element.disabled && 
                            !(element.readOnly && ['text', 'search', 'email', 'url', 'tel', 'password'].includes(element.type));
                break;
              case 'select':
                clickable = !element.disabled;
                break;
              case 'label':
                clickable = element.control != null && !element.control.disabled;
                break;
              case 'img':
                clickable = ['zoom-in', 'zoom-out'].includes(getComputedStyle(element).cursor);
                break;
              case 'details':
                clickable = true;
                reason = 'Open/Close';
                break;
              case 'object':
              case 'embed':
                clickable = true;
                break;
              case 'body':
                // Special handling for body element - for frame focusing
                if (element === document.body && window.innerWidth > 3 && window.innerHeight > 3) {
                  if (isScrollableElement(element)) {
                    clickable = true;
                    reason = 'Scroll';
                  }
                }
                break;
              case 'div':
              case 'ol':
              case 'ul':
                // Scrollable containers
                if (isScrollableElement(element)) {
                  clickable = true;
                  reason = 'Scroll';
                }
                break;
            }

            // Check for event handlers
            if (!clickable) {
              clickable = element.hasAttribute('onclick') ||
                          hasAngularClickHandler(element) ||
                          hasJsAction(element);
            }

            // Check role attribute
            if (!clickable) {
              const role = element.getAttribute('role');
              const clickableRoles = ['button', 'tab', 'link', 'checkbox', 'menuitem', 
                                     'menuitemcheckbox', 'menuitemradio', 'radio'];
              if (role && clickableRoles.includes(role.toLowerCase())) {
                clickable = true;
              }
            }

            // Check contentEditable
            if (!clickable) {
              const contentEditable = element.getAttribute('contentEditable');
              if (contentEditable && ['', 'contenteditable', 'true'].includes(contentEditable.toLowerCase())) {
                clickable = true;
              }
            }

            // Check class name for button-like classes
            if (!clickable) {
              const className = element.getAttribute('class') || '';
              if (className.toLowerCase().includes('button')) {
                clickable = true;
                possibleFalsePositive = true;
              }
            }

            // Check tabindex
            if (!clickable) {
              const tabIndexStr = element.getAttribute('tabindex');
              if (tabIndexStr) {
                const tabIndex = parseInt(tabIndexStr);
                if (!isNaN(tabIndex) && tabIndex >= 0) {
                  clickable = true;
                  secondClassCitizen = true;
                }
              }
            }

            return { clickable, reason, possibleFalsePositive, secondClassCitizen };
          };

          const getLinkText = (element) => {
            const tagName = element.tagName.toLowerCase();
            let linkText = '';

            if (tagName === 'input') {
              if (element.labels && element.labels.length > 0) {
                linkText = element.labels[0].textContent?.trim() || '';
                if (linkText.endsWith(':')) {
                  linkText = linkText.slice(0, -1);
                }
              } else if (element.type === 'file') {
                linkText = 'Choose File';
              } else if (element.type !== 'password') {
                linkText = element.value || element.placeholder || '';
              }
            } else if (tagName === 'a' && !element.textContent?.trim()) {
              const img = element.querySelector('img');
              if (img) {
                linkText = img.alt || img.title || '';
              }
            } else if (element.textContent) {
              linkText = element.textContent.slice(0, 256);
            } else if (element.hasAttribute('title')) {
              linkText = element.getAttribute('title') || '';
            } else {
              linkText = element.innerHTML.slice(0, 256);
            }

            return linkText.trim();
          };

          // Create hint marker overlay container
          const createHintContainer = () => {
            let container = document.getElementById('vimium-hint-container');
            if (!container) {
              container = document.createElement('div');
              container.id = 'vimium-hint-container';
              container.style.cssText = \`
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
                isolation: isolate !important;
              \`;
              document.documentElement.appendChild(container);
            }
            return container;
          };

          // Clear existing hint markers
          const clearHints = () => {
            const container = document.getElementById('vimium-hint-container');
            if (container) {
              container.innerHTML = '';
            }
          };

          // Generate hint strings (A, B, C, ..., AA, AB, etc.)
          const generateHintString = (index) => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            let result = '';
            let num = index - 1;
            
            while (num >= 0) {
              result = chars[num % 26] + result;
              num = Math.floor(num / 26) - 1;
            }
            
            return result || 'A';
          };

          // Display hint markers
          window.showHints = () => {
            clearHints();
            const container = createHintContainer();
            const hints = window.detectHints();
            
            hints.forEach((hint, index) => {
              const marker = document.createElement('div');
              const hintLabel = generateHintString(index + 1);
              
              marker.style.cssText = \`
                position: absolute !important;
                left: \${hint.rect.left}px !important;
                top: \${hint.rect.top}px !important;
                background: linear-gradient(to bottom, #FFF785 0%, #FFC542 100%) !important;
                border: 1px solid #C38A22 !important;
                border-radius: 3px !important;
                box-shadow: 0px 3px 7px 0px rgba(0, 0, 0, 0.3) !important;
                color: #302505 !important;
                font-family: Helvetica, Arial, sans-serif !important;
                font-size: 11px !important;
                font-weight: bold !important;
                padding: 2px 5px !important;
                text-align: center !important;
                user-select: none !important;
                cursor: pointer !important;
                min-width: 16px !important;
                z-index: 2147483647 !important;
                pointer-events: auto !important;
              \`;
              
              marker.textContent = hintLabel;
              marker.title = hint.reason || hint.linkText || hint.href || '';
              
              // Store hint data on the marker for click handling
              marker.setAttribute('data-hint-index', index);
              
              // Add click handler to the marker
              marker.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const hintIndex = parseInt(marker.getAttribute('data-hint-index'));
                
                // Find and click the corresponding element
                const allHints = window.detectHints();
                if (allHints[hintIndex]) {
                  const targetHint = allHints[hintIndex];
                  const elements = getAllElements(document.documentElement);
                  
                  // Find the element that matches this hint
                  for (const element of elements) {
                    const rect = element.getBoundingClientRect();
                    if (Math.abs(rect.top - targetHint.rect.top) < 1 &&
                        Math.abs(rect.left - targetHint.rect.left) < 1 &&
                        Math.abs(rect.width - targetHint.rect.width) < 1 &&
                        Math.abs(rect.height - targetHint.rect.height) < 1) {
                      
                      // Special handling for different element types
                      if (element.tagName === 'DETAILS') {
                        element.open = !element.open;
                      } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
                        element.focus();
                      } else {
                        element.click();
                      }
                      break;
                    }
                  }
                }
              });
              
              container.appendChild(marker);
            });
            
            return hints;
          };

          // Hide hint markers
          window.hideHints = () => {
            clearHints();
          };

          // Main detection function
          window.detectHints = () => {
            let hints = [];
            const allElements = getAllElements(document.documentElement);
            
            // First pass: collect all hints
            allElements.forEach(element => {
              if (!isVisible(element)) return;
              
              const interactInfo = isInteractable(element);
              if (!interactInfo.clickable) return;
              
              const rect = element.getBoundingClientRect();
              const linkText = getLinkText(element);
              
              // Handle image maps
              if (element.tagName.toLowerCase() === 'img') {
                const mapName = element.getAttribute('usemap');
                if (mapName) {
                  const map = document.querySelector('map[name="' + mapName.replace(/^#/, '') + '"]');
                  if (map) {
                    const areas = map.getElementsByTagName('area');
                    for (const area of areas) {
                      const areaRect = area.getBoundingClientRect();
                      if (areaRect.width > 0 && areaRect.height > 0) {
                        hints.push({
                          element: area,
                          rect: {
                            top: areaRect.top,
                            left: areaRect.left,
                            width: areaRect.width,
                            height: areaRect.height,
                            right: areaRect.right,
                            bottom: areaRect.bottom
                          },
                          linkText: area.alt || area.title || 'Area',
                          tagName: 'area',
                          href: area.href || null,
                          reason: interactInfo.reason,
                          possibleFalsePositive: false,
                          secondClassCitizen: false
                        });
                      }
                    }
                    return; // Skip the image itself
                  }
                }
              }
              
              hints.push({
                element: element,
                rect: {
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                  right: rect.right,
                  bottom: rect.bottom
                },
                linkText,
                tagName: element.tagName.toLowerCase(),
                href: element.href || null,
                reason: interactInfo.reason,
                possibleFalsePositive: interactInfo.possibleFalsePositive,
                secondClassCitizen: interactInfo.secondClassCitizen
              });
            });
            
            // Filter out false positives
            hints = hints.filter((hint, index) => {
              if (!hint.possibleFalsePositive) return true;
              
              // Check if any descendant in nearby hints is clickable
              const lookbackWindow = 6;
              const start = Math.max(0, index - lookbackWindow);
              
              for (let i = start; i < index; i++) {
                let candidateDescendant = hints[i].element;
                // Check up to 3 levels of ancestry
                for (let j = 0; j < 3; j++) {
                  candidateDescendant = candidateDescendant?.parentElement;
                  if (candidateDescendant === hint.element) {
                    return false; // This is a false positive
                  }
                }
              }
              
              return true;
            });
            
            // Return only the data needed by the renderer (not the element references)
            return hints.map(hint => ({
              rect: hint.rect,
              linkText: hint.linkText,
              tagName: hint.tagName,
              href: hint.href,
              reason: hint.reason
            }));
          };
          
          // Auto-show hints when page loads
          setTimeout(() => {
            if (window.showHints) {
              window.showHints();
            }
          }, 1000);
        })();
      `;
      view.webContents.executeJavaScript(hintDetectorScript)
        .then(() => {
          console.log(`Successfully injected hint detection script for view: ${key}`);
        })
        .catch(error => {
          console.error(`Failed to inject hint detection script for view: ${key}`, error);
        });
    });

    // Handle hint click requests from renderer
    ipcMain.handle(`hint:click:${key}`, async (_, index) => {
      const clickScript = `
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
      view.webContents.executeJavaScript(clickScript);
    });

    views.set(key, view);
    win.contentView.addChildView(view);
    return key;
  });

  ipcMain.handle("view:setBounds", async (_, key, bounds) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    // Validate bounds structure
    if (!bounds || typeof bounds !== 'object' ||
        typeof bounds.x !== 'number' ||
        typeof bounds.y !== 'number' ||
        typeof bounds.width !== 'number' ||
        typeof bounds.height !== 'number') {
      throw new TypeError(`Invalid bounds format: ${JSON.stringify(bounds)}`);
    }
    
    view.setBounds(bounds);
  });

  ipcMain.handle("view:remove", async (_, key) => {
    const view = views.get(key);
    if (!view) {
      console.warn(`[Main] View not found during removal: ${key}`);
      return; // Exit early if view doesn't exist
    }
    if (win) win.contentView.removeChildView(view);
    views.delete(key);
    console.log(`[Main] Removed view: ${key}`);
  });

  ipcMain.handle("nav:back", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.goBack();
  });

  ipcMain.handle("nav:forward", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.goForward();
  });

  ipcMain.handle("nav:canGoBack", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.canGoBack();
  });

  ipcMain.handle("nav:canGoForward", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.canGoForward();
  });

  ipcMain.handle("nav:loadURL", async (_, key, url) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);

    try {
      await view.webContents.loadURL(url);
      await waitForReadyState(view, "complete");

      // Get page metadata after load completes
      const title = view.webContents.getTitle();
      const favicon = await view.webContents.executeJavaScript(`
        document.querySelector('link[rel="icon"]')?.href ||
        document.querySelector('link[rel="shortcut icon"]')?.href ||
        ''
      `);
      return { title, favicon };
    } catch (error) {
      console.error("Failed to load URL or get HTML:", error);
      throw error;
    }
  });

  async function waitForReadyState(view: WebContentsView, targetState: string) {
    while (true) {
      try {
        const readyState = await view.webContents.executeJavaScript(
          "document.readyState"
        );
        if (readyState === targetState) {
          break;
        }
      } catch (error) {
        console.error("Error checking readyState:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // wait 100ms
    }
  }

  ipcMain.handle("nav:getCurrentURL", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.getURL();
  });

  ipcMain.handle("nav:getFavicon", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      const favicon = await view.webContents.executeJavaScript(`
        document.querySelector('link[rel="icon"]')?.href ||
        document.querySelector('link[rel="shortcut icon"]')?.href ||
        ''
      `);
      return favicon;
    } catch (error) {
      console.error("Error getting favicon:", error);
      return "";
    }
  });

  ipcMain.handle("nav:getPageTitle", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.getTitle();
  });

  ipcMain.handle("nav:getHistory", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    return view.webContents.navigationHistory.getAllEntries();
  });

  ipcMain.handle("hints:detect", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    console.log(`Detecting hints for view: ${key}`);
    try {
      // Just call the already injected detectHints function
      const hints = await view.webContents.executeJavaScript("window.detectHints ? window.detectHints() : []");
      console.log(`Found ${hints?.length || 0} hints for view: ${key}`);
      return hints || [];
    } catch (error) {
      console.error(`Error detecting hints for view: ${key}:`, error);
      return [];
    }
  });

  ipcMain.handle("hints:show", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      await view.webContents.executeJavaScript("window.showHints ? window.showHints() : []");
      console.log(`Showed hints for view: ${key}`);
    } catch (error) {
      console.error(`Error showing hints for view: ${key}:`, error);
    }
  });

  ipcMain.handle("hints:hide", async (_, key) => {
    const view = views.get(key);
    if (!view) throw new Error(`View not found: ${key}`);
    
    try {
      await view.webContents.executeJavaScript("window.hideHints ? window.hideHints() : null");
      console.log(`Hid hints for view: ${key}`);
    } catch (error) {
      console.error(`Error hiding hints for view: ${key}:`, error);
    }
  });

  // Forward active view change events to renderer
  ipcMain.on("active-view-changed", (_, viewKey) => {
    win.webContents.send("active-view-changed", viewKey);
  });

  // Make all links open with the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });

  // Auto update
  update(win);

  // Add new handler for GenAI messages
  ipcMain.handle("genai:send", async (_, message: string) => {
    return agentService.processMessage(message);
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});

// New window example arg: new windows url
ipcMain.handle("open-win", (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`);
  } else {
    childWindow.loadFile(indexHtml, { hash: arg });
  }
});
