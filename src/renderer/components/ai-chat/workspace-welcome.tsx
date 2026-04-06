import { FC } from "react";
import { Globe, PencilIcon, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

export const WorkspaceWelcome: FC = () => {
  const { t } = useTranslation("welcome");

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-6 fade-in slide-in-from-bottom-2 animate-in duration-300 ease-out">
      <div className="space-y-2">
        <div className="text-4xl font-bold text-foreground">
          {t("title")}
        </div>
        <div className="text-lg text-muted-foreground">
          {t("subtitle")}
        </div>
      </div>

      <div className="max-w-2xl space-y-4 text-muted-foreground">
        <p>
          {t("description")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 w-full max-w-3xl">
        <div className="flex flex-col items-center p-4 rounded-lg bg-background/50 border border-border/50">
          <Globe className="size-8 mb-2 text-blue-500" />
          <div className="font-medium text-foreground">{t("feature.browse.title")}</div>
          <div className="text-sm text-muted-foreground">
            {t("feature.browse.description")}
          </div>
        </div>
        <div className="flex flex-col items-center p-4 rounded-lg bg-background/50 border border-border/50">
          <PencilIcon className="size-8 mb-2 text-green-500" />
          <div className="font-medium text-foreground">{t("feature.automate.title")}</div>
          <div className="text-sm text-muted-foreground">
            {t("feature.automate.description")}
          </div>
        </div>
        <div className="flex flex-col items-center p-4 rounded-lg bg-background/50 border border-border/50">
          <Search className="size-8 mb-2 text-purple-500" />
          <div className="font-medium text-foreground">{t("feature.extract.title")}</div>
          <div className="text-sm text-muted-foreground">
            {t("feature.extract.description")}
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground pt-4">
        {t("prompt.suggestion")}
      </div>
    </div>
  );
};
