# ViewControlWorker - LangChain Agent with P-Queue Execution

This agent provides browser view control capabilities using LangChain with tool execution through p-queue to prevent main process choking.

## Features

- **LangChain Agent**: Uses proper LangChain `AgentExecutor` and `createOpenAIToolsAgent`
- **Tool Function**: Implements tools using LangChain's `tool()` function with Zod schemas
- **P-Queue Integration**: All tool executions go through centralized p-queue
- **Non-blocking**: Main process remains responsive during operations
- **Type Safety**: Zod schemas and TypeScript types throughout

## Available Tools

### 1. Navigate Tool
- **Name**: `navigate_view`
- **Schema**: `{ viewId: string, url: string }`
- **Description**: Navigate a browser view to a specific URL
- **Usage**: "Navigate view1 to https://example.com"

### 2. Refresh Tool
- **Name**: `refresh_view`
- **Schema**: `{ viewId: string }`
- **Description**: Refresh the current page in a browser view
- **Usage**: "Refresh view1"

### 3. Go Back Tool
- **Name**: `go_back_view`
- **Schema**: `{ viewId: string }`
- **Description**: Navigate back in the browser history of a view
- **Usage**: "Go back in view1"

### 4. Go Forward Tool
- **Name**: `go_forward_view`
- **Schema**: `{ viewId: string }`
- **Description**: Navigate forward in the browser history of a view
- **Usage**: "Go forward in view1"

## Usage Example

```typescript
import { ViewControlWorker } from "@/agents/workers";

// Create worker instance
const worker = new ViewControlWorker();

// Handle chat request
const stream = await worker.handleChat({
  messages: [
    { role: 'user', content: 'Navigate view1 to https://example.com' }
  ],
  system: "Please navigate to the specified URL",
  requestId: "req-123"
});

// Process the stream
for await (const chunk of stream) {
  console.log('Received chunk:', chunk);
}
```

## Architecture

### Components

1. **ViewControlWorker**: Main agent class using LangChain AgentExecutor
2. **ViewControlTools**: LangChain tools using `tool()` function
3. **PQueueManager**: Centralized queue management
4. **ViewControlService**: Singleton service for browser view operations

### Execution Flow

1. User request → ViewControlWorker
2. LangChain AgentExecutor processes request
3. Agent calls tools via p-queue
4. Tools execute ViewControlService methods
5. Results returned through agent

### P-Queue Benefits

- **Concurrency Control**: Configurable concurrent operations (default: 3)
- **Timeout Handling**: 30-second timeout per operation
- **Non-blocking**: Main process remains responsive
- **Orderly Execution**: Operations queued and executed in order
- **Resource Management**: Prevents system overload

## Configuration

### P-Queue Settings
```typescript
// Default configuration in main.ts
PQueueManager.getInstance({
  concurrency: 3,        // Max concurrent operations
  timeout: 30000,       // 30 seconds per operation
  autoStart: true,      // Start automatically
});
```

### Agent Settings
```typescript
// Agent configuration
const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: process.env.NODE_ENV === 'development',
  maxIterations: 10,    // Max tool calls per request
  returnIntermediateSteps: true,
});
```

## Error Handling

The agent includes comprehensive error handling:

- **Tool Execution**: Errors caught and returned as descriptive messages
- **Queue Management**: Timeout and cancellation handling
- **View Operations**: Invalid view IDs handled gracefully
- **Stream Processing**: Stream errors properly propagated

## Logging

Detailed logging is available at multiple levels:

- **Agent Execution**: Agent initialization and execution
- **Tool Calls**: Individual tool execution with parameters
- **Queue Status**: Queue size, pending operations, concurrency
- **Error Tracking**: Comprehensive error logging with stack traces

## Integration

The ViewControlWorker integrates seamlessly with the existing Autai architecture:

- Uses existing ViewControlService singleton
- Integrates with PQueueManager for all operations
- Compatible with existing telemetry and logging systems
- Follows established patterns for agent workers

## Testing

To test the implementation:

```typescript
// Basic navigation test
const worker = new ViewControlWorker();
const result = await worker.handleChat({
  messages: [{ role: 'user', content: 'Navigate test-view to https://httpbin.org/get' }],
  requestId: 'test-123'
});

// Multi-step test
const complexResult = await worker.handleChat({
  messages: [{
    role: 'user',
    content: 'Navigate view1 to https://example.com, then refresh it, then go back'
  }],
  requestId: 'test-456'
});
```