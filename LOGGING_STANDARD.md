# Logging Standards for Autai

## Log Format Guidelines

### 1. General Principles
- Use lowercase for log messages (except for proper nouns)
- Keep messages concise and descriptive
- Use metadata objects for context instead of string interpolation where possible
- Avoid redundant prefixes like [MODULE_NAME] since the logger scope handles this

### 2. Log Levels

#### ERROR
- Use for actual errors that need attention
- Format: `"failed to [action]"` or `"error [context]"`
- Always include error object as second parameter
```typescript
logger.error("failed to initialize service", error);
logger.error("error parsing response", { error, response });
```

#### WARN  
- Use for recoverable issues or unexpected conditions
- Format: `"[subject] not found"` or `"unexpected [condition]"`
```typescript
logger.warn("view not found", { viewId });
logger.warn("unexpected response format", { response });
```

#### INFO
- Use for significant events and state changes
- Format: `"[action completed]"` or `"[subject] [verb]"`
```typescript
logger.info("server started", { port });
logger.info("thread created", { threadId });
logger.info("view destroyed", { viewId });
```

#### DEBUG
- Use for detailed operational information
- Format: `"[verb]ing [object]"` or detailed state descriptions
```typescript
logger.debug("injecting scripts", { viewId });
logger.debug("updating visibility", { viewId, visible: true });
logger.debug("processing request", { method, url });
```

### 3. Common Patterns

#### Service Initialization
```typescript
logger.info("service initialized", { config });
logger.error("failed to initialize service", error);
```

#### Request/Response
```typescript
logger.debug("processing request", { method, url });
logger.info("request completed", { status, duration });
logger.error("request failed", { error, method, url });
```

#### Resource Lifecycle
```typescript
logger.info("creating resource", { id, type });
logger.info("resource created", { id });
logger.debug("updating resource", { id, changes });
logger.info("resource destroyed", { id });
```

#### State Changes
```typescript
logger.debug("setting state", { from: oldState, to: newState });
logger.info("state changed", { state: newState });
```

### 4. Metadata Guidelines
- Include relevant IDs (threadId, viewId, etc.)
- Keep metadata objects flat when possible
- Use consistent property names across the codebase
- Avoid logging sensitive information (passwords, API keys, etc.)

### 5. Module Scoping
Each service/module should create its own logger scope:
```typescript
private logger = createLogger('ServiceName');
```

This automatically prefixes logs with the service name, so avoid manual prefixes like:
- ❌ `logger.info("[SERVICE] action completed")`
- ✅ `logger.info("action completed")`