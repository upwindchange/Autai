import { useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatBox } from "@/components/genai/chatbox";

export default function GenAI() {
  const [conversation, setConversation] = useState<
    Array<{ text: string; sender: string }>
  >([]);

  const handleSend = async (message: string) => {
    // Add user message
    setConversation((prev) => [...prev, { text: message, sender: "user" }]);

    // Send to main process
    const response = await window.ipcRenderer.invoke("genai:send", message);

    // Add agent response
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
