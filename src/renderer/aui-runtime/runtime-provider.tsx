import type { ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useAssistantTool,
} from "@assistant-ui/react";
import { LocalChatAdapter } from "./local-adapter";

// Define the add tool component
function AddToolComponent() {
  useAssistantTool({
    toolName: "add",
    description: "Add two numbers together",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
      },
      required: ["a", "b"],
    },
    execute: async ({ a, b }: { a: number; b: number }) => {
      // For this POC, we'll just return the sum
      // In a real implementation, this might call the backend or do the calculation here
      return { result: a + b };
    },
  });

  return null;
}

interface LocalRuntimeProviderProps {
  children: ReactNode;
}

export function LocalRuntimeProvider({ children }: LocalRuntimeProviderProps) {
  // Create runtime using useLocalRuntime with our custom adapter
  const runtime = useLocalRuntime(LocalChatAdapter, {
    // Keep the existing attachment adapters
    adapters: {
      attachments: new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
      ]),
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AddToolComponent />
      {children}
    </AssistantRuntimeProvider>
  );
}
