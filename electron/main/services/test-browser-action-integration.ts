// Integration test for debugging BrowserActionService with WebViewService
// This creates a real Electron window and WebContentsView to test the full stack

import { app, BrowserWindow } from "electron";
import { BrowserActionService } from "./BrowserActionService";
import { WebViewService } from "./WebViewService";
import { StateManager } from "./StateManager";

// Test runner function
async function runBrowserActionIntegrationTest() {
  // Wait for app to be ready
  await app.whenReady();

  // Create a test window
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Initialize services
  const stateManager = new StateManager(win);
  const webViewService = new WebViewService(stateManager, win);
  stateManager.setWebViewService(webViewService);

  const browserActionService = new BrowserActionService(webViewService);

  // Create a test task and page
  const taskId = "test-task-1";
  const pageId = "test-page-1";

  // Register the task
  stateManager.createTask("New Task", "https://www.reddit.com");

  try {
    console.log("=== Starting BrowserActionService Integration Test ===\n");

    // Create a view for testing
    console.log("1. Creating WebContentsView...");
    const view = await webViewService.createView(
      taskId,
      pageId,
      "https://example.com"
    );
    if (!view) {
      throw new Error("Failed to create view");
    }
    console.log("✓ View created:", view.id);

    // Set the view as active and visible
    stateManager.setActiveView(view.id);
    const bounds = { x: 0, y: 0, width: 1200, height: 800 };
    webViewService.setViewBounds(view.id, bounds);
    webViewService.updateViewVisibility();

    // Wait for page to load
    console.log("\n2. Waiting for page to load...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("✓ Page loaded");

    // Test navigation
    console.log("\n3. Testing Navigation Actions...");

    const navResult = await browserActionService.navigateTo(
      taskId,
      pageId,
      "https://www.example.com"
    );
    console.log("Navigate result:", navResult);

    // Wait for navigation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const urlResult = await browserActionService.getCurrentUrl(taskId, pageId);
    console.log("Current URL:", urlResult);

    const titleResult = await browserActionService.getPageTitle(taskId, pageId);
    console.log("Page title:", titleResult);

    // Test element detection
    console.log("\n4. Testing Element Detection...");

    const elementsResult = await browserActionService.getPageElements(
      taskId,
      pageId,
      { viewportOnly: true }
    );
    console.log("Elements found:", elementsResult);

    // Test hints
    console.log("\n5. Testing Hint System...");

    const showHintsResult = await browserActionService.showHints(
      taskId,
      pageId
    );
    console.log("Show hints result:", showHintsResult);

    // Wait to see hints
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const hideHintsResult = await browserActionService.hideHints(
      taskId,
      pageId
    );
    console.log("Hide hints result:", hideHintsResult);

    // Test content extraction
    console.log("\n6. Testing Content Extraction...");

    const textResult = await browserActionService.extractText(taskId, pageId);
    console.log(
      "Extracted text (first 100 chars):",
      textResult.extractedContent?.substring(0, 100) + "..."
    );

    // Test screenshot
    console.log("\n7. Testing Screenshot...");

    const screenshotResult = await browserActionService.captureScreenshot(
      taskId,
      pageId
    );
    console.log(
      "Screenshot captured:",
      screenshotResult.success,
      "size:",
      screenshotResult.screenshot?.length
    );

    // Test script execution
    console.log("\n8. Testing Script Execution...");

    const scriptResult = await browserActionService.executeScript(
      taskId,
      pageId,
      'document.querySelectorAll("a").length'
    );
    console.log("Number of links on page:", scriptResult);

    // Test scrolling
    console.log("\n9. Testing Scrolling...");

    const scrollResult = await browserActionService.scrollPage(
      taskId,
      pageId,
      "down",
      300
    );
    console.log("Scroll result:", scrollResult);

    console.log("\n=== Test Complete ===");

    // Keep window open for debugging
    console.log(
      "\nWindow will stay open for debugging. Close it manually when done."
    );
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Run the test if executed directly
if (require.main === module) {
  runBrowserActionIntegrationTest().catch(console.error);
}

export { runBrowserActionIntegrationTest };
