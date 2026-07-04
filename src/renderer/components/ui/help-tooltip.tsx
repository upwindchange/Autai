"use client";

import { type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

const DESKTOP_MAX_PX = 280;

export interface HelpTooltipProps {
  /** Tooltip body. A plain `t(...)` string, or a rich node (e.g. body + example). */
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Open delay (ms). Defaults to 0 (matches the app's existing help icons). */
  delayDuration?: number;
  /** Classes for the trigger icon. */
  iconClassName?: string;
  /**
   * Optional max width in px. When omitted the cap is responsive: a narrow
   * fixed max on desktop, near-full viewport on mobile. If provided, it
   * overrides the responsive cap.
   */
  maxWidth?: number;
  /** Extra classes on the tooltip surface. */
  contentClassName?: string;
}

/**
 * The app's standard "CircleHelp + tooltip" affordance.
 *
 * Width is pure CSS — no JS measurement. The base tooltip surface is
 * `width: fit-content` (so short tips shrink to their text) with
 * `text-wrap: balance`; here we cap it with a max-width and force
 * `text-wrap: wrap`. Normal wrapping packs each line right up to the cap
 * (ragged right on the last line, like any paragraph) instead of `balance`'s
 * even-length lines — which left a wide empty gap on every wrapped tip,
 * especially for CJK. `overflow-wrap: break-word` lets long unbreakable tokens
 * wrap too. The cap is reactive (resize-aware) via `useIsMobile`.
 */
export function HelpTooltip({
  content,
  side = "top",
  align = "center",
  delayDuration = 0,
  iconClassName = "size-4 shrink-0 text-muted-foreground",
  maxWidth,
  contentClassName,
}: HelpTooltipProps) {
  const isMobile = useIsMobile();
  const maxWidthStyle =
    maxWidth !== undefined ?
      `${maxWidth}px`
    : isMobile ? "calc(100vw - 1.5rem)"
    : `${DESKTOP_MAX_PX}px`;

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>
        <CircleHelp className={iconClassName} />
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className={contentClassName}
        style={{
          maxWidth: maxWidthStyle,
          textWrap: "wrap",
          overflowWrap: "break-word",
        }}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
