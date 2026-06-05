/**
 * MCP server management routes — CRUD for MCP server configurations,
 * connection testing, and tool discovery.
 */

import { Hono } from "hono";
import { mcpService } from "@/services/mcpService";
import { McpServerConfigSchema } from "@shared";
import log from "electron-log/main";

const logger = log.scope("ApiServer:MCP");
export const mcpRoutes = new Hono();

// GET /mcp/servers — list all configured MCP servers
mcpRoutes.get("/servers", (c) => {
  try {
    const servers = mcpService.listServers();
    return c.json(servers);
  } catch (error) {
    logger.error("Error listing MCP servers:", error);
    return c.json({ error: "Failed to list MCP servers" }, 500);
  }
});

// POST /mcp/servers — add a new MCP server
mcpRoutes.post("/servers", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = McpServerConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid server config", details: parsed.error.issues },
        400,
      );
    }
    const server = mcpService.addServer(parsed.data);
    return c.json(server, 201);
  } catch (error) {
    logger.error("Error adding MCP server:", error);
    return c.json({ error: "Failed to add MCP server" }, 500);
  }
});

// PUT /mcp/servers/:id — update an MCP server
mcpRoutes.put("/servers/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = McpServerConfigSchema.partial().safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid server config", details: parsed.error.issues },
        400,
      );
    }
    const existing = mcpService.getServer(id);
    if (!existing) {
      return c.json({ error: "Server not found" }, 404);
    }
    const server = mcpService.updateServer(id, parsed.data);
    return c.json(server);
  } catch (error) {
    logger.error("Error updating MCP server:", error);
    return c.json({ error: "Failed to update MCP server" }, 500);
  }
});

// DELETE /mcp/servers/:id — delete an MCP server
mcpRoutes.delete("/servers/:id", (c) => {
  try {
    const id = c.req.param("id");
    const existing = mcpService.getServer(id);
    if (!existing) {
      return c.json({ error: "Server not found" }, 404);
    }
    mcpService.deleteServer(id);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error deleting MCP server:", error);
    return c.json({ error: "Failed to delete MCP server" }, 500);
  }
});

// POST /mcp/servers/:id/toggle — toggle enabled/disabled
mcpRoutes.post("/servers/:id/toggle", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const enabled = Boolean(body.enabled);
    const existing = mcpService.getServer(id);
    if (!existing) {
      return c.json({ error: "Server not found" }, 404);
    }
    const server = mcpService.toggleServer(id, enabled);
    return c.json(server);
  } catch (error) {
    logger.error("Error toggling MCP server:", error);
    return c.json({ error: "Failed to toggle MCP server" }, 500);
  }
});

// POST /mcp/servers/:id/test — test connection and list discovered tools
mcpRoutes.post("/servers/:id/test", async (c) => {
  try {
    const id = c.req.param("id");
    const existing = mcpService.getServer(id);
    if (!existing) {
      return c.json({ error: "Server not found" }, 404);
    }
    const result = await mcpService.testConnection(id);
    return c.json(result);
  } catch (error) {
    logger.error("Error testing MCP server connection:", error);
    return c.json({ error: "Failed to test connection" }, 500);
  }
});
