import { START, END, Send } from "@langchain/langgraph";
import {
	BrowserResearcherStateType,
	BrowserResearcherState,
	graph_builder,
} from "./state";
import { searchPlannerNode } from "./nodes/search-planner";
import { pageWorkerNode } from "./nodes/page-worker";
import { synthesizerNode } from "./nodes/synthesizer";

// Conditional edge: Assign workers to parallelize page processing
function assignWorkers(state: typeof BrowserResearcherState.State): Send[] {
	// Spawn a worker for each search result
	// Each worker will create its own tab and process the page independently
	return state.searchResults.map((result) => {
		return new Send("page-worker", {
			url: result.url,
			sessionId: state.sessionId,
			researchTopic: state.researchTopic,
			messages: state.messages,
			// Note: tabId will be created by the page-worker node
		});
	});
}

// Conditional edge: Check if all workers have completed before synthesizing
function shouldContinueToSynthesizer(
	state: typeof BrowserResearcherState.State,
): typeof END | "synthesizer" {
	// Check if we've processed all URLs from search results
	if (
		state.searchResults &&
		state.processedUrls &&
		state.processedUrls.length >= state.searchResults.length
	) {
		return "synthesizer";
	}
	// More workers still running, continue to END
	return END;
}

// Build the browser researcher graph
export const browserResearcherGraph = graph_builder
	.addNode("search-planner", searchPlannerNode, {
		ends: ["assign-workers"],
	})
	.addNode("page-worker", pageWorkerNode, {
		ends: ["synthesizer", END],
	})
	.addNode("synthesizer", synthesizerNode, {
		ends: [END],
	})
	.addEdge(START, "search-planner")
	.addConditionalEdges("search-planner", assignWorkers, ["page-worker"])
	.addConditionalEdges("page-worker", shouldContinueToSynthesizer, [
		"synthesizer",
		END,
	])
	.compile();

// Main entry point for the browser researcher agent
export async function browserResearcherNode(state: BrowserResearcherStateType) {
	const response = await browserResearcherGraph.invoke(state);
	return response;
}
