import { Hono } from "hono";
import { createUIMessageStreamResponse, type ToolSet } from "ai";
import { chatModel } from "@agents/providers";
import { ChatWorker } from "@agents/workers";
import { BrowserWorker } from "@agents/workers/browserWorker/worker";
import {
  threadPersistenceService,
  threadIntelligenceService,
  settingsService,
} from "@/services";
import { sendAlert } from "@/utils";
import { resolveChatOverride } from "@agents/utils/threadChatOverride";
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

    const { messages, tools } = parsed.data;

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

    const sessionId = c.req.header("x-session-id");

    if (!sessionId) {
      logger.error("No session ID in X-Session-Id header");
      sendAlert(
        "Chat Error",
        "No session ID found. Please start a new chat session.",
      );
      return c.json({ error: "No session ID" }, 400);
    }

    // Resolve the per-thread chat override from the DB (single source of truth
    // — the renderer persists it immediately via PATCH /threads/:id on every
    // picker/settings change, so reading it here replaces the old client-
    // injected X-Chat-* headers and system/modelParams body fields). Provider/
    // model are validated against the live registry and purged if stale.
    const override = resolveChatOverride(sessionId);
    const chatSelection =
      override.providerId && override.modelId ?
        { providerId: override.providerId, modelId: override.modelId }
      : undefined;
    const chatResolved = chatModel(chatSelection);
    const chatLanguageModel = chatResolved.model;
    const chatNpm = chatResolved.npm;

    // Effective model settings: thread override wins, else system default.
    const sysDefault = settingsService.settings;
    const effectiveSystem =
      override.systemPrompt ?? (sysDefault.systemPrompt || undefined);
    const effectiveParams = override.params ?? sysDefault.defaultModelParams;

    logger.info("Chat request received", {
      messagesCount: messages?.length,
      hasTools: !!tools,
      useBrowser,
      webSearch,
      mcpServerIds: mcpServerIds.length,
      sessionId,
      chatModel: chatSelection,
      systemPromptSource:
        override.systemPrompt ? "thread"
        : sysDefault.systemPrompt ? "system-default"
        : "none",
      systemPromptLength: effectiveSystem?.length ?? 0,
      modelParamsSource:
        override.params ? "thread"
        : sysDefault.defaultModelParams ? "system-default"
        : "none",
      effectiveParams,
    });

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
          threadPersistenceService.saveMessages(sessionId, finalMessages);
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
        chatNpm,
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
          threadPersistenceService.saveMessages(sessionId, finalMessages);
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
