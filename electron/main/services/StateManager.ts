import { BrowserWindow } from "electron";
import type {
  Task,
  Page,
  View,
  Agent,
  AppState,
  StateChangeEvent,
  IViewManager,
} from "../../shared/types";
import { PageUpdateSchema } from "../../shared/types";

/**
 * Central state management for the entire application.
 * Manages tasks, pages, views, and agents with proper lifecycle handling.
 */
export class StateManager {
  private tasks = new Map<string, Task>();
  private views = new Map<string, View>();
  private agents = new Map<string, Agent>();

  private activeTaskId: string | null = null;
  private activeViewId: string | null = null;

  private stateChangeListeners: ((event: StateChangeEvent) => void)[] = [];
  private win: BrowserWindow;
  private viewManager: IViewManager | null = null;
  private isDestroyed = false;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  /**
   * Set the view manager dependency (called after both services are created)
   */
  setViewManager(viewManager: IViewManager): void {
    if (this.viewManager) {
      throw new Error("ViewManager already set");
    }
    if (!viewManager) {
      throw new Error("ViewManager cannot be null or undefined");
    }
    this.viewManager = viewManager;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (event: StateChangeEvent) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter(
        (l) => l !== listener
      );
    };
  }

  private emit(event: StateChangeEvent) {
    this.stateChangeListeners.forEach((listener) => listener(event));
  }

  /**
   * Public method to emit state changes (for use by other services)
   */
  emitStateChange(event: StateChangeEvent) {
    this.emit(event);
  }

  /**
   * Task operations
   */
  async createTask(title: string = "New Task", initialUrl?: string): Promise<Task> {
    const taskId = `task-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    const task: Task = {
      id: taskId,
      title,
      pages: new Map(),
      activePageId: null,
    };

    this.tasks.set(taskId, task);
    this.emit({ type: "TASK_CREATED", task });

    // Create initial page if URL provided
    if (initialUrl) {
      const page = await this.addPage(taskId, initialUrl);
      if (page) {
        // Update the task's activePageId if it wasn't set in addPage
        const updatedTask = this.tasks.get(taskId);
        if (updatedTask && !updatedTask.activePageId) {
          updatedTask.activePageId = page.id;
        }
      }
    }

    return task;
  }

  deleteTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Delete all views for this task
    const viewsToDelete = this.getViewsForTask(taskId);
    viewsToDelete.forEach((view) => {
      this.viewManager?.destroyView(view.id);
    });

    // Delete all agents for this task
    const agentsToDelete = Array.from(this.agents.values()).filter(
      (agent) => agent.taskId === taskId
    );

    agentsToDelete.forEach((agent) => this.destroyAgent(agent.id));

    // Delete the task
    this.tasks.delete(taskId);

    if (this.activeTaskId === taskId) {
      this.activeTaskId = null;
      this.emit({ type: "ACTIVE_TASK_CHANGED", taskId: null });
    }

    this.emit({ type: "TASK_DELETED", taskId });
  }

  /**
   * Page operations
   */
  async addPage(taskId: string, url: string): Promise<Page | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const pageId = `page-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    const page: Page = {
      id: pageId,
      url,
      title: "Loading...",
      favicon: "",
    };

    task.pages.set(pageId, page);

    // Set as active if it's the first page
    if (task.pages.size === 1) {
      task.activePageId = pageId;
    }

    this.emit({ type: "PAGE_ADDED", taskId, page });

    // Create view for this page
    const view = await this.viewManager?.createView(taskId, pageId, url);
    if (view && task.activePageId === pageId) {
      // Set as active view and make visible
      this.setActiveView(view.id);
      this.viewManager?.setActiveView(view.id);
    }

    return page;
  }

  removePage(taskId: string, pageId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.pages.has(pageId)) return;

    // Find and destroy associated view
    const view = this.getViewForPage(taskId, pageId);
    if (view) {
      this.viewManager?.destroyView(view.id);
    }

    task.pages.delete(pageId);

    // Update active page if needed
    if (task.activePageId === pageId) {
      const remainingPages = Array.from(task.pages.keys());
      task.activePageId = remainingPages[0] || null;
    }

    this.emit({ type: "PAGE_REMOVED", taskId, pageId });
  }

  updatePage(taskId: string, pageId: string, updates: Partial<Page>): void {
    const task = this.tasks.get(taskId);
    const page = task?.pages.get(pageId);
    if (!page || !task) return;

    // Validate updates with Zod
    const validation = PageUpdateSchema.safeParse(updates);
    if (!validation.success) {
      console.warn(`Invalid page update for ${pageId}:`, validation.error.format());
      return;
    }

    Object.assign(page, validation.data);

    this.emit({ type: "PAGE_UPDATED", taskId, pageId, updates: validation.data });
  }

  /**
   * View operations (metadata only - WebContentsView handled by WebViewService)
   */

  setActiveView(viewId: string | null): void {
    // Don't update if it's already the active view
    if (this.activeViewId === viewId) return;

    // Update active view ID
    this.activeViewId = viewId;

    // Update active task if we have a view
    if (viewId) {
      const view = this.views.get(viewId);
      if (view) {
        this.activeTaskId = view.taskId;
        this.emit({ type: "ACTIVE_TASK_CHANGED", taskId: view.taskId });
      }
    }

    this.emit({ type: "ACTIVE_VIEW_CHANGED", viewId });
  }

  /**
   * Helper methods for WebViewService
   */
  isActiveView(viewId: string): boolean {
    return this.activeViewId === viewId;
  }

  getActiveViewId(): string | null {
    return this.activeViewId;
  }

  /**
   * Agent operations (placeholder for future implementation)
   */
  createAgent(taskId: string): Agent {
    const agentId = `agent-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;
    const agent: Agent = {
      id: agentId,
      taskId,
      processId: -1, // Will be set when process is spawned
      status: "idle",
      createdAt: Date.now(),
    };

    this.agents.set(agentId, agent);
    this.emit({ type: "AGENT_CREATED", agent });
    return agent;
  }

  destroyAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // TODO: Terminate process when implemented
    this.agents.delete(agentId);
    this.emit({ type: "AGENT_DELETED", agentId });
  }

  updateAgentStatus(agentId: string, status: Agent["status"]): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.status = status;
    this.emit({ type: "AGENT_STATUS_CHANGED", agentId, status });
  }

  /**
   * State queries
   */
  getFullState(): AppState {
    // Convert Maps to plain objects for serialization
    const tasksObj: Record<string, Task> = {};
    this.tasks.forEach((task, id) => {
      tasksObj[id] = task;
    });

    return {
      tasks: tasksObj,
      views: Object.fromEntries(this.views),
      agents: Object.fromEntries(this.agents),
      activeTaskId: this.activeTaskId,
      activeViewId: this.activeViewId,
    };
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getView(viewId: string): View | undefined {
    return this.views.get(viewId);
  }

  getViewsForTask(taskId: string): View[] {
    return Array.from(this.views.values()).filter(
      (view) => view.taskId === taskId
    );
  }

  getViewForPage(taskId: string, pageId: string): View | undefined {
    return Array.from(this.views.values()).find(
      (view) => view.taskId === taskId && view.pageId === pageId
    );
  }

  /**
   * Register a view (for use by WebViewService)
   */
  registerView(viewId: string, view: View): void {
    this.views.set(viewId, view);
    this.emit({ type: "VIEW_CREATED", view });
  }

  /**
   * Unregister a view (for use by WebViewService)
   */
  unregisterView(viewId: string): void {
    this.views.delete(viewId);

    if (this.activeViewId === viewId) {
      this.activeViewId = null;
      this.emit({ type: "ACTIVE_VIEW_CHANGED", viewId: null });
    }

    this.emit({ type: "VIEW_DELETED", viewId });
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Prevent multiple destroy calls
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Note: Views are destroyed by WebViewService

    // Clear all data
    this.tasks.clear();
    this.views.clear();
    this.agents.clear();
    this.stateChangeListeners = [];
  }
}
