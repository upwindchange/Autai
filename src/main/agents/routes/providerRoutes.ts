/**
 * Provider catalog routes — serves TOML-driven provider definitions, logos, and model lists.
 */

import fs from "node:fs";
import { Hono } from "hono";
import * as registry from "@agents/providers/registry";

export const providerRoutes = new Hono();

// GET /providers — all provider definitions
providerRoutes.get("/", (c) => {
  return c.json(registry.getAllProviders());
});

// GET /providers/:dir/logo — serve logo SVG
providerRoutes.get("/:dir/logo", (c) => {
  const dir = c.req.param("dir");
  const logoPath = registry.getLogoPath(dir);
  if (!logoPath || !fs.existsSync(logoPath)) {
    return c.json({ error: "Provider logo not found" }, 404);
  }
  const svg = fs.readFileSync(logoPath, "utf-8");
  return c.body(svg, 200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "public, max-age=86400",
  });
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
