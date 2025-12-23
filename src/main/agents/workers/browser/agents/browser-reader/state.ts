import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";

const BrowserReaderState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<string>,
	response: Annotation<string>,
});

// Extract the state type for function signatures
export type BrowserReaderStateType = typeof BrowserReaderState.State;

export const graph_builder = new StateGraph(BrowserReaderState);
