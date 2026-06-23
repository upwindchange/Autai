import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";

/**
 * Floating "Aa" trigger for the reader settings — the Kindle/Apple Books
 * convention. Anchored absolute to the (relative) entertainment thread root, so
 * it stays put while the viewport scrolls; its popover portals to <body>, so it
 * is never clipped by the viewport's overflow:auto.
 */
export const ReaderSettingsButton = () => {
  const { t } = useTranslation("reader");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="absolute right-4 bottom-4 z-40 size-10 rounded-full shadow-md"
          aria-label={t("reader.openSettings")}
        >
          <span className="text-base font-semibold leading-none">Aa</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[80vh] w-80 overflow-y-auto p-4"
      >
        <ReaderSettingsPanel />
      </PopoverContent>
    </Popover>
  );
};
