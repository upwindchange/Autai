import { type ToolCallContentPartComponent } from "@assistant-ui/react";
import { CalculatorIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const CalculatorTool: ToolCallContentPartComponent = ({
  args,
  result,
  status,
}) => {
  const expression = args?.expression as string;
  
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
        <div className="font-mono text-sm">
          {expression}
        </div>
        
        {result !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">=</span>
            <span className="font-mono font-semibold text-sm">
              {typeof result === "number" ? result.toLocaleString() : String(result)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const AnswerTool: ToolCallContentPartComponent = ({
  args,
  status,
}) => {
  const steps = args?.steps as Array<{ calculation: string; reasoning: string }>;
  const answer = args?.answer as string;
  
  if (!steps || !answer) return null;
  
  return (
    <div className={cn(
      "my-4 rounded-lg border bg-accent/50 p-4",
      status.type === "running" && "animate-pulse"
    )}>
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