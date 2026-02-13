import { useEffect, useRef } from "react";
import { useAssistantEvent } from "@assistant-ui/react";
import log from "electron-log/renderer";

const logger = log.scope("useSessionLifecycle");

/**
 * Hook that bridges assistant-ui v0.12 session events to backend IPC.
 * Handles session lifecycle events: creation, switching, and deletion.
 */
export function useSessionLifecycle() {
	const previousSessionIdRef = useRef<string | null>(null);

	// Handle session switch events
	useAssistantEvent("threadListItem.switchedTo", (event) => {
		logger.debug("session switch event", { sessionId: event.threadId });

		if (event.threadId && event.threadId !== previousSessionIdRef.current) {
			logger.debug("sending sessiontab:switched ipc", {
				sessionId: event.threadId,
			});
			window.ipcRenderer.send("sessiontab:switched", event.threadId);
			previousSessionIdRef.current = event.threadId;
		}
	});

	// Handle session initialization
	useAssistantEvent("thread.initialize", (event) => {
		logger.debug("session initialize event", { sessionId: event.threadId });

		if (event.threadId) {
			logger.debug("sending sessiontab:created ipc", {
				sessionId: event.threadId,
			});
			window.ipcRenderer.send("sessiontab:created", event.threadId);
			previousSessionIdRef.current = event.threadId;
		}
	});

	// Handle session cleanup (when component unmounts)
	useEffect(() => {
		return () => {
			if (previousSessionIdRef.current) {
				logger.debug("cleanup: sending sessiontab:deleted ipc", {
					sessionId: previousSessionIdRef.current,
				});
				window.ipcRenderer.send(
					"sessiontab:deleted",
					previousSessionIdRef.current,
				);
			}
		};
	}, []);
}
