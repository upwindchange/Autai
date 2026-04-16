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

      result.push({
        name: toml.name,
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
      });
    } catch (err) {
      logger.error(`Failed to parse model ${fullPath}:`, err);
    }
  }

  return result;
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
    if (!providers.has("openai-compatible")) {
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

    logger.info(`Loaded ${providers.size} providers`);
  }

  return [...providers.values()].sort((a, b) => {
    if (a.dir === "openai-compatible") return -1;
    if (b.dir === "openai-compatible") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function getProvider(dir: string): ProviderDefinition | undefined {
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
