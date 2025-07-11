import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { StateManager } from '../services/StateManager';
import { settingsService } from '../services';
import type { 
  CreateTaskCommand, 
  AddPageCommand, 
  SelectPageCommand, 
  DeleteTaskCommand,
  DeletePageCommand,
  SetViewBoundsCommand,
  NavigateCommand,
  StateChangeEvent 
} from '../../shared/types';

/**
 * Bridges IPC communication between main and renderer processes.
 * Handles all state-related commands and synchronization.
 */
export class StateBridge {
  private stateManager: StateManager;
  private win: BrowserWindow;
  private unsubscribe: (() => void) | null = null;

  constructor(stateManager: StateManager, win: BrowserWindow) {
    this.stateManager = stateManager;
    this.win = win;
    this.setupHandlers();
    this.setupStateSync();
  }

  private setupHandlers(): void {
    // Task operations
    ipcMain.handle('app:createTask', async (_event: IpcMainInvokeEvent, command: CreateTaskCommand) => {
      try {
        const task = this.stateManager.createTask(command.title, command.initialUrl);
        return { success: true, data: task };
      } catch (error) {
        console.error('Error creating task:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('app:deleteTask', async (_event: IpcMainInvokeEvent, command: DeleteTaskCommand) => {
      try {
        this.stateManager.deleteTask(command.taskId);
        return { success: true };
      } catch (error) {
        console.error('Error deleting task:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Page operations
    ipcMain.handle('app:addPage', async (_event: IpcMainInvokeEvent, command: AddPageCommand) => {
      try {
        const page = await this.stateManager.addPage(command.taskId, command.url);
        return { success: true, data: page };
      } catch (error) {
        console.error('Error adding page:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('app:deletePage', async (_event: IpcMainInvokeEvent, command: DeletePageCommand) => {
      try {
        this.stateManager.removePage(command.taskId, command.pageId);
        return { success: true };
      } catch (error) {
        console.error('Error deleting page:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('app:selectPage', async (_event: IpcMainInvokeEvent, command: SelectPageCommand) => {
      try {
        const view = this.stateManager.getViewForPage(command.taskId, command.pageId);
        if (view) {
          this.stateManager.setActiveView(view.id);
          
          // Update task's active page
          const task = this.stateManager.getTask(command.taskId);
          if (task) {
            task.activePageId = command.pageId;
          }
        }
        return { success: true };
      } catch (error) {
        console.error('Error selecting page:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // View operations
    ipcMain.handle('app:setViewBounds', async (_event: IpcMainInvokeEvent, command: SetViewBoundsCommand) => {
      try {
        this.stateManager.setViewBounds(command.viewId, command.bounds);
        return { success: true };
      } catch (error) {
        console.error('Error setting view bounds:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Navigation operations
    ipcMain.handle('app:navigate', async (_event: IpcMainInvokeEvent, command: NavigateCommand) => {
      try {
        const views = Array.from(this.stateManager.getFullState().views);
        const view = views.find(([_, v]) => v.pageId === command.pageId)?.[1];
        
        if (view) {
          const webView = this.stateManager.getWebContentsView(view.id);
          if (webView) {
            await webView.webContents.loadURL(command.url);
            
            // Update page URL
            this.stateManager.updatePage(view.taskId, command.pageId, { 
              url: command.url,
              lastVisited: Date.now()
            });
          }
        }
        return { success: true };
      } catch (error) {
        console.error('Error navigating:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Get initial state
    ipcMain.handle('app:getState', async () => {
      return this.stateManager.getFullState();
    });

    // Get interactable elements (for AI agent)
    ipcMain.handle('app:getInteractableElements', async (_event: IpcMainInvokeEvent, viewId: string, viewportOnly: boolean = true) => {
      try {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (!webView) return [];
        
        const elements = await webView.webContents.executeJavaScript(
          `window.getInteractableElements ? window.getInteractableElements(${viewportOnly}) : []`
        );
        return elements || [];
      } catch (error) {
        console.error('Error getting interactable elements:', error);
        return [];
      }
    });

    // Click element by ID (for AI agent)
    ipcMain.handle('app:clickElement', async (_event: IpcMainInvokeEvent, viewId: string, elementId: number, viewportOnly: boolean = true) => {
      try {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (!webView) return false;
        
        const result = await webView.webContents.executeJavaScript(
          `window.clickElementById ? window.clickElementById(${elementId}, ${viewportOnly}) : false`
        );
        return result;
      } catch (error) {
        console.error('Error clicking element:', error);
        return false;
      }
    });

    // Navigation controls
    ipcMain.handle('app:goBack', async (_event: IpcMainInvokeEvent, viewId: string) => {
      try {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView && webView.webContents.canGoBack()) {
          webView.webContents.goBack();
          return { success: true };
        }
        return { success: false, error: 'Cannot go back' };
      } catch (error) {
        console.error('Error going back:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('app:goForward', async (_event: IpcMainInvokeEvent, viewId: string) => {
      try {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView && webView.webContents.canGoForward()) {
          webView.webContents.goForward();
          return { success: true };
        }
        return { success: false, error: 'Cannot go forward' };
      } catch (error) {
        console.error('Error going forward:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('app:reload', async (_event: IpcMainInvokeEvent, viewId: string) => {
      try {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView) {
          webView.webContents.reload();
          return { success: true };
        }
        return { success: false, error: 'View not found' };
      } catch (error) {
        console.error('Error reloading:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('app:stop', async (_event: IpcMainInvokeEvent, viewId: string) => {
      try {
        const webView = this.stateManager.getWebContentsView(viewId);
        if (webView) {
          webView.webContents.stop();
          return { success: true };
        }
        return { success: false, error: 'View not found' };
      } catch (error) {
        console.error('Error stopping:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Expand/collapse task
    ipcMain.handle('app:setExpandedTask', async (_event: IpcMainInvokeEvent, taskId: string | null) => {
      // This is UI-only state, just acknowledge it
      return { success: true };
    });

    // Hide/show views using the View's setVisible API
    ipcMain.handle('app:setViewVisibility', async (_event: IpcMainInvokeEvent, { viewId, isHidden }: { viewId: string; isHidden: boolean }) => {
      try {
        // Use the StateManager's method which handles visibility properly
        this.stateManager.setViewVisibility(viewId, !isHidden);
        return { success: true };
      } catch (error) {
        console.error('Error setting view visibility:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    // Settings handlers
    ipcMain.handle('settings:load', async () => {
      return await settingsService.loadSettings();
    });

    ipcMain.handle('settings:save', async (_event: IpcMainInvokeEvent, settings: any) => {
      await settingsService.saveSettings(settings);
      return { success: true };
    });

    ipcMain.handle('settings:test', async (_event: IpcMainInvokeEvent, config: any) => {
      return await settingsService.testConnection(config);
    });

    ipcMain.handle('settings:getActive', async () => {
      return settingsService.getActiveSettings();
    });

    ipcMain.handle('settings:isConfigured', async () => {
      return settingsService.isConfigured();
    });

    // Temporary AI handlers (will be replaced with multi-process implementation)
    ipcMain.handle('ai:streamMessage', async (event: IpcMainInvokeEvent, taskId: string, message: string, includeContext: boolean = false) => {
      console.log(`AI streaming placeholder for task ${taskId}: ${message}`);
      const streamId = `${taskId}-${Date.now()}`;
      
      // Send a placeholder response
      setTimeout(() => {
        event.sender.send(`ai:stream:${streamId}`, {
          type: 'token',
          content: 'AI agents are being upgraded to multi-process architecture. This is a placeholder response.',
          metadata: { taskId }
        });
        event.sender.send(`ai:stream:${streamId}:end`);
      }, 100);
      
      return streamId;
    });

    ipcMain.handle('ai:clearHistory', async (_event: IpcMainInvokeEvent, taskId: string) => {
      console.log(`AI clear history placeholder for task ${taskId}`);
      return { success: true };
    });

    ipcMain.handle('ai:getHistory', async (_event: IpcMainInvokeEvent, taskId: string) => {
      console.log(`AI get history placeholder for task ${taskId}`);
      return [];
    });

    ipcMain.handle('ai:removeAgent', async (_event: IpcMainInvokeEvent, taskId: string) => {
      console.log(`AI remove agent placeholder for task ${taskId}`);
      return { success: true };
    });

    ipcMain.handle('ai:getActiveTasks', async () => {
      return [];
    });
  }

  private setupStateSync(): void {
    // Subscribe to state changes and forward to renderer
    this.unsubscribe = this.stateManager.subscribe((event: StateChangeEvent) => {
      if (!this.win.isDestroyed() && this.win.webContents) {
        this.win.webContents.send('state:change', event);
      }
    });

    // Send full state sync periodically (as backup)
    setInterval(() => {
      if (!this.win.isDestroyed() && this.win.webContents) {
        this.win.webContents.send('state:sync', this.stateManager.getFullState());
      }
    }, 5000);
  }

  /**
   * Update view bounds for all views based on container bounds
   */
  updateViewBounds(containerBounds: Electron.Rectangle): void {
    const state = this.stateManager.getFullState();
    const activeViewId = state.activeViewId;

    // Update bounds for active view only - visibility is handled separately
    if (activeViewId) {
      const view = state.views[activeViewId];
      if (view) {
        this.stateManager.setViewBounds(view.id, containerBounds);
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Remove all IPC handlers
    const handlers = [
      'app:createTask', 'app:deleteTask', 'app:addPage', 'app:deletePage',
      'app:selectPage', 'app:setViewBounds', 'app:navigate', 'app:getState',
      'app:getInteractableElements', 'app:clickElement', 'app:goBack',
      'app:goForward', 'app:reload', 'app:stop', 'app:setExpandedTask',
      'app:setViewVisibility'
    ];

    handlers.forEach(channel => ipcMain.removeHandler(channel));

    // Also remove settings handlers
    const settingsHandlers = [
      'settings:load', 'settings:save', 'settings:test', 
      'settings:getActive', 'settings:isConfigured'
    ];
    settingsHandlers.forEach(channel => ipcMain.removeHandler(channel));

    // Remove AI handlers
    const aiHandlers = [
      'ai:streamMessage', 'ai:clearHistory', 'ai:getHistory',
      'ai:removeAgent', 'ai:getActiveTasks'
    ];
    aiHandlers.forEach(channel => ipcMain.removeHandler(channel));
  }
}