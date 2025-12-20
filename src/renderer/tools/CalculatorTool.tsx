import { makeAssistantTool, tool } from "@assistant-ui/react";
import { calculateToolSchema } from "@shared/tools";
import { evaluate } from "mathjs";
import { CalculatorIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Register the tool
export const CalculatorTool = makeAssistantTool({
	toolName: "calculate",
	...tool({
		description: "Evaluate mathematical expressions using mathjs",
		parameters: calculateToolSchema,
		execute: async ({ expression }) => {
			try {
				const result = evaluate(expression);
				return { result: Number(result) };
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	}),
	render: ({ args, status, result }) => {
		return (
			<div
				className={cn(
					"my-2 rounded-lg border bg-card p-3",
					status.type === "running" && "animate-pulse",
				)}
			>
				<div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
					<CalculatorIcon className="h-4 w-4" />
					<span className="font-medium">Calculator</span>
				</div>
				<div className="space-y-2">
					<div className="font-mono text-sm">{args.expression}</div>
					{result && (
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground">=</span>
							<span className="font-mono font-semibold text-sm">
								{result.error ?
									<span className="text-destructive">{result.error}</span>
								:	result.result?.toLocaleString()}
							</span>
						</div>
					)}
				</div>
			</div>
		);
	},
});
