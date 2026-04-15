/**
 * Provider Registry — scans TOML files from src/shared/providers/
 * and caches all provider definitions, model catalogs, and logo paths.
 */

import fs from "node:fs";
import path from "node:path";
import TOML from "smol-toml";
import log from "electron-log/main";
import type {
  ProviderDefinition,
  ModelDefinition,
} from "@shared";

const logger = log.scope("ProviderRegistry");

// ──────────────────────────────────────────────
// Internal cache
// ──────────────────────────────────────────────

const providers = new Map<string, ProviderDefinition>();
const models = new Map<string, ModelDefinition[]>();
const logoPaths = new Map<string, string>();

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

export function initialize(basePath: string): void {
  providers.clear();
  models.clear();
  logoPaths.clear();

  const entries = fs.readdirSync(basePath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir = entry.name;
    const tomlPath = path.join(basePath, dir, "provider.toml");

    if (!fs.existsSync(tomlPath)) continue;

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

      providers.set(dir, def);

      // Cache logo path
      const logo = path.join(basePath, dir, "logo.svg");
      if (fs.existsSync(logo)) {
        logoPaths.set(dir, logo);
      }

      // Scan model files
      const modelsDir = path.join(basePath, dir, "models");
      if (fs.existsSync(modelsDir)) {
        const modelList = scanModels(modelsDir, modelsDir);
        models.set(dir, modelList);
      }
    } catch (err) {
      logger.error(`Failed to parse provider ${dir}:`, err);
    }
  }

  logger.info(
    `Loaded ${providers.size} providers with ${[...models.values()].reduce((sum, m) => sum + m.length, 0)} models`,
  );
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
      const raw = fs.readFileSync(fullPath, "utf-8");
      const toml = TOML.parse(raw) as unknown as ModelToml;

      // Compute relative path from baseDir as file identifier
      const relPath = path.relative(baseDir, fullPath);
      const file = relPath.replace(/\.toml$/, "");

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
        cost: toml.cost
          ? {
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
  return [...providers.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function getProvider(dir: string): ProviderDefinition | undefined {
  return providers.get(dir);
}

export function getModels(dir: string): ModelDefinition[] {
  return models.get(dir) ?? [];
}

export function getLogoPath(dir: string): string | undefined {
  return logoPaths.get(dir);
}
