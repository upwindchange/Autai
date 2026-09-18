import { Moon, Sun, SunMoon } from "lucide-react";
import { resolveLanguage } from "@/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/components/settings";

export function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const { settings, updateSettings } = useSettings();
  const { t, i18n } = useTranslation("settings");
  const handleLanguageChange = async (lng: "system" | "en" | "zh") => {
    await i18n.changeLanguage(resolveLanguage(lng));
    await updateSettings({ ...settings, language: lng });
  };

  const handleStartupModeChange = async (mode: string) => {
    await updateSettings({
      ...settings,
      defaultAppMode: mode as "chat" | "entertainment",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("general.title")}</h2>
        <p className="text-muted-foreground mt-1">{t("general.subtitle")}</p>
      </div>

      <div className="columns-1 gap-6 -mb-6 xl:columns-2 *:mb-6 *:break-inside-avoid">
        <Card>
          <CardHeader>
            <CardTitle>{t("general.theme.title")}</CardTitle>
            <CardDescription>{t("general.theme.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ButtonGroup>
              {(
                [
                  {
                    value: "light",
                    icon: Sun,
                    label: t("general.theme.light"),
                  },
                  { value: "dark", icon: Moon, label: t("general.theme.dark") },
                  {
                    value: "system",
                    icon: SunMoon,
                    label: t("general.theme.system"),
                  },
                ] as const
              ).map(({ value, icon: Icon, label }) => (
                <Button
                  key={value}
                  variant={theme === value ? "default" : "outline"}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  <Icon className="size-4" />
                  {label}
                </Button>
              ))}
            </ButtonGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("general.language.title")}</CardTitle>
            <CardDescription>
              {t("general.language.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={settings.language}
              onValueChange={handleLanguageChange}
            >
              <SelectTrigger className="w-full max-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">
                  {t("general.language.system")}
                </SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">中文</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("general.startup.title")}</CardTitle>
            <CardDescription>
              {t("general.startup.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={settings.defaultAppMode}
              onValueChange={handleStartupModeChange}
            >
              <SelectTrigger className="w-full max-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">
                  {t("general.startup.chat")}
                </SelectItem>
                <SelectItem value="entertainment">
                  {t("general.startup.entertainment")}
                </SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
