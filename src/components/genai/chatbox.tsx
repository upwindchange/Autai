import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatBoxProps {
  onSend: (message: string) => void;
}

export function ChatBox({ onSend }: ChatBoxProps) {
  const [message, setMessage] = useState("");

  const handleSubmit = () => {
    if (message.trim()) {
      onSend(message);
      setMessage("");
    }
  };

  return (
    <div className="flex flex-col h-full gap-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your message here."
        className="flex-1 resize-none"
      />
      <Button className="h-10" onClick={handleSubmit}>
        Send
      </Button>
    </div>
  );
}
