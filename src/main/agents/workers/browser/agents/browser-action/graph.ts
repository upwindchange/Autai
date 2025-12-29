import { START, END } from "@langchain/langgraph";
import { graph_builder, BrowserActionStateType } from "./state";
import { browserActionPlannerNode } from "./nodes/planner";
import { browserActionTaskExecutorNode } from "./nodes/task-executor";
import { browserActionExecutorNode } from "./nodes/action-executor";

// Build the browser-action workflow graph
export const browserActionGraph = graph_builder
	.addNode("planner", browserActionPlannerNode, {
		ends: ["task-executor"],
	})
	.addNode("task-executor", browserActionTaskExecutorNode, {
		ends: ["action-executor", END],
	})
	.addNode("action-executor", browserActionExecutorNode, {
		ends: ["task-executor"],
	})
	.addEdge(START, "planner")
	.compile();

export async function browserActionNode(state: BrowserActionStateType) {
	const response = await browserActionGraph.invoke(state);

	return response;
}
