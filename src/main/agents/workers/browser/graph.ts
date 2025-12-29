import { graph_builder } from "./state";
import { browserUseRouterEdge, browserUseRouterNode } from "./router";
import { START } from "@langchain/langgraph";
import { browserActionNode } from "./agents/browser-action/graph";
import { BrowserResearcherNode } from "./agents/browser-researcher/graph";

// Build workflow
export const browserUseWorkflow = graph_builder
	.addNode("browserUseRouterNode", browserUseRouterNode)
	.addNode("browserActionNode", browserActionNode)
	.addNode("BrowserResearcherNode", BrowserResearcherNode)
	.addEdge(START, "browserUseRouterNode")
	.addConditionalEdges("browserUseRouterNode", browserUseRouterEdge, {
		// Name returned by routeJoke : Name of next node to visit
		"browser-action": "browserActionNode",
		"browser-researcher": "BrowserResearcherNode",
	})
	.compile();
