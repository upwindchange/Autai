# AgentActionRegistry Implementation Plan (Phase 2.1)

## Overview

This document outlines the detailed implementation plan for the AgentActionRegistry system, which will serve as the bridge between AI agents and browser automation capabilities in Autai. This is Phase 2.1 of the browser automation implementation and is designed to be an organic foundation for subsequent phases.

## Current State Analysis

### What We Have

1. **BrowserActionService** (Phase 1 - Complete)
   - Comprehensive browser automation methods (20+ actions)
   - Navigation: `navigateTo`, `goBack`, `goForward`, `refresh`
   - Interaction: `clickElement`, `typeText`, `pressKey`, `hover`
   - Content: `getPageElements`, `extractText`, `captureScreenshot`
   - Scrolling: `scrollPage`, `scrollToElement`
   - Forms: `selectOption`, `setCheckbox`
   - Utilities: `executeScript`, `getCurrentUrl`, `getPageTitle`, `waitForSelector`

2. **StreamingAgentService**
   - LangChain-based chat with streaming responses
   - Conversation history management
   - Basic context injection (URL, title, elements count)
   - StreamChunk type with unused 'tool_call' capability

3. **Type System**
   - `ActionResult` type for operation outcomes
   - `StreamChunk` with support for tool calls (not implemented)
   - `InteractableElement` for DOM element representation
   - Basic agent and streaming configurations

### Key Gaps

1. **No Action Discovery** - Agents cannot discover available actions
2. **No Action Execution** - No framework for agents to execute browser actions
3. **No Validation** - No parameter validation or type safety for action calls
4. **No Context Awareness** - Actions aren't aware of page state or task context
5. **No Result Handling** - No structured way to process action results

## Implementation Design

### Core Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌───────────────────┐
│StreamingAgentService│────▶│  AgentActionRegistry │────▶│BrowserActionService│
└─────────────────────┘     └──────────────────────┘     └───────────────────┘
         │                            │                             │
         │ 1. Request Action          │ 2. Validate & Execute       │
         │                            │                             │
         ▼                            ▼                             ▼
   ┌───────────┐              ┌──────────────┐            ┌──────────────┐
   │StreamChunk│              │ActionCatalog │            │ActionResult  │
   │(tool_call)│              │& Validators  │            │              │
   └───────────┘              └──────────────┘            └──────────────┘
```

### Phase 2.1 Implementation Steps

## 1. Type Definitions Enhancement

### Location: `electron/shared/types/agentActions.ts` (NEW)

```typescript
// Action execution context
export interface ActionContext {
  taskId: string;
  pageId: string;
  pageUrl?: string;
  pageTitle?: string;
  viewportSize?: { width: number; height: number };
  lastActionResult?: ActionResult;
}

// Parameter schema for validation
export interface ParameterSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
  enum?: any[];
  default?: any;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    custom?: string; // Function name for custom validation
  };
}

// Action definition structure
export interface ActionDefinition {
  id: string;
  name: string;
  category: 'navigation' | 'interaction' | 'content' | 'form' | 'utility';
  description: string;
  examples: string[];
  parameters: ParameterSchema[];
  returns: {
    type: string;
    description: string;
  };
  availability?: {
    requiresElement?: boolean;
    requiresPage?: boolean;
    conditions?: string[];
  };
}

// Action execution request
export interface ActionRequest {
  actionId: string;
  parameters: Record<string, any>;
  context: ActionContext;
  requestId?: string;
}

// Enhanced action result
export interface EnhancedActionResult extends ActionResult {
  actionId: string;
  executionTime: number;
  context?: ActionContext;
  suggestions?: string[]; // Suggested follow-up actions
}
```

### Location: `electron/shared/types/streaming.ts` (UPDATE)

```typescript
// Enhance StreamChunk for action requests
export interface StreamChunk {
  type: 'token' | 'error' | 'metadata' | 'tool_call' | 'action_request' | 'action_result';
  content: string;
  metadata?: Record<string, unknown>;
  actionRequest?: ActionRequest;
  actionResult?: EnhancedActionResult;
}

// Add action capability to agent options
export interface AgentStreamOptions {
  message: string;
  context?: {
    currentUrl?: string;
    pageTitle?: string;
    interactableElements?: unknown[];
    availableActions?: string[]; // List of available action IDs
  };
  enableActions?: boolean;
}
```

## 2. AgentActionRegistry Service

### Location: `electron/main/services/AgentActionRegistry.ts` (NEW)

```typescript
export class AgentActionRegistry {
  private actions: Map<string, ActionDefinition>;
  private executors: Map<string, ActionExecutor>;
  private browserActionService: BrowserActionService;
  private validationCache: Map<string, ValidationResult>;

  constructor(browserActionService: BrowserActionService) {
    this.actions = new Map();
    this.executors = new Map();
    this.browserActionService = browserActionService;
    this.validationCache = new Map();
    this.registerBuiltInActions();
  }

  // Core methods
  register(action: ActionDefinition, executor: ActionExecutor): void
  unregister(actionId: string): boolean
  getAction(actionId: string): ActionDefinition | undefined
  getAvailableActions(context: ActionContext): ActionDefinition[]
  execute(request: ActionRequest): Promise<EnhancedActionResult>
  validateParameters(actionId: string, params: any): ValidationResult
  
  // Utility methods
  getCatalog(context?: ActionContext): ActionCatalog
  getActionsByCategory(category: string): ActionDefinition[]
  searchActions(query: string): ActionDefinition[]
  
  // Private methods
  private registerBuiltInActions(): void
  private createActionDefinition(...): ActionDefinition
  private wrapBrowserAction(...): ActionExecutor
}
```

### Key Implementation Details:

1. **Built-in Action Registration**
   - Map all BrowserActionService methods to ActionDefinitions
   - Create parameter schemas for each action
   - Define categories and examples

2. **Context-Aware Availability**
   - Actions filtered based on current page state
   - Element-dependent actions only available when elements exist
   - Navigation actions disabled during loading

3. **Validation System**
   - Type checking for all parameters
   - Range validation for numeric inputs
   - Pattern matching for strings (URLs, selectors)
   - Custom validation functions

4. **Execution Pipeline**
   - Pre-execution validation
   - Context enrichment
   - Error handling and recovery
   - Performance tracking
   - Result enhancement with suggestions

## 3. Action Catalog Generation

### Location: `electron/main/services/AgentActionRegistry.ts` (method)

```typescript
private registerBuiltInActions(): void {
  // Navigation Actions
  this.register({
    id: 'navigate',
    name: 'Navigate to URL',
    category: 'navigation',
    description: 'Navigate the browser to a specific URL',
    examples: [
      'navigate to https://example.com',
      'go to the login page',
      'open google search'
    ],
    parameters: [{
      name: 'url',
      type: 'string',
      required: true,
      description: 'The URL to navigate to',
      validation: {
        pattern: '^https?://.+',
        custom: 'isValidUrl'
      }
    }],
    returns: {
      type: 'ActionResult',
      description: 'Navigation result with final URL'
    }
  }, this.wrapBrowserAction('navigateTo'));

  // Interaction Actions
  this.register({
    id: 'click',
    name: 'Click Element',
    category: 'interaction',
    description: 'Click on an interactive element by its ID',
    examples: [
      'click button 5',
      'click the submit button',
      'click element with id 12'
    ],
    parameters: [{
      name: 'elementId',
      type: 'number',
      required: true,
      description: 'The numeric ID of the element to click',
      validation: {
        min: 1,
        custom: 'isValidElementId'
      }
    }],
    returns: {
      type: 'ActionResult',
      description: 'Click result'
    },
    availability: {
      requiresElement: true
    }
  }, this.wrapBrowserAction('clickElement'));

  // ... register all other actions
}
```

## 4. Integration with StreamingAgentService

### Location: `electron/main/services/streamingAgentService.ts` (UPDATE)

Enhance the StreamingAgentService to:

1. **Action Discovery**
   - Inject available actions into system prompt
   - Format action descriptions for LLM understanding
   - Include examples and parameter schemas

2. **Action Execution**
   - Parse LLM responses for action requests
   - Execute actions through registry
   - Stream action results back to agent

3. **Context Management**
   - Maintain action history
   - Track page state changes
   - Update available actions dynamically

```typescript
// Enhanced prompt with action capabilities
const systemPromptWithActions = `
You are a helpful AI assistant with browser automation capabilities.

Available Actions:
${this.formatAvailableActions(context)}

To use an action, respond with:
<action>
{
  "action": "actionId",
  "parameters": {
    "param1": "value1"
  }
}
</action>

Current Context:
- URL: ${context.currentUrl}
- Page Title: ${context.pageTitle}
- Interactive Elements: ${context.interactableElements?.length || 0}
`;
```

## 5. Action Result Processing

### Location: `electron/main/services/AgentActionResultProcessor.ts` (NEW)

```typescript
export class AgentActionResultProcessor {
  processBrowserActionResult(
    result: ActionResult,
    action: ActionDefinition,
    context: ActionContext
  ): EnhancedActionResult {
    // Enhance result with context
    // Add execution metadata
    // Generate follow-up suggestions
    // Format for agent consumption
  }

  generateSuggestions(
    result: EnhancedActionResult,
    availableActions: ActionDefinition[]
  ): string[] {
    // Suggest logical next actions
    // Based on result and context
  }
}
```

## 6. Error Handling and Recovery

### Location: Throughout AgentActionRegistry

1. **Validation Errors**
   - Clear parameter type mismatches
   - Missing required parameters
   - Invalid parameter values

2. **Execution Errors**
   - Element not found
   - Navigation failures
   - Timeout scenarios

3. **Recovery Strategies**
   - Retry with backoff
   - Alternative action suggestions
   - Graceful degradation

## Testing Strategy

1. **Unit Tests**
   - Action registration and retrieval
   - Parameter validation logic
   - Context filtering

2. **Integration Tests**
   - Action execution through registry
   - StreamingAgent integration
   - Error handling flows

3. **E2E Tests**
   - Agent-driven browser automation
   - Multi-step workflows
   - Error recovery scenarios

## Migration Path to Future Phases

This implementation sets up for:

### Phase 2.2: Agent Brain Model
- Action history tracking foundation
- Context state management
- Decision-making data structures

### Phase 2.3: Enhanced Prompts
- Action description templates
- Example generation system
- Context formatting infrastructure

### Phase 3: Advanced Features
- Tab management action category
- File system action category
- Complex form automation actions

## Success Criteria

1. **Functionality**
   - All BrowserActionService methods exposed as actions
   - Agents can discover and execute actions
   - Results properly formatted and returned

2. **Performance**
   - Action execution < 100ms overhead
   - Validation caching effective
   - No memory leaks

3. **Developer Experience**
   - Clear action definitions
   - Easy to add new actions
   - Comprehensive logging

4. **Agent Experience**
   - Natural action discovery
   - Clear parameter requirements
   - Helpful error messages

## Implementation Timeline

- **Day 1-2**: Type definitions and core registry structure
- **Day 3-4**: Built-in action registration and validation
- **Day 5-6**: StreamingAgent integration
- **Day 7**: Testing and documentation

## Next Steps After Implementation

1. Implement Phase 2.2 (Agent Brain Model)
2. Add action usage analytics
3. Create action composition patterns
4. Develop custom action plugins system