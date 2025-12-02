# LangChain Agent Implementation Plan

## Overview
Replace the current Express.js simulated backend in `src/main/assistant/server.ts` with a real LangChain agent using `createAgent` function and `.stream` method for OpenAI-compatible APIs. Keep frontend tools defined with assistant-ui and executed in the browser.

## Current Architecture Analysis
- **Frontend**: Tools defined with `useAssistantTool` in `src/renderer/aui-runtime/runtime-provider.tsx`
- **Adapter**: `LocalChatAdapter` in `src/renderer/aui-runtime/local-adapter.ts` passes tools via `context.tools`
- **Backend**: `src/main/assistant/server.ts` receives tools but uses hardcoded keyword detection
- **Settings**: OpenAI-compatible provider configs from `src/main/services/settingsService.ts`

## Implementation Strategy

### Key Insight
Frontend tools are already working! The `AddToolComponent` demonstrates the pattern:
- Tools are defined in frontend with `useAssistantTool`
- Tools are passed to backend through `context.tools` parameter
- Backend should intelligently decide when to use tools (not hardcoded keywords)

### Step 1: Create LangChain Agent Factory
**File**: `src/main/assistant/agentFactory.ts`

```typescript
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { settingsService } from "@/services/settingsService";
import { HumanMessage } from "@langchain/core/messages";

// Convert frontend tools to LangChain tools
function convertFrontendTools(frontendTools: any[]) {
  return frontendTools.map(tool => ({
    name: tool.toolName || tool.name,
    description: tool.description,
    schema: tool.parameters || tool.schema,
    // Note: Tool execution happens in frontend, not here
    handler: async (args: any) => {
      // This should never be called since tools execute in frontend
      throw new Error(`Tool ${tool.name} should execute in frontend`);
    }
  }));
}

export function createLangChainAgent(frontendTools: any[] = []) {
  const settings = settingsService.settings;
  const chatConfig = settings.modelConfigurations.chat;
  const provider = settings.providers.find(p => p.id === chatConfig.providerId);

  if (!provider || provider.provider !== "openai-compatible") {
    throw new Error("Only OpenAI-compatible providers supported for now");
  }

  // Create ChatOpenAI instance for OpenAI-compatible provider
  const model = new ChatOpenAI({
    model: chatConfig.model,
    apiKey: provider.apiKey,
    baseURL: provider.apiUrl || "https://api.openai.com/v1",
    temperature: 0,
  });

  // Convert frontend tools to LangChain format
  const langchainTools = convertFrontendTools(frontendTools);

  return createAgent({
    model,
    tools: langchainTools,
  });
}
```

### Step 2: Update Express Server for Frontend Tools
**File**: `src/main/assistant/server.ts` - Replace `/chat` endpoint

```typescript
import express, { Request, Response } from "express";
import cors from "cors";
import log from "electron-log/main";
import { createLangChainAgent } from "./agentFactory";
import { HumanMessage } from "@langchain/core/messages";

// Keep existing middleware, PORT, server management
// Replace only the /chat endpoint implementation:

app.post("/chat", async (req: Request, res: Response) => {
  try {
    const { messages, tools } = req.body;

    // Validate input (keep existing validation)
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Invalid messages format" });
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      res.status(400).json({ error: "No user message found" });
      return;
    }

    // Extract user text content (keep existing logic)
    let userText = "";
    if (Array.isArray(lastMessage.content)) {
      userText = lastMessage.content
        .filter((item: any) => item.type === "text")
        .map((item: any) => item.text)
        .join(" ");
    } else if (typeof lastMessage.content === "string") {
      userText = lastMessage.content;
    }

    if (!userText) {
      res.status(400).json({ error: "No text content found in user message" });
      return;
    }

    // Create LangChain agent with frontend tools
    const agent = createLangChainAgent(tools || []);

    // Start streaming with LangChain
    const stream = await agent.stream(
      {
        messages: [new HumanMessage(userText)],
      },
      { streamMode: "values" }
    );

    // Track tool calls and content separately
    const toolCalls: any[] = [];
    let textContent = "";

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Stream responses
    for await (const chunk of stream) {
      const lastMessage = chunk.messages.at(-1);

      if (!lastMessage) continue;

      // Handle AI messages
      if (lastMessage.getType() === "ai") {
        // Accumulate text content
        if (lastMessage.content) {
          textContent += lastMessage.content;

          // Stream accumulated text
          res.write(`data: ${JSON.stringify({
            type: "text",
            content: textContent,
          })}\n\n`);
        }

        // Check for tool calls
        if ("tool_calls" in lastMessage && lastMessage.tool_calls) {
          // Convert LangChain tool calls to UI format
          for (const toolCall of lastMessage.tool_calls) {
            toolCalls.push({
              type: "tool-call",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              args: toolCall.args,
            });
          }
        }
      }

      // Handle tool results (LangChain will execute tools automatically)
      if (lastMessage.getType() === "tool") {
        res.write(`data: ${JSON.stringify({
          type: "tool-result",
          toolCallId: lastMessage.tool_call_id,
          result: lastMessage.content,
        })}\n\n`);
      }
    }

    // Send final tool calls if any (assistant-ui will handle execution)
    if (toolCalls.length > 0) {
      res.write(`data: ${JSON.stringify({
        type: "tool-calls",
        content: toolCalls,
      })}\n\n`);
    }

    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (error) {
    logger.error("Chat endpoint error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### Step 3: Update LocalChatAdapter to Handle Tool Responses
**File**: `src/renderer/aui-runtime/local-adapter.ts` - Handle new response format

```typescript
// The backend only sends text/event-stream, so we handle all responses as streaming
// Remove the content type check since we only handle streaming responses

// Handle streaming text response (existing logic - keep it as is)
const reader = response.body.getReader();
const decoder = new TextDecoder();
let accumulatedText = "";
const toolCalls: any[] = [];

try {
  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    // Decode the chunk
    const chunk = decoder.decode(value, { stream: true });

    // Parse SSE data lines
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);

        if (data === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(data);

          if (parsed.type === 'text') {
            // Handle text content
            accumulatedText = parsed.content;
            yield {
              content: [
                {
                  type: "text" as const,
                  text: accumulatedText,
                },
              ],
            };
          } else if (parsed.type === 'tool-calls') {
            // Handle tool calls
            toolCalls.push(...parsed.content);
            yield {
              content: parsed.content,
            };
          } else if (parsed.type === 'tool-result') {
            // Handle tool results
            yield {
              content: [
                {
                  type: "tool-result" as const,
                  toolCallId: parsed.toolCallId,
                  result: parsed.result,
                },
              ],
            };
          }
        } catch (e) {
          // Ignore parsing errors for malformed chunks
        }
      }
    }
  }
} finally {
  reader.releaseLock();
}
```

### Step 4: Keep Frontend Tool Simple
**File**: `src/renderer/aui-runtime/runtime-provider.tsx` - Keep only the add tool

```typescript
// Keep existing AddToolComponent unchanged
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
      console.log("this log shows that the add tool is really been executed");
      return { result: a + b };
    },
  });

  return null;
}
```

### Step 5: Update Runtime Provider
**File**: `src/renderer/aui-runtime/runtime-provider.tsx` - Keep only add tool

```typescript
export function LocalRuntimeProvider({ children }: LocalRuntimeProviderProps) {
  const runtime = useLocalRuntime(LocalChatAdapter, {
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
```

## Key Benefits

1. **Intelligent Tool Selection**: LangChain determines when to use tools based on conversation context
2. **Frontend Tool Execution**: Tools run in browser with full access to frontend APIs
3. **Real Streaming**: Uses `.stream()` method for real-time responses
4. **Settings Integration**: Leverages existing OpenAI-compatible provider configurations
5. **API Compatibility**: Maintains compatibility with current UI patterns
6. **Extensibility**: Easy to add new frontend tools without backend changes

## Files to Modify

1. **Create**: `src/main/assistant/agentFactory.ts` - LangChain agent creation with frontend tools
2. **Update**: `src/main/assistant/server.ts` - Replace `/chat` endpoint to use LangChain
3. **Update**: `src/renderer/aui-runtime/local-adapter.ts` - Handle new response format
4. **Update**: `src/renderer/aui-runtime/runtime-provider.tsx` - Add more example tools

## Testing Strategy

1. Test with existing OpenAI-compatible provider settings
2. Verify intelligent tool selection (ask "What's 5+3?" should trigger add tool)
3. Test streaming responses work correctly
4. Verify tool execution in frontend (check console logs)
5. Test error handling for invalid configurations

## How It Works

1. **Frontend**: Tools defined with `useAssistantTool` get registered with assistant-ui
2. **Adapter**: `LocalChatAdapter` passes tools to backend via `context.tools`
3. **Backend**: LangChain agent intelligently decides when to call tools
4. **Tool Calls**: Backend sends tool call instructions back to frontend
5. **Execution**: Frontend executes tools and displays results
6. **Flow**: Tools can call other tools in sequence as needed

## Future Enhancements

1. Add browser automation tools
2. Add file system access tools
3. Add web search tools
4. Support additional providers (Anthropic, DeepInfra)
5. Add conversation memory and context persistence