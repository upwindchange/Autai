import express, { type Express } from "express";
import cors from "cors";
import { type Server } from "http";
import { ChatWorker, BrowserUseWorker } from "@agents/workers";
import { SessionTabService } from "@/services";
import { sendAlert } from "@/utils";
import { pipeUIMessageStreamToResponse, type UIMessage, ToolSet } from "ai";
import log from "electron-log/main";

export class ApiServer {
	private app: Express;
	private server: Server | null = null;
	private port: number = 3001;
	private logger = log.scope("ApiServer");
	private chatWorker: ChatWorker;
	private browserUseWorker: BrowserUseWorker;

	constructor() {
		this.app = express();
		this.chatWorker = new ChatWorker();
		this.browserUseWorker = new BrowserUseWorker();
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
							const stream = await this.browserUseWorker.handleChat(
								messages,
								sessionId,
								useBrowser,
								webSearch,
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
							result.pipeUIMessageStreamToResponse(response);
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
