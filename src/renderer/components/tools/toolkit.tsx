import { type Toolkit } from "@assistant-ui/react";
import { evaluate } from "mathjs";
import { CalculatorIcon, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { calculateToolSchema, answerToolSchema } from "@shared/tools";
import { Plan } from "@/components/tool-ui/plan";
import { safeParseSerializablePlan } from "@/components/tool-ui/plan/schema";
import { ToolUI } from "@/components/tool-ui/shared";

export const frontendToolkit: Toolkit = {
  // Calculator tool - executes on frontend
  calculate: {
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
                  : result.result?.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    },
  },

  // Answer tool - UI only (no execute, handled by backend)
  answer: {
    description: "Display solution steps and final answer",
    parameters: answerToolSchema,
    // No execute - backend provides the result
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
  },

  // Plan tool - backend renders a structured plan, UI displays it
  plan: {
    type: "backend",
    render: ({ result }) => {
      const parsed = safeParseSerializablePlan(result);
      if (!parsed) return null;

      // Check raw result for approval flag (backend sets this, not in schema)
      const needsApproval =
        (result as Record<string, unknown>)?.requiresApproval === true;

      if (!needsApproval) {
        return <Plan {...parsed} />;
      }

      return (
        <ToolUI id={parsed.id}>
          <ToolUI.Surface>
            <Plan {...parsed} />
          </ToolUI.Surface>
          <ToolUI.Actions>
            <ToolUI.LocalActions
              actions={[
                { id: "approve", label: "Approve Plan" },
                {
                  id: "revise",
                  label: "Request Changes",
                  variant: "secondary",
                },
              ]}
              onAction={(actionId) => {
                const decision =
                  actionId === "approve" ? "approved" : "rejected";
                window.ipcRenderer.invoke("hitl:respond", {
                  id: parsed.id,
                  response: decision,
                });
              }}
            />
          </ToolUI.Actions>
        </ToolUI>
      );
    },
  },
};
