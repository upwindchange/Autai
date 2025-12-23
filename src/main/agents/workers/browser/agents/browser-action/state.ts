import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";

const BrowserActionState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<string>,
	response: Annotation<string>,
});

// Extract the state type for function signatures
export type BrowserActionStateType = typeof BrowserActionState.State;

export const graph_builder = new StateGraph(BrowserActionState);
