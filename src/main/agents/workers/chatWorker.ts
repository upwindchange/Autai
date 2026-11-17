import {
  convertToModelMessages,
  isStepCount,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
  streamText,
  type StreamTextResult,
  type Tool,
} from "ai";
import { flushTelemetry, repairToolCall, TIMEOUTS } from "@agents/utils";
import { settingsService } from "@/services";
import { mcpService } from "@/services/mcpService";
import {
  forwardSamplingParams,
  customProviderOptions,
} from "@agents/providers";
import type { MCPClient } from "@ai-sdk/mcp";
import type { ModelParameters } from "@shared";
import log from "electron-log/main";

const systemPrompt = `Respond in Markdown; the renderer displays Markdown natively.

1. Contain rich content in Markdown constructs: fenced code blocks with the proper language tag for code, e.g. \`\`\`mermaid fenced blocks for diagrams when a visual helps; Markdown tables for tabular data.
2. Never output HTML, including HTML code blocks, unless the user explicitly asks for HTML in their message.
3. Math is embedded inline using double dollars: $$E = mc^2$$. Never use single dollars for math.
4. Do not use mermaid unless appropriate.

Mermaid supports exactly these types — the first line inside the \`\`\`mermaid block must be the declaration keyword:
- flowchart (alias: graph)
- sequenceDiagram
- classDiagram
- stateDiagram-v2 (alias: stateDiagram)
- erDiagram
- journey (User Journey)
- gantt
- pie
- quadrantChart
- requirementDiagram (alias: requirement)
- gitGraph
- C4Context / C4Container / C4Component / C4Dynamic / C4Deployment
- mindmap
- timeline
- kanban
- eventmodeling
- sankey-beta (alias: sankey)
- xychart-beta (alias: xychart)
- block-beta (alias: block)
- packet-beta (alias: packet)
- architecture-beta (alias: architecture)
- treemap-beta (alias: treemap)
- ishikawa-beta (alias: ishikawa)
- radar-beta
- venn-beta
- wardley-beta
- treeView-beta
- cynefin-beta
- swimlane-beta
- railroad-beta / railroad-abnf-beta / railroad-ebnf-beta / railroad-peg-beta
- info (renders a version banner only)

No other diagram type renders (ZenUML, flowchart-elk, etc. are unavailable).`;

export interface ChatWorkerResult {
  result: StreamTextResult<any, any, any>;
  mcpClients: MCPClient[];
}

export class ChatWorker {
  private logger = log.scope("ChatWorker");

  async handleChat(
    messages: UIMessage[],
    sessionId: string,
    chatLanguageModel: LanguageModel,
    chatNpm: string,
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
        isStepCount(20),
      ];

      // User-provided system prompt comes FIRST (primary instruction), the
      // built-in Markdown-format prompt is appended after (additive rules).
      // Empty user prompt ⇒ system collapses to just the built-in prompt,
      // matching the previous behaviour with no regression.
      const mergedSystem =
        `${system ? system.trim() + "\n\n" : ""}${systemPrompt}`.trim();

      // Map ModelParameters → AI SDK v6 CallSettings. Only fields the user
      // explicitly set are forwarded (undefined ⇒ SDK/model default).
      // NOTE: ModelParameters.maxTokens → streamText.maxOutputTokens.
      const forwardedParams = forwardSamplingParams(params);
      const providerOptions = customProviderOptions({
        model: chatLanguageModel,
        npm: chatNpm,
        params,
      });

      this.logger.debug("creating stream with chat model", {
        systemLength: mergedSystem.length,
        hasUserSystemPrompt: !!system,
        forwardedParams,
        providerOptions,
        toolCount: Object.keys(mergedTools).length,
      });

      const result = streamText({
        model: chatLanguageModel,
        messages: await convertToModelMessages(messages),
        instructions: mergedSystem,
        stopWhen: stopConditions,
        maxRetries: settingsService.settings.maxRetries,
        timeout: TIMEOUTS.chat,
        abortSignal: signal,
        ...forwardedParams,
        ...(providerOptions && { providerOptions }),
        ...(Object.keys(mergedTools).length > 0 && { tools: mergedTools }),
        experimental_repairToolCall: repairToolCall,
        // Flush the Langfuse span processor when the stream completes so the
        // turn's traces export promptly (same discipline as the research workers).
        onEnd: () => flushTelemetry(),
        telemetry: {
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
