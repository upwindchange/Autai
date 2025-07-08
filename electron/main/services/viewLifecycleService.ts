import { WebContentsView } from "electron";

interface ViewLifecycleInfo {
  key: string;
  createdAt: Date;
  lastAccessedAt: Date;
  url: string;
  isActive: boolean;
}

/**
 * Tracks the lifecycle of WebContentsViews
 */
export class ViewLifecycleService {
  private viewLifecycles = new Map<string, ViewLifecycleInfo>();
  private activeViewKey: string | null = null;

  /**
   * Register a new view
   */
  registerView(key: string, url: string) {
    this.viewLifecycles.set(key, {
      key,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      url,
      isActive: false
    });
    console.log(`[ViewLifecycle] Registered view: ${key} for URL: ${url}`);
  }

  /**
   * Update the active view
   */
  setActiveView(key: string) {
    // Mark previous active view as inactive
    if (this.activeViewKey && this.viewLifecycles.has(this.activeViewKey)) {
      const prevView = this.viewLifecycles.get(this.activeViewKey)!;
      prevView.isActive = false;
    }

    // Mark new view as active
    if (this.viewLifecycles.has(key)) {
      const view = this.viewLifecycles.get(key)!;
      view.isActive = true;
      view.lastAccessedAt = new Date();
      this.activeViewKey = key;
    }
  }

  /**
   * Unregister a view
   */
  unregisterView(key: string) {
    const view = this.viewLifecycles.get(key);
    if (view) {
      console.log(`[ViewLifecycle] Unregistering view: ${key}, created at: ${view.createdAt.toISOString()}, lifetime: ${Date.now() - view.createdAt.getTime()}ms`);
      this.viewLifecycles.delete(key);
      
      if (this.activeViewKey === key) {
        this.activeViewKey = null;
      }
    }
  }

  /**
   * Get lifecycle info for a view
   */
  getViewLifecycle(key: string): ViewLifecycleInfo | undefined {
    return this.viewLifecycles.get(key);
  }

  /**
   * Get all views
   */
  getAllViews(): ViewLifecycleInfo[] {
    return Array.from(this.viewLifecycles.values());
  }

  /**
   * Get views that haven't been accessed recently
   */
  getStaleViews(thresholdMinutes: number = 30): ViewLifecycleInfo[] {
    const threshold = Date.now() - (thresholdMinutes * 60 * 1000);
    return this.getAllViews().filter(view => 
      !view.isActive && view.lastAccessedAt.getTime() < threshold
    );
  }

  /**
   * Log current state
   */
  logState() {
    console.log("[ViewLifecycle] Current state:");
    console.log(`  Active view: ${this.activeViewKey}`);
    console.log(`  Total views: ${this.viewLifecycles.size}`);
    
    this.viewLifecycles.forEach(view => {
      console.log(`  - ${view.key}: ${view.url} (active: ${view.isActive}, created: ${view.createdAt.toISOString()})`);
    });
  }
}

export const viewLifecycleService = new ViewLifecycleService();