import { BrowserWindow, WebContentsView } from 'electron';
import type { Task, Page, View, Agent, AppState, StateChangeEvent } from '../../shared/types';
import { getHintDetectorScript } from '../scripts/hintDetectorLoader';

/**
 * Central state management for the entire application.
 * Manages tasks, pages, views, and agents with proper lifecycle handling.
 */
export class StateManager {
  private tasks = new Map<string, Task>();
  private views = new Map<string, View>();
  private agents = new Map<string, Agent>();
  private webContentsViews = new Map<string, WebContentsView>();
  
  private activeTaskId: string | null = null;
  private activeViewId: string | null = null;
  
  private stateChangeListeners: ((event: StateChangeEvent) => void)[] = [];
  private win: BrowserWindow;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (event: StateChangeEvent) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter(l => l !== listener);
    };
  }

  private emit(event: StateChangeEvent) {
    this.stateChangeListeners.forEach(listener => listener(event));
  }

  /**
   * Task operations
   */
  createTask(title: string = 'New Task', initialUrl?: string): Task {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const task: Task = {
      id: taskId,
      title,
      pages: new Map(),
      activePageId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.tasks.set(taskId, task);
    this.emit({ type: 'TASK_CREATED', task });

    // Create initial page if URL provided
    if (initialUrl) {
      this.addPage(taskId, initialUrl);
    }

    return task;
  }

  deleteTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Delete all views for this task
    const viewsToDelete = Array.from(this.views.values())
      .filter(view => view.taskId === taskId);
    
    viewsToDelete.forEach(view => this.destroyView(view.id));

    // Delete all agents for this task
    const agentsToDelete = Array.from(this.agents.values())
      .filter(agent => agent.taskId === taskId);
    
    agentsToDelete.forEach(agent => this.destroyAgent(agent.id));

    // Delete the task
    this.tasks.delete(taskId);
    
    if (this.activeTaskId === taskId) {
      this.activeTaskId = null;
      this.emit({ type: 'ACTIVE_TASK_CHANGED', taskId: null });
    }

    this.emit({ type: 'TASK_DELETED', taskId });
  }

  /**
   * Page operations
   */
  async addPage(taskId: string, url: string): Promise<Page | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const pageId = `page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const page: Page = {
      id: pageId,
      url,
      title: 'Loading...',
      favicon: '',
      createdAt: Date.now(),
      lastVisited: Date.now()
    };

    task.pages.set(pageId, page);
    task.updatedAt = Date.now();
    
    // Set as active if it's the first page
    if (task.pages.size === 1) {
      task.activePageId = pageId;
    }

    this.emit({ type: 'PAGE_ADDED', taskId, page });

    // Create view for this page
    const view = await this.createView(taskId, pageId);
    if (view && task.activePageId === pageId) {
      this.setActiveView(view.id);
    }

    return page;
  }

  removePage(taskId: string, pageId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.pages.has(pageId)) return;

    // Find and destroy associated view
    const view = Array.from(this.views.values())
      .find(v => v.taskId === taskId && v.pageId === pageId);
    
    if (view) {
      this.destroyView(view.id);
    }

    task.pages.delete(pageId);
    task.updatedAt = Date.now();

    // Update active page if needed
    if (task.activePageId === pageId) {
      const remainingPages = Array.from(task.pages.keys());
      task.activePageId = remainingPages[0] || null;
    }

    this.emit({ type: 'PAGE_REMOVED', taskId, pageId });
  }

  updatePage(taskId: string, pageId: string, updates: Partial<Page>): void {
    const task = this.tasks.get(taskId);
    const page = task?.pages.get(pageId);
    if (!page) return;

    Object.assign(page, updates);
    task.updatedAt = Date.now();

    this.emit({ type: 'PAGE_UPDATED', taskId, pageId, updates });
  }

  /**
   * View operations
   */
  async createView(taskId: string, pageId: string): Promise<View | null> {
    const task = this.tasks.get(taskId);
    const page = task?.pages.get(pageId);
    if (!task || !page) return null;

    // Check if view already exists
    const existingView = Array.from(this.views.values())
      .find(v => v.taskId === taskId && v.pageId === pageId);
    if (existingView) return existingView;

    const viewId = `view-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create WebContentsView
    const webView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      }
    });

    webView.setBackgroundColor('#00000000');
    
    // Set up event handlers
    webView.webContents.on('page-title-updated', (_, title) => {
      this.updatePage(taskId, pageId, { title });
    });

    webView.webContents.on('page-favicon-updated', (_, favicons) => {
      if (favicons.length > 0) {
        this.updatePage(taskId, pageId, { favicon: favicons[0] });
      }
    });

    webView.webContents.on('did-finish-load', () => {
      // Inject hint detector for AI interaction
      const hintDetectorScript = getHintDetectorScript();
      webView.webContents.executeJavaScript(hintDetectorScript)
        .catch(error => console.error('Failed to inject hint detector:', error));
    });

    // Load URL
    try {
      await webView.webContents.loadURL(page.url);
    } catch (error) {
      console.error(`Failed to load URL ${page.url}:`, error);
    }

    // Create view metadata
    const view: View = {
      id: viewId,
      taskId,
      pageId,
      webContentsId: webView.webContents.id,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      isActive: false,
      isVisible: false
    };

    this.views.set(viewId, view);
    this.webContentsViews.set(viewId, webView);
    this.win.contentView.addChildView(webView);

    this.emit({ type: 'VIEW_CREATED', view });
    return view;
  }

  destroyView(viewId: string): void {
    const view = this.views.get(viewId);
    const webView = this.webContentsViews.get(viewId);
    
    if (!view || !webView) return;

    // Remove from window
    this.win.contentView.removeChildView(webView);
    
    // Clean up WebContents
    if (!webView.webContents.isDestroyed()) {
      webView.webContents.stop();
      webView.webContents.removeAllListeners();
      webView.webContents.close();
    }

    this.views.delete(viewId);
    this.webContentsViews.delete(viewId);

    if (this.activeViewId === viewId) {
      this.activeViewId = null;
      this.emit({ type: 'ACTIVE_VIEW_CHANGED', viewId: null });
    }

    this.emit({ type: 'VIEW_DELETED', viewId });
  }

  setViewBounds(viewId: string, bounds: Electron.Rectangle): void {
    const view = this.views.get(viewId);
    const webView = this.webContentsViews.get(viewId);
    
    if (!view || !webView) return;

    view.bounds = bounds;
    view.isVisible = bounds.width > 0 && bounds.height > 0;
    
    // Only set bounds for the active view or when explicitly hiding
    if (viewId === this.activeViewId || bounds.width === 0) {
      webView.setBounds(bounds);
    }

    this.emit({ type: 'VIEW_UPDATED', viewId, updates: { bounds, isVisible: view.isVisible } });
  }

  setActiveView(viewId: string | null): void {
    // Deactivate current view
    if (this.activeViewId) {
      const currentView = this.views.get(this.activeViewId);
      if (currentView) {
        currentView.isActive = false;
        this.emit({ type: 'VIEW_UPDATED', viewId: this.activeViewId, updates: { isActive: false } });
      }
    }

    // Activate new view
    this.activeViewId = viewId;
    if (viewId) {
      const view = this.views.get(viewId);
      if (view) {
        view.isActive = true;
        this.activeTaskId = view.taskId;
        this.emit({ type: 'VIEW_UPDATED', viewId, updates: { isActive: true } });
        this.emit({ type: 'ACTIVE_TASK_CHANGED', taskId: view.taskId });
      }
    }

    this.emit({ type: 'ACTIVE_VIEW_CHANGED', viewId });
    
    // Update view visibility - hide all views except the active one
    this.updateViewVisibility();
  }
  
  /**
   * Updates visibility of all views - shows only the active view
   */
  private updateViewVisibility(): void {
    this.views.forEach((view, viewId) => {
      const webView = this.webContentsViews.get(viewId);
      if (!webView) return;
      
      if (viewId === this.activeViewId && view.isVisible) {
        // Show active view with its current bounds
        webView.setBounds(view.bounds);
      } else {
        // Hide non-active views
        webView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    });
  }

  /**
   * Agent operations (placeholder for future implementation)
   */
  createAgent(taskId: string): Agent {
    const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const agent: Agent = {
      id: agentId,
      taskId,
      processId: -1, // Will be set when process is spawned
      status: 'idle',
      createdAt: Date.now()
    };

    this.agents.set(agentId, agent);
    this.emit({ type: 'AGENT_CREATED', agent });
    return agent;
  }

  destroyAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // TODO: Terminate process when implemented
    this.agents.delete(agentId);
    this.emit({ type: 'AGENT_DELETED', agentId });
  }

  updateAgentStatus(agentId: string, status: Agent['status']): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.status = status;
    this.emit({ type: 'AGENT_STATUS_CHANGED', agentId, status });
  }

  /**
   * State queries
   */
  getFullState(): AppState {
    // Convert Maps to plain objects for serialization
    const tasksObj: Record<string, Task> = {};
    this.tasks.forEach((task, id) => {
      tasksObj[id] = {
        ...task,
        pages: Object.fromEntries(task.pages) as any // Will be converted back to Map in renderer
      };
    });

    return {
      tasks: tasksObj,
      views: Object.fromEntries(this.views),
      agents: Object.fromEntries(this.agents),
      activeTaskId: this.activeTaskId,
      activeViewId: this.activeViewId
    };
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getView(viewId: string): View | undefined {
    return this.views.get(viewId);
  }

  getWebContentsView(viewId: string): WebContentsView | undefined {
    return this.webContentsViews.get(viewId);
  }

  getViewsForTask(taskId: string): View[] {
    return Array.from(this.views.values()).filter(view => view.taskId === taskId);
  }

  getViewForPage(taskId: string, pageId: string): View | undefined {
    return Array.from(this.views.values())
      .find(view => view.taskId === taskId && view.pageId === pageId);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Destroy all views
    Array.from(this.views.keys()).forEach(viewId => this.destroyView(viewId));
    
    // Clear all data
    this.tasks.clear();
    this.views.clear();
    this.agents.clear();
    this.webContentsViews.clear();
    this.stateChangeListeners = [];
  }
}