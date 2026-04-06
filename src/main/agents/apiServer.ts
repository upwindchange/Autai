import express, { type Express } from "express";
import cors from "cors";
import { type Server } from "http";
import { ChatWorker } from "@agents/workers";
import { BrowserWorker } from "@agents/workers/browserWorker/worker";
import {
  SessionTabService,
  threadPersistenceService,
  settingsService,
} from "@/services";
import { sendAlert } from "@/utils";
import {
  pipeUIMessageStreamToResponse,
  type UIMessage,
  ToolSet,
} from "ai";
import log from "electron-log/main";
import type { SettingsState, TestConnectionConfig, LogLevel } from "@shared";

export class ApiServer {
  private app: Express;
  private server: Server | null = null;
  private port: number = 3001;
  private logger = log.scope("ApiServer");
  private chatWorker: ChatWorker;

  constructor() {
    this.app = express();
    this.chatWorker = new ChatWorker();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Enable CORS for all origins
    this.app.use(cors());

    // Parse JSON bodies
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Add request logging middleware for debugging
    this.app.use((req, _res, next) => {
      this.logger.debug(`${req.method} ${req.url}`);
      next();
    });

    // Chat endpoint
    this.app.post(
      "/chat",
      async (
        req: express.Request<
          Record<string, never>,
          Record<string, unknown>,
          {
            id: string;
            messages: UIMessage[];
            system?: string;
            tools?: ToolSet[];
          }
        >,
        response,
      ) => {
        try {
          const { messages, system, tools } = req.body;

          // Read metadata from headers instead of body
          const useBrowser = req.headers["x-use-browser"] === "true";
          const webSearch = req.headers["x-web-search"] === "true";

          // Get sessionId from headers, fallback to SessionTabService
          const sessionTabService = SessionTabService.getInstance();
          const sessionId =
            (req.headers["x-session-id"] as string | undefined) ??
            sessionTabService.activeSessionId;

          this.logger.info("Chat request received", {
            messagesCount: messages?.length,
            hasSystem: !!system,
            hasTools: !!tools,
            useBrowser,
            webSearch,
            sessionId,
          });

          // Ensure we have a session ID
          if (!sessionId) {
            this.logger.error(
              "No session ID available from headers or SessionTabService",
            );
            sendAlert(
              "Chat Error",
              "No session ID found. Please start a new chat session.",
            );
            return;
          }

          // Stream the response using pipeUIMessageStreamToResponse method
          this.logger.debug("Starting stream response...");
          try {
            this.logger.info(messages);
            // Route to appropriate worker based on metadata
            this.logger.debug("making worker decision", {
              messagesCount: messages?.length,
              firstMessageRole: (messages?.[0] as { role?: string })?.role,
              useBrowser,
              webSearch,
            });

            if (useBrowser || webSearch) {
              this.logger.info(
                "browser mode enabled, using browser-use worker",
                {
                  useBrowser,
                  webSearch,
                },
              );
              const stream = await BrowserWorker(
                messages,
                sessionId,
                useBrowser,
                webSearch,
                (finalMessages) => {
                  threadPersistenceService.saveMessages(
                    sessionId,
                    finalMessages,
                  );
                },
              );
              pipeUIMessageStreamToResponse({ response, stream });
            } else {
              this.logger.info("using chat worker");
              const result = await this.chatWorker.handleChat(
                messages,
                sessionId,
                system,
                tools,
              );
              result.pipeUIMessageStreamToResponse(response, {
                originalMessages: messages,
                generateMessageId: () => crypto.randomUUID(),
                onFinish: ({ messages: finalMessages }) => {
                  threadPersistenceService.saveMessages(
                    sessionId,
                    finalMessages,
                  );
                },
              });
            }

            // Pipe the stream result to the Express response
          } catch (error) {
            this.logger.error("Error handling chat:", error);
            if (!response.headersSent) {
              if (
                error instanceof Error &&
                error.message === "API key not configured"
              ) {
                response.status(400).json({ error: "API key not configured" });
              } else {
                response.status(500).json({ error: "Internal server error" });
              }
            }
          }
        } catch (error) {
          this.logger.error("Outer error in chat handler:", {
            error,
            stack: error instanceof Error ? error.stack : "No stack",
          });
        }
      },
    );

    // Thread management endpoints
    this.app.get("/threads", (_req, res) => {
      try {
        const threads = threadPersistenceService.listThreads();
        res.json({
          threads: threads.map((t) => ({
            remoteId: t.id,
            status: t.status,
            title: t.title,
          })),
        });
      } catch (error) {
        this.logger.error("Error listing threads:", error);
        res.status(500).json({ error: "Failed to list threads" });
      }
    });

    this.app.post("/threads", (req, res) => {
      try {
        const { id } = req.body as { id: string };
        if (!id) {
          res.status(400).json({ error: "Thread id is required" });
          return;
        }
        const thread = threadPersistenceService.createThread(id);
        res.status(201).json({
          remoteId: thread.id,
          externalId: undefined,
        });
      } catch (error) {
        this.logger.error("Error creating thread:", error);
        res.status(500).json({ error: "Failed to create thread" });
      }
    });

    this.app.get("/threads/:id", (req, res) => {
      try {
        const thread = threadPersistenceService.getThread(req.params.id);
        if (!thread) {
          res.status(404).json({ error: "Thread not found" });
          return;
        }
        res.json({
          remoteId: thread.id,
          status: thread.status,
          title: thread.title,
        });
      } catch (error) {
        this.logger.error("Error fetching thread:", error);
        res.status(500).json({ error: "Failed to fetch thread" });
      }
    });

    this.app.patch("/threads/:id", (req, res) => {
      try {
        const { title, status } = req.body as {
          title?: string;
          status?: string;
        };
        if (title !== undefined) {
          threadPersistenceService.renameThread(req.params.id, title);
        }
        if (status === "archived") {
          threadPersistenceService.archiveThread(req.params.id);
        }
        if (status === "regular") {
          threadPersistenceService.unarchiveThread(req.params.id);
        }
        res.json({ success: true });
      } catch (error) {
        this.logger.error("Error updating thread:", error);
        res.status(500).json({ error: "Failed to update thread" });
      }
    });

    this.app.delete("/threads/:id", (req, res) => {
      try {
        threadPersistenceService.deleteThread(req.params.id);
        res.json({ success: true });
      } catch (error) {
        this.logger.error("Error deleting thread:", error);
        res.status(500).json({ error: "Failed to delete thread" });
      }
    });

    this.app.get("/threads/:id/messages", (req, res) => {
      try {
        const messages = threadPersistenceService.loadMessages(req.params.id);
        res.json({ messages });
      } catch (error) {
        this.logger.error("Error loading messages:", error);
        res.status(500).json({ error: "Failed to load messages" });
      }
    });

    // Settings endpoints
    this.setupSettingsRoutes();

    // Health check endpoint
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", port: this.port });
    });
  }

  private setupSettingsRoutes(): void {
    // Get settings
    this.app.get("/settings", (_req, res) => {
      try {
        res.json(settingsService.settings);
      } catch (error) {
        this.logger.error("Error loading settings:", error);
        res.status(500).json({ error: "Failed to load settings" });
      }
    });

    // Save settings
    this.app.put("/settings", (req, res) => {
      try {
        const settings = req.body as SettingsState;
        settingsService.saveSettings(settings);

        // Apply log level if changed
        if (settings.logLevel) {
          log.transports.file.level = settings.logLevel as LogLevel;
          log.transports.console.level = settings.logLevel as LogLevel;
          log.transports.ipc.level = settings.logLevel as LogLevel;
        }

        res.json({ success: true });
      } catch (error) {
        this.logger.error("Error saving settings:", error);
        res.status(500).json({ error: "Failed to save settings" });
      }
    });

    // Check if configured
    this.app.get("/settings/configured", (_req, res) => {
      try {
        res.json({ configured: settingsService.isConfigured() });
      } catch (error) {
        this.logger.error("Error checking configuration:", error);
        res.status(500).json({ error: "Failed to check configuration" });
      }
    });

    // Test connection
    this.app.post("/settings/test", async (req, res) => {
      try {
        const config = req.body as TestConnectionConfig;
        await settingsService.testConnection(config);
        res.json({ success: true });
      } catch (error) {
        this.logger.error("Error testing connection:", error);
        res.status(500).json({ error: "Failed to test connection" });
      }
    });

    // Get log file path
    this.app.get("/settings/log-path", (_req, res) => {
      try {
        const file = log.transports.file.getFile();
        res.json({ path: file?.path || "" });
      } catch (error) {
        this.logger.error("Error getting log path:", error);
        res.status(500).json({ error: "Failed to get log path" });
      }
    });

    // Clear logs
    this.app.post("/settings/clear-logs", (_req, res) => {
      try {
        const file = log.transports.file.getFile();
        if (file) {
          file.clear();
          this.logger.info("Log file cleared");
        }
        res.json({ success: true });
      } catch (error) {
        this.logger.error("Error clearing logs:", error);
        res.status(500).json({ error: "Failed to clear logs" });
      }
    });

    // Open log folder
    this.app.post("/settings/open-log-folder", async (_req, res) => {
      try {
        const { shell } = await import("electron");
        const file = log.transports.file.getFile();
        if (file?.path) {
          const path = await import("path");
          const logDir = path.dirname(file.path);
          await shell.openPath(logDir);
        }
        res.json({ success: true });
      } catch (error) {
        this.logger.error("Error opening log folder:", error);
        res.status(500).json({ error: "Failed to open log folder" });
      }
    });

    // Open DevTools
    this.app.post("/settings/open-devtools", async (_req, res) => {
      try {
        const { BrowserWindow } = await import("electron");
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
          win.webContents.openDevTools();
        }
        res.json({ success: true });
      } catch (error) {
        this.logger.error("Error opening DevTools:", error);
        res.status(500).json({ error: "Failed to open DevTools" });
      }
    });
  }

  start(): void {
    this.server = this.app.listen(this.port, () => {
      this.logger.info(`API server running on http://localhost:${this.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      try {
        this.logger.info("Closing API server...");
        this.server.close((err) => {
          if (err) {
            this.logger.error("Error closing API server:", err);
          } else {
            this.logger.info("API server closed successfully");
          }
        });

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
        this.server = null; // Ensure we clear the reference even if there's an error
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
