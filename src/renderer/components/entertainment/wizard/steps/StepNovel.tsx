import { type Dispatch, type FC, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import type { EntertainmentConfig } from "@shared";
import { pickFiles } from "@/lib/filePicker";
import { patchSharedOptions } from "../wizardSteps";

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
  // When on, the source is one continuous text (a post, an email thread, …)
  // and the title/author fields below are disabled — there's no "book title".
  const nonNovel = config.options.nonNovelSource;

  const setNonNovelSource = (value: boolean) =>
    setConfig((prev) => patchSharedOptions(prev, { nonNovelSource: value }));

  // File acquisition — same path for both modes; unified native/browser pick.
  const onPick = async () => {
    const picked = await pickFiles();
    // Spec = single novel; ignore any extras.
    const first = picked[0];
    if (!first) return;
    const { file, fsPath, name } = first;
    setPendingFile(file);
    setConfig((prev) => ({
      ...prev,
      novel: {
        type: "file",
        filename: name,
        ...(fsPath ? { fsPath } : {}),
      },
    }));
  };

  const clearFile = () => {
    setPendingFile(undefined);
    setConfig((prev) => ({ ...prev, novel: { type: "file", filename: "" } }));
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

  // This step is a small form (a checkbox, a source toggle, a few inputs +
  // one textarea). Unlike the options step — which has ~85 toggles and earns a
  // wide layout — stretching this across the full wizard width leaves huge
  // empty whitespace and tiny content. Cap it to a comfortable form column and
  // center it; on narrow screens max-w-3xl doesn't engage, so it stays
  // full-width there.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* Not a chaptered novel — the most consequential choice on this step:
          it switches the reader from per-chapter parsing to building organic
          chapters from a single storyline. Explanation is in the body (not a
          tooltip) so it's always visible. */}
      <div className="rounded-lg border bg-card px-4 py-3">
        <Field orientation="horizontal">
          <Checkbox
            id="ent-non-novel"
            checked={nonNovel}
            onCheckedChange={(v) => setNonNovelSource(v === true)}
          />
          <FieldContent>
            <FieldLabel
              htmlFor="ent-non-novel"
              className="cursor-pointer text-sm font-medium"
            >
              {t("options.source.nonNovel.label")}
            </FieldLabel>
            <FieldDescription>
              {t("options.source.nonNovel.tooltip")}
            </FieldDescription>
            <FieldDescription>
              {t("options.source.nonNovel.example")}
            </FieldDescription>
          </FieldContent>
        </Field>
      </div>

      {/* Source-type toggle — dehydrate only. Interactive is file-only. */}
      {!isInteractive && (
        <>
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

          {/* Why file upload is the recommended path: it's faster (no per-chapter
              web fetch) and unlocks the file-only features — table of contents,
              章节并写 (cross-chapter awareness). Surfaced as a visible note, not a
              tooltip, since it's a real tradeoff the user is choosing between. */}
          <Field>
            <FieldContent>
              <FieldDescription>
                {t("novel.source.recommendFile.note")}
              </FieldDescription>
            </FieldContent>
          </Field>
        </>
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
          {/* Title + author pair on wide screens — both single-line inputs, so
              they read naturally side-by-side once the wizard is wide enough. */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Title — required only when it's a chaptered novel; disabled (greyed)
                when the source isn't a novel. */}
            <Field data-disabled={nonNovel}>
              <FieldLabel htmlFor="ent-novel-title">
                <span>{t("novel.internet.title.label")}</span>
                {!nonNovel && <span className="text-destructive">*</span>}
              </FieldLabel>
              <Input
                id="ent-novel-title"
                value={config.novel.title}
                onChange={(e) => setInternetField("title", e.target.value)}
                placeholder={t("novel.internet.title.placeholder")}
                disabled={nonNovel}
              />
            </Field>

            {/* Author — never required; disabled alongside the title. */}
            <Field data-disabled={nonNovel}>
              <FieldLabel htmlFor="ent-novel-author">
                <span>{t("novel.internet.author.label")}</span>
              </FieldLabel>
              <Input
                id="ent-novel-author"
                value={config.novel.author ?? ""}
                onChange={(e) => setInternetField("author", e.target.value)}
                placeholder={t("novel.internet.author.placeholder")}
                disabled={nonNovel}
              />
            </Field>
          </div>

          {/* Source — always required (where to read it), never disabled. */}
          <Field>
            <FieldLabel htmlFor="ent-novel-source">
              <span>{t("novel.internet.source.label")}</span>
              <span className="text-destructive">*</span>
              <HelpTooltip content={t("novel.internet.source.tooltip")} />
            </FieldLabel>
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
          </Field>
        </>
      }
    </div>
  );
};
