import { useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Moon, PanelLeftIcon, PanelRightIcon, Sun, SunMoon, ArrowLeft } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/stores/uiStore";
import { useEffect } from "react";
import type { FC } from "react";

interface AppHeaderProps {
  title: string;
  showSplitView: boolean;
  onToggleSplitView: () => void;
}

export const AppHeader: FC<AppHeaderProps> = ({
  title,
  showSplitView,
  onToggleSplitView,
}) => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation("common");
  const { t: tSettings } = useTranslation("settings");
  const { showSettings, setShowSettings } = useUiStore();
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
        <TooltipIconButton
          variant="ghost"
          size="icon"
          side="left"
          tooltip={showSplitView ? t("splitView.hide") : t("splitView.show")}
          onClick={onToggleSplitView}
        >
          <PanelRightIcon className="size-4" />
        </TooltipIconButton>
      </div>
    </header>
  );
};
