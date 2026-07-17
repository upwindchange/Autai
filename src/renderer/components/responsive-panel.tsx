import { type FC, type ReactNode, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export interface ResponsivePanelProps {
  /**
   * Which screen edge the trigger sits near. The desktop popover opens *away*
   * from this edge and the mobile drawer slides in *from* it (vaul top/bottom).
   * Use `"bottom"` for footer/composer-anchored controls, `"top"` for
   * header-anchored controls.
   */
  anchor?: "top" | "bottom";
  /** Desktop popover alignment over the trigger. */
  align?: "start" | "center" | "end";
  /** Panel title — also serves as the mobile drawer's accessible title. A
   * ReactNode lets a consumer place a badge/status inline with the title. */
  title: ReactNode;
  /** Optional tooltip on the trigger. Omit to render the trigger bare. */
  tooltip?: string;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /**
   * Optional action row pinned outside the scroll area (e.g. Apply/Reset
   * buttons). When provided, the desktop popover and mobile drawer both split
   * into a scrollable body + a fixed footer with a top border, so the actions
   * stay reachable and fully opaque while the body scrolls. Omit for plain
   * title + body panels (renders exactly as before).
   */
  footer?: ReactNode;
  /**
   * Extra classes for the scrollable content area. A `w-*` here overrides the
   * desktop popover's default width (resolved by tailwind-merge).
   */
  contentClassName?: string;
}

/**
 * Trigger + panel content wrapped in a Popover (desktop) or top/bottom Drawer
 * (mobile), with an optional tooltip on the trigger. `open`/`onOpenChange` are
 * owned by the caller so a host can stay visible while a panel is open.
 *
 * `anchor` orients both surfaces: `"bottom"` (default) opens the popover upward
 * and slides a bottom sheet up — for controls near the bottom edge (reader
 * footer, composer). `"top"` opens the popover downward and slides a top sheet
 * down — for controls near the top edge (app header).
 *
 * The tooltip is forced closed while its own panel is open, and is always
 * controlled (a stable boolean, never undefined) to avoid Radix's
 * controlled→uncontrolled warning — which, because the trigger is shared with
 * the Popover/Drawer trigger, could destabilize pointer handling. Both content
 * viewports are `relative` so children can resolve scroll offsets via
 * offsetParent transform-independently.
 */
export const ResponsivePanel: FC<ResponsivePanelProps> = ({
  anchor = "bottom",
  align = "center",
  title,
  tooltip,
  trigger,
  open,
  onOpenChange,
  children,
  footer,
  contentClassName,
}) => {
  const isMobile = useIsMobile();

  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipProps = {
    open: open ? false : tooltipOpen,
    onOpenChange: setTooltipOpen,
  };

  const popoverSide = anchor === "bottom" ? "top" : "bottom";
  const tooltipSide = anchor === "bottom" ? "top" : "bottom";
  const drawerDirection = anchor;

  const triggerNode =
    tooltip ?
      <TooltipProvider delayDuration={300}>
        <Tooltip {...tooltipProps}>
          <TooltipTrigger asChild>
            {isMobile ?
              <DrawerTrigger asChild>{trigger}</DrawerTrigger>
            : <PopoverTrigger asChild>{trigger}</PopoverTrigger>}
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    : isMobile ? <DrawerTrigger asChild>{trigger}</DrawerTrigger>
    : <PopoverTrigger asChild>{trigger}</PopoverTrigger>;

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        direction={drawerDirection}
      >
        {triggerNode}
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div
            className={cn(
              "relative overflow-y-auto px-4 pb-6",
              contentClassName,
            )}
          >
            {children}
          </div>
          {footer && (
            <div className="border-t bg-background px-4 py-3">{footer}</div>
          )}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {triggerNode}
      <PopoverContent
        side={popoverSide}
        align={align}
        sideOffset={8}
        className={cn(
          footer ?
            "relative flex max-h-[80vh] w-80 flex-col overflow-hidden p-0"
          : "relative max-h-[80vh] w-80 overflow-y-auto p-4",
          contentClassName,
        )}
      >
        {footer ?
          <>
            <div className="px-4 pt-4 pb-2 text-sm font-medium">{title}</div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
            <div className="border-t bg-background px-4 py-3">{footer}</div>
          </>
        : <>
            <div className="mb-3 text-sm font-medium">{title}</div>
            {children}
          </>
        }
      </PopoverContent>
    </Popover>
  );
};
