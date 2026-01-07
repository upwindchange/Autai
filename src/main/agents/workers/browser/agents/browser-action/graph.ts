import { START, END } from "@langchain/langgraph";
import { graph_builder } from "./state";
import { browserActionPlannerNode } from "./nodes/planner";
import { browserActionTaskExecutorNode } from "./nodes/task-executor";
import { browserActionExecutorNode } from "./nodes/action-executor";
import log from "electron-log/main";
import type { BrowserUseStateType } from "../../state";

const logger = log.scope("browserActionNode");

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

export async function browserActionNode(state: BrowserUseStateType) {
	logger.info(state);
	const response = await browserActionGraph.invoke({
		messages: state.messages,
		sessionId: state.sessionId,
	});

	return response;
}
