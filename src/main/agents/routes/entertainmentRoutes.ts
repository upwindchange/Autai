import { Hono } from "hono";
import { createUIMessageStreamResponse } from "ai";
import { chatModel } from "@agents/providers";
import { EntertainmentWorker } from "@agents/workers/entertainmentWorker/worker";
import {
  SessionTabService,
  threadPersistenceService,
  threadIntelligenceService,
} from "@/services";
import { i18n } from "@/i18n";
import { sendAlert } from "@/utils";
import { eventBus } from "@/utils/eventBus";
import { ChatRequestSchema } from "../schemas/apiSchemas";
import {
  EntertainmentConfigSchema,
  type EntertainmentConfig,
} from "@shared";
import { entertainmentChapterRoutes } from "./entertainmentChapterRoutes";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Entertainment");

export const entertainmentRoutes = new Hono();

// Dehydrate now flows through the DB-backed chapter routes below (REST + the
// entertainment:chapterReady event); this POST "/" UIMessage path remains for
// the interactive placeholder / future use. Nested here so both share the
// /entertainment prefix (/entertainment/threads/:tid/chapters).
entertainmentRoutes.route("/", entertainmentChapterRoutes);

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

    // First message: set a deterministic title + tag straight from the wizard
    // config. Entertainment threads never go through the LLM enricher — the
    // title and tag are fully known here (《story》 — 重写|互动), so set them
    // directly and notify the renderer to refresh its metadata.
    // (Dehydrate no longer reaches this route — it POSTs to the chapter endpoint
    // and its title/tag side-effects run in entertainmentService. This block now
    // only fires for the interactive path, but stays union-aware for safety.)
    if (messages?.length === 1 && messages[0].role === "user") {
      const novel = parsedConfig.novel;
      const modeLabel = i18n.t(`entertainment.${parsedConfig.mode}`);
      const novelLabel =
        novel.type === "internet" ? novel.title : novel.filename;
      const isZh = (i18n.language ?? "en").startsWith("zh");
      const title = isZh ?
        `《${novelLabel}》 — ${modeLabel}`
      : `${novelLabel} — ${modeLabel}`;
      threadPersistenceService.renameThread(sessionId, title);

      // Attach the matching entertainment tag. Seeded at startup; the
      // create-if-missing covers a language switch where the seeded tag name
      // uses a different locale than the current one.
      let tag = threadPersistenceService
        .listTagsByMode("entertainment")
        .find((t) => t.name === modeLabel);
      if (!tag) {
        tag = threadPersistenceService.createTag(
          modeLabel,
          parsedConfig.mode === "dehydrate" ? "#F28E2B" : "#E15759",
          0,
          "entertainment",
        );
      }
      threadPersistenceService.addTagToThread(sessionId, tag.id);

      logger.info("Set deterministic entertainment title + tag", {
        sessionId,
        title,
        tag: tag.name,
      });
      eventBus.emitEvent("threads:metadataUpdated", {
        threadId: sessionId,
        title,
        tags: [{ ...tag, color: tag.color ?? "" }],
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
