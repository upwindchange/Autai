import { useAssistantContext, useThreadContext } from "@assistant-ui/react";
import { getExternalStoreMessages } from "@assistant-ui/react-ai-sdk";
import { useThreadManager } from "./thread-manager";

export function useTaskChat(taskId: string) {
  const assistant = useAssistantContext();
  const thread = useThreadContext();
  const threadManager = useThreadManager();

  // Get thread data from our store
  const threadData = threadManager.getThread(taskId);

  // Convert assistant-ui messages to AI SDK format if needed
  const getAISDKMessages = () => {
    const messages = thread.messages;
    return messages.map(m => getExternalStoreMessages(m)).flat();
  };

  return {
    // Assistant context methods
    append: assistant.append,
    submitFeedback: assistant.submitFeedback,
    
    // Thread context methods
    messages: thread.messages,
    isRunning: thread.isRunning,
    
    // Thread manager methods
    clearHistory: () => {
      threadManager.updateThread(taskId, { messages: [] });
    },
    
    // Utility
    getAISDKMessages,
    threadData,
  };
}