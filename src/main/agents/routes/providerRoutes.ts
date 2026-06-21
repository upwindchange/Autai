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
      result.push({
        providerId: p.id,
        providerDir: p.providerDir,
        providerName: def?.name ?? p.providerDir,
        ...(def?.logo && { logo: def.logo }),
        modelId: m.file,
        modelName: m.name,
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
