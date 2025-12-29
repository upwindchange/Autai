import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

// OverallState for orchestration level
const BrowserResearcherState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<string>,
	sessionId: Annotation<string>,
	researchTopic: Annotation<string>,
	searchResults: Annotation<Array<{url: string; title: string}>>,
	pageSummaries: Annotation<Array<{url: string; summary: string}>>({
		reducer: (a, b) => a.concat(b), // Accumulate parallel results
		default: () => [],
	}),
	processedUrls: Annotation<string[]>({
		reducer: (a, b) => a.concat(b),
		default: () => [],
	}),
	finalReport: Annotation<string>,
	status: Annotation<string>,
	errors: Annotation<any[]>({
		reducer: (a, b) => a.concat(b),
		default: () => [],
	}),
});

// WorkerState for parallel page workers
const PageWorkerState = Annotation.Root({
	url: Annotation<string>,
	tabId: Annotation<string>,
	sessionId: Annotation<string>,
	researchTopic: Annotation<string>,
	messages: Annotation<BaseMessage[]>,
	summary: Annotation<string>,
});

// Extract the state types for function signatures
export type BrowserResearcherStateType = typeof BrowserResearcherState.State;
export type PageWorkerStateType = typeof PageWorkerState.State;

// Export graph builder for OverallState
export const graph_builder = new StateGraph(BrowserResearcherState);

// Export Annotations for use in graph
export { BrowserResearcherState, PageWorkerState };
