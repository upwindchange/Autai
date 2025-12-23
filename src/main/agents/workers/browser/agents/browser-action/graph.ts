import { START } from "@langchain/langgraph";
import { graph_builder, BrowserActionStateType } from "./state";

// Subgraph
const subgraphBuilder = graph_builder
	.addNode("subgraphNode1", (state) => {
		return { bar: "hi! " + state.mode };
	})
	.addEdge(START, "subgraphNode1");

const subgraph = subgraphBuilder.compile();

export async function browserActionNode(state: BrowserActionStateType) {
	subgraph.invoke({ messages: state.messages });

	const response = await subgraph.invoke({ messages: state.messages });

	return { response: response.response };
}
