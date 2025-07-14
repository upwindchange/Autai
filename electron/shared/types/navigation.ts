/**
 * Navigation-related types shared between main and renderer processes
 */

export interface NavigateCommand {
  taskId: string;
  pageId: string;
  url: string;
}

export interface NavigationResult {
  success: boolean;
  error?: string;
  url?: string;
}