import { BrowserUseStateType } from "./state";
import { Command } from "@langchain/langgraph";

export async function browserUseRouterNode(state: BrowserUseStateType) {
	// Use command pattern with explicit routing based on boolean flags
	if (state.useBrowser) {
		return new Command({
			goto: "browserActionNode",
		});
	} else if (state.webSearch) {
		return new Command({
			goto: "browserResearcherNode",
		});
	}
	// This should never be reached due to UI mutual exclusivity guarantees
	return {};
}
