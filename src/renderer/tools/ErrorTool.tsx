import { makeAssistantTool, tool } from "@assistant-ui/react";
import { displayErrorToolSchema } from "@shared/tools";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Define the tool using imported schema
const errorTool = tool({
  description: "Display an error message to the user with details",
  parameters: displayErrorToolSchema,
  execute: async ({ title, message, details }) => {
    return {
      type: "error",
      title: title || "Error",
      message,
      details,
      timestamp: new Date().toISOString()
    };
  },
});

// Create the React component that registers the tool
export const ErrorTool = makeAssistantTool({
  ...errorTool,
  toolName: "displayError",

  // Define the UI that will be shown when this tool runs
  render: ({ args, status }) => {
    const { title, message, details } = args;
    const displayTitle = title || "Error";
    const displayMessage = message || "An error occurred";

    return (
      <div className={cn(
        "my-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4",
        status.type === "running" && "animate-pulse"
      )}>
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <h4 className="font-semibold text-destructive">{displayTitle}</h4>
            <p className="text-sm text-foreground/90">{displayMessage}</p>
            {details && (
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Technical details
                </summary>
                <pre className="mt-2 text-xs bg-muted/50 p-2 rounded overflow-x-auto">
                  {details}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  },
});