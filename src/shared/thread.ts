/**
 * thread-related types for the new architecture
 * Each thread (assistant-ui thread) can have multiple browser views
 */

import { z } from "zod";

// Type aliases for clarity
export type ThreadId = string;
export type ViewId = string;

// Thread-view state for tracking relationships
export const ThreadViewStateSchema = z.object({
	threadId: z.string().min(1),
	viewIds: z.array(z.string()),
	activeViewId: z.string().nullable(),
});

export type ThreadViewState = z.infer<typeof ThreadViewStateSchema>;
