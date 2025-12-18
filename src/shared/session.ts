/**
 * thread-related types for the new architecture
 * Each thread (assistant-ui thread) can have multiple browser views
 */

import { z } from "zod";

// Type aliases for clarity
export type SessionId = string;
export type TabId = string;

// Thread-view state for tracking relationships
export const SessionTabStateSchema = z.object({
	sessionId: z.string().min(1),
	tabIds: z.array(z.string()),
	activeTabId: z.string().nullable(),
});

export type sessionTabState = z.infer<typeof SessionTabStateSchema>;
