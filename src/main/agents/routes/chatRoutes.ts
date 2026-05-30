import { Hono } from "hono";
import { createUIMessageStreamResponse, type ToolSet } from "ai";
import { ChatWorker } from "@agents/workers";
import { BrowserWorker } from "@agents/workers/browserWorker/worker";
import {
  SessionTabService,
  threadPersistenceService,
  threadIntelligenceService,
} from "@/services";
import { sendAlert } from "@/utils";
import { ChatRequestSchema } from "../schemas/apiSchemas";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Chat");
const chatWorker = new ChatWorker();

export const chatRoutes = new Hono();

chatRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }

    const { messages, system, tools } = parsed.data;

    // Read metadata from headers
    const useBrowser = c.req.header("x-use-browser") === "true";
    const usePlannedBrowser = c.req.header("x-use-planned-browser") === "true";
    const webSearch = c.req.header("x-web-search") === "true";
    const deepResearch = c.req.header("x-deep-research") === "true";
    const quickSearch = c.req.header("x-quick-search") === "true";

    const sessionTabService = SessionTabService.getInstance();
    const sessionId =
      c.req.header("x-session-id") ?? sessionTabService.activeSessionId;

    logger.info("Chat request received", {
      messagesCount: messages?.length,
      hasSystem: !!system,
      hasTools: !!tools,
      useBrowser,
      webSearch,
      sessionId,
    });

    if (!sessionId) {
      logger.error("No session ID available from headers or SessionTabService");
      sendAlert(
        "Chat Error",
        "No session ID found. Please start a new chat session.",
      );
      return c.json({ error: "No session ID" }, 400);
    }

    // Detect first message and trigger thread enrichment immediately (fire-and-forget)
    if (messages?.length === 1 && messages[0].role === "user") {
      const rawMessage = JSON.stringify(messages[0]);
      logger.info("Triggering thread enrichment", { sessionId, rawMessage });
      threadIntelligenceService
        .enrichThread(sessionId, rawMessage)
        .catch((err) => {
          logger.warn("Thread enrichment failed:", err);
        });
    }

    if (useBrowser || webSearch || deepResearch || quickSearch) {
      logger.info("browser mode enabled, using browser-use worker", {
        useBrowser,
        webSearch,
        deepResearch,
        quickSearch,
      });

      // Create derived AbortController from the HTTP request signal
      const abortController = new AbortController();
      c.req.raw.signal.addEventListener(
        "abort",
        () => {
          if (!abortController.signal.aborted) {
            abortController.abort(
              c.req.raw.signal.reason ?? "Client disconnected",
            );
          }
        },
        { once: true },
      );

      const stream = await BrowserWorker(
        messages,
        sessionId,
        useBrowser,
        usePlannedBrowser,
        webSearch,
        deepResearch,
        quickSearch,
        (finalMessages) => {
          threadPersistenceService.saveMessages(sessionId, finalMessages);
        },
        abortController.signal,
      );
      return createUIMessageStreamResponse({ stream });
    } else {
      logger.info("using chat worker");

      // Create derived AbortController from the HTTP request signal
      const abortController = new AbortController();
      c.req.raw.signal.addEventListener(
        "abort",
        () => {
          if (!abortController.signal.aborted) {
            abortController.abort(
              c.req.raw.signal.reason ?? "Client disconnected",
            );
          }
        },
        { once: true },
      );

      const result = await chatWorker.handleChat(
        messages,
        sessionId,
        system,
        tools as ToolSet[] | undefined,
        abortController.signal,
      );
      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        generateMessageId: () => crypto.randomUUID(),
        onFinish: ({ messages: finalMessages }) => {
          logger.info("Chat onFinish fired", {
            sessionId,
            messageCount: finalMessages.length,
          });
          threadPersistenceService.saveMessages(sessionId, finalMessages);
        },
      });
    }
  } catch (error) {
    logger.error("Error handling chat:", error);
    if (error instanceof Error && error.message === "API key not configured") {
      return c.json({ error: "API key not configured" }, 400);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});
