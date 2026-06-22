import { Hono } from "hono";
import { createUIMessageStreamResponse } from "ai";
import { chatModel } from "@agents/providers";
import { EntertainmentWorker } from "@agents/workers/entertainmentWorker/worker";
import {
  SessionTabService,
  threadPersistenceService,
  threadIntelligenceService,
} from "@/services";
import { sendAlert } from "@/utils";
import { ChatRequestSchema } from "../schemas/apiSchemas";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Entertainment");

export const entertainmentRoutes = new Hono();

/**
 * Entertainment endpoint — mirrors chatRoutes but always routes through the
 * EntertainmentWorker (no plain-chat fallback). The worker picks the
 * placeholder sub-agent (dehydrate | interactive) based on the
 * x-entertainment-mode header.
 */
entertainmentRoutes.post("/", async (c) => {
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

    // Entertainment sub-mode: 网文脱水 (dehydrate) | 网文交互 (interactive).
    // Frontend toggle wiring is deferred, so default to "dehydrate".
    const mode: "dehydrate" | "interactive" =
      c.req.header("x-entertainment-mode") === "interactive"
        ? "interactive"
        : "dehydrate";

    const sessionTabService = SessionTabService.getInstance();
    const sessionId =
      c.req.header("x-session-id") ?? sessionTabService.activeSessionId;

    // Per-thread chat model selection, threaded live from the UI. Absent ⇒
    // the global "chat" assignment is used (chatModel falls back internally).
    const chatProviderId = c.req.header("x-chat-provider-id");
    const chatModelId = c.req.header("x-chat-model-id");
    const chatSelection =
      chatProviderId && chatModelId
        ? { providerId: chatProviderId, modelId: chatModelId }
        : undefined;
    const chatLanguageModel = chatModel(chatSelection);

    logger.info("Entertainment request received", {
      messagesCount: messages?.length,
      hasSystem: !!system,
      hasTools: !!tools,
      mode,
      sessionId,
    });

    if (!sessionId) {
      logger.error("No session ID available from headers or SessionTabService");
      sendAlert(
        "Entertainment Error",
        "No session ID found. Please start a new entertainment thread.",
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

    const stream = await EntertainmentWorker(
      messages,
      sessionId,
      mode,
      chatLanguageModel,
      (finalMessages) => {
        threadPersistenceService.saveMessages(
          sessionId,
          finalMessages,
          chatSelection,
        );
        threadIntelligenceService
          .generateSuggestions(sessionId, finalMessages)
          .catch((err) => {
            logger.warn("Suggestion generation failed:", err);
          });
      },
      abortController.signal,
    );
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    logger.error("Error handling entertainment:", error);
    if (error instanceof Error && error.message === "API key not configured") {
      return c.json({ error: "API key not configured" }, 400);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});
