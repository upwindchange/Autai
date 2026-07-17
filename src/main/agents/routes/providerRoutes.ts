/**
 * Provider catalog routes — serves TOML-driven provider definitions and model lists.
 * The virtual "openai-compatible" provider fetches its model list dynamically
 * from the user's saved API endpoint.
 */

import { Hono } from "hono";
import * as registry from "@agents/providers/registry";
import { settingsService } from "@/services/settingsService";

export const providerRoutes = new Hono();

// GET /providers — all provider definitions (includes inline logo SVGs)
providerRoutes.get("/", (c) => {
  return c.json(registry.getAllProviders());
});

// GET /providers/configured/models — flat list of all models across the user's
// CONFIGURED providers. Each entry carries the userProviders.id needed to
// persist a per-thread model override, plus the provider's logo for display.
// `limit` is the resolved context/output caps: TOML catalog `limit` if present,
// else the user-entered manual override (for no-TOML openai-compatible models).
// Registered before /:dir/models so Hono doesn't capture "configured" as a dir.
providerRoutes.get("/configured/models", async (c) => {
  const providers = settingsService.settings.providers;
  const result: {
    providerId: string;
    providerDir: string;
    providerName: string;
    logo?: string;
    modelId: string;
    modelName: string;
    limit?: { context: number; output?: number };
  }[] = [];

  for (const p of providers) {
    const def = registry.getProvider(p.providerDir);
    const models = await registry.getModelsForConfig({
      providerDir: p.providerDir,
      apiKey: p.apiKey,
      ...(p.apiUrlOverride && { apiUrlOverride: p.apiUrlOverride }),
    });
    for (const m of models) {
      if (!m.name) continue; // skip malformed/unnamed entries (defense in depth)
      // TOML limit wins; otherwise fall back to a manual override (openai-compat).
      // The override may carry only one of context/output, but the response type
      // requires both — synthesize the missing one as undefined-free by only
      // emitting `limit` when at least the context is known (the denominator the
      // UI actually needs); output is included when present.
      const override = settingsService.getModelOverride(p.id, m.file);
      const ctx = m.limit?.context ?? override?.contextWindow;
      const out = m.limit?.output ?? override?.maxOutputTokens;
      const limit =
        ctx !== undefined ?
          { context: ctx, ...(out && { output: out }) }
        : undefined;
      result.push({
        providerId: p.id,
        providerDir: p.providerDir,
        providerName: def?.name ?? p.providerDir,
        ...(def?.logo && { logo: def.logo }),
        modelId: m.file,
        modelName: m.name,
        ...(limit && { limit }),
      });
    }
  }

  return c.json({ models: result });
});

// GET /providers/:dir/models — models for a provider
providerRoutes.get("/:dir/models", async (c) => {
  const dir = c.req.param("dir");

  const definition = registry.getProvider(dir);
  if (!definition) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const saved = settingsService.settings.providers.find(
    (p) => p.providerDir === dir,
  );
  const models = await registry.getModelsForConfig({
    providerDir: dir,
    apiKey: saved?.apiKey ?? "",
    ...(saved?.apiUrlOverride && { apiUrlOverride: saved.apiUrlOverride }),
  });
  return c.json(models);
});
