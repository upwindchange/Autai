import { Moon, Sun, SunMoon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/components/settings";

export function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const { t, i18n } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();

  const handleLanguageChange = async (lng: string) => {
    await i18n.changeLanguage(lng);
    await updateSettings({ ...settings, language: lng as "en" | "zh" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("general.title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("general.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("general.theme.title")}</CardTitle>
          <CardDescription>
            {t("general.theme.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={theme}
            onValueChange={setTheme}
            className="grid grid-cols-3 gap-4"
          >
            <Label
              htmlFor="theme-light"
              className="flex flex-col items-center gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent has-[data-state=checked]:border-primary has-[data-state=checked]:bg-accent"
            >
              <RadioGroupItem value="light" id="theme-light" className="sr-only" />
              <Sun className="size-6" />
              <span className="text-sm font-medium">
                {t("general.theme.light")}
              </span>
            </Label>
            <Label
              htmlFor="theme-dark"
              className="flex flex-col items-center gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent has-[data-state=checked]:border-primary has-[data-state=checked]:bg-accent"
            >
              <RadioGroupItem value="dark" id="theme-dark" className="sr-only" />
              <Moon className="size-6" />
              <span className="text-sm font-medium">
                {t("general.theme.dark")}
              </span>
            </Label>
            <Label
              htmlFor="theme-system"
              className="flex flex-col items-center gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent has-[data-state=checked]:border-primary has-[data-state=checked]:bg-accent"
            >
              <RadioGroupItem value="system" id="theme-system" className="sr-only" />
              <SunMoon className="size-6" />
              <span className="text-sm font-medium">
                {t("general.theme.system")}
              </span>
            </Label>
          </RadioGroup>
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
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}
