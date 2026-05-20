import { tool } from "ai";
import { presentSourcesToolSchema } from "@shared/tools";

export const presentSourcesTool = tool({
  description:
    "Present a list of reference sources to the user as clickable badges with favicons. " +
    "Call this tool with the URLs you referenced in your answer so the user can visit them.",
  inputSchema: presentSourcesToolSchema,
  execute: async ({ sources }) => ({ sources }),
});

export const sourceTools = { presentSources: presentSourcesTool };
