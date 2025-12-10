import { makeAssistantToolUI } from "@assistant-ui/react";
import { CalculatorIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type CalculatorToolArgs = {
  expression: string;
};

type CalculatorToolResult = {
  result?: number;
  error?: string;
};

// Create the UI component for the calculator tool
export const CalculatorTool = makeAssistantToolUI<
  CalculatorToolArgs,
  string
>({
  toolName: "calculate",

  // Define the UI that will be shown when this tool runs
  render: ({ args, status, result }) => {
    // Result might be a JSON string or already parsed object
    let resultObj: CalculatorToolResult | undefined;
    if (result) {
      try {
        resultObj = typeof result === 'string'
          ? JSON.parse(result) as CalculatorToolResult
          : result as CalculatorToolResult;
      } catch (_error) {
        // If parsing fails, display error
        resultObj = { error: 'Invalid result format' };
      }
    }

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
          {resultObj && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">=</span>
              <span className="font-mono font-semibold text-sm">
                {resultObj.error ? (
                  <span className="text-destructive">{resultObj.error}</span>
                ) : (
                  resultObj.result?.toLocaleString()
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  },
});