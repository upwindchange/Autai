import { type FC, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useChaptersStore } from "@/stores/chaptersStore";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { TableOfContents } from "../table-of-contents/TableOfContents";

// Subtle entrance for the revealed triggers so the cluster grows upward
// intentionally rather than snapping into place.
const REVEAL_ANIMATION = "animate-in fade-in-0 slide-in-from-bottom-2 duration-150";

/**
 * Floating reader controls (bottom-right). The table of contents and the
 * reader-settings (display) affordances are collapsed into ONE menu icon;
 * hovering it (or tapping it, on touch) expands the cluster to reveal both.
 * Each affordance opens a Popover (desktop) or bottom-sheet Drawer (mobile) and
 * carries a tooltip so the icons are self-explanatory.
 *
 * Reveal state is the OR of: a tap-to-pin toggle (`expanded`), pointer hover
 * (`hovered`, desktop), and "a panel is open" (`settingsOpen`/`tocOpen`). The
 * menu button is FIRST in DOM order and the column is reversed so it still sits
 * at the bottom visually — that way keyboard users reach the revealed triggers
 * by forward Tab after activating the menu. A `dismissed` guard makes an explicit
 * close-click collapse the cluster immediately, even while the pointer is still
 * over it. Tooltips live under one shared provider and are suppressed while
 * their own panel is open.
 */
export const ReaderControlsButton: FC = () => {
  const { t } = useTranslation("reader");
  const isMobile = useIsMobile();

  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const revealed =
    expanded || (hovered && !dismissed) || settingsOpen || tocOpen;

  // TOC data comes straight from the chapters store (this button lives inside
  // the entertainment tree, so the active thread is already loaded there).
  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterNumber = useChaptersStore((s) => s.currentChapterNumber);
  const currentThreadId = useChaptersStore((s) => s.currentThreadId);
  const setCurrentChapter = useChaptersStore((s) => s.setCurrentChapter);
  const setPosition = useChaptersStore((s) => s.setPosition);
  const ensureWorker = useChaptersStore((s) => s.ensureWorker);
  const loadChapters = useChaptersStore((s) => s.loadChapters);

  // Jumping via the TOC sets the reader position + kicks the worker for that
  // chapter (handles jumps far ahead), then closes the TOC so the reader takes
  // over (e-reader convention: pick a chapter → read it).
  const handleSelect = (n: number) => {
    setCurrentChapter(n);
    if (currentThreadId) {
      void setPosition(currentThreadId, n);
      void ensureWorker(currentThreadId, n);
    }
    setTocOpen(false);
  };

  // Refresh the chapter list so background-acquired/rewritten siblings surface.
  // Fires both on hover (desktop: pre-warm before the panel opens) and on panel
  // open (covers touch and guarantees freshness), guarded against overlapping
  // loads. No continuous polling.
  const refreshToc = () => {
    if (!currentThreadId) return;
    if (useChaptersStore.getState().loading) return;
    void loadChapters(currentThreadId);
  };
  const onTocOpenChange = (open: boolean) => {
    setTocOpen(open);
    if (open) refreshToc();
  };

  const settingsTrigger = (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={t("reader.openSettings")}
      className={`size-10 rounded-full shadow-md ${REVEAL_ANIMATION}`}
    >
      <span className="text-base font-semibold leading-none">Aa</span>
    </Button>
  );

  const tocTrigger = (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={t("reader.toc.title")}
      onMouseEnter={refreshToc}
      className={`size-10 rounded-full shadow-md ${REVEAL_ANIMATION}`}
    >
      <List className="size-5" />
    </Button>
  );

  // Toggle the pinned-open state. Closing while hovered also sets `dismissed`
  // so the cluster collapses immediately (the X click is honored) rather than
  // only when the pointer later leaves.
  const toggleMenu = () => {
    if (expanded) {
      setDismissed(true);
      setExpanded(false);
    } else {
      setExpanded(true);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="absolute right-4 bottom-4 z-40">
        <div
          className="flex flex-col-reverse items-end gap-2"
          onMouseEnter={() => {
            setHovered(true);
            setDismissed(false);
          }}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Menu button first in DOM (the reversed column keeps it visually at
              the bottom) so forward Tab reaches the revealed triggers after the
              menu is activated. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t("reader.controls.label")}
                aria-expanded={revealed}
                onClick={toggleMenu}
                className="size-10 rounded-full shadow-md"
              >
                {revealed ?
                  <X className="size-5" />
                : <Menu className="size-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {t("reader.controls.label")}
            </TooltipContent>
          </Tooltip>

          {revealed && (
            <>
              <ResponsivePanel
                isMobile={isMobile}
                title={t("reader.title")}
                tooltip={t("reader.openSettings")}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                trigger={settingsTrigger}
              >
                <ReaderSettingsPanel />
              </ResponsivePanel>
              <ResponsivePanel
                isMobile={isMobile}
                title={t("reader.toc.title")}
                tooltip={t("reader.toc.title")}
                open={tocOpen}
                onOpenChange={onTocOpenChange}
                trigger={tocTrigger}
              >
                <TableOfContents
                  chapters={chapters}
                  currentChapterNumber={currentChapterNumber}
                  onSelect={handleSelect}
                />
              </ResponsivePanel>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

interface ResponsivePanelProps {
  isMobile: boolean;
  title: string;
  tooltip: string;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Wraps a trigger + panel content in a Popover (desktop) or bottom-sheet Drawer
 * (mobile), with a tooltip on the trigger. `open`/`onOpenChange` are owned by
 * the caller so the parent cluster can stay expanded while a panel is open; the
 * tooltip is forced closed while its own panel is open (avoids it re-appearing
 * over the panel). Both scroll viewports are `relative` so the TOC can resolve
 * its scroll offsets transform-independently via offsetParent.
 */
const ResponsivePanel: FC<ResponsivePanelProps> = ({
  isMobile,
  title,
  tooltip,
  trigger,
  open,
  onOpenChange,
  children,
}) => {
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <DrawerTrigger asChild>{trigger}</DrawerTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">{tooltip}</TooltipContent>
        </Tooltip>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="relative overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="relative max-h-[80vh] w-80 overflow-y-auto p-4"
      >
        <div className="mb-3 text-sm font-medium">{title}</div>
        {children}
      </PopoverContent>
    </Popover>
  );
};
