import { SystemMessage } from "@langchain/core/messages";
import { BrowserResearcherStateType } from "../state";
import { complexLangchainModel } from "@/agents/providers";
import { createAgent, toolStrategy } from "langchain";
import { Command, END } from "@langchain/langgraph";
import { z } from "zod";

export async function synthesizerNode(
	state: BrowserResearcherStateType,
): Promise<Command> {
	// Build context from all page summaries
	const summariesContext = state.pageSummaries
		.map(
			(summary, index) => `
### Source ${index + 1}
URL: ${summary.url}
Summary: ${summary.summary}
`,
		)
		.join("\n");

	const systemPrompt = new SystemMessage(
		`You are a research synthesizer creating a comprehensive markdown report from multiple sources.

## Research Topic
${state.researchTopic}

## Source Summaries
${summariesContext}

## Your Task
Create a well-structured markdown report that includes:

1. **Table of Contents**: List the main sections of the report
2. **Executive Summary**: A comprehensive overview of the findings (2-3 paragraphs)
3. **Detailed Findings**: Organized by themes or topics, with citations to sources
4. **Citations**: List all sources with their URLs

## Report Format

\`\`\`markdown
# Research Report: {Research Topic}

## Table of Contents
- Section 1
- Section 2
- Section 3
...

## Executive Summary
{Comprehensive overview combining insights from all sources}

## Detailed Findings

### Theme 1: {Theme Name}
{Findings from multiple sources, synthesized together}
- Source: [URL]

### Theme 2: {Theme Name}
{Findings from multiple sources, synthesized together}
- Source: [URL]

...

## Citations
1. {Source Title/Description} - {URL}
2. {Source Title/Description} - {URL}
...
\`\`\`

## Important
- Synthesize information from ALL sources
- Organize findings by themes, not by source
- Include specific insights and facts
- Cross-reference information when sources agree or disagree
- Maintain accuracy - only include information from the summaries
- Make the executive summary comprehensive and actionable
- Use proper markdown formatting

Now create the research report.`,
	);

	const ReportSchema = z.object({
		finalReport: z
			.string()
			.describe(
				"Complete markdown report with table of contents, executive summary, detailed findings, and citations",
			),
	});

	const agent = createAgent({
		model: complexLangchainModel(),
		responseFormat: toolStrategy(ReportSchema),
		systemPrompt,
	});

	const response = await agent.invoke({ messages: state.messages });

	return new Command({
		update: {
			finalReport: response.structuredResponse.finalReport,
			status: "completed",
		},
		goto: END,
	});
}
