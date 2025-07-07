import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatBox } from "@/components/genai/chatbox";

/**
 * AI chat interface component with conversation history and input
 */
export default function GenAI() {
  const [conversation, setConversation] = useState<
    Array<{ text: string; sender: string }>
  >([]);

  /**
   * Handles sending messages to the AI agent via IPC
   */
  const handleSend = async (message: string) => {
    setConversation((prev) => [...prev, { text: message, sender: "user" }]);

    const response = await window.ipcRenderer.invoke("genai:send", message);

    setConversation((prev) => [...prev, { text: response, sender: "agent" }]);
  };

  return (
    <ResizablePanelGroup direction="vertical">
      <ResizablePanel>
        <div className="conversation-history p-4">
          {conversation.map((msg, i) => (
            <div key={i} className="mb-2">
              <strong>{msg.sender}:</strong> {msg.text}
            </div>
          ))}
        </div>
      </ResizablePanel>
      <ResizableHandle style={{ backgroundColor: "transparent" }} />
      <ResizablePanel defaultSize={30}>
        <ChatBox onSend={handleSend} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
