/**
 * MCP Service — manages MCP server configurations and client lifecycle.
 *
 * Two responsibilities:
 * 1. CRUD for MCP server configs in SQLite (mcp_servers table)
 * 2. MCP client lifecycle — connecting, discovering tools, and disconnecting
 *
 * Transport: HTTP and SSE only (no stdio — incompatible with sandboxed
 * distribution targets like Mac App Store, Snap, Flatpak).
 */

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { Tool } from "ai";
import { getDb } from "@/db";
import { mcpServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log/main";
import type { McpServerConfig, McpTransportType } from "@shared";
import type { McpServerRow } from "@/db/types";

// --- Result types ---

export interface McpToolsResult {
  tools: Record<string, Tool>; // merged AI SDK tool set
  clients: MCPClient[]; // for cleanup by caller
}

export interface McpTestResult {
  success: boolean;
  error?: string;
  toolCount?: number;
  toolNames?: string[];
}

class McpService {
  private logger = log.scope("McpService");

  // --- Config CRUD ---

  listServers(): McpServerRow[] {
    const db = getDb();
    return db.select().from(mcpServers).orderBy(mcpServers.name).all();
  }

  getServer(id: string): McpServerRow | undefined {
    const db = getDb();
    return db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
  }

  addServer(config: McpServerConfig): McpServerRow {
    const id = crypto.randomUUID();
    const db = getDb();
    db.insert(mcpServers)
      .values({
        id,
        name: config.name,
        description: config.description ?? null,
        transportType: config.transportType,
        connectionConfig: JSON.stringify(config.connectionConfig),
        enabled: config.enabled ? "true" : "false",
      })
      .run();
    this.logger.info("Added MCP server", { id, name: config.name });
    return this.getServer(id)!;
  }

  updateServer(id: string, config: Partial<McpServerConfig>): McpServerRow {
    const db = getDb();
    const values: Partial<McpServerRow> = {
      updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    };
    if (config.name !== undefined) values.name = config.name;
    if (config.description !== undefined)
      values.description = config.description;
    if (config.transportType !== undefined)
      values.transportType = config.transportType;
    if (config.connectionConfig !== undefined)
      values.connectionConfig = JSON.stringify(config.connectionConfig);
    if (config.enabled !== undefined)
      values.enabled = config.enabled ? "true" : "false";

    db.update(mcpServers).set(values).where(eq(mcpServers.id, id)).run();
    this.logger.info("Updated MCP server", { id });
    return this.getServer(id)!;
  }

  deleteServer(id: string): void {
    const db = getDb();
    db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
    this.logger.info("Deleted MCP server", { id });
  }

  toggleServer(id: string, enabled: boolean): McpServerRow {
    return this.updateServer(id, { enabled });
  }

  // --- Client lifecycle and tool discovery ---

  async connectAndDiscoverTools(serverIds: string[]): Promise<McpToolsResult> {
    const allTools: Record<string, Tool> = {};
    const clients: MCPClient[] = [];

    for (const id of serverIds) {
      const server = this.getServer(id);
      if (!server || server.enabled !== "true") continue;

      try {
        const client = await this.createClient(server);
        const tools = await client.tools();
        const toolNames = Object.keys(tools);

        // Check for collisions with existing tools
        for (const name of toolNames) {
          if (name in allTools) {
            this.logger.warn(
              `Tool name collision: "${name}" from server "${server.name}" overwrites existing tool`,
            );
          }
        }

        Object.assign(allTools, tools);
        clients.push(client);
        this.logger.info(
          `Connected to MCP server "${server.name}", loaded ${toolNames.length} tools`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to connect to MCP server "${server.name}":`,
          error,
        );
        // Continue with other servers — best-effort loading
      }
    }

    return { tools: allTools, clients };
  }

  async testConnection(serverId: string): Promise<McpTestResult> {
    const server = this.getServer(serverId);
    if (!server) return { success: false, error: "Server not found" };

    let client: MCPClient | undefined;
    try {
      client = await this.createClient(server);
      const tools = await client.tools();
      const toolNames = Object.keys(tools);
      this.logger.info(
        `Test connection to "${server.name}" succeeded, found ${toolNames.length} tools`,
      );
      return { success: true, toolCount: toolNames.length, toolNames };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Test connection to "${server.name}" failed:`, error);
      return { success: false, error: message };
    } finally {
      await client?.close().catch(() => {});
    }
  }

  // --- Private helpers ---

  private async createClient(server: McpServerRow): Promise<MCPClient> {
    const config = JSON.parse(server.connectionConfig) as {
      url?: string;
      headers?: Record<string, string>;
    };
    const transportType = server.transportType as McpTransportType;

    switch (transportType) {
      case "http":
        return createMCPClient({
          transport: {
            type: "http",
            url: config.url!,
            headers: config.headers,
          },
        });
      case "sse":
        return createMCPClient({
          transport: {
            type: "sse",
            url: config.url!,
            headers: config.headers,
          },
        });
      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }
}

export const mcpService = new McpService();
