import { makeAssistantToolUI } from "@assistant-ui/react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type AnswerToolArgs = {
	steps: Array<{
		calculation: string;
		reasoning: string;
	}>;
	answer: string;
};

// Create the UI component for the answer tool
export const AnswerTool = makeAssistantToolUI<AnswerToolArgs, string>({
	toolName: "answer",

	// Define the UI that will be shown when this tool runs
	render: ({ args, status }) => {
		const { steps, answer } = args;

		if (!steps || !answer) return null;

		return (
			<div
				className={cn(
					"my-4 rounded-lg border bg-accent/50 p-4",
					status.type === "running" && "animate-pulse",
				)}
			>
				<div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
					<MessageSquare className="h-4 w-4" />
					<span className="font-medium">Solution Summary</span>
				</div>
				<div className="space-y-3">
					{steps.map((step, index) => (
						<div key={index} className="space-y-1">
							<div className="font-mono text-sm">{step.calculation}</div>
							<div className="text-sm text-muted-foreground pl-4">
								{step.reasoning}
							</div>
						</div>
					))}
				</div>
				<div className="mt-4 pt-3 border-t">
					<p className="font-semibold">{answer}</p>
				</div>
			</div>
		);
	},
});
