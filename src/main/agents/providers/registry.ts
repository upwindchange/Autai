/**
 * Provider Registry — lazy-loads provider definitions and model catalogs from TOML files.
 *
 * `initialize()` stores the base path only (zero I/O).
 * Providers and models are loaded on first access and cached.
 */

import fs from "node:fs";
import path from "node:path";
import TOML from "smol-toml";
import log from "electron-log/main";
import type { ProviderDefinition, ModelDefinition } from "@shared";

const logger = log.scope("ProviderRegistry");

// ──────────────────────────────────────────────
// Internal state
// ──────────────────────────────────────────────

let basePath: string | null = null;
let allProvidersScanned = false;

const providers = new Map<string, ProviderDefinition>();
const models = new Map<string, ModelDefinition[]>();

// ──────────────────────────────────────────────
// TOML file types (raw from disk)
// ──────────────────────────────────────────────

interface ProviderToml {
  name: string;
  env: string[];
  npm: string;
  doc: string;
  api?: string;
}

interface ModelToml {
  name: string;
  // `base_model = "<providerDir>/<modelFile>"` — the models.dev catalog's
  // inheritance key. The child file holds only the fields it overrides (e.g.
  // cost); it inherits name/family/limit/modalities/capabilities from the base.
  // Resolved in scanModels / loadBaseModel.
  base_model?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  knowledge?: string;
  open_weights?: boolean;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
    cached_input?: number;
  };
  limit?: {
    context: number;
    output: number;
  };
  modalities?: {
    input: string[];
    output: string[];
  };
  interleaved?: {
    field: string;
  };
}

// ──────────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────────

export function initialize(dir: string): void {
  providers.clear();
  models.clear();
  basePath = dir;
  allProvidersScanned = false;
  logger.info("Registry initialized (lazy loading enabled)");
}

// ──────────────────────────────────────────────
// Single-provider loading
// ──────────────────────────────────────────────

function loadProvider(dir: string): ProviderDefinition | undefined {
  if (!basePath) return undefined;

  const tomlPath = path.join(basePath, dir, "provider.toml");
  if (!fs.existsSync(tomlPath)) return undefined;

  try {
    const raw = fs.readFileSync(tomlPath, "utf-8");
    const toml = TOML.parse(raw) as unknown as ProviderToml;

    const def: ProviderDefinition = {
      dir,
      name: toml.name,
      env: toml.env,
      npm: toml.npm,
      api: toml.api,
      doc: toml.doc,
    };

    const logoFile = path.join(basePath, dir, "logo.svg");
    if (fs.existsSync(logoFile)) {
      def.logo = fs.readFileSync(logoFile, "utf-8");
    }

    providers.set(dir, def);
    return def;
  } catch (err) {
    logger.error(`Failed to parse provider ${dir}:`, err);
    return undefined;
  }
}

// ──────────────────────────────────────────────
// Model scanning (recursive for nested dirs like deepinfra/models/meta-llama/)
// ──────────────────────────────────────────────

/** Drop keys whose value is `undefined` so they don't clobber a base on merge. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/** Map a parsed model TOML to a ModelDefinition with the given file id. */
function toModelDefinition(toml: ModelToml, file: string): ModelDefinition {
  return {
    // Fall back to the file id so a model whose `base_model` is missing/broken
    // (or a sparse self-referential base) never renders nameless.
    name: toml.name ?? file,
    file,
    family: toml.family,
    attachment: toml.attachment,
    reasoning: toml.reasoning,
    temperature: toml.temperature,
    toolCall: toml.tool_call,
    structuredOutput: toml.structured_output,
    knowledge: toml.knowledge,
    openWeights: toml.open_weights,
    cost:
      toml.cost ?
        {
          input: toml.cost.input,
          output: toml.cost.output,
          cacheRead: toml.cost.cache_read,
          cacheWrite: toml.cost.cache_write,
          cachedInput: toml.cost.cached_input,
        }
      : undefined,
    limit: toml.limit,
    modalities: toml.modalities,
    interleaved: toml.interleaved,
  };
}

/**
 * Load the base model TOML referenced by `base_model`.
 * `from` is `"<providerDir>/<modelFile>"` (modelFile may itself be a nested path).
 * Resolves chained `base_model` references so multi-hop and self-referential
 * chains collapse to a complete model; a `visited` set + depth cap terminate cycles.
 */
function loadBaseModel(
  from: string,
  visited: Set<string> = new Set(),
): ModelToml | null {
  if (visited.has(from) || visited.size >= 8) return null; // cycle / depth guard
  visited.add(from);
  if (!basePath) return null;
  const slashIdx = from.indexOf("/");
  if (slashIdx < 0) return null;
  const providerDir = from.slice(0, slashIdx);
  const modelRel = from.slice(slashIdx + 1);
  const baseFile = path.join(
    basePath,
    providerDir,
    "models",
    `${modelRel}.toml`,
  );
  if (!fs.existsSync(baseFile)) return null;

  try {
    let raw = fs.readFileSync(baseFile, "utf-8");
    // Windows symlink-as-text guard (mirrors scanModels).
    const trimmed = raw.trim();
    if (trimmed.startsWith("../") || trimmed.startsWith("./")) {
      const resolved = path.resolve(path.dirname(baseFile), trimmed);
      if (fs.existsSync(resolved)) raw = fs.readFileSync(resolved, "utf-8");
    }
    const toml = TOML.parse(raw) as unknown as ModelToml;

    // Resolve chained inheritance: merge any ancestor the base itself references,
    // so multi-hop and self-referential `base_model` chains collapse to one model.
    // Nearer base overrides the deeper ancestor.
    if (toml.base_model) {
      const ancestor = loadBaseModel(toml.base_model, visited);
      if (ancestor) return { ...ancestor, ...stripUndefined(toml) };
    }
    return toml;
  } catch (err) {
    logger.error(`Failed to parse base model ${from}:`, err);
    return null;
  }
}

function scanModels(baseDir: string, currentDir: string): ModelDefinition[] {
  const result: ModelDefinition[] = [];
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      result.push(...scanModels(baseDir, fullPath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;

    try {
      let raw = fs.readFileSync(fullPath, "utf-8");

      // On Windows, git stores symlinks as plain text containing the target path.
      // Detect this and follow the reference to the actual TOML file.
      const trimmed = raw.trim();
      if (trimmed.startsWith("../") || trimmed.startsWith("./")) {
        const resolved = path.resolve(path.dirname(fullPath), trimmed);
        if (fs.existsSync(resolved)) {
          raw = fs.readFileSync(resolved, "utf-8");
        }
      }

      const toml = TOML.parse(raw) as unknown as ModelToml;

      // Compute relative path from baseDir as file identifier.
      // Filenames use '+' instead of ':' for Windows compatibility;
      // convert back so the model ID matches the actual API model name.
      const relPath = path.relative(baseDir, fullPath);
      const file = relPath.replace(/\.toml$/, "").replace(/\+/g, ":");

      // Resolve `base_model`: inherit the base model's fields (name, family, …),
      // then let this model override anything it explicitly defines (e.g. cost).
      // The child keeps its own `file` (its own model id / API endpoint).
      if (toml.base_model) {
        const base = loadBaseModel(toml.base_model);
        if (base) {
          result.push({
            ...toModelDefinition(base, file),
            ...stripUndefined(toModelDefinition(toml, file)),
          });
          continue;
        }
      }

      result.push(toModelDefinition(toml, file));
    } catch (err) {
      logger.error(`Failed to parse model ${fullPath}:`, err);
    }
  }

  return result;
}

/**
 * Register the virtual "openai-compatible" provider (no TOML on disk).
 *
 * Extracted from getAllProviders() so both it and getProvider() resolve the
 * provider consistently regardless of which is called first. Without this,
 * getProvider("openai-compatible") returns undefined until getAllProviders()
 * runs — and /configured/models (read by the model selector) calls
 * getProvider() directly, so the logo never reached the selector.
 *
 * Idempotent: no-op once registered (or before basePath is set).
 */
function ensureOpenAiCompatibleProvider(): void {
  if (providers.has("openai-compatible") || !basePath) return;

  const openaiLogoPath = path.join(basePath, "openai", "logo.svg");
  providers.set("openai-compatible", {
    dir: "openai-compatible",
    name: "OpenAI Compatible",
    env: ["API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "http://localhost:11434/v1",
    doc: "https://sdk.vercel.ai/providers/ai-sdk-providers/openai-compatible",
    ...(fs.existsSync(openaiLogoPath) && {
      logo: fs.readFileSync(openaiLogoPath, "utf-8"),
    }),
  });
}

// ──────────────────────────────────────────────
// Public getters
// ──────────────────────────────────────────────

export function getAllProviders(): ProviderDefinition[] {
  if (!allProvidersScanned && basePath) {
    allProvidersScanned = true;

    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (providers.has(entry.name)) continue;
      loadProvider(entry.name);
    }

    // Virtual provider — no TOML files on disk
    ensureOpenAiCompatibleProvider();

    logger.info(`Loaded ${providers.size} providers`);
  }

  return [...providers.values()].sort((a, b) => {
    if (a.dir === "openai-compatible") return -1;
    if (b.dir === "openai-compatible") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function getProvider(dir: string): ProviderDefinition | undefined {
  // The virtual provider has no TOML on disk, so register it before the lookup.
  // Otherwise it's only available after getAllProviders() has primed the map,
  // and callers like /configured/models (which go straight to getProvider)
  // would see undefined and lose the provider's logo.
  if (dir === "openai-compatible") ensureOpenAiCompatibleProvider();
  if (providers.has(dir)) return providers.get(dir);
  return loadProvider(dir);
}

export function getModels(dir: string): ModelDefinition[] {
  if (models.has(dir)) return models.get(dir) ?? [];

  if (!basePath) return [];

  const modelsDir = path.join(basePath, dir, "models");
  if (fs.existsSync(modelsDir)) {
    const result = scanModels(modelsDir, modelsDir);
    models.set(dir, result);
    logger.info(`Loaded ${result.length} models for ${dir}`);
    return result;
  }

  models.set(dir, []);
  return [];
}

/**
 * Resolve the available models for a *configured* provider.
 *
 * Static TOML providers return their scanned catalog. The virtual
 * "openai-compatible" provider has no TOML models, so its list is fetched
 * dynamically from the user's saved API endpoint (defaults to local Ollama).
 */
export async function getModelsForConfig(providerConfig: {
  providerDir: string;
  apiKey: string;
  apiUrlOverride?: string;
}): Promise<ModelDefinition[]> {
  const dir = providerConfig.providerDir;

  const tomlModels = getModels(dir);
  if (tomlModels.length > 0) return tomlModels;

  if (dir === "openai-compatible") {
    const definition = getProvider(dir);
    const apiUrl =
      providerConfig.apiUrlOverride ||
      definition?.api ||
      "http://localhost:11434/v1";
    try {
      const headers: Record<string, string> = {};
      if (providerConfig.apiKey) {
        headers["Authorization"] = `Bearer ${providerConfig.apiKey}`;
      }
      const res = await fetch(`${apiUrl}/models`, { headers });
      const data = (await res.json()) as { data: { id: string }[] };
      return (data.data ?? []).map((m) => ({ name: m.id, file: m.id }));
    } catch {
      return [];
    }
  }

  return [];
}
