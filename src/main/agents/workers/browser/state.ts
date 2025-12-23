import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";

const BrowserUseState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<string>,
});

// Extract the state type for function signatures
export type BrowserUseStateType = typeof BrowserUseState.State;

export const graph_builder = new StateGraph(BrowserUseState);
