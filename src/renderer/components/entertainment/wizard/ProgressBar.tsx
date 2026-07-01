import { cn } from "@/lib/utils";

interface ProgressBarProps {
  step: number;
  labels: string[];
}

/**
 * Three-segment stepper for the wizard. Completed/current segments fill,
 * upcoming segments stay muted. Aria progressbar for screen readers.
 */
export function ProgressBar({ step, labels }: ProgressBarProps) {
  return (
    <div
      className="flex flex-col gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={labels.length}
      aria-valuenow={step + 1}
    >
      <div className="flex h-1.5 gap-1">
        {labels.map((_, i) => (
          <div
            key={i}
            className="relative flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "absolute inset-0 origin-left rounded-full bg-primary transition-transform duration-200",
                i <= step ? "scale-x-100" : "scale-x-0",
              )}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        {labels.map((label, i) => (
          <span
            key={i}
            className={cn(
              "text-xs transition-colors",
              i === step ? "font-medium text-foreground"
              : i < step ? "text-muted-foreground"
              : "text-muted-foreground/50",
              i === labels.length - 1 ? "text-right"
              : i === 0 ? "text-left"
              : "text-center",
              i !== 0 && i !== labels.length - 1 && "flex-1",
            )}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
