import { SystemMessage } from "@langchain/core/messages";
import { BrowserResearcherStateType, PageWorkerStateType } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command, Send } from "@langchain/langgraph";
import { z } from "zod";
import { createTabTool } from "@/agents/tools/SessionTabTools";
import { navigateTool } from "@/agents/tools/TabControlTools";
import { getFlattenDOMTool } from "@/agents/tools/DOMTools";

export async function searchPlannerNode(
	state: BrowserResearcherStateType,
): Promise<Command> {
	const systemPrompt = new SystemMessage(
		`You are a search specialist using DuckDuckGo to find relevant information for the user's research topic.

## Your Task
1. Create a new browser tab for the search
2. Navigate to DuckDuckGo search URL: https://duckduckgo.com/?q={encoded_research_topic}
3. Extract the page DOM to identify search results
4. Parse the search results to extract URLs and titles
5. Select the top 5-10 most relevant results

## DuckDuckGo Search Result Structure
- Search results are typically links with titles and descriptions
- Look for <a> tags containing result titles and href attributes
- Each result has a URL (href) and a title (link text)

## Important
- Extract both the URL and title for each result
- Select 5-10 of the most relevant results based on the research topic
- Return structured data with url and title fields
- Skip ads, sponsored content, and navigation elements

Now search DuckDuckGo and extract the search results.`,
	);

	const SearchResultSchema = z.object({
		searchResults: z
			.array(
				z.object({
					url: z.string().describe("The URL of the search result"),
					title: z.string().describe("The title of the search result"),
				}),
			)
			.describe("Array of 5-10 relevant search results with URLs and titles"),
	});

	const agent = createAgent({
		model: complexLangchainModel,
		tools: [createTabTool, navigateTool, getFlattenDOMTool],
		responseFormat: toolStrategy(SearchResultSchema),
		systemPrompt,
	});

	const response = await agent.invoke({ messages: state.messages });
	const searchResults = response.structuredResponse.searchResults;

	// Create Send objects for each search result to spawn parallel workers
	const workerCommands: Send[] = searchResults.map((result) => {
		return new Send("page-worker", {
			url: result.url,
			sessionId: state.sessionId,
			researchTopic: state.researchTopic,
			messages: state.messages,
		} as PageWorkerStateType);
	});

	return new Command({
		update: {
			searchResults: searchResults,
		},
		// Send array of Send objects to spawn parallel workers
		goto: workerCommands,
	});
}
