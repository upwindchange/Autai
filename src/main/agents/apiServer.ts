import express, { type Express } from "express";
import cors from "cors";
import { type Server } from "http";
import { agentHandler } from "@agents";
import log from "electron-log/main";
import type { ChatRequest } from "@shared";
import { ThreadViewService } from "@/services/ThreadViewService";
import { sendAlert } from "@/utils";

export class ApiServer {
	private app: Express;
	private server: Server | null = null;
	private port: number = 3001;
	private logger = log.scope("ApiServer");

	constructor() {
		this.app = express();
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
					ChatRequest & { id: string }
				>,
				res,
			) => {
				try {
					const { messages, system, tools } = req.body;

					this.logger.info("Chat request received", {
						messagesCount: messages?.length,
						hasSystem: !!system,
						hasTools: !!tools,
					});

					// Get current active thread ID from ThreadViewService
					const threadViewService = ThreadViewService.getInstance();
					const activeThreadId = threadViewService.activeThreadId;

					this.logger.debug("Thread context", {
						activeThreadId,
						hasActiveThread: !!activeThreadId,
					});

					// Ensure we have an active thread ID - this should always exist when a chat starts
					if (!activeThreadId) {
						this.logger.error(
							"No active thread found when chat request was made",
						);
						sendAlert(
							"Chat Error",
							"No active thread found. Please start a new chat session.",
						);
						return;
					}

					// Stream the response using pipeUIMessageStreamToResponse method
					this.logger.debug("Starting stream response...");
					try {
						const result = await agentHandler.handleChat({
							messages,
							system,
							tools,
							threadId: activeThreadId,
						});

						// Pipe the stream result to the Express response
						result.pipeUIMessageStreamToResponse(res);
					} catch (error) {
						this.logger.error("Error handling chat:", error);
						if (!res.headersSent) {
							if (
								error instanceof Error &&
								error.message === "API key not configured"
							) {
								res.status(400).json({ error: "API key not configured" });
							} else {
								res.status(500).json({ error: "Internal server error" });
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

		// Health check endpoint
		this.app.get("/health", (_req, res) => {
			res.json({ status: "ok", port: this.port });
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
