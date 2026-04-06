import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Moon, PanelRightIcon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
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

  return (
    <header className="bg-background sticky top-0 flex h-14 shrink-0 items-center gap-2">
      <div className="flex flex-1 items-center gap-2 px-3">
        <SidebarTrigger />
        <Separator
          orientation="vertical"
          className="mr-2 data-[orientation=vertical]:h-4"
        />
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
          tooltip={
            showSplitView ? t("splitView.hide") : t("splitView.show")
          }
          onClick={onToggleSplitView}
        >
          <PanelRightIcon className="size-4" />
        </TooltipIconButton>
      </div>
    </header>
  );
};
