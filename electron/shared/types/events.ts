/**
 * State change event types shared between main and renderer processes
 */

import type { Task, Page, View, Agent } from './core';

export type StateChangeEvent = 
  | { type: 'TASK_CREATED'; task: Task }
  | { type: 'TASK_DELETED'; taskId: string }
  | { type: 'TASK_UPDATED'; taskId: string; updates: Partial<Task> }
  | { type: 'PAGE_ADDED'; taskId: string; page: Page }
  | { type: 'PAGE_REMOVED'; taskId: string; pageId: string }
  | { type: 'PAGE_UPDATED'; taskId: string; pageId: string; updates: Partial<Page> }
  | { type: 'VIEW_CREATED'; view: View }
  | { type: 'VIEW_DELETED'; viewId: string }
  | { type: 'VIEW_UPDATED'; viewId: string; updates: Partial<View> }
  | { type: 'VIEW_CRASHED'; viewId: string; details: unknown }
  | { type: 'ACTIVE_VIEW_CHANGED'; viewId: string | null }
  | { type: 'ACTIVE_TASK_CHANGED'; taskId: string | null }
  | { type: 'AGENT_CREATED'; agent: Agent }
  | { type: 'AGENT_DELETED'; agentId: string }
  | { type: 'AGENT_STATUS_CHANGED'; agentId: string; status: Agent['status'] };