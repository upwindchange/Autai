import { SystemMessage } from "@langchain/core/messages";
import { BrowserUseStateType, BrowserModeSchema } from "./state";
import { simpleLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import z from "zod";

export async function browserUseRouterNode(state: BrowserUseStateType) {
	const systemPrompt =
		new SystemMessage(`You are a router that determines whether the user wants to:
1. "browser-action" - Perform actions on the browser (click, type, navigate, etc.)
2. "browser-researcher" - Read and analyze the page content

Based on the user's message, choose the appropriate mode.`);

	const agent = createAgent({
		model: simpleLangchainModel,
		responseFormat: toolStrategy(
			z.object({ mode: BrowserModeSchema }),
		),
		systemPrompt,
	});

	const response = await agent.invoke({ messages: state.messages });

	return response.structuredResponse;
}

export async function browserUseRouterEdge(state: BrowserUseStateType) {
	return state.mode;
}
