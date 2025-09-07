import { type ToolCallContentPartComponent } from "@assistant-ui/react";
import { CalculatorIcon, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
  CalculateToolParams,
  CalculateToolResult,
  AnswerToolParams,
  DisplayErrorToolParams,
  DisplayErrorToolResult,
} from "@shared";
import {
  repairZodInput,
  answerToolSchema,
  calculateToolSchema,
  displayErrorToolSchema,
} from "@shared";

export const CalculatorTool: ToolCallContentPartComponent<
  CalculateToolParams,
  CalculateToolResult
> = ({ args, result, status }) => {
  // Use the generic Zod repair utility and safeParse to validate input
  const repairedArgs = repairZodInput(args, calculateToolSchema);
  const validation = calculateToolSchema.safeParse(repairedArgs);

  if (!validation.success) {
    return (
      <Alert variant="destructive" className="my-2">
        <AlertTitle>Tool Input Error</AlertTitle>
        <AlertDescription>
          The AI assistant provided invalid input for the calculator tool.
          Please try asking your question again.
        </AlertDescription>
      </Alert>
    );
  }

  const expression = validation.data.expression;

  return (
    <div
      className={cn(
        "my-2 rounded-lg border bg-card p-3",
        status.type === "running" && "animate-pulse"
      )}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <CalculatorIcon className="h-4 w-4" />
        <span className="font-medium">Calculator</span>
      </div>

      <div className="space-y-2">
        <div className="font-mono text-sm">{expression}</div>

        {result !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">=</span>
            <span className="font-mono font-semibold text-sm">
              {typeof result === "number"
                ? result.toLocaleString()
                : String(result)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const AnswerTool: ToolCallContentPartComponent<
  AnswerToolParams,
  void
> = ({ args, status }) => {
  // Use the generic Zod repair utility and safeParse to validate input
  const repairedArgs = repairZodInput(args, answerToolSchema);
  const validation = answerToolSchema.safeParse(repairedArgs);

  if (!validation.success) {
    return (
      <Alert variant="destructive" className="my-2">
        <AlertTitle>Tool Input Error</AlertTitle>
        <AlertDescription>
          The AI assistant provided invalid input for the answer tool. Please
          try asking your question again.
        </AlertDescription>
      </Alert>
    );
  }

  const { steps, answer } = validation.data;

  if (!steps || !answer) return null;

  return (
    <div
      className={cn(
        "my-4 rounded-lg border bg-accent/50 p-4",
        status.type === "running" && "animate-pulse"
      )}
    >
      <h3 className="font-semibold mb-3">Solution Summary</h3>

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
};

export const DisplayErrorTool: ToolCallContentPartComponent<
  DisplayErrorToolParams,
  DisplayErrorToolResult
> = ({ args, result, status }) => {
  // Use result if available (after execution), otherwise use args
  const errorData = result || args;

  // Use the generic Zod repair utility and safeParse to validate input
  const repairedArgs = repairZodInput(errorData, displayErrorToolSchema);
  const validation = displayErrorToolSchema.safeParse(repairedArgs);

  if (!validation.success) {
    return (
      <Alert variant="destructive" className="my-2">
        <AlertTitle>Tool Input Error</AlertTitle>
        <AlertDescription>
          The AI assistant provided invalid input for the error display tool.
          Please try asking your question again.
        </AlertDescription>
      </Alert>
    );
  }

  const { title, message, details } = validation.data;
  const displayTitle = title || "Error";
  const displayMessage = message || "An error occurred";
  const displayDetails = details;

  return (
    <div
      className={cn(
        "my-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4",
        status.type === "running" && "animate-pulse"
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
        <div className="space-y-2 flex-1">
          <h4 className="font-semibold text-destructive">{displayTitle}</h4>
          <p className="text-sm text-foreground/90">{displayMessage}</p>
          {displayDetails && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Technical details
              </summary>
              <pre className="mt-2 text-xs bg-muted/50 p-2 rounded overflow-x-auto">
                {displayDetails}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
};
