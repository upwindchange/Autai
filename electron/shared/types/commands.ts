/**
 * IPC command types shared between main and renderer processes
 */

import type { Rectangle } from 'electron';

export interface CreateTaskCommand {
  title?: string;
  initialUrl?: string;
}

export interface AddPageCommand {
  taskId: string;
  url: string;
}

export interface SelectPageCommand {
  taskId: string;
  pageId: string;
}

export interface DeleteTaskCommand {
  taskId: string;
}

export interface DeletePageCommand {
  taskId: string;
  pageId: string;
}

export interface SetViewBoundsCommand {
  viewId: string;
  bounds: Rectangle;
}

export interface SetViewVisibilityCommand {
  viewId: string;
  isHidden: boolean;
}

export interface StreamMessageCommand {
  taskId: string;
  message: string;
}

export interface ClearHistoryCommand {
  taskId: string;
}

export interface NavigationControlCommand {
  taskId: string;
  pageId: string;
  action: 'back' | 'forward' | 'reload' | 'stop';
}

// Browser Action Commands
export interface NavigateToCommand {
  taskId: string;
  pageId: string;
  url: string;
}

export interface BrowserNavigationCommand {
  taskId: string;
  pageId: string;
}

export interface ClickElementCommand {
  taskId: string;
  pageId: string;
  elementId: number;
}

export interface TypeTextCommand {
  taskId: string;
  pageId: string;
  elementId: number;
  text: string;
}

export interface PressKeyCommand {
  taskId: string;
  pageId: string;
  key: string;
}

export interface GetPageElementsCommand {
  taskId: string;
  pageId: string;
  options?: {
    viewportOnly?: boolean;
  };
}

export interface ExtractTextCommand {
  taskId: string;
  pageId: string;
  elementId?: number;
}

export interface CaptureScreenshotCommand {
  taskId: string;
  pageId: string;
  options?: {
    rect?: Rectangle;
  };
}

export interface ScrollPageCommand {
  taskId: string;
  pageId: string;
  direction: 'up' | 'down';
  amount?: number;
}

export interface ScrollToElementCommand {
  taskId: string;
  pageId: string;
  elementId: number;
}

export interface HoverCommand {
  taskId: string;
  pageId: string;
  elementId: number;
}

export interface WaitForSelectorCommand {
  taskId: string;
  pageId: string;
  selector: string;
  timeout?: number;
}

export interface SelectOptionCommand {
  taskId: string;
  pageId: string;
  elementId: number;
  value: string;
}

export interface SetCheckboxCommand {
  taskId: string;
  pageId: string;
  elementId: number;
  checked: boolean;
}

export interface ExecuteScriptCommand {
  taskId: string;
  pageId: string;
  script: string;
}

export interface PageInfoCommand {
  taskId: string;
  pageId: string;
}