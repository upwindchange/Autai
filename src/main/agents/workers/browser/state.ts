import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";

const BrowserUseState = Annotation.Root({
	...MessagesAnnotation.spec,
	sessionId: Annotation<string>,
	useBrowser: Annotation<boolean>,
	webSearch: Annotation<boolean>,
});

// Extract the state type for function signatures
export type BrowserUseStateType = typeof BrowserUseState.State;

export const graph_builder = new StateGraph(BrowserUseState);
