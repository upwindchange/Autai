# Tool Message Utilities Documentation

This documentation explains how to use the tool message utilities from `@agents/utils` for manually creating AI SDK native messages with tool calls.

## Overview

The tool message utilities provide two functions for creating AI SDK-compatible tool call messages:

1. **`executeToolDirectly`** - Executes a tool and creates tool call/result messages
2. **`simulateToolCall`** - Creates tool call/result messages without executing the tool

## Installation

The utilities are available from the agents utils package:

```typescript
import {
	executeToolDirectly,
	simulateToolCall,
	type Tool,
	type ToolExecutionResult,
	type ToolSimulationResult,
} from '@agents/utils';
```

## Function 1: `executeToolDirectly`

### Purpose

Executes a tool and generates AI SDK native messages for the tool call and its result. Use this when you want to:

- Execute a tool and get both the result and the corresponding messages
- Inject tool calls into an existing conversation history
- Have fine-grained control over tool execution

### Signature

```typescript
async function executeToolDirectly({
	tool,
	toolName,
	input,
}: {
	tool: Tool;
	toolName: string;
	input: unknown;
}): Promise<ToolExecutionResult>
```

### Parameters

- **`tool`** - The tool object to execute (must have an `execute` function)
- **`toolName`** - The name of the tool (string)
- **`input`** - The input parameters for the tool (must match the tool's input schema)

### Returns

```typescript
type ToolExecutionResult = {
	assistantMessage: AssistantModelMessage;  // Tool call message
	toolMessage: ToolModelMessage;            // Tool result message
	toolCallId: string;                       // Generated tool call ID
	output: unknown;                          // Raw tool output
}
```

### Example Usage

#### Basic Example

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { executeToolDirectly } from '@agents/utils';

// Define a tool
const weatherTool = tool({
	description: 'Get weather for a location',
	inputSchema: z.object({
		location: z.string().describe('The city name'),
	}),
	execute: async ({ location }) => {
		// Simulate API call
		return {
			temperature: 72,
			condition: 'sunny',
			humidity: 45,
		};
	},
});

// Execute the tool and create messages
const { assistantMessage, toolMessage, toolCallId, output } =
	await executeToolDirectly({
		tool: weatherTool,
		toolName: 'weatherTool',
		input: { location: 'San Francisco' },
	});

console.log('Tool output:', output);
// { temperature: 72, condition: 'sunny', humidity: 45 }

console.log('Tool call ID:', toolCallId);
// 'call-abc123xyz456...'
```

#### Injecting into Conversation History

```typescript
import { generateText } from 'ai';
import { executeToolDirectly } from '@agents/utils';

// Execute tool
const { assistantMessage, toolMessage } = await executeToolDirectly({
	tool: weatherTool,
	toolName: 'weatherTool',
	input: { location: 'San Francisco' },
});

// Use in generateText with existing messages
const result = await generateText({
	model: 'anthropic/claude-sonnet-4-5',
	tools: { weatherTool },
	messages: [
		{ role: 'user', content: 'What is the weather in San Francisco?' },
		// Inject the tool call and result
		assistantMessage,
		toolMessage,
		{ role: 'user', content: 'What about New York?' },
	],
});
```

#### Error Handling

```typescript
try {
	const { assistantMessage, toolMessage, output } =
		await executeToolDirectly({
			tool: weatherTool,
			toolName: 'weatherTool',
			input: { location: 'San Francisco' },
		});

	// Use the messages
	console.log('Tool executed successfully:', output);
} catch (error) {
	console.error('Tool execution failed:', error);
	// Handle error appropriately
}
```

## Function 2: `simulateToolCall`

### Purpose

Creates tool call and result messages **without** executing the tool. Use this when you want to:

- Test tool interactions without actual execution
- Inject mock tool results into conversation history
- Simulate tool calls for debugging purposes
- Pre-populate tool results for testing scenarios

### Signature

```typescript
async function simulateToolCall({
	toolName,
	input,
	output,
}: {
	toolName: string;
	input: unknown;
	output: unknown;
}): Promise<ToolSimulationResult>
```

### Parameters

- **`toolName`** - The name of the tool (string)
- **`input`** - The input parameters for the tool
- **`output`** - The output to use (tool is NOT executed)

### Returns

```typescript
type ToolSimulationResult = {
	assistantMessage: AssistantModelMessage;  // Tool call message
	toolMessage: ToolModelMessage;            // Tool result message
	toolCallId: string;                       // Generated tool call ID
}
```

### Example Usage

#### Basic Example

```typescript
import { simulateToolCall } from '@agents/utils';

// Simulate a tool call without executing it
const { assistantMessage, toolMessage, toolCallId } =
	await simulateToolCall({
		toolName: 'weatherTool',
		input: { location: 'San Francisco' },
		output: {
			temperature: 72,
			condition: 'sunny',
			humidity: 45,
		},
	});

console.log('Simulated tool call ID:', toolCallId);
// 'call-abc123xyz456...'
```

#### Testing Scenarios

```typescript
import { generateText } from 'ai';
import { simulateToolCall } from '@agents/utils';

// Simulate a successful tool call
const { assistantMessage: successMsg, toolMessage: successResult } =
	await simulateToolCall({
		toolName: 'searchWeb',
		input: { query: 'AI tools' },
		output: {
			results: [
				{ title: 'AI SDK', url: 'https://example.com' },
			],
		},
	});

// Simulate a failed tool call
const { assistantMessage: failMsg, toolMessage: failResult } =
	await simulateToolCall({
		toolName: 'searchWeb',
		input: { query: 'test' },
		output: {
			error: 'Network timeout',
		},
	});

// Test with different scenarios
const testResult = await generateText({
	model: 'anthropic/claude-sonnet-4-5',
	tools: { searchWeb: searchWebTool },
	messages: [
		{ role: 'user', content: 'Search for AI tools' },
		successMsg,
		successResult,
		{ role: 'user', content: 'Now search for test' },
		failMsg,
		failResult,
	],
});
```

#### Mocking for Development

```typescript
// Mock multiple tool calls for development
const mockWeatherData = {
	'San Francisco': { temperature: 72, condition: 'sunny' },
	'New York': { temperature: 45, condition: 'cloudy' },
	'Tokyo': { temperature: 68, condition: 'rainy' },
};

// Create mock messages
const mockMessages = Object.entries(mockWeatherData).map(
	([location, weather]) => {
		const { assistantMessage, toolMessage } = simulateToolCall({
			toolName: 'weatherTool',
			input: { location },
			output: weather,
		});
		return [assistantMessage, toolMessage];
	}
).flat();

// Use in development
const result = await generateText({
	model: 'anthropic/claude-sonnet-4-5',
	tools: { weatherTool },
	messages: [
		{ role: 'user', content: 'Get weather for multiple cities' },
		...mockMessages,
		{ role: 'user', content: 'Summarize the weather' },
	],
});
```

## Message Structure

Both functions create messages that follow the AI SDK's native message format:

### Assistant Message (Tool Call)

```typescript
{
	role: 'assistant',
	content: [
		{
			type: 'tool-call',
			toolCallId: 'call-abc123...',  // Generated ID
			toolName: 'weatherTool',
			input: { location: 'San Francisco' }
		}
	]
}
```

### Tool Message (Tool Result)

```typescript
{
	role: 'tool',
	content: [
		{
			type: 'tool-result',
			toolCallId: 'call-abc123...',  // Same ID as tool call
			toolName: 'weatherTool',
			output: {
				type: 'json',
				value: { temperature: 72, condition: 'sunny' }
			}
		}
	]
}
```

## Best Practices

### 1. Tool Naming Consistency

Always use the same `toolName` that you register with the AI SDK:

```typescript
const tools = {
	weatherTool,  // Registered as 'weatherTool'
	searchTool,
};

// Use the same name when creating messages
const { assistantMessage } = await executeToolDirectly({
	tool: weatherTool,
	toolName: 'weatherTool',  // Must match registration
	input: { location: 'SF' },
});
```

### 2. Input Schema Validation

Ensure the input matches your tool's input schema:

```typescript
const weatherTool = tool({
	inputSchema: z.object({
		location: z.string(),
		units: z.enum(['celsius', 'fahrenheit']).optional(),
	}),
	// ...
});

// Valid input
await executeToolDirectly({
	tool: weatherTool,
	toolName: 'weatherTool',
	input: { location: 'SF', units: 'fahrenheit' },
});

// Invalid input - will cause issues
await executeToolDirectly({
	tool: weatherTool,
	toolName: 'weatherTool',
	input: { city: 'SF' },  // Wrong field name!
});
```

### 3. Error Handling

Always wrap tool execution in try-catch:

```typescript
try {
	const { assistantMessage, toolMessage, output } =
		await executeToolDirectly({
			tool: weatherTool,
			toolName: 'weatherTool',
			input: { location: 'SF' },
		});

	// Process successful result
} catch (error) {
	// Handle execution errors
	console.error('Tool failed:', error);

	// Optionally create error message
	const errorResult = await simulateToolCall({
		toolName: 'weatherTool',
		input: { location: 'SF' },
		output: { error: error.message },
	});
}
```

### 4. Tool Call IDs

Each function call generates a unique tool call ID using the format `call-{random 24 chars}`:

```typescript
const { toolCallId: id1 } = await executeToolDirectly({...});
const { toolCallId: id2 } = await simulateToolCall({...});

// IDs are unique
console.log(id1 !== id2);  // true
```

### 5. Message Ordering

When injecting into conversation history, maintain proper order:

```typescript
const messages = [
	{ role: 'user', content: 'Get weather for SF' },
	assistantMessage,  // Tool call
	toolMessage,        // Tool result
	{ role: 'user', content: 'Now get weather for NY' },
	// ... next messages
];
```

## Common Use Cases

### Use Case 1: Manual Agent Loop

```typescript
async function runManualAgentLoop() {
	let messages: Array<any> = [
		{ role: 'user', content: 'Get weather for SF and NY' },
	];

	let iterations = 0;
	const maxIterations = 5;

	while (iterations < maxIterations) {
		const result = await generateText({
			model: 'anthropic/claude-sonnet-4-5',
			tools: { weatherTool },
			messages,
		});

		// Add assistant response
		messages.push(...result.response.messages);

		// Check if tool calls needed
		if (result.finishReason === 'tool-calls') {
			// Execute tools manually
			for (const toolCall of result.toolCalls) {
				const { assistantMessage, toolMessage } =
					await executeToolDirectly({
						tool: toolCall.tool,
						toolName: toolCall.toolName,
						input: toolCall.args,
					});

				messages.push(assistantMessage, toolMessage);
			}
		} else {
			break; // Done
		}

		iterations++;
	}

	return messages;
}
```

### Use Case 2: Caching Tool Results

```typescript
const toolCache = new Map<string, ToolExecutionResult>();

async function getCachedToolResult(
	tool: Tool,
	toolName: string,
	input: unknown
) {
	const cacheKey = JSON.stringify({ toolName, input });

	if (toolCache.has(cacheKey)) {
		return toolCache.get(cacheKey);
	}

	const result = await executeToolDirectly({
		tool,
		toolName,
		input,
	});

	toolCache.set(cacheKey, result);
	return result;
}
```

### Use Case 3: Testing Tool Integration

```typescript
describe('Tool Integration Tests', () => {
	it('should handle tool calls correctly', async () => {
		// Simulate tool call
		const { assistantMessage, toolMessage } = await simulateToolCall({
			toolName: 'weatherTool',
			input: { location: 'Test City' },
			output: { temperature: 70, condition: 'test' },
		});

		// Test with generateText
		const result = await generateText({
			model: 'anthropic/claude-sonnet-4-5',
			tools: { weatherTool },
			messages: [
				{ role: 'user', content: 'Test' },
				assistantMessage,
				toolMessage,
			],
		});

		expect(result.text).toBeDefined();
	});
});
```

## Type Safety

Both functions are fully typed with TypeScript:

```typescript
import type {
	Tool,
	ToolExecutionOptions,
	ToolExecutionResult,
	ToolSimulationResult,
} from '@agents/utils';

// Type-safe tool execution
const result: ToolExecutionResult = await executeToolDirectly({
	tool: myTool,
	toolName: 'myTool',
	input: { param: 'value' },
});

// Access typed properties
const { assistantMessage, toolMessage, toolCallId, output } = result;
```

## Logging

Both functions use scoped logging via `electron-log`:

```typescript
// Logs are scoped under 'ToolMessageUtils'
// Debug logs show:
// - Tool execution attempts
// - Tool call IDs
// - Input/output data

// Error logs show:
// - Tool execution failures
// - Error messages
```

## Troubleshooting

### Issue: "Tool does not have execute function"

**Cause**: The tool object doesn't have an `execute` function.

**Solution**: Ensure your tool definition includes an `execute` function, or use `simulateToolCall` instead.

```typescript
// ❌ Wrong - no execute function
const badTool = tool({
	description: 'Bad tool',
	inputSchema: z.object({}),
	// Missing execute function
});

// ✅ Correct - has execute function
const goodTool = tool({
	description: 'Good tool',
	inputSchema: z.object({}),
	execute: async (input) => {
		return { result: 'success' };
	},
});
```

### Issue: Type errors with output

**Cause**: Output type doesn't match expected structure.

**Solution**: Ensure output is JSON-serializable:

```typescript
// ❌ Wrong - contains non-serializable data
const badOutput = {
	data: new Date(),  // Date objects aren't JSON-serializable
	function: () => {}, // Functions aren't JSON-serializable
};

// ✅ Correct - all JSON-serializable
const goodOutput = {
	data: new Date().toISOString(),  // String representation
	count: 42,
	items: ['a', 'b', 'c'],
};
```

## See Also

- [AI SDK Documentation](../ai/docs/)
- [Tool Examples](../ai/examples/)
- [Agent Implementation](../src/main/agents/)
