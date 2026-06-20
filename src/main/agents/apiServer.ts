import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { chatRoutes } from "./routes/chatRoutes";
import { threadRoutes } from "./routes/threadRoutes";
import { tagRoutes } from "./routes/tagRoutes";
import { settingsRoutes } from "./routes/settingsRoutes";
import { providerRoutes } from "./routes/providerRoutes";
import { mcpRoutes } from "./routes/mcpRoutes";
import { eventsRoutes } from "./routes/eventsRoutes";
import { appRoutes } from "./routes/appRoutes";
import { shellRoutes } from "./routes/shellRoutes";
import { dialogRoutes } from "./routes/dialogRoutes";
import { sessionRoutes } from "./routes/sessionRoutes";
import { hitlRoutes } from "./routes/hitlRoutes";
import { authRoutes } from "./routes/authRoutes";
import { authService, settingsService } from "@/services";
import {
  isLocalOwner,
  isPublicPath,
  getSessionToken,
} from "./utils/requestAuth";
import log from "electron-log/main";

export class ApiServer {
  private app: Hono;
  private server: ServerType | null = null;
  private port: number = 0;
  private logger = log.scope("ApiServer");

  constructor() {
    this.app = new Hono();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use("*", cors());

    this.app.use("*", async (c, next) => {
      this.logger.debug(`${c.req.method} ${c.req.url}`);
      await next();
    });

    // Remote-access auth gate. Active only when in remote mode AND a password
    // is configured. Public paths (SPA shell/assets, health, the login
    // handshake) always pass; the loopback owner (desktop) is exempt; otherwise
    // a valid session cookie or bearer token is required. Registered before the
    // API routes and the SPA catch-all so it gates both.
    this.app.use("*", async (c, next) => {
      const authActive =
        settingsService.settings.serverMode === "remote" &&
        authService.hasPassword();
      if (
        !authActive ||
        isPublicPath(c.req.method, c.req.path) ||
        isLocalOwner(c)
      ) {
        return next();
      }
      const token = getSessionToken(c);
      if (token && authService.validateSession(token)) {
        return next();
      }
      this.logger.debug(`401 unauthorized: ${c.req.method} ${c.req.path}`);
      return c.json({ error: "Unauthorized" }, 401);
    });
  }

  private setupRoutes(): void {
    this.app.route("/chat", chatRoutes);
    this.app.route("/threads", threadRoutes);
    this.app.route("/tags", tagRoutes);
    this.app.route("/settings", settingsRoutes);
    this.app.route("/providers", providerRoutes);
    this.app.route("/mcp", mcpRoutes);
    this.app.route("/events", eventsRoutes);
    this.app.route("/app", appRoutes);
    this.app.route("/shell", shellRoutes);
    this.app.route("/dialog", dialogRoutes);
    this.app.route("/sessions", sessionRoutes);
    this.app.route("/hitl", hitlRoutes);
    this.app.route("/auth", authRoutes);

    // Health check endpoint
    this.app.get("/health", (c) => {
      return c.json({ status: "ok", port: this.port });
    });
  }

  async start(opts: {
    host?: string;
    port?: number;
    staticRoot?: string;
  } = {}): Promise<number> {
    const host = opts.host ?? "127.0.0.1";
    const port = opts.port ?? 0;

    // Serve the built renderer SPA so remote browsers can use the app.
    // Registered after all API routes so /chat, /threads, /events, /health, etc.
    // take precedence; unmatched GETs fall back to index.html (client routing).
    if (opts.staticRoot) {
      this.serveSpa(opts.staticRoot);
    }

    return new Promise((resolve, reject) => {
      this.server = serve({
        fetch: this.app.fetch,
        port,
        hostname: host,
      });

      this.server.on("listening", () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
        }
        this.logger.info(`API server running on http://${host}:${this.port}`);
        resolve(this.port);
      });

      this.server.on("error", reject);
    });
  }

  private serveSpa(root: string): void {
    if (!fs.existsSync(root)) {
      this.logger.debug(`Static root not found, skipping SPA serving: ${root}`);
      return;
    }
    const indexPath = path.join(root, "index.html");
    this.app.use("/*", serveStatic({ root }));
    this.app.get("*", (c) => c.html(fs.readFileSync(indexPath, "utf-8")));
  }

  stop(): void {
    if (this.server) {
      try {
        this.logger.info("Closing API server...");
        this.server.close();

        // Force close after 1 second if it hasn't closed gracefully
        setTimeout(() => {
          if (this.server) {
            this.server.close(() => {});
            this.server = null;
            this.logger.warn("API server force closed");
          }
        }, 1000);
      } catch (error) {
        this.logger.error("Error stopping API server:", error);
        this.server = null;
      }
    } else {
      this.logger.debug("API server already stopped or not initialized");
    }
  }

  getPort(): number {
    return this.port;
  }
}

export const apiServer = new ApiServer();
