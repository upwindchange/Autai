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
import {
  EntertainmentConfigSchema,
  type EntertainmentConfig,
} from "@shared";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Entertainment");

export const entertainmentRoutes = new Hono();

/**
 * Entertainment endpoint — mirrors chatRoutes but always routes through the
 * EntertainmentWorker (no plain-chat fallback). The wizard serializes the full
 * configuration (mode + novel + options) as a JSON text part in the last user
 * message; we parse + Zod-validate it here and forward the typed config to the
 * worker, which routes on `mode` (dehydrate | interactive).
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

    // The wizard serializes the full EntertainmentConfig as a JSON text part in
    // the LAST user message. Parse + Zod-validate it here; the worker router
    // consumes the typed object downstream.
    const lastUser = [...(messages ?? [])]
      .reverse()
      .find((m) => m.role === "user");
    const configText = lastUser?.parts?.find((p) => p.type === "text")?.text;
    let parsedConfig: EntertainmentConfig | null = null;
    if (typeof configText === "string") {
      try {
        const result = EntertainmentConfigSchema.safeParse(
          JSON.parse(configText),
        );
        if (result.success) parsedConfig = result.data;
      } catch {
        // leave null — handled below
      }
    }
    if (!parsedConfig) {
      logger.warn("Invalid entertainment config in last user message", {
        configTextPreview:
          typeof configText === "string" ? configText.slice(0, 160) : undefined,
      });
      return c.json(
        {
          error:
            "Invalid entertainment config (expected JSON in the last user message text part)",
        },
        400,
      );
    }

    // Log the FULL parsed config so the wizard → route → worker path is
    // verifiable from the main-process logs.
    logger.info("parsed entertainment config", { config: parsedConfig });

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
      mode: parsedConfig.mode,
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

    // Detect first message and trigger thread enrichment immediately (fire-and-forget).
    // Feed a human-readable summary (NOT the raw JSON config blob) so the title
    // generator produces something sensible instead of stringified JSON.
    if (messages?.length === 1 && messages[0].role === "user") {
      const novel = parsedConfig.novel;
      const novelLabel =
        novel.type === "internet" ? `《${novel.title}》` : novel.filename;
      const enrichText = `${novelLabel} — ${parsedConfig.mode}`;
      logger.info("Triggering thread enrichment", { sessionId, enrichText });
      threadIntelligenceService
        .enrichThread(sessionId, enrichText)
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
      parsedConfig,
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
