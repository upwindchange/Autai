import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatBox() {
  return (
    <div className="flex flex-col h-full gap-2">
      <Textarea
        placeholder="Type your message here."
        className="flex-1 resize-none"
      />
      <Button className="h-10">Send</Button>
    </div>
  );
}
