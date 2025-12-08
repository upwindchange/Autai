import { makeAssistantTool, tool } from "@assistant-ui/react";
import { calculateToolSchema } from "@shared/tools";
import { evaluate } from "mathjs";
import { CalculatorIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Define the tool using imported schema
const calculateTool = tool({
  description: "Evaluate mathematical expressions using mathjs",
  parameters: calculateToolSchema,
  execute: async ({ expression }) => {
    try {
      const result = evaluate(expression);
      return { result: Number(result) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  },
});

// Create the React component that registers the tool
export const CalculatorTool = makeAssistantTool({
  ...calculateTool,
  toolName: "calculate",

  // Define the UI that will be shown when this tool runs
  render: ({ args, status, result }) => {
    return (
      <div className={cn(
        "my-2 rounded-lg border bg-card p-3",
        status.type === "running" && "animate-pulse"
      )}>
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
                {result.error ? (
                  <span className="text-destructive">{result.error}</span>
                ) : (
                  result.result?.toLocaleString()
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  },
});