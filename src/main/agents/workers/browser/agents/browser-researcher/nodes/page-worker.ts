import { SystemMessage } from "@langchain/core/messages";
import { PageWorkerStateType, BrowserResearcherStateType } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { z } from "zod";
import { createTabTool } from "@/agents/tools/SessionTabTools";
import { navigateTool } from "@/agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@/agents/tools/DOMTools";
import {
	clickElementTool,
	scrollPagesTool,
	hoverElementTool,
} from "@/agents/tools/InteractiveTools";

export async function pageWorkerNode(
	state: PageWorkerStateType,
): Promise<Partial<BrowserResearcherStateType>> {
	const systemPrompt = new SystemMessage(
		`You are a content researcher extracting and summarizing relevant information from a web page.

## Your Task
1. Create a new browser tab for this worker
2. Navigate to the target URL
3. Extract the page content using DOM tools
4. Handle edge cases if needed:
   - Recaptcha: Try basic solving, skip after 10 attempts
   - Lazy loading: Scroll down to load more content
   - Content expansion: Click "read more" or similar elements
5. Summarize the content in the context of the research topic

## Research Topic
${state.researchTopic}

## Target URL
${state.url}

## Edge Case Handling
- **Recaptcha**: If present, try to solve it using available tools. If unsuccessful after multiple attempts, skip and continue.
- **Lazy loading**: Scroll down the page to load dynamically rendered content
- **Paywalls/content limits**: Extract what's accessible without attempting to bypass
- **Popups/overlays**: Close them if they block content access
- **Expandable content**: Click "read more", "show more", or similar elements

## Summary Guidelines
- Focus on information relevant to the research topic
- Extract key facts, insights, and findings
- Maintain accuracy - don't invent information
- If the page is irrelevant or inaccessible, state that clearly
- Include source context in your summary

Now extract and summarize the relevant content.`,
	);

	const SummarySchema = z.object({
		summary: z
			.string()
			.describe(
				"Summary of the page content relevant to the research topic, or a note if the page is inaccessible",
			),
	});

	const agent = createAgent({
		model: complexLangchainModel,
		tools: [
			createTabTool,
			navigateTool,
			getFlattenDOMTool,
			clickElementTool,
			scrollPagesTool,
			hoverElementTool,
		],
		responseFormat: toolStrategy(SummarySchema),
		systemPrompt,
	});

	const response = await agent.invoke(
		{ messages: state.messages },
		{ recursionLimit: 10 }, // Simple recaptcha handling with attempt limit
	);

	return {
		pageSummaries: [
			{
				url: state.url,
				summary: response.structuredResponse.summary,
			},
		],
		processedUrls: [state.url],
	};
}
