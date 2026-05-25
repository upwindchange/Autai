import {
  convertToModelMessages,
  stepCountIs,
  StreamTextResult,
  ToolSet,
  type UIMessage,
  streamText,
} from "ai";
import { chatModel } from "@agents/providers";
import { repairToolCall, TIMEOUTS } from "@agents/utils";
import { calculateTool } from "@agents/tools";
import { settingsService } from "@/services";
import log from "electron-log/main";
const systemPrompt = `When your response can benefit from a visual diagram, output a mermaid code block using one of these chart types: Flowchart, Sequence Diagram, Class Diagram, State Diagram, Entity Relationship Diagram, User Journey, Gantt, Pie Chart, Quadrant Chart, Requirement Diagram, GitGraph, C4 Diagram, Mindmap, Timeline, ZenUML, Sankey, XY Chart, Block Diagram, Packet, Kanban, Architecture, Radar, Event Modeling, Treemap, Venn, Ishikawa, Wardley, TreeView

For inline math expressions, use double dollar signs like $$E = mc^2$$. Never use single dollar signs for math.`;

export class ChatWorker {
  private logger = log.scope("ChatWorker");

  async handleChat(
    messages: UIMessage[],
    sessionId: string,
    system?: string,
    tools?: ToolSet[],
  ): Promise<StreamTextResult<any, any>> {
    this.logger.debug("request received", {
      messagesCount: messages?.length,
      hasSystem: !!system,
      sessionId: sessionId,
      hasTools: !!tools,
      toolCount: tools ? Object.keys(tools).length : 0,
    });

    try {
      this.logger.debug("creating stream with chat model");

      // Configure stop conditions based on available tools
      const stopConditions = [
        // Safety limit to prevent infinite loops
        stepCountIs(20),
      ];

      const result = streamText({
        model: chatModel(),
        messages: await convertToModelMessages(messages),
        system: `${systemPrompt} ${system || ""}`,
        stopWhen: stopConditions,
        timeout: TIMEOUTS.chat,
        // tools: {
        //   calculate: calculateTool,
        // },
        experimental_repairToolCall: repairToolCall,
        experimental_telemetry: {
          isEnabled: settingsService.settings.langfuse.enabled,
          functionId: "chat-worker",
        },
      });

      this.logger.debug("returning stream text result");
      // Convert StreamTextResult to ReadableStream for consistency
      return result;
    } catch (error) {
      this.logger.error("failed to create stream", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}
