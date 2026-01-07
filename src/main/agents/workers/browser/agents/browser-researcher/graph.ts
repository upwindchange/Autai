import { START, END } from "@langchain/langgraph";
import {
	BrowserResearcherState,
	graph_builder,
} from "./state";
import { searchPlannerNode } from "./nodes/search-planner";
import { pageWorkerNode } from "./nodes/page-worker";
import { synthesizerNode } from "./nodes/synthesizer";
import type { BrowserUseStateType } from "../../state";

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
		ends: ["page-worker"], // goto can contain Send objects targeting page-worker
	})
	.addNode("page-worker", pageWorkerNode, {
		ends: ["synthesizer", END],
	})
	.addNode("synthesizer", synthesizerNode, {
		ends: [END],
	})
	.addEdge(START, "search-planner")
	.addConditionalEdges("page-worker", shouldContinueToSynthesizer, [
		"synthesizer",
		END,
	])
	.compile();

// Main entry point for the browser researcher agent
export async function browserResearcherNode(state: BrowserUseStateType) {
	const response = await browserResearcherGraph.invoke({
		messages: state.messages,
		sessionId: state.sessionId,
	});
	return response;
}
