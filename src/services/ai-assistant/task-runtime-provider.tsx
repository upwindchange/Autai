"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useThreadManager } from "./thread-manager";
import { useSettings } from "@/components/settings";
import type { FC, PropsWithChildren } from "react";

interface TaskRuntimeProviderProps extends PropsWithChildren {
  taskId: string;
}

// Create a simple API endpoint handler
const API_ENDPOINT = "/api/chat";

// In Electron, we'll intercept this and handle it directly
if (typeof window !== "undefined" && window.ipcRenderer) {
  // Register a handler for the chat API
  window.fetch = new Proxy(window.fetch, {
    apply: async (target, thisArg, args) => {
      const [url, options] = args;
      
      if (typeof url === "string" && url === API_ENDPOINT && options?.method === "POST") {
        // Handle chat API request directly
        const { handleChatRequest } = await import("./api-handler");
        const body = JSON.parse(options.body as string);
        const { activeProfile } = useSettings();
        
        const response = await handleChatRequest({
          ...body,
          settings: activeProfile?.settings,
        });
        
        return response;
      }
      
      // For all other requests, use the original fetch
      return target.apply(thisArg, args);
    },
  });
}

export const TaskRuntimeProvider: FC<TaskRuntimeProviderProps> = ({
  taskId,
  children,
}) => {
  const threadManager = useThreadManager();

  // Get or create thread for this task
  let thread = threadManager.getThread(taskId);
  if (!thread) {
    thread = threadManager.createThread({ taskId });
  }

  // Create runtime using useChatRuntime with API endpoint
  const runtime = useChatRuntime({
    api: API_ENDPOINT,
    body: {
      taskId,
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};