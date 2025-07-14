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