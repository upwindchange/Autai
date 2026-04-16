/**
 * Provider catalog routes — serves TOML-driven provider definitions and model lists.
 */

import { Hono } from "hono";
import * as registry from "@agents/providers/registry";

export const providerRoutes = new Hono();

// GET /providers — all provider definitions (includes inline logo SVGs)
providerRoutes.get("/", (c) => {
  return c.json(registry.getAllProviders());
});

// GET /providers/:dir/models — models for a provider
providerRoutes.get("/:dir/models", (c) => {
  const dir = c.req.param("dir");
  const definition = registry.getProvider(dir);
  if (!definition) {
    return c.json({ error: "Provider not found" }, 404);
  }
  return c.json(registry.getModels(dir));
});
