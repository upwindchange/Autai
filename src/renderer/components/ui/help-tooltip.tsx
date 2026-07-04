"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface HelpTooltipProps {
  /** Tooltip body. A plain `t(...)` string, or a rich node (e.g. body + example). */
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Open delay (ms). Defaults to 0 (matches the app's existing help icons). */
  delayDuration?: number;
  /** Classes for the trigger icon. */
  iconClassName?: string;
  /** Max width in px before the tip wraps. Defaults to 360; capped by viewport. */
  maxWidth?: number;
  /** Extra classes on the tooltip surface. */
  contentClassName?: string;
}

/**
 * The app's standard "CircleHelp + tooltip" affordance, used wherever a field or
 * option needs an inline explanation.
 *
 * Width is content-fit, not a fixed cap. The base tooltip is `w-fit
 * text-balance`, but per Chrome's docs `text-wrap: balance` only evens the lines
 * *within* the existing width — it does not shrink-wrap the box. So a long tip
 * otherwise renders at its capped max-content width with a large empty gap on
 * the right (acutely so for CJK, which has no word boundaries). Pure CSS can't
 * hug wrapped content, so on open we measure the smallest width that keeps the
 * line count unchanged and set it imperatively — a binary search on
 * `offsetHeight`, run in a layout effect before paint so there's no flash.
 */
export function HelpTooltip({
  content,
  side = "top",
  align = "center",
  delayDuration = 0,
  iconClassName = "size-4 shrink-0 text-muted-foreground",
  maxWidth = 360,
  contentClassName,
}: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (!open) {
      el.style.width = "";
      return;
    }
    // Smallest width that keeps the same number of lines as at the cap = the
    // longest wrapped line → the box hugs its content with no right-side gap.
    const cap = Math.min(maxWidth, window.innerWidth - 24);
    el.style.width = `${cap}px`;
    const targetHeight = el.offsetHeight;
    let lo = 1;
    let hi = cap;
    let best = cap;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      el.style.width = `${mid}px`;
      if (el.offsetHeight === targetHeight) {
        best = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    el.style.width = `${best}px`;
  }, [open, content, maxWidth]);

  return (
    <Tooltip delayDuration={delayDuration} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <CircleHelp className={iconClassName} />
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className={contentClassName}>
        <div ref={contentRef} className="break-words">
          {content}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
