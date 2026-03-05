import { graph_builder } from "./state";
import { browserUseRouterNode } from "./router";
import { START } from "@langchain/langgraph";
import { browserActionNode } from "./agents/browser-action/graph";
import { browserResearcherNode } from "./agents/browser-researcher/graph";
import { MemorySaver } from "@langchain/langgraph";

const checkpointer = new MemorySaver();

export const browserUseWorkflow = graph_builder
	.addNode("browserUseRouterNode", browserUseRouterNode, {
		ends: ["browserActionNode", "browserResearcherNode"],
	})
	.addNode("browserActionNode", browserActionNode)
	.addNode("browserResearcherNode", browserResearcherNode)
	.addEdge(START, "browserUseRouterNode")
	.compile({ checkpointer });
