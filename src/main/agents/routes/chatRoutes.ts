import { Hono } from "hono";
import { createUIMessageStreamResponse, type ToolSet } from "ai";
import { chatModel } from "@agents/providers";
import { ChatWorker } from "@agents/workers";
import { BrowserWorker } from "@agents/workers/browserWorker/worker";
import {
  SessionTabService,
  threadPersistenceService,
  threadIntelligenceService,
  settingsService,
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

    const { messages, system, modelParams, tools } = parsed.data;

    // Read metadata from headers
    const useBrowser = c.req.header("x-use-browser") === "true";
    const usePlannedBrowser = c.req.header("x-use-planned-browser") === "true";
    const webSearch = c.req.header("x-web-search") === "true";
    const deepResearch = c.req.header("x-deep-research") === "true";
    const quickSearch = c.req.header("x-quick-search") === "true";

    // Read MCP server IDs from header
    const mcpServerIdsHeader = c.req.header("x-mcp-servers");
    const mcpServerIds =
      mcpServerIdsHeader ? mcpServerIdsHeader.split(",").filter(Boolean) : [];

    const sessionTabService = SessionTabService.getInstance();
    const sessionId =
      c.req.header("x-session-id") ?? sessionTabService.activeSessionId;

    // Per-thread chat model selection, threaded live from the UI. Absent ⇒
    // the global "chat" assignment is used (chatModel falls back internally).
    const chatProviderId = c.req.header("x-chat-provider-id");
    const chatModelId = c.req.header("x-chat-model-id");
    const chatSelection =
      chatProviderId && chatModelId ?
        { providerId: chatProviderId, modelId: chatModelId }
      : undefined;
    const chatLanguageModel = chatModel(chatSelection).model;

    // Resolve effective model settings: thread-level override wins, else fall
    // back to the system-level defaults (settingsService is the single source
    // of truth — keeps fallback logic out of the renderer). The raw thread
    // override (not the resolved fallback) is what gets persisted on finish.
    const sysDefault = settingsService.settings;
    const effectiveSystem = system ?? (sysDefault.systemPrompt || undefined);
    const effectiveParams = modelParams ?? sysDefault.defaultModelParams;

    logger.info("Chat request received", {
      messagesCount: messages?.length,
      hasSystem: !!system,
      hasTools: !!tools,
      useBrowser,
      webSearch,
      mcpServerIds: mcpServerIds.length,
      sessionId,
      // Effective settings after thread-override → system-default resolution.
      // Logs the *source* of each setting so "why did temperature apply?" is
      // diagnosable without re-deriving the fallback chain from the request.
      chatModel: chatSelection,
      systemPromptSource:
        system ? "thread"
        : sysDefault.systemPrompt ? "system-default"
        : "none",
      systemPromptLength: effectiveSystem?.length ?? 0,
      modelParamsSource:
        modelParams ? "thread"
        : sysDefault.defaultModelParams ? "system-default"
        : "none",
      effectiveParams,
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

      const { result, mcpClients } = await chatWorker.handleChat(
        messages,
        sessionId,
        chatLanguageModel,
        effectiveSystem,
        tools as ToolSet | undefined,
        abortController.signal,
        mcpServerIds,
        effectiveParams,
      );
      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        generateMessageId: () => crypto.randomUUID(),
        // Forward token usage into message metadata so the renderer's
        // ContextDisplay (useThreadTokenUsage) can show the input/output
        // breakdown and total-÷context-window ratio. Only the chat branch —
        // multi-agent modes stream via a raw ReadableStream with no single
        // result.totalUsage to forward.
        // Forward token usage into message metadata so the renderer's
        // ContextDisplay (useThreadTokenUsage) can show the input/output
        // breakdown and total÷context-window ratio. The usage is nested under
        // `custom.usage` because the assistant-ui message conversion preserves
        // the `custom` namespace (while stripping a top-level `usage` key);
        // useThreadTokenUsage reads metadata.custom.usage as its fallback path.
        // Only the chat branch — multi-agent modes stream via a raw
        // ReadableStream with no single result.totalUsage to forward.
        messageMetadata: ({ part }) => {
          if (part.type === "finish") {
            return { custom: { usage: part.totalUsage } };
          }
          return undefined;
        },
        onFinish: async ({ messages: finalMessages }) => {
          logger.info("Chat onFinish fired", {
            sessionId,
            messageCount: finalMessages.length,
          });
          // Persist the raw thread-level override (not the resolved fallback) —
          // system-default values belong to settings, not the thread row.
          // providerId/modelId are only written when the request carried an
          // explicit selection (matches the pre-existing pattern); params and
          // systemPrompt are written whenever the request carried them.
          const hasOverride =
            !!chatSelection ||
            system !== undefined ||
            modelParams !== undefined;
          logger.debug("Persisting thread chat override on chat finish", {
            sessionId,
            hasOverride,
            persistedSystemPrompt: system ?? null,
            persistedParams: modelParams ?? null,
          });
          threadPersistenceService.saveMessages(
            sessionId,
            finalMessages,
            hasOverride ?
              {
                providerId: chatSelection?.providerId ?? "",
                modelId: chatSelection?.modelId ?? "",
                ...(system !== undefined && { systemPrompt: system }),
                ...(modelParams !== undefined && { params: modelParams }),
              }
            : undefined,
          );
          threadIntelligenceService
            .generateSuggestions(sessionId, finalMessages)
            .catch((err) => {
              logger.warn("Suggestion generation failed:", err);
            });
          // Close MCP clients
          for (const client of mcpClients) {
            await client
              .close()
              .catch((e) => logger.warn("MCP client close error:", e));
          }
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
