import { CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * CircleHelp + Tooltip affordance. Mirrors the pattern in
 * connection-section.tsx's `HelpIcon`. Used next to the source field and on
 * each Module-1 checkbox.
 */
export function HelpIcon({ label }: { label: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
