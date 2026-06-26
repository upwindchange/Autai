import { type FC, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, Settings2, X } from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useChaptersStore } from "@/stores/chaptersStore";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { TableOfContents } from "../table-of-contents/TableOfContents";

/**
 * Floating reader controls (bottom-right). Groups the table of contents with
 * the "Aa" reader-settings affordance — the TOC button is "collapsed" together
 * with the layout-adjustment button rather than floating separately.
 *
 * Responsive:
 *  - Desktop: a compact always-visible cluster of two round triggers.
 *  - Mobile: a single FAB that expands into the two triggers, keeping the
 *    bottom edge uncluttered on small screens.
 *
 * Each trigger opens its panel as a Popover (desktop) or a bottom-sheet Drawer
 * (mobile). The Drawer replaces the old bottom-right popover, which overflowed
 * and felt cramped on narrow viewports.
 */
export const ReaderControlsButton: FC = () => {
  const { t } = useTranslation("reader");
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);

  // TOC data comes straight from the chapters store (this button lives inside
  // the entertainment tree, so the active thread is already loaded there).
  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterId = useChaptersStore((s) => s.currentChapterId);
  const setCurrentChapter = useChaptersStore((s) => s.setCurrentChapter);

  const roundTrigger = (label: string, children: ReactNode) => (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={label}
      className="size-10 rounded-full shadow-md"
    >
      {children}
    </Button>
  );

  const settingsPanel = (
    <ResponsivePanel
      isMobile={isMobile}
      title={t("reader.title")}
      trigger={roundTrigger(
        t("reader.openSettings"),
        <span className="text-base font-semibold leading-none">Aa</span>,
      )}
    >
      <ReaderSettingsPanel />
    </ResponsivePanel>
  );

  const tocPanel = (
    <ResponsivePanel
      isMobile={isMobile}
      title={t("reader.toc.title")}
      trigger={roundTrigger(t("reader.toc.title"), <List className="size-5" />)}
    >
      <TableOfContents
        chapters={chapters}
        currentChapterId={currentChapterId}
        onSelect={setCurrentChapter}
      />
    </ResponsivePanel>
  );

  return (
    <div className="absolute right-4 bottom-4 z-40 flex flex-col items-end gap-2">
      {/* Mobile: the two triggers are revealed by expanding the FAB. Desktop:
          always visible (the conditional below is always true on desktop). */}
      {(!isMobile || expanded) && (
        <div className="flex flex-col items-end gap-2">
          {settingsPanel}
          {tocPanel}
        </div>
      )}
      {isMobile && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={t("reader.controls.label")}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="size-10 rounded-full shadow-md"
        >
          {expanded ?
            <X className="size-5" />
          : <Settings2 className="size-5" />}
        </Button>
      )}
    </div>
  );
};

interface ResponsivePanelProps {
  isMobile: boolean;
  title: string;
  trigger: ReactNode;
  children: ReactNode;
}

/**
 * Wraps a trigger + panel content in a Popover (desktop) or bottom-sheet Drawer
 * (mobile). The title is supplied here so the inner panels stay chrome-free.
 */
const ResponsivePanel: FC<ResponsivePanelProps> = ({
  isMobile,
  title,
  trigger,
  children,
}) => {
  if (isMobile) {
    return (
      <Drawer>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[80vh] w-80 overflow-y-auto p-4"
      >
        <div className="mb-3 text-sm font-medium">{title}</div>
        {children}
      </PopoverContent>
    </Popover>
  );
};
