/**
 * Stream utility functions for AI SDK stream handling.
 */

/**
 * Manually merges a ReadableStream into a writer and returns a promise that resolves when complete.
 *
 * This is needed because the AI SDK's writer.merge() doesn't expose the completion promise,
 * making it impossible to wait for nested streams to finish before continuing execution.
 *
 * Based on the AI SDK's internal writer.merge() implementation from create-ui-message-stream.ts
 *
 * @template T - The type of chunks in the stream
 * @param stream - The ReadableStream to read from
 * @param writer - An object with a write method that accepts stream chunks
 * @returns A promise that resolves when the stream is fully consumed
 *
 * @example
 * ```typescript
 * // Instead of:
 * writer.merge(taskExecutorStream);
 * await consumeStream({ stream: taskExecutorStream }); // ERROR: stream locked!
 *
 * // Use:
 * await mergeStreamAndWait(taskExecutorStream, writer);
 * ```
 */
export async function mergeStreamAndWait<T>(
	stream: ReadableStream<T>,
	writer: { write: (chunk: T) => void },
): Promise<void> {
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			writer.write(value);
		}
	} finally {
		reader.releaseLock();
	}
}
