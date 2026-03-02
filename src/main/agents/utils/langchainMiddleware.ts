import { modelRetryMiddleware, toolRetryMiddleware } from "langchain";

/**
 * Retry middleware configuration with exponential backoff.
 * Retries failed model and tool calls with:
 * - 2 retries (3 total attempts)
 * - Exponential backoff starting at 1s
 * - Maximum delay of 60s
 * - Random jitter (±25%) to avoid thundering herd
 * - Continues on failure (returns error message instead of raising)
 */
export const retryMiddleware = [
	modelRetryMiddleware({
		maxRetries: 3,
		backoffFactor: 2.0,
		initialDelayMs: 1000,
		maxDelayMs: 60000,
		jitter: true,
		onFailure: "continue",
	}),
	toolRetryMiddleware({
		maxRetries: 3,
		backoffFactor: 2.0,
		initialDelayMs: 1000,
		maxDelayMs: 60000,
		jitter: true,
		onFailure: "continue",
	}),
];
