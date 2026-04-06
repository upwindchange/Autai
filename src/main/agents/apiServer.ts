import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve, type ServerType } from "@hono/node-server";
import { chatRoutes } from "./routes/chatRoutes";
import { threadRoutes } from "./routes/threadRoutes";
import { settingsRoutes } from "./routes/settingsRoutes";
import log from "electron-log/main";

export class ApiServer {
  private app: Hono;
  private server: ServerType | null = null;
  private port: number = 3001;
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
  }

  private setupRoutes(): void {
    this.app.route("/chat", chatRoutes);
    this.app.route("/threads", threadRoutes);
    this.app.route("/settings", settingsRoutes);

    // Health check endpoint
    this.app.get("/health", (c) => {
      return c.json({ status: "ok", port: this.port });
    });
  }

  start(): void {
    this.server = serve({
      fetch: this.app.fetch,
      port: this.port,
    });
    this.logger.info(`API server running on http://localhost:${this.port}`);
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
