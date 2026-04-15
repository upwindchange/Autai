# Provider System Rewrite Plan

## Context

The current provider system hardcodes 3 provider types (openai-compatible, anthropic, deepinfra) across 4 backend classes, discriminated union Zod schemas, and frontend type selectors. Meanwhile, `src/shared/providers/` contains 110+ TOML provider definitions with logos and model catalogs that are completely unused. This rewrite makes the entire system data-driven from those TOML files: adding a new provider means adding a folder, zero code changes.

**Key facts:**

- 79 providers use `@ai-sdk/openai-compatible` (just need `api` URL from TOML)
- 4 SDK packages already installed: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/deepinfra`, `@ai-sdk/openai-compatible`
- `asar: false` in electron-builder — TOML files are accessible directly on disk
- No existing users — safe to destroy DB schema

---

## New Dependency

- `smol-toml` — lightweight TOML parser for Node.js (user runs `pnpm add smol-toml`)

---

## Files to DELETE

| File                                                                   | Reason                                     |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| `src/main/agents/providers/BaseProvider.ts`                            | Replaced by single `Provider` class        |
| `src/main/agents/providers/AnthropicProvider.ts`                       | Merged into `Provider`                     |
| `src/main/agents/providers/OpenAICompatibleProvider.ts`                | Merged into `Provider`                     |
| `src/main/agents/providers/DeepInfraProvider.ts`                       | Merged into `Provider`                     |
| `src/renderer/components/settings/settings-sections/provider-card.tsx` | Replaced by `configured-provider-card.tsx` |
| `src/renderer/components/settings/settings-sections/model-list.tsx`    | Replaced by `toml-model-list.tsx`          |

---

## Files to CREATE

### 1. `src/shared/providers.ts` — New shared types

Flat types replacing the discriminated union in `settings.ts`:

```typescript
// From TOML: provider definition (read-only catalog data)
interface ProviderDefinition {
  dir: string; // folder name: "anthropic", "zhipuai-coding-plan"
  name: string; // "Anthropic", "Zhipu AI Coding Plan"
  env: string[]; // ["ANTHROPIC_API_KEY"]
  npm: string; // "@ai-sdk/anthropic"
  api?: string; // default base URL (for openai-compatible)
  doc: string; // documentation URL
}

// From TOML: model definition
interface ModelDefinition {
  name: string; // display name: "Claude Sonnet 4.6"
  file: string; // filename stem: "claude-sonnet-4-6"
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  toolCall?: boolean;
  structuredOutput?: boolean;
  knowledge?: string;
  openWeights?: boolean;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  limit?: { context: number; output: number };
  modalities?: { input: string[]; output: string[] };
}

// User config: stored in SQLite (flat, no discriminated union)
interface UserProviderConfig {
  id: string; // UUID
  providerDir: string; // references ProviderDefinition.dir
  apiKey: string;
  apiUrlOverride?: string; // user override of TOML default
}

// Model role assignment: stored in SQLite
interface ModelRoleAssignment {
  role: "chat" | "simple" | "complex";
  providerId: string;
  modelFile: string; // TOML file stem
}
```

### 2. `src/main/agents/providers/registry.ts` — TOML registry

Scans `src/shared/providers/*/provider.toml` at startup, caches everything in memory.

**Key functions:**

- `initialize(basePath: string): void` — scan all dirs, parse TOML, cache
- `getAllProviders(): ProviderDefinition[]` — sorted by name
- `getProvider(dir: string): ProviderDefinition | undefined`
- `getModels(dir: string): ModelDefinition[]` — recursively finds `models/**/*.toml`
- `getLogoPath(dir: string): string` — absolute path to `logo.svg`

Uses `smol-toml` for parsing. Model file stem (filename without `.toml`) becomes the `file` identifier.

### 3. `src/main/agents/providers/provider.ts` — Single provider class

Replaces all 4 existing provider classes. Uses `definition.npm` to dispatch to the right SDK:

```
"@ai-sdk/openai"              → createOpenAI({ apiKey, baseURL })
"@ai-sdk/anthropic"           → createAnthropic({ apiKey, baseURL })
"@ai-sdk/deepinfra"           → createDeepInfra({ apiKey, baseURL })
"@ai-sdk/openai-compatible"   → createOpenAICompatible({ name, apiKey, baseURL })
other                         → dynamic import(npm) with clear error if not installed
```

Constructor takes `(config: UserProviderConfig, definition: ProviderDefinition)`. The `apiUrlOverride` takes precedence over `definition.api`.

### 4. `src/main/agents/routes/providerRoutes.ts` — Provider catalog API

New Hono routes:
| Method | Path | Response |
|--------|------|----------|
| `GET` | `/providers` | `ProviderDefinition[]` — all providers from TOML |
| `GET` | `/providers/:dir/logo` | SVG file (`image/svg+xml`) |
| `GET` | `/providers/:dir/models` | `ModelDefinition[]` |

### 5. `src/renderer/hooks/useProviderCatalog.ts` — Frontend hook

Fetches `GET /providers` once, caches. Returns `{ providers, loading, error }`.

### 6. `src/renderer/components/settings/settings-sections/provider-catalog.tsx`

Searchable grid of all 110+ providers with logos. Each shows logo, name, npm SDK badge, "Add" button. Replaces the hardcoded 3-button empty state.

### 7. `src/renderer/components/settings/settings-sections/configured-provider-card.tsx`

Shows a user-configured provider: logo (from `/providers/:dir/logo`), name, API key input, optional URL override, model selector, test connection, delete. Replaces the old `provider-card.tsx`.

### 8. `src/renderer/components/settings/settings-sections/toml-model-list.tsx`

Model list populated from `GET /providers/:dir/models` (TOML data). Shows model name, cost, context window. Searchable. Replaces `model-list.tsx`. Falls back to API fetch for openai-compatible providers that support live model lists (optional enhancement).

---

## Files to MODIFY

### 9. `src/shared/settings.ts` — Replace discriminated union with flat types

**Remove:** `ProviderType`, `ProviderTypeSchema`, all 3 `*ProviderConfigSchema`, all 3 `Default*Schema`, `ProviderConfigSchema` (discriminated union), `getDefaultModelName()`, `getDefaultProviderName()`, `getDefaultProvider()`, `createModelConfigForProvider()`, `TestConnectionConfigSchema`, `TestConnectionConfig`.

**Replace `SettingsState` with:**

```typescript
{
  providers: UserProviderConfig[],         // flat array, no defaults
  modelAssignments: {
    chat: ModelRoleAssignment,
    simple: ModelRoleAssignment,
    complex: ModelRoleAssignment,
  },
  useSameModelForAgents: boolean,
  // ... logLevel, langfuse, autoTag fields unchanged
}
```

**Add:** Export from `./providers` or import the new types directly.

### 10. `src/main/agents/providers/index.ts` — Rewrite

Replace hardcoded factory with registry-driven resolution:

```
chatModel() → read modelAssignments.chat → lookup UserProviderConfig →
  lookup ProviderDefinition from registry → create Provider →
  createLanguageModel(modelFile)
```

Keep `chatModel()`, `simpleModel()`, `complexModel()` exports (consumed by workers). Add model cache invalidation when settings change.

### 11. `src/main/services/settingsService.ts` — Rewrite DB schema

**New schema:**

```sql
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_providers (
  id TEXT PRIMARY KEY,
  provider_dir TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  api_url_override TEXT
);
CREATE TABLE IF NOT EXISTS model_assignments (
  role TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES user_providers(id) ON DELETE CASCADE,
  model_file TEXT NOT NULL
);
```

Drop old `providers` and `model_configurations` tables. No default providers — user adds from catalog.

### 12. `src/main/agents/routes/settingsRoutes.ts` — Update

- `POST /settings/test` accepts `{ providerDir, apiKey, apiUrlOverride?, modelFile }` (flat, no discriminated union)
- Settings GET/PUT use new `SettingsState` type

### 13. `src/main/agents/schemas/apiSchemas.ts` — Update

Replace `TestConnectionConfigSchema` with flat schema. Re-export new `SettingsStateSchema`.

### 14. `src/main/agents/apiServer.ts` — Add provider routes

```typescript
import { providerRoutes } from "./routes/providerRoutes";
this.app.route("/providers", providerRoutes);
```

### 15. `src/main/index.ts` — Initialize registry

Add after `settingsService.initialize()`:

```typescript
import { registry } from "@agents/providers/registry";
const providersPath =
  app.isPackaged ?
    path.join(process.resourcesPath, "providers")
  : path.resolve(__dirname, "../../src/shared/providers");
registry.initialize(providersPath);
```

### 16. `electron.vite.config.ts` — Copy providers to output

Add a Vite plugin in `main.plugins` that copies `src/shared/providers/` to `out/main/shared/providers/` after build (same pattern as `bindingSqlite3` plugin). In production, this ensures TOML files are accessible.

### 17. `electron-builder.json` — Include providers

Add to `extraResources`:

```json
{ "from": "out/main/shared/providers", "to": "providers" }
```

### 18. `src/renderer/components/settings/settings-sections/providers-models-section.tsx` — Rewrite

- Empty state → `<ProviderCatalog />` (searchable grid of all providers)
- Provider list → `<ConfiguredProviderCard />` for each user provider
- Model role selector uses TOML model data
- No more hardcoded provider type buttons

### 19. `src/renderer/components/settings/settings-sections/model-role-selector.tsx` — Rewrite

- Fetches models from `GET /providers/:dir/models`
- Shows TOML model data (name, cost, context)
- Uses `modelFile` as identifier

### 20. `src/renderer/components/settings/settings-context.tsx` — Update types

Replace `ProviderConfig` with `UserProviderConfig`. Same CRUD API shape but flat types.

### 21. `src/renderer/components/settings/types.ts` — Update

```typescript
export interface EditingProvider extends UserProviderConfig {
  isNew?: boolean;
}
export type SectionType = "providers" | "development" | "about";
```

### 22. Locale files — Update

Remove hardcoded type strings (`type.openaiCompatible`, etc.). Add catalog strings.

---

## Implementation Order

**Phase 1: Foundation** (types + registry, no breaking changes yet)

1. Create `src/shared/providers.ts`
2. Update `src/shared/index.ts` — add export
3. Create `src/main/agents/providers/registry.ts`
4. Create `src/main/agents/providers/provider.ts`

**Phase 2: Backend rewrite** (breaking changes) 5. Rewrite `src/main/agents/providers/index.ts` 6. Rewrite `src/shared/settings.ts` — new flat types 7. Rewrite `src/main/services/settingsService.ts` — new DB schema 8. Create `src/main/agents/routes/providerRoutes.ts` 9. Update `src/main/agents/schemas/apiSchemas.ts` 10. Update `src/main/agents/routes/settingsRoutes.ts` 11. Update `src/main/agents/apiServer.ts` — add provider routes 12. Update `src/main/index.ts` — init registry

**Phase 3: Frontend** 13. Create `src/renderer/hooks/useProviderCatalog.ts` 14. Create `src/renderer/components/settings/settings-sections/provider-catalog.tsx` 15. Create `src/renderer/components/settings/settings-sections/configured-provider-card.tsx` 16. Create `src/renderer/components/settings/settings-sections/toml-model-list.tsx` 17. Rewrite `src/renderer/components/settings/settings-sections/providers-models-section.tsx` 18. Rewrite `src/renderer/components/settings/settings-sections/model-role-selector.tsx` 19. Update `src/renderer/components/settings/settings-context.tsx` 20. Update `src/renderer/components/settings/types.ts` 21. Update locale files

**Phase 4: Cleanup** 22. Delete 4 old provider classes + 2 old frontend components 23. Update `electron.vite.config.ts` + `electron-builder.json`

---

## Verification

1. **Registry**: `curl http://localhost:3001/providers` → 110+ providers, `curl http://localhost:3001/providers/anthropic/models` → 22 Claude models
2. **Logo**: `curl http://localhost:3001/providers/anthropic/logo` → SVG content
3. **UI**: Settings > Providers shows catalog grid with logos, searchable. Add Anthropic, enter key, select model.
4. **Chat**: Send message → verify correct model used (check logs for SDK dispatch)
5. **Edge cases**: Provider with `api` field (e.g. zhipuai-coding-plan) sets baseURL correctly. Uninstalled SDK shows clear error.
6. **TypeScript**: `pnpm tsc` passes with no errors
