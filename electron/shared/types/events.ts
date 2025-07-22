/**
 * State change event types shared between main and renderer processes
 */

import { z } from 'zod';
import { 
  TaskSchema, 
  PageSchema, 
  ViewSchema, 
  AgentSchema, 
  AgentStatusSchema,
  TaskIdSchema,
  PageIdSchema,
  ViewIdSchema,
  AgentIdSchema
} from './core';

// Individual event schemas
const TaskCreatedEventSchema = z.object({
  type: z.literal('TASK_CREATED'),
  task: TaskSchema,
});

const TaskDeletedEventSchema = z.object({
  type: z.literal('TASK_DELETED'),
  taskId: TaskIdSchema,
});

const TaskUpdatedEventSchema = z.object({
  type: z.literal('TASK_UPDATED'),
  taskId: TaskIdSchema,
  updates: TaskSchema.partial(),
});

const PageAddedEventSchema = z.object({
  type: z.literal('PAGE_ADDED'),
  taskId: TaskIdSchema,
  page: PageSchema,
});

const PageRemovedEventSchema = z.object({
  type: z.literal('PAGE_REMOVED'),
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
});

const PageUpdatedEventSchema = z.object({
  type: z.literal('PAGE_UPDATED'),
  taskId: TaskIdSchema,
  pageId: PageIdSchema,
  updates: PageSchema.partial(),
});

const ViewCreatedEventSchema = z.object({
  type: z.literal('VIEW_CREATED'),
  view: ViewSchema,
});

const ViewDeletedEventSchema = z.object({
  type: z.literal('VIEW_DELETED'),
  viewId: ViewIdSchema,
});

const ViewUpdatedEventSchema = z.object({
  type: z.literal('VIEW_UPDATED'),
  viewId: ViewIdSchema,
  updates: ViewSchema.partial(),
});

const ViewCrashedEventSchema = z.object({
  type: z.literal('VIEW_CRASHED'),
  viewId: ViewIdSchema,
  details: z.unknown(),
});

const ActiveViewChangedEventSchema = z.object({
  type: z.literal('ACTIVE_VIEW_CHANGED'),
  viewId: ViewIdSchema.nullable(),
});

const ActiveTaskChangedEventSchema = z.object({
  type: z.literal('ACTIVE_TASK_CHANGED'),
  taskId: TaskIdSchema.nullable(),
});

const AgentCreatedEventSchema = z.object({
  type: z.literal('AGENT_CREATED'),
  agent: AgentSchema,
});

const AgentDeletedEventSchema = z.object({
  type: z.literal('AGENT_DELETED'),
  agentId: AgentIdSchema,
});

const AgentStatusChangedEventSchema = z.object({
  type: z.literal('AGENT_STATUS_CHANGED'),
  agentId: AgentIdSchema,
  status: AgentStatusSchema,
});

// Discriminated union of all events
export const StateChangeEventSchema = z.discriminatedUnion('type', [
  TaskCreatedEventSchema,
  TaskDeletedEventSchema,
  TaskUpdatedEventSchema,
  PageAddedEventSchema,
  PageRemovedEventSchema,
  PageUpdatedEventSchema,
  ViewCreatedEventSchema,
  ViewDeletedEventSchema,
  ViewUpdatedEventSchema,
  ViewCrashedEventSchema,
  ActiveViewChangedEventSchema,
  ActiveTaskChangedEventSchema,
  AgentCreatedEventSchema,
  AgentDeletedEventSchema,
  AgentStatusChangedEventSchema,
]);

export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>;