# AI SDK Tool Calling - Research Findings

## Context

Research on AI SDK tool calling capabilities to answer three specific questions about tool output extraction, context passing, and direct code integration.

---

## Question 1: How to Extract Tool Output

### Direct Access from Result Object

Tool outputs are directly accessible from the `generateText` and `streamText` result objects:

```typescript
const result = await generateText({
	model: myModel,
	tools: { myTool },
	prompt: "...",
});

// Access all tool results from the last step:
const toolResults = result.toolResults; // Array<TypedToolResult<TOOLS>>

// Each tool result contains:
for (const toolResult of result.toolResults) {
	console.log(toolResult.toolName); // string
	console.log(toolResult.toolCallId); // string
	console.log(toolResult.input); // typed input
	console.log(toolResult.output); // typed output - THIS IS WHAT YOU WANT
}
```

### Access from Multi-Step Results

When using `stopWhen` for multi-step calls, access results from all steps:

```typescript
const { steps } = await generateText({
	model: myModel,
	tools: { myTool },
	stopWhen: stepCountIs(5),
	prompt: "...",
});

// Extract all tool calls and results from all steps:
const allToolResults = steps.flatMap((step) => step.toolResults);
```

### Real-Time Access via Callbacks

Access tool outputs as they complete using lifecycle callbacks:

```typescript
const result = await generateText({
	model: myModel,
	tools: { myTool },
	experimental_onToolCallFinish: ({ toolName, output, error }) => {
		if (error) {
			console.error(`Tool ${toolName} failed:`, error);
		} else {
			console.log(`Tool ${toolName} output:`, output);
			// Process output here in real-time
		}
	},
	onStepFinish: ({ toolResults }) => {
		// Access all tool results from this step
		for (const toolResult of toolResults) {
			console.log("Tool result:", toolResult.output);
		}
	},
	prompt: "...",
});
```

### Streaming Tool Results

For streaming with preliminary results (e.g., status updates):

```typescript
const result = streamText({
	model: myModel,
	tools: {
		myTool: tool({
			inputSchema: z.object({ query: z.string() }),
			async *execute({ query }) {
				yield { status: "loading", progress: 0 };
				// do work
				yield { status: "loading", progress: 50 };
				// do more work
				yield { status: "success", data: "final result" };
			},
		}),
	},
	prompt: "...",
});

for await (const chunk of result.fullStream) {
	if (chunk.type === "tool-result") {
		if (chunk.preliminary) {
			console.log("Preliminary:", chunk.output);
		} else {
			console.log("Final:", chunk.output);
		}
	}
}
```

### Type-Safe Access

Use typed extraction for type-safe tool result handling:

```typescript
import { TypedToolResult } from "ai";

type MyToolResult = TypedToolResult<typeof myToolSet>;

function processToolResults(results: MyToolResult[]) {
	for (const result of results) {
		if (result.dynamic) continue;
		switch (result.toolName) {
			case "myTool":
				// Fully typed access:
				result.output.someProperty; // typed!
				break;
		}
	}
}
```

---

## Question 2: Passing Input to Tools Without Agent Prompts (Context Variables)

### `experimental_context` Parameter

AI SDK provides `experimental_context` for passing data directly to tools without including it in prompts:

```typescript
// Pass context when calling generateText
const result = await generateText({
	model: myModel,
	tools: {
		databaseQuery: tool({
			description: "Query database with context",
			inputSchema: z.object({
				query: z.string(),
			}),
			execute: async ({ query }, { experimental_context: context }) => {
				// Access context from outer scope
				const typedContext = context as {
					dbConnection: Database;
					userId: string;
					apiKey: string;
				};

				// Use context directly - no tokens consumed!
				return await typedContext.dbConnection.query(query);
			},
		}),
	},
	experimental_context: {
		dbConnection: myDatabase, // Direct object reference
		userId: "user-123",
		apiKey: process.env.API_KEY,
	},
	prompt: "Query the user database",
});
```

### Key Features of `experimental_context`:

- **Zero Token Consumption**: Context data is NOT sent to the LLM
- **Direct Object Access**: Pass any JavaScript object (connections, instances, large data)
- **Type Safety**: Cast to your expected type in the tool
- **Immutable**: Context should be treated as read-only (prevent race conditions)
- **Available Everywhere**: Access in tools, `prepareStep`, and callbacks

### Context in `prepareStep` for Dynamic Updates

Modify context between steps based on previous tool results:

```typescript
const result = await generateText({
	model: myModel,
	tools: { myTool },
	experimental_context: { step: 0, data: {} },
	prepareStep: async ({
		stepNumber,
		steps,
		messages,
		experimental_context,
	}) => {
		const context = experimental_context as {
			step: number;
			data: Record<string, unknown>;
		};

		// Update context based on previous steps
		context.step = stepNumber;
		context.data.lastToolResult = steps[stepNumber - 1]?.toolResults[0]?.output;

		// Return updated context for next step
		return {
			experimental_context: context,
		};
	},
	stopWhen: stepCountIs(3),
	prompt: "...",
});
```

### Context in Callbacks

Access context in all lifecycle callbacks:

```typescript
await generateText({
	model: myModel,
	tools: { myTool },
	experimental_context: { myData: "value" },
	onToolCallStart: ({ experimental_context }) => {
		console.log("Context at tool start:", experimental_context);
	},
	onToolCallFinish: ({ experimental_context, output }) => {
		console.log("Context at tool finish:", experimental_context);
		console.log("Tool output:", output);
	},
	onStepFinish: ({ experimental_context, toolResults }) => {
		console.log("Context at step finish:", experimental_context);
		console.log("Tool results:", toolResults);
	},
	prompt: "...",
});
```

### Differences from LangChain's `setContextVariable/getContextVariable`:

| Feature         | AI SDK `experimental_context`                | LangChain Context Variables |
| --------------- | -------------------------------------------- | --------------------------- |
| **Scope**       | Passed once, flows through entire lifecycle  | Get/set at any point        |
| **Mutability**  | Treat as immutable (update in `prepareStep`) | Mutable setters             |
| **Token Usage** | Never sent to LLM                            | Never sent to LLM           |
| **Type Safety** | Manual casting required                      | Varies by implementation    |
| **Status**      | Experimental (may change in patches)         | Stable API                  |

### Practical Example: Database Connection Pool

```typescript
const dbPool = new DatabasePool(CONFIG);

const result = await generateText({
	model: myModel,
	tools: {
		queryUser: tool({
			description: "Get user by ID",
			inputSchema: z.object({ userId: z.string() }),
			execute: async ({ userId }, { experimental_context: context }) => {
				const { db } = context as { db: DatabasePool };
				// Direct database access - no tokens, reliable
				return await db.query("SELECT * FROM users WHERE id = ?", [userId]);
			},
		}),
	},
	experimental_context: { db: dbPool },
	prompt: "Get user information for user 123",
});

// Access tool results
const userData = result.toolResults[0]?.output;
```

---

## Question 3: Using Tools to Output Results Directly to Code Scope

### Yes - Tools as Function API

Tools can be used as a function API that returns structured data to your code:

```typescript
// Define tool that executes business logic
const calculatePrice = tool({
	description: "Calculate product price with discounts",
	inputSchema: z.object({
		productId: z.string(),
		quantity: z.number(),
		customerTier: z.enum(["bronze", "silver", "gold"]),
	}),
	execute: async ({ productId, quantity, customerTier }) => {
		// Your business logic here
		const basePrice = await getProductPrice(productId);
		const discount = getDiscountForTier(customerTier);
		const finalPrice = basePrice * quantity * (1 - discount);

		// Return structured data to your code
		return {
			productId,
			quantity,
			basePrice,
			discount,
			finalPrice,
			currency: "USD",
			calculatedAt: new Date().toISOString(),
		};
	},
});

// Use agent as decision-maker for function inputs
const result = await generateText({
	model: myModel,
	tools: {
		calculatePrice,
	},
	// Agent decides what parameters to pass
	prompt:
		"Calculate price for 5 units of product PROD-123 for a gold tier customer",
});

// Extract structured output from tool directly into your code
const priceCalculation = result.toolResults.find(
	(r) => r.toolName === "calculatePrice",
)?.output;

// Now use the data in your application
if (priceCalculation) {
	await createOrder({
		productId: priceCalculation.productId,
		quantity: priceCalculation.quantity,
		price: priceCalculation.finalPrice,
	});

	console.log(
		`Order created: $${priceCalculation.finalPrice} (${priceCalculation.discount * 100}% discount applied)`,
	);
}
```

### Multi-Tool Agent as API Orchestrator

Agent decides which tools to call and in what order:

```typescript
const result = await generateText({
	model: myModel,
	stopWhen: stepCountIs(10),
	tools: {
		searchProducts: tool({
			description: "Search for products",
			inputSchema: z.object({ query: z.string() }),
			execute: async ({ query }) => {
				return await database.products.search(query);
			},
		}),
		comparePrices: tool({
			description: "Compare prices across vendors",
			inputSchema: z.object({
				products: z.array(z.object({ id: z.string(), price: z.number() })),
			}),
			execute: async ({ products }) => {
				return {
					cheapest: products.sort((a, b) => a.price - b.price)[0],
					average:
						products.reduce((sum, p) => sum + p.price, 0) / products.length,
				};
			},
		}),
		recommendAlternative: tool({
			description: "Recommend alternative products",
			inputSchema: z.object({ productId: z.string() }),
			execute: async ({ productId }) => {
				return await database.recommendations.getAlternatives(productId);
			},
		}),
	},
	prompt: "Find the best deal for a laptop under $1000",
});

// Extract all tool outputs
const allResults = result.toolResults;

// Process results in your application
for (const toolResult of allResults) {
	switch (toolResult.toolName) {
		case "searchProducts":
			displayProducts(toolResult.output);
			break;
		case "comparePrices":
			displayPriceComparison(toolResult.output);
			break;
		case "recommendAlternative":
			displayRecommendations(toolResult.output);
			break;
	}
}
```

### Using `onStepFinish` for Real-Time Processing

Process tool results as soon as each step completes:

```typescript
let accumulatedData: {
	searches?: Product[];
	comparisons?: PriceComparison;
	recommendations?: Product[];
} = {};

const result = await generateText({
	model: myModel,
	tools: {
		/* ... */
	},
	onStepFinish: ({ toolResults }) => {
		// Process each tool result immediately
		for (const toolResult of toolResults) {
			switch (toolResult.toolName) {
				case "searchProducts":
					accumulatedData.searches = toolResult.output;
					updateUI({ products: toolResult.output });
					break;
				case "comparePrices":
					accumulatedData.comparisons = toolResult.output;
					updateUI({ comparison: toolResult.output });
					break;
				case "recommendAlternative":
					accumulatedData.recommendations = toolResult.output;
					updateUI({ recommendations: toolResult.output });
					break;
			}
		}
	},
	stopWhen: stepCountIs(10),
	prompt: "...",
});

// Use accumulated data after completion
sendAnalytics(accumulatedData);
```

### Pattern: Agent as Decision Engine

Use the LLM only for decision-making, with tools doing all the work:

```typescript
// Tools contain all business logic
const tools = {
	validateData: tool({
		description: "Validate input data",
		inputSchema: z.object({ data: z.any() }),
		execute: async ({ data }) => {
			return validationService.validate(data);
		},
	}),
	processData: tool({
		description: "Process validated data",
		inputSchema: z.object({ validatedData: z.any() }),
		execute: async ({ validatedData }) => {
			return processingService.process(validatedData);
		},
	}),
	saveResult: tool({
		description: "Save processed result to database",
		inputSchema: z.object({
			result: z.any(),
			tableName: z.string(),
		}),
		execute: async ({ result, tableName }) => {
			return await database.save(tableName, result);
		},
	}),
};

// Agent orchestrates the workflow
const result = await generateText({
	model: myModel,
	tools,
	stopWhen: stepCountIs(5),
	prompt: "Validate the user data, process it, and save to the results table",
	experimental_context: { userData: userInput },
});

// Extract final result from save operation
const saveResult = result.toolResults.find((r) => r.toolName === "saveResult");
console.log("Saved record ID:", saveResult?.output.id);
```

### Key Differences from `Output.object()`:

| Aspect              | Tool-Based Approach                   | `Output.object()`      |
| ------------------- | ------------------------------------- | ---------------------- |
| **Multi-step**      | Yes - agent can chain tools           | No - single generation |
| **Decision-making** | Agent decides tool calls              | Agent generates output |
| **Side Effects**    | Tools can do anything (DB, API, etc.) | Pure output generation |
| **Reliability**     | Tools execute deterministically       | Schema-dependent       |
| **Complexity**      | More complex setup                    | Simpler setup          |
| **Use Case**        | Complex workflows, side effects       | Simple structured data |

---

## Summary & Recommendations

### Q1: Extracting Tool Output

- **Use `result.toolResults`** for direct access to typed tool outputs
- **Use `onStepFinish` or `onToolCallFinish`** for real-time processing
- **Use `steps.flatMap(s => s.toolResults)`** for multi-step scenarios

### Q2: Passing Context Without Tokens

- **Use `experimental_context`** parameter to pass any data directly to tools
- **Access via `{ experimental_context }`** in tool execute function
- **Update in `prepareStep`** for context that changes between steps
- **Zero token cost** - context never goes to the LLM

### Q3: Tools as Function API

- **Yes**, tools can output results directly to code scope
- **Use `result.toolResults.find(r => r.toolName === 'myTool')?.output`** to extract
- **Chain tools** for complex workflows with agent orchestration
- **Process in callbacks** for real-time results

### Best Practices

1. Always type your context: `context as MyContextType`
2. Use `experimental_context` for large data or connections
3. Prefer `onToolCallFinish` for immediate processing
4. Use `stopWhen` for multi-step workflows
5. Combine tools + context for powerful, token-efficient workflows
