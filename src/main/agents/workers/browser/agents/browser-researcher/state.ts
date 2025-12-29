import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";

const BrowserResearcherState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<string>,
	response: Annotation<string>,
});

// Extract the state type for function signatures
export type BrowserResearcherStateType = typeof BrowserResearcherState.State;

export const graph_builder = new StateGraph(BrowserResearcherState);
