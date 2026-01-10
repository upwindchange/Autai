import { BrowserUseStateType } from "./state";

export async function browserUseRouterNode(state: BrowserUseStateType) {
	// Use command pattern with explicit routing based on boolean flags
	if (state.useBrowser) {
		return {
			goto: "browserActionNode",
		};
	} else if (state.webSearch) {
		return {
			goto: "browserResearcherNode",
		};
	}
	// This should never be reached due to UI mutual exclusivity guarantees
	return {};
}
