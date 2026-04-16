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

// GET /providers/:dir/models — models for a provider
providerRoutes.get("/:dir/models", async (c) => {
  const dir = c.req.param("dir");

  const definition = registry.getProvider(dir);
  if (!definition) {
    return c.json({ error: "Provider not found" }, 404);
  }

  // Return static TOML models if available
  const tomlModels = registry.getModels(dir);
  if (tomlModels.length > 0) {
    return c.json(tomlModels);
  }

  // For openai-compatible with no TOML models, fetch dynamically from
  // the user's saved API endpoint (defaults to localhost Ollama)
  if (dir === "openai-compatible") {
    const saved = settingsService.settings.providers.find(
      (p) => p.providerDir === "openai-compatible",
    );
    const apiUrl =
      saved?.apiUrlOverride || definition.api || "http://localhost:11434/v1";

    try {
      const headers: Record<string, string> = {};
      if (saved?.apiKey) {
        headers["Authorization"] = `Bearer ${saved.apiKey}`;
      }
      const res = await fetch(`${apiUrl}/models`, { headers });
      const data = (await res.json()) as { data: { id: string }[] };
      return c.json(
        (data.data ?? []).map((m) => ({ name: m.id, file: m.id })),
      );
    } catch {
      return c.json([]);
    }
  }

  return c.json([]);
});
