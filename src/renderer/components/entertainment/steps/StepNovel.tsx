import { type Dispatch, type FC, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { EntertainmentConfig } from "@shared";
import { pickFiles } from "@/lib/filePicker";
import { HelpIcon } from "./HelpIcon";

interface StepNovelProps {
  config: EntertainmentConfig;
  setConfig: Dispatch<SetStateAction<EntertainmentConfig>>;
  pendingFile: File | undefined;
  setPendingFile: (f: File | undefined) => void;
}

export const StepNovel: FC<StepNovelProps> = ({
  config,
  setConfig,
  pendingFile,
  setPendingFile,
}) => {
  const { t } = useTranslation("entertainment");
  const isInteractive = config.mode === "interactive";

  // File acquisition — same path for both modes; unified native/browser pick.
  const onPick = async () => {
    const picked = await pickFiles();
    // Spec = single novel; ignore any extras.
    const first = picked[0];
    if (!first) return;
    const { file, fsPath, name } = first;
    setPendingFile(file);
    setConfig((prev) =>
      prev.mode === "dehydrate" ?
        {
          ...prev,
          novel: {
            type: "file",
            filename: name,
            ...(fsPath ? { fsPath } : {}),
          },
        }
      : {
          ...prev,
          novel: {
            type: "file",
            filename: name,
            ...(fsPath ? { fsPath } : {}),
          },
        },
    );
  };

  const clearFile = () => {
    setPendingFile(undefined);
    setConfig((prev) =>
      prev.mode === "dehydrate" ?
        { ...prev, novel: { type: "file", filename: "" } }
      : { ...prev, novel: { type: "file", filename: "" } },
    );
  };

  // Switch novel source type (dehydrate only — interactive is locked to file).
  const switchNovelType = (type: "file" | "internet") => {
    if (type === "file") {
      setPendingFile(undefined);
      setConfig((prev) =>
        prev.mode === "dehydrate" ?
          { ...prev, novel: { type: "file", filename: "" } }
        : prev,
      );
    } else {
      setConfig((prev) =>
        prev.mode === "dehydrate" ?
          { ...prev, novel: { type: "internet", title: "", source: "" } }
        : prev,
      );
    }
  };

  const setInternetField = (
    field: "title" | "author" | "source",
    value: string,
  ) => {
    setConfig((prev) =>
      prev.mode === "dehydrate" && prev.novel.type === "internet" ?
        { ...prev, novel: { ...prev.novel, [field]: value } }
      : prev,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Source-type toggle — dehydrate only. Interactive is file-only. */}
      {!isInteractive && (
        <RadioGroup
          value={config.novel.type}
          onValueChange={(v) => switchNovelType(v as "file" | "internet")}
          className="flex flex-row gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="file" id="ent-novel-file" />
            <Label htmlFor="ent-novel-file">{t("novel.file.label")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="internet" id="ent-novel-internet" />
            <Label htmlFor="ent-novel-internet">
              {t("novel.internet.label")}
            </Label>
          </div>
        </RadioGroup>
      )}

      {config.novel.type === "file" ?
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onPick}
            className="self-start"
          >
            <Upload className="size-4" />
            {t("novel.file.pick")}
          </Button>
          {pendingFile && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{config.novel.filename}</span>
              <button
                type="button"
                onClick={clearFile}
                aria-label={t("novel.file.clear")}
                className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      : <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ent-novel-title">
              {t("novel.internet.title.label")}
            </Label>
            <Input
              id="ent-novel-title"
              value={config.novel.title}
              onChange={(e) => setInternetField("title", e.target.value)}
              placeholder={t("novel.internet.title.placeholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ent-novel-author">
              {t("novel.internet.author.label")}
            </Label>
            <Input
              id="ent-novel-author"
              value={config.novel.author ?? ""}
              onChange={(e) => setInternetField("author", e.target.value)}
              placeholder={t("novel.internet.author.placeholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="ent-novel-source">
                {t("novel.internet.source.label")}
              </Label>
              <HelpIcon label={t("novel.internet.source.tooltip")} />
            </div>
            <Textarea
              id="ent-novel-source"
              value={config.novel.source}
              onChange={(e) => setInternetField("source", e.target.value)}
              placeholder={t("novel.internet.source.placeholder")}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {t("novel.internet.source.hint")}
            </p>
          </div>
        </>
      }
    </div>
  );
};
