import { useState, useCallback, useEffect, useRef } from "react";
import type { Message, UseTaskChatReturn } from "../types";
import type { StreamChunk } from "../../../../electron/shared/types/index";
import { useAppStore } from "@/store/appStore";

/**
 * Handle debug commands for testing browser actions
 */
async function handleDebugCommand(
  taskId: string,
  command: string,
  setTaskMessages: React.Dispatch<React.SetStateAction<Map<string, Message[]>>>
) {
  const store = useAppStore.getState();
  const activeTaskId = store.activeTaskId;
  const tasks = store.tasks;

  const currentTask = activeTaskId ? tasks.get(activeTaskId) : null;
  const currentPage = currentTask?.activePageId
    ? currentTask.pages.get(currentTask.activePageId)
    : null;

  if (!currentTask?.id || !currentPage?.id) {
    const errorMsg: Message = {
      id: `${taskId}-debug-error-${Date.now()}`,
      content: "Debug Error: No active task or page",
      sender: "system",
      isComplete: true,
      timestamp: new Date(),
      taskId,
      error: "No active task or page",
    };

    setTaskMessages((prev) => {
      const updated = new Map(prev);
      const taskMsgs = updated.get(taskId) || [];
      updated.set(taskId, [...taskMsgs, errorMsg]);
      return updated;
    });
    return;
  }

  // Add user message
  const userMsg: Message = {
    id: `${taskId}-debug-user-${Date.now()}`,
    content: command,
    sender: "user",
    isComplete: true,
    timestamp: new Date(),
    taskId,
  };

  setTaskMessages((prev) => {
    const updated = new Map(prev);
    const taskMsgs = updated.get(taskId) || [];
    updated.set(taskId, [...taskMsgs, userMsg]);
    return updated;
  });

  // Parse debug command
  const parts = command.split(" ");
  const debugCmd = parts[0];

  try {
    let result: unknown;
    let resultMessage = "";

    switch (debugCmd) {
      case "debug:help":
        resultMessage = `Available debug commands:

**Navigation:**
- debug:navigateTo <url>
- debug:goBack
- debug:goForward
- debug:refresh
- debug:stop

**Elements:**
- debug:getElements [viewportOnly=true/false]
- debug:showHints
- debug:hideHints
- debug:click <elementId>
- debug:type <elementId> <text>
- debug:hover <elementId>

**Content:**
- debug:extractText [elementId]
- debug:screenshot
- debug:getCurrentUrl
- debug:getPageTitle

**Scrolling:**
- debug:scroll <up/down> [pixels]
- debug:scrollTo <elementId>

**Advanced:**
- debug:pressKey <key>
- debug:waitFor <selector> [timeout]
- debug:execute <script>
- debug:buildDomTree

**Form:**
- debug:selectOption <elementId> <value>
- debug:setCheckbox <elementId> <true/false>

**DOM:**
- debug:buildDomTree`;
        break;

      case "debug:navigateTo":
        if (parts.length < 2) throw new Error("Usage: debug:navigateTo <url>");
        result = await window.ipcRenderer.invoke("app:navigateTo", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          url: parts.slice(1).join(" "),
        });
        resultMessage = `Navigation result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:goBack":
        result = await window.ipcRenderer.invoke("app:goBack", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Go back result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:goForward":
        result = await window.ipcRenderer.invoke("app:goForward", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Go forward result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:refresh":
        result = await window.ipcRenderer.invoke("app:refresh", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Refresh result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:stop":
        result = await window.ipcRenderer.invoke("app:stop", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Stop result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:getElements": {
        const viewportOnly = parts[1] !== "false";
        result = await window.ipcRenderer.invoke("app:getPageElements", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          options: { viewportOnly },
        });
        resultMessage = `Page elements (viewportOnly=${viewportOnly}):\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;
      }

      case "debug:showHints":
        result = await window.ipcRenderer.invoke("app:showHints", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Show hints result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:hideHints":
        result = await window.ipcRenderer.invoke("app:hideHints", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Hide hints result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:click":
        if (parts.length < 2) throw new Error("Usage: debug:click <elementId>");
        result = await window.ipcRenderer.invoke("app:clickElement", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          elementId: parseInt(parts[1]),
        });
        resultMessage = `Click element ${
          parts[1]
        } result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
        break;

      case "debug:type":
        if (parts.length < 3)
          throw new Error("Usage: debug:type <elementId> <text>");
        result = await window.ipcRenderer.invoke("app:typeText", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          elementId: parseInt(parts[1]),
          text: parts.slice(2).join(" "),
        });
        resultMessage = `Type text result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:hover":
        if (parts.length < 2) throw new Error("Usage: debug:hover <elementId>");
        result = await window.ipcRenderer.invoke("app:hover", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          elementId: parseInt(parts[1]),
        });
        resultMessage = `Hover element ${
          parts[1]
        } result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
        break;

      case "debug:extractText":
        result = await window.ipcRenderer.invoke("app:extractText", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          elementId: parts[1] ? parseInt(parts[1]) : undefined,
        });
        resultMessage = `Extract text result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:screenshot":
        result = await window.ipcRenderer.invoke("app:captureScreenshot", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Screenshot captured:\n\`\`\`json\n${JSON.stringify(
          {
            ...(typeof result === 'object' && result !== null ? result : {}),
            screenshot: (result as any)?.screenshot ? "[Binary Data]" : undefined,
          },
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:getCurrentUrl":
        result = await window.ipcRenderer.invoke("app:getCurrentUrl", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Current URL:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:getPageTitle":
        result = await window.ipcRenderer.invoke("app:getPageTitle", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `Page title:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:scroll":
        if (parts.length < 2)
          throw new Error("Usage: debug:scroll <up/down> [pixels]");
        result = await window.ipcRenderer.invoke("app:scrollPage", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          direction: parts[1] as "up" | "down",
          amount: parts[2] ? parseInt(parts[2]) : undefined,
        });
        resultMessage = `Scroll ${
          parts[1]
        } result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
        break;

      case "debug:scrollTo":
        if (parts.length < 2)
          throw new Error("Usage: debug:scrollTo <elementId>");
        result = await window.ipcRenderer.invoke("app:scrollToElement", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          elementId: parseInt(parts[1]),
        });
        resultMessage = `Scroll to element ${
          parts[1]
        } result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
        break;

      case "debug:pressKey":
        if (parts.length < 2) throw new Error("Usage: debug:pressKey <key>");
        result = await window.ipcRenderer.invoke("app:pressKey", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          key: parts[1],
        });
        resultMessage = `Press key '${
          parts[1]
        }' result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
        break;

      case "debug:waitFor":
        if (parts.length < 2)
          throw new Error("Usage: debug:waitFor <selector> [timeout]");
        result = await window.ipcRenderer.invoke("app:waitForSelector", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          selector: parts[1],
          timeout: parts[2] ? parseInt(parts[2]) : undefined,
        });
        resultMessage = `Wait for selector '${
          parts[1]
        }' result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
        break;

      case "debug:execute":
        if (parts.length < 2) throw new Error("Usage: debug:execute <script>");
        result = await window.ipcRenderer.invoke("app:executeScript", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          script: parts.slice(1).join(" "),
        });
        resultMessage = `Execute script result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:selectOption":
        if (parts.length < 3)
          throw new Error("Usage: debug:selectOption <elementId> <value>");
        result = await window.ipcRenderer.invoke("app:selectOption", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          elementId: parseInt(parts[1]),
          value: parts.slice(2).join(" "),
        });
        resultMessage = `Select option result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:setCheckbox":
        if (parts.length < 3)
          throw new Error("Usage: debug:setCheckbox <elementId> <true/false>");
        result = await window.ipcRenderer.invoke("app:setCheckbox", {
          taskId: currentTask.id,
          pageId: currentPage.id,
          elementId: parseInt(parts[1]),
          checked: parts[2] === "true",
        });
        resultMessage = `Set checkbox result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      case "debug:buildDomTree":
        result = await window.ipcRenderer.invoke("app:buildDomTree", {
          taskId: currentTask.id,
          pageId: currentPage.id,
        });
        resultMessage = `DOM Tree result:\n\`\`\`json\n${JSON.stringify(
          result,
          null,
          2
        )}\n\`\`\``;
        break;

      default:
        throw new Error(
          `Unknown debug command: ${debugCmd}. Type 'debug:help' for available commands.`
        );
    }

    // Add result message
    const resultMsg: Message = {
      id: `${taskId}-debug-result-${Date.now()}`,
      content: resultMessage,
      sender: "assistant",
      isComplete: true,
      timestamp: new Date(),
      taskId,
    };

    setTaskMessages((prev) => {
      const updated = new Map(prev);
      const taskMsgs = updated.get(taskId) || [];
      updated.set(taskId, [...taskMsgs, resultMsg]);
      return updated;
    });
  } catch (error) {
    // Add error message
    const errorMsg: Message = {
      id: `${taskId}-debug-error-${Date.now()}`,
      content: `Debug Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      sender: "system",
      isComplete: true,
      timestamp: new Date(),
      taskId,
      error: error instanceof Error ? error.message : String(error),
    };

    setTaskMessages((prev) => {
      const updated = new Map(prev);
      const taskMsgs = updated.get(taskId) || [];
      updated.set(taskId, [...taskMsgs, errorMsg]);
      return updated;
    });
  }
}

/**
 * Hook for managing chat state per task with streaming support
 */
export function useTaskChat(taskId: string | null): UseTaskChatReturn {
  // Store messages per task in a Map
  const [taskMessages, setTaskMessages] = useState<Map<string, Message[]>>(
    new Map()
  );
  const streamListenersRef = useRef<Map<string, () => void>>(new Map());

  // Get messages for current task
  const messages = taskId ? taskMessages.get(taskId) || [] : [];
  const isStreaming =
    messages.length > 0 && !messages[messages.length - 1].isComplete;

  /**
   * Send a message to the AI agent for the current task
   */
  const sendMessage = useCallback(
    async (content: string) => {
      if (!taskId || !content.trim()) return;

      // Check if this is a debug command
      if (content.startsWith("debug:")) {
        await handleDebugCommand(taskId, content, setTaskMessages);
        return;
      }

      // Add user message
      const userMessage: Message = {
        id: `${taskId}-user-${Date.now()}`,
        content,
        sender: "user",
        isComplete: true,
        timestamp: new Date(),
        taskId,
      };

      setTaskMessages((prev) => {
        const updated = new Map(prev);
        const taskMsgs = updated.get(taskId) || [];
        updated.set(taskId, [...taskMsgs, userMessage]);
        return updated;
      });

      try {
        // Start streaming with task-specific agent
        const streamId = await window.ipcRenderer.invoke("ai:streamMessage", {
          taskId,
          message: content,
        });

        // Add AI placeholder message
        const aiMessageId = `${taskId}-ai-${Date.now()}`;
        const aiMessage: Message = {
          id: aiMessageId,
          content: "",
          sender: "assistant",
          isComplete: false,
          timestamp: new Date(),
          taskId,
        };

        setTaskMessages((prev) => {
          const updated = new Map(prev);
          const taskMsgs = updated.get(taskId) || [];
          updated.set(taskId, [...taskMsgs, aiMessage]);
          return updated;
        });

        // Clean up any existing listeners for this stream
        const existingCleanup = streamListenersRef.current.get(streamId);
        if (existingCleanup) {
          existingCleanup();
        }

        // Handle streaming chunks
        const handleChunk = (_event: unknown, chunk: StreamChunk) => {
          setTaskMessages((prev) => {
            const updated = new Map(prev);
            const taskMsgs = [...(updated.get(taskId) || [])];
            const lastMsgIndex = taskMsgs.length - 1;

            if (
              lastMsgIndex >= 0 &&
              taskMsgs[lastMsgIndex].id === aiMessageId
            ) {
              // Create a new message object to ensure React detects the change
              const updatedMsg = { ...taskMsgs[lastMsgIndex] };

              if (chunk.type === "token") {
                updatedMsg.content = updatedMsg.content + chunk.content;
              } else if (chunk.type === "error") {
                updatedMsg.content = chunk.content;
                updatedMsg.error = chunk.content;
                updatedMsg.isComplete = true;
              }

              // Replace the message with the updated one
              taskMsgs[lastMsgIndex] = updatedMsg;
            }

            updated.set(taskId, taskMsgs);
            return updated;
          });
        };

        // Handle stream end
        const handleEnd = () => {
          setTaskMessages((prev) => {
            const updated = new Map(prev);
            const taskMsgs = [...(updated.get(taskId) || [])];
            const lastMsgIndex = taskMsgs.length - 1;

            if (
              lastMsgIndex >= 0 &&
              taskMsgs[lastMsgIndex].id === aiMessageId
            ) {
              // Create a new message object to ensure React detects the change
              const updatedMsg = { ...taskMsgs[lastMsgIndex] };
              updatedMsg.isComplete = true;
              taskMsgs[lastMsgIndex] = updatedMsg;
            }

            updated.set(taskId, taskMsgs);
            return updated;
          });

          // Clean up listeners
          cleanup();
        };

        // Set up listeners
        window.ipcRenderer.on(`ai:stream:${streamId}`, handleChunk);
        window.ipcRenderer.once(`ai:stream:${streamId}:end`, handleEnd);

        // Store cleanup function
        const cleanup = () => {
          window.ipcRenderer.off(`ai:stream:${streamId}`, handleChunk);
          window.ipcRenderer.off(`ai:stream:${streamId}:end`, handleEnd);
          streamListenersRef.current.delete(streamId);
        };

        streamListenersRef.current.set(streamId, cleanup);
      } catch (error) {
        console.error("Error sending message:", error);

        // Add error message
        const errorMessage: Message = {
          id: `${taskId}-error-${Date.now()}`,
          content: `Error: ${
            error instanceof Error ? error.message : "Failed to send message"
          }`,
          sender: "system",
          isComplete: true,
          timestamp: new Date(),
          taskId,
          error: error instanceof Error ? error.message : "Unknown error",
        };

        setTaskMessages((prev) => {
          const updated = new Map(prev);
          const taskMsgs = updated.get(taskId) || [];
          updated.set(taskId, [...taskMsgs, errorMessage]);
          return updated;
        });
      }
    },
    [taskId]
  );

  /**
   * Clear messages for the current task
   */
  const clearMessages = useCallback(() => {
    if (!taskId) return;

    setTaskMessages((prev) => {
      const updated = new Map(prev);
      updated.set(taskId, []);
      return updated;
    });

    // Also clear history in backend
    window.ipcRenderer.invoke("ai:clearHistory", { taskId });
  }, [taskId]);

  /**
   * Clean up listeners when component unmounts or task changes
   */
  useEffect(() => {
    return () => {
      // Clean up all stream listeners
      streamListenersRef.current.forEach((cleanup) => cleanup());
      streamListenersRef.current.clear();
    };
  }, []);

  /**
   * Remove agent when task is removed
   */
  useEffect(() => {
    // This will be called from the parent when a task is deleted
    const handleTaskDeleted = (_event: unknown, deletedTaskId: string) => {
      setTaskMessages((prev) => {
        const updated = new Map(prev);
        updated.delete(deletedTaskId);
        return updated;
      });

      // Remove agent from backend
      window.ipcRenderer.invoke("ai:removeAgent", { taskId: deletedTaskId });
    };

    window.ipcRenderer.on("task:deleted", handleTaskDeleted);

    return () => {
      window.ipcRenderer.off("task:deleted", handleTaskDeleted);
    };
  }, []);

  return {
    messages,
    sendMessage,
    isStreaming,
    clearMessages,
    taskId,
  };
}
