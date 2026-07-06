import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  step: number;
  labels: string[];
}

/**
 * Three-node horizontal stepper for the wizard. Numbered circles connected by
 * fill lines; completed steps show a check, the current step is filled +
 * ringed, upcoming steps stay muted. The two connector lines are `flex-1`, so
 * nodes sit at 0%/50%/100% — which is why the labels below use left/center/
 * right alignment (they line up with the nodes, not the segment thirds).
 *
 * Scales cleanly from a narrow phone to a wide desktop: the connectors just
 * lengthen, the nodes stay fixed-size, and labels never wrap into the gutter.
 */
export function ProgressBar({ step, labels }: ProgressBarProps) {
  const last = labels.length - 1;
  return (
    <div
      className="flex flex-col gap-2"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={labels.length}
      aria-valuenow={step + 1}
    >
      <div className="flex items-center">
        {labels.map((_, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <div key={i} className={cn("flex items-center", i < last && "flex-1")}>
              <span
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                  current &&
                    "ring-2 ring-primary/30 ring-offset-2 ring-offset-background",
                  done || current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30 bg-background text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              {i < last && (
                <span className="relative mx-1 h-0.5 flex-1 overflow-hidden rounded-full bg-muted sm:mx-2">
                  <span
                    className={cn(
                      "absolute inset-0 origin-left rounded-full bg-primary transition-transform duration-300",
                      i < step ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between">
        {labels.map((label, i) => (
          <span
            key={i}
            className={cn(
              "text-xs transition-colors",
              i === step ?
                "font-medium text-foreground"
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
