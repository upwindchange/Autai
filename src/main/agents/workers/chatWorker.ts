import {
	streamText,
	convertToModelMessages,
	stepCountIs,
	hasToolCall,
	StreamTextResult,
	ToolSet,
	type UIMessage,
	type JSONSchema7,
} from "ai";
import { chatModel } from "@agents/providers";
import { repairToolCall } from "@agents/utils";
import { settingsService } from "@/services";
import log from "electron-log/main";
import { frontendTools } from "@assistant-ui/react-ai-sdk";

const systemPrompt = `You are a helpful AI assistant integrated into a web browser automation tool.
                     You can help users navigate web pages, answer questions about the current page content,
                     and provide assistance with browser automation tasks.
                     You have access to various tools for calculations, answering questions, and displaying information.
                     When solving math problems, reason step by step.
                     IMPORTANT: Before using the calculate tool for any mathematical computation, you MUST first request approval from the user using the requestApproval tool.
                     In the approval request, explain what calculation you want to perform and why it's needed.
                     Only proceed with the calculation after receiving user approval.`;

export class ChatWorker {
	private logger = log.scope("ChatWorker");

	async handleChat(
		messages: UIMessage[],
		sessionId: string,
		system?: string,
		tools?: Record<string, { description?: string; parameters: JSONSchema7 }>,
	): Promise<StreamTextResult<ToolSet, never>> {
		this.logger.debug("request received", {
			messagesCount: messages?.length,
			hasSystem: !!system,
			sessionId: sessionId,
			hasTools: !!tools,
			toolCount: tools ? Object.keys(tools).length : 0,
		});

		try {
			this.logger.debug("creating stream with chat model");

			// Use frontend tools if provided, otherwise no tools
			const toolsToUse = tools || {};

			// Configure stop conditions based on available tools
			const stopConditions = [
				// Safety limit to prevent infinite loops
				stepCountIs(20),
			];

			// Add stop conditions for common tool patterns if available
			if (tools && typeof tools === "object") {
				const toolNames = Object.keys(tools);

				// Stop when answer/task completion tool is called
				if (toolNames.includes("answer")) {
					stopConditions.push(hasToolCall("answer"));
				}

				// Stop when error display tool is called
				if (toolNames.includes("displayError")) {
					stopConditions.push(hasToolCall("displayError"));
				}
			}

			const result = streamText({
				model: chatModel(),
				messages: await convertToModelMessages(messages),
				system: `${systemPrompt} ${system || ""}`,
				stopWhen: stopConditions,
				tools: frontendTools(toolsToUse),
				experimental_repairToolCall: repairToolCall,
				experimental_telemetry: {
					isEnabled: settingsService.settings.langfuse.enabled,
					functionId: "chat-worker",
					metadata: {
						langfuseTraceId: sessionId,
					},
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
