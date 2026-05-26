import { useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  Moon,
  PanelLeftIcon,
  PanelRightIcon,
  Sun,
  SunMoon,
  ArrowLeft,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/uiStore";
import { useEffect } from "react";
import type { FC } from "react";

interface AppHeaderProps {
  title: string;
}

export const AppHeader: FC<AppHeaderProps> = ({
  title,
}) => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation("common");
  const { t: tSettings } = useTranslation("settings");
  const { showSettings, setShowSettings, showSplitView, toggleSplitView } = useUiStore();
  const { open, toggleSidebar } = useSidebar();

  useEffect(() => {
    window.ipcRenderer.send("theme:change", theme);
  }, [theme]);

  const showBackButton = showSettings && !open;

  return (
    <header className="bg-background sticky top-0 flex h-14 shrink-0 items-center gap-2">
      <div className="flex flex-1 items-center gap-2 px-3">
        <TooltipIconButton
          variant="ghost"
          size="icon"
          side="left"
          tooltip={t("sidebar.toggle")}
          onClick={toggleSidebar}
        >
          <PanelLeftIcon className="size-4" />
        </TooltipIconButton>
        <Separator
          orientation="vertical"
          className="mr-2 data-[orientation=vertical]:h-4"
        />
        {showBackButton && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-lg px-3"
            onClick={() => setShowSettings(false)}
          >
            <ArrowLeft className="size-4" />
            {tSettings("view.backToChat")}
          </Button>
        )}
        <div className="flex-1">{title}</div>
        <TooltipIconButton
          variant="ghost"
          size="icon"
          side="left"
          tooltip={
            theme === "system" ? t("theme.system")
            : theme === "light" ?
              t("theme.light")
            : t("theme.dark")
          }
          onClick={() => {
            const next =
              theme === "system" ? "light"
              : theme === "light" ? "dark"
              : "system";
            setTheme(next);
          }}
        >
          {theme === "system" ?
            <SunMoon className="size-4" />
          : resolvedTheme === "dark" ?
            <Moon className="size-4" />
          : <Sun className="size-4" />}
        </TooltipIconButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              variant="outline"
              size="sm"
              pressed={showSplitView}
              onPressedChange={toggleSplitView}
              className="gap-1.5 rounded-lg px-2 text-xs data-[state=on]:bg-blue-500/10 data-[state=on]:text-blue-500 data-[state=on]:border-blue-500/40"
            >
              <PanelRightIcon className="size-4" />
              {t("splitView.label")}
            </Toggle>
          </TooltipTrigger>
          <TooltipContent side="left">
            {t("splitView.tooltip")}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
};
