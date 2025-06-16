import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatBox } from "@/components/genai/chatbox";

export default function GenAI() {
  return (
    <ResizablePanelGroup direction="vertical">
      <ResizablePanel>One</ResizablePanel>
      <ResizableHandle style={{ backgroundColor: "transparent" }} />
      <ResizablePanel defaultSize={30}>
        <ChatBox />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
