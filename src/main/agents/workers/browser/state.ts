import {
	Annotation,
	MessagesAnnotation,
	StateGraph,
} from "@langchain/langgraph";
import { z } from "zod";

export const BrowserModeSchema = z.enum([
	"browser-action",
	"browser-researcher",
]);

export type BrowserMode = z.infer<typeof BrowserModeSchema>;

const BrowserUseState = Annotation.Root({
	...MessagesAnnotation.spec,
	mode: Annotation<BrowserMode>,
	sessionId: Annotation<string>,
});

// Extract the state type for function signatures
export type BrowserUseStateType = typeof BrowserUseState.State;

export const graph_builder = new StateGraph(BrowserUseState);
