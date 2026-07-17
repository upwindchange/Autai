import {
  convertToModelMessages,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
  streamText,
  type StreamTextResult,
  type Tool,
} from "ai";
import { repairToolCall, TIMEOUTS } from "@agents/utils";
import { settingsService } from "@/services";
import { mcpService } from "@/services/mcpService";
import type { MCPClient } from "@ai-sdk/mcp";
import type { ModelParameters } from "@shared";
import log from "electron-log/main";

const systemPrompt = `When your response can benefit from a visual diagram, output a mermaid code block using one of these chart types: Flowchart, Sequence Diagram, Class Diagram, State Diagram, Entity Relationship Diagram, User Journey, Gantt, Pie Chart, Quadrant Chart, Requirement Diagram, GitGraph, C4 Diagram, Mindmap, Timeline, ZenUML, Sankey, XY Chart, Block Diagram, Packet, Kanban, Architecture, Radar, Event Modeling, Treemap, Venn, Ishikawa, Wardley, TreeView

For inline math expressions, use double dollar signs like $$E = mc^2$$. Never use single dollar signs for math.`;

export interface ChatWorkerResult {
  result: StreamTextResult<any, any>;
  mcpClients: MCPClient[];
}

export class ChatWorker {
  private logger = log.scope("ChatWorker");

  async handleChat(
    messages: UIMessage[],
    sessionId: string,
    chatLanguageModel: LanguageModel,
    system?: string,
    tools?: ToolSet,
    signal?: AbortSignal,
    mcpServerIds?: string[],
    params?: ModelParameters,
  ): Promise<ChatWorkerResult> {
    this.logger.debug("request received", {
      messagesCount: messages?.length,
      hasSystem: !!system,
      sessionId: sessionId,
      hasTools: !!tools,
      toolCount:
        tools ? Object.keys(tools as Record<string, unknown>).length : 0,
      mcpServerIds: mcpServerIds?.length ?? 0,
      params,
    });

    let mcpClients: MCPClient[] = [];

    try {
      // Build merged tool set
      let mergedTools: Record<string, Tool> = {};

      // Load MCP tools if server IDs provided
      if (mcpServerIds && mcpServerIds.length > 0) {
        const mcpResult =
          await mcpService.connectAndDiscoverTools(mcpServerIds);
        mergedTools = { ...mergedTools, ...mcpResult.tools };
        mcpClients = mcpResult.clients;
        this.logger.info("Loaded MCP tools", {
          mcpToolCount: Object.keys(mcpResult.tools).length,
        });
      }

      // Merge with any passed-in tools
      if (tools) {
        mergedTools = { ...mergedTools, ...tools };
      }

      // Configure stop conditions based on available tools
      const stopConditions = [
        // Safety limit to prevent infinite loops
        stepCountIs(20),
      ];

      // User-provided system prompt comes FIRST (primary instruction), the
      // built-in mermaid/math prompt is appended after (additive capability).
      // Empty user prompt ⇒ system collapses to just the built-in prompt,
      // matching the previous behaviour with no regression.
      const mergedSystem =
        `${system ? system.trim() + "\n\n" : ""}${systemPrompt}`.trim();

      // Map ModelParameters → AI SDK v6 CallSettings. Only fields the user
      // explicitly set are forwarded (undefined ⇒ SDK/model default).
      // NOTE: ModelParameters.maxTokens → streamText.maxOutputTokens.
      const forwardedParams =
        params ?
          {
            ...(params.temperature != null && {
              temperature: params.temperature,
            }),
            ...(params.maxTokens != null && {
              maxOutputTokens: params.maxTokens,
            }),
            ...(params.topP != null && { topP: params.topP }),
            ...(params.topK != null && { topK: params.topK }),
            ...(params.frequencyPenalty != null && {
              frequencyPenalty: params.frequencyPenalty,
            }),
            ...(params.presencePenalty != null && {
              presencePenalty: params.presencePenalty,
            }),
            ...(params.stopSequences?.length && {
              stopSequences: params.stopSequences,
            }),
          }
        : {};

      this.logger.debug("creating stream with chat model", {
        systemLength: mergedSystem.length,
        hasUserSystemPrompt: !!system,
        forwardedParams,
        toolCount: Object.keys(mergedTools).length,
      });

      const result = streamText({
        model: chatLanguageModel,
        messages: await convertToModelMessages(messages),
        system: mergedSystem,
        stopWhen: stopConditions,
        maxRetries: settingsService.settings.maxRetries,
        timeout: TIMEOUTS.chat,
        abortSignal: signal,
        ...forwardedParams,
        ...(Object.keys(mergedTools).length > 0 && { tools: mergedTools }),
        experimental_repairToolCall: repairToolCall,
        experimental_telemetry: {
          isEnabled: settingsService.settings.langfuse.enabled,
          functionId: "chat-worker",
        },
      });

      this.logger.debug("returning stream text result");
      return { result, mcpClients };
    } catch (error) {
      // Close MCP clients on error
      for (const client of mcpClients) {
        await client.close().catch(() => {});
      }
      this.logger.error("failed to create stream", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}
