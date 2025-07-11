import { useState, useCallback, useEffect, useRef } from 'react';
import type { Message, UseTaskChatReturn, StreamChunk } from '../types';

/**
 * Hook for managing chat state per task with streaming support
 */
export function useTaskChat(taskId: string | null): UseTaskChatReturn {
  // Store messages per task in a Map
  const [taskMessages, setTaskMessages] = useState<Map<string, Message[]>>(new Map());
  const streamListenersRef = useRef<Map<string, () => void>>(new Map());
  
  // Get messages for current task
  const messages = taskId ? (taskMessages.get(taskId) || []) : [];
  const isStreaming = messages.length > 0 && !messages[messages.length - 1].isComplete;

  /**
   * Send a message to the AI agent for the current task
   */
  const sendMessage = useCallback(async (content: string) => {
    if (!taskId || !content.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: `${taskId}-user-${Date.now()}`,
      content,
      sender: 'user',
      isComplete: true,
      timestamp: new Date(),
      taskId
    };

    setTaskMessages(prev => {
      const updated = new Map(prev);
      const taskMsgs = updated.get(taskId) || [];
      updated.set(taskId, [...taskMsgs, userMessage]);
      return updated;
    });

    try {
      // Start streaming with task-specific agent
      const streamId = await window.ipcRenderer.invoke('ai:streamMessage', taskId, content);
      
      // Add AI placeholder message
      const aiMessageId = `${taskId}-ai-${Date.now()}`;
      const aiMessage: Message = {
        id: aiMessageId,
        content: '',
        sender: 'assistant',
        isComplete: false,
        timestamp: new Date(),
        taskId
      };

      setTaskMessages(prev => {
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
        setTaskMessages(prev => {
          const updated = new Map(prev);
          const taskMsgs = [...(updated.get(taskId) || [])];
          const lastMsgIndex = taskMsgs.length - 1;
          
          if (lastMsgIndex >= 0 && taskMsgs[lastMsgIndex].id === aiMessageId) {
            // Create a new message object to ensure React detects the change
            const updatedMsg = { ...taskMsgs[lastMsgIndex] };
            
            if (chunk.type === 'token') {
              updatedMsg.content = updatedMsg.content + chunk.content;
            } else if (chunk.type === 'error') {
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
        setTaskMessages(prev => {
          const updated = new Map(prev);
          const taskMsgs = [...(updated.get(taskId) || [])];
          const lastMsgIndex = taskMsgs.length - 1;
          
          if (lastMsgIndex >= 0 && taskMsgs[lastMsgIndex].id === aiMessageId) {
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
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage: Message = {
        id: `${taskId}-error-${Date.now()}`,
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        sender: 'system',
        isComplete: true,
        timestamp: new Date(),
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      setTaskMessages(prev => {
        const updated = new Map(prev);
        const taskMsgs = updated.get(taskId) || [];
        updated.set(taskId, [...taskMsgs, errorMessage]);
        return updated;
      });
    }
  }, [taskId]);

  /**
   * Clear messages for the current task
   */
  const clearMessages = useCallback(() => {
    if (!taskId) return;

    setTaskMessages(prev => {
      const updated = new Map(prev);
      updated.set(taskId, []);
      return updated;
    });

    // Also clear history in backend
    window.ipcRenderer.invoke('ai:clearHistory', taskId);
  }, [taskId]);

  /**
   * Clean up listeners when component unmounts or task changes
   */
  useEffect(() => {
    return () => {
      // Clean up all stream listeners
      streamListenersRef.current.forEach(cleanup => cleanup());
      streamListenersRef.current.clear();
    };
  }, []);

  /**
   * Remove agent when task is removed
   */
  useEffect(() => {
    // This will be called from the parent when a task is deleted
    const handleTaskDeleted = (_event: unknown, deletedTaskId: string) => {
      setTaskMessages(prev => {
        const updated = new Map(prev);
        updated.delete(deletedTaskId);
        return updated;
      });
      
      // Remove agent from backend
      window.ipcRenderer.invoke('ai:removeAgent', deletedTaskId);
    };

    window.ipcRenderer.on('task:deleted', handleTaskDeleted);

    return () => {
      window.ipcRenderer.off('task:deleted', handleTaskDeleted);
    };
  }, []);

  return {
    messages,
    sendMessage,
    isStreaming,
    clearMessages,
    taskId
  };
}