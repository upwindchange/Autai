import { Annotation, StateGraph } from "@langchain/langgraph";

// Graph state
export const StateAnnotation = Annotation.Root({
	joke: Annotation<string>,
	topic: Annotation<string>,
	feedback: Annotation<string>,
	funnyOrNot: Annotation<string>,
});

export const graph_builder = new StateGraph(StateAnnotation);
