import { type Dispatch, type FC, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AlphaGlyph } from "@/components/ui/alpha-glyph";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { isValidHttpUrl } from "@shared";
import type { EntertainmentConfig, SourceKind } from "@shared";
import { pickFiles } from "@/lib/filePicker";
import { patchSharedOptions } from "../wizardSteps";

interface StepNovelProps {
  config: EntertainmentConfig;
  setConfig: Dispatch<SetStateAction<EntertainmentConfig>>;
  setPendingFile: (f: File | undefined) => void;
  agreed: boolean;
  setAgreed: Dispatch<SetStateAction<boolean>>;
}

export const StepNovel: FC<StepNovelProps> = ({
  config,
  setConfig,
  setPendingFile,
  agreed,
  setAgreed,
}) => {
  const { t } = useTranslation("entertainment");
  // When on, the source is one continuous text (a post, an email thread, …)
  // and the title/author fields below are disabled — there's no "book title".
  const nonNovel = config.options.nonNovelSource;

  // sourceKind is always present on runtime configs; the ?? "search" fallback
  // mirrors isStepValid for hand-cast (test) configs missing the field.
  const kind: SourceKind =
    config.novel.type === "internet" ?
      (config.novel.sourceKind ?? "search")
    : "search";
  // Red only once the user typed something that isn't a URL — an empty link
  // field shows the muted "required" hint instead.
  const sourceTouchedInvalid =
    config.novel.type === "internet" &&
    config.novel.source.trim() !== "" &&
    !isValidHttpUrl(config.novel.source);

  // Toggling structure also patches the internet novel's sourceKind in the
  // SAME setConfig: a non-chaptered source must use the locked "content"
  // kind, and drops back to "search" when turned off. One combined updater —
  // patchSharedOptions only touches options.
  const setNonNovelSource = (value: boolean) =>
    setConfig((prev) => {
      const next = patchSharedOptions(prev, { nonNovelSource: value });
      if (next.novel.type !== "internet") return next;
      return {
        ...next,
        novel: { ...next.novel, sourceKind: value ? "content" : "search" },
      };
    });

  // Native pick with withBytes:false — the backend reads/decodes the file on
  // upload, so we skip base64-encoding bytes the renderer would discard.
  const onPick = async () => {
    const picked = await pickFiles({ withBytes: false });
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

  // Switch novel source type. Both modes accept file | internet, so this is
  // unconditional.
  const switchNovelType = (type: "file" | "internet") => {
    if (type === "file") {
      setPendingFile(undefined);
      setConfig((prev) => ({ ...prev, novel: { type: "file", filename: "" } }));
    } else {
      // "search" is the only kind valid with an empty source, so the fresh
      // internet form opens without a red error; a non-chaptered source locks
      // to "content" instead.
      setConfig((prev) => ({
        ...prev,
        novel: {
          type: "internet",
          title: "",
          source: "",
          sourceKind: prev.options.nonNovelSource ? "content" : "search",
        },
      }));
    }
  };

  // Switch how the fetcher should treat `source`. Switching TO "search"
  // clears the stored link (unused there); switching between link kinds keeps
  // the URL text so refining the choice never retypes the link.
  const setSourceKind = (next: SourceKind) => {
    setConfig((prev) => {
      if (prev.novel.type !== "internet") return prev;
      return {
        ...prev,
        novel: {
          ...prev.novel,
          sourceKind: next,
          ...(next === "search" ? { source: "" } : {}),
        },
      };
    });
  };

  const setInternetField = (
    field: "title" | "author" | "source",
    value: string,
  ) => {
    setConfig((prev) =>
      prev.novel.type === "internet" ?
        { ...prev, novel: { ...prev.novel, [field]: value } }
      : prev,
    );
  };

  // Start chapter — chaptered internet mode only. Empty = start at chapter 1
  // (the default). Typed text parses on the fly: a non-empty value that isn't
  // a positive integer stores an invalid number, which `isStepValid` rejects
  // (and the backend schema would too) — that's the whole error story.
  const startChapter =
    config.novel.type === "internet" ?
      (config.novel.startChapterNumber?.toString() ?? "")
    : "";
  const setStartChapter = (value: string) => {
    const parsed = value.trim() === "" ? undefined : Number.parseInt(value, 10);
    setConfig((prev) =>
      prev.novel.type === "internet" ?
        { ...prev, novel: { ...prev.novel, startChapterNumber: parsed } }
      : prev,
    );
  };

  // Small form — cap to a centered column (max-w-3xl) to avoid wide whitespace.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* Story source — two orthogonal choices combined into one card:
          structure (chaptered vs non-chaptered fiction) and acquisition
          (file upload vs internet fetch). Both long explanations live under
          help tooltips so the card stays compact. */}
      <div className="grid gap-4 sm:grid-cols-2 sm:divide-x">
        {/* Structure — chaptered fiction vs a single continuous text. */}
        <div className="flex flex-col gap-2 sm:px-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{t("novel.source.structureLabel")}</span>
            <HelpTooltip
              content={
                <>
                  <p>{t("options.source.nonNovel.tooltip")}</p>
                  <p className="mt-1">{t("options.source.nonNovel.example")}</p>
                </>
              }
            />
          </div>
          <RadioGroup
            value={nonNovel ? "nonNovel" : "novel"}
            onValueChange={(v) => setNonNovelSource(v === "nonNovel")}
            className="flex flex-row gap-6"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="novel" id="ent-novel-chaptered" />
              <Label htmlFor="ent-novel-chaptered">
                {t("options.source.chaptered.label")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="nonNovel" id="ent-novel-nonchaptered" />
              <Label htmlFor="ent-novel-nonchaptered">
                {t("options.source.nonNovel.label")}
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* Acquisition — file upload vs internet fetch. */}
        <div className="flex flex-col gap-2 sm:px-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">
              {t("novel.source.acquisitionLabel")}
            </span>
            <HelpTooltip content={t("novel.source.recommendFile.note")} />
          </div>
          <RadioGroup
            value={config.novel.type}
            onValueChange={(v) => switchNovelType(v as "file" | "internet")}
            className="flex flex-row gap-6"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="file" id="ent-novel-file" />
              <Label htmlFor="ent-novel-file">{t("novel.file.label")}</Label>
              {/* Upload is the fastest option of all — badge it. */}
              <Badge variant="secondary">
                {t("novel.internet.sourceKind.badge.fastest")}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="internet" id="ent-novel-internet" />
              <Label htmlFor="ent-novel-internet">
                <span className="relative">
                  {t("novel.internet.label")}
                  <AlphaGlyph className="absolute -top-1.5 -right-3.5 text-muted-foreground" />
                </span>
              </Label>
            </div>
          </RadioGroup>
          {/* Every online path is slower than uploading the file — say so
              inline (not a tooltip) while the internet branch is open. */}
          {config.novel.type === "internet" && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("novel.internet.slowerThanFile")}
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <AlphaGlyph className="size-3 shrink-0" />
                {t("novel.internet.alphaNote")}
              </p>
            </div>
          )}
        </div>
      </div>

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
          {config.novel.filename && (
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

            {/* Start chapter — chaptered internet mode only: begin reading at
                chapter N instead of chapter 1. Required (and marked so) when
                the source is a direct chapter link — the link defines N. */}
            {!nonNovel && (
              <Field className="sm:max-w-48">
                <FieldLabel htmlFor="ent-novel-start-chapter">
                  <span>{t("novel.internet.startChapter.label")}</span>
                  {kind === "chapter" && (
                    <span className="text-destructive">*</span>
                  )}
                  <HelpTooltip
                    content={t("novel.internet.startChapter.tooltip")}
                  />
                </FieldLabel>
                <Input
                  id="ent-novel-start-chapter"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={startChapter}
                  onChange={(e) => setStartChapter(e.target.value)}
                />
                {kind === "chapter" && (
                  <p className="text-xs text-muted-foreground">
                    {t("novel.internet.startChapter.requiredForChapterLink")}
                  </p>
                )}
              </Field>
            )}
          </div>

          {/* How the fetcher should find the story — the speed ordering
              (chapter ≫ toc ≫ page ≫ search) is explained in the tooltip;
              the per-item descriptions reinforce it, and the search item is
              warning-toned to actively discourage it. A non-chaptered source
              locks to the single "content" kind instead. */}
          <Field>
            <FieldLabel>
              <span>{t("novel.internet.sourceKind.label")}</span>
              <HelpTooltip content={t("novel.internet.sourceKind.tooltip")} />
            </FieldLabel>
            {nonNovel ?
              <RadioGroup
                value="content"
                disabled
                className="flex flex-col gap-2"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="content" id="ent-kind-content" />
                    <Label htmlFor="ent-kind-content" className="font-normal">
                      {t("novel.internet.sourceKind.content.label")}
                    </Label>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground">
                    {t("novel.internet.sourceKind.content.desc")}
                  </p>
                </div>
              </RadioGroup>
            : <RadioGroup
                value={kind}
                onValueChange={(v) => setSourceKind(v as SourceKind)}
                className="flex flex-col gap-2"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="chapter" id="ent-kind-chapter" />
                    <Label htmlFor="ent-kind-chapter" className="font-normal">
                      {t("novel.internet.sourceKind.chapter.label")}
                    </Label>
                    <Badge variant="secondary">
                      {t("novel.internet.sourceKind.badge.fastest")}
                    </Badge>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground">
                    {t("novel.internet.sourceKind.chapter.desc")}
                  </p>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="toc" id="ent-kind-toc" />
                    <Label htmlFor="ent-kind-toc" className="font-normal">
                      {t("novel.internet.sourceKind.toc.label")}
                    </Label>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground">
                    {t("novel.internet.sourceKind.toc.desc")}
                  </p>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="page" id="ent-kind-page" />
                    <Label htmlFor="ent-kind-page" className="font-normal">
                      {t("novel.internet.sourceKind.page.label")}
                    </Label>
                  </div>
                  <p className="pl-6 text-xs text-muted-foreground">
                    {t("novel.internet.sourceKind.page.desc")}
                  </p>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="search" id="ent-kind-search" />
                    <Label htmlFor="ent-kind-search" className="font-normal">
                      {t("novel.internet.sourceKind.search.label")}
                    </Label>
                  </div>
                  <p className="pl-6 text-xs text-amber-600 dark:text-amber-400">
                    {t("novel.internet.sourceKind.search.desc")}
                  </p>
                </div>
              </RadioGroup>
            }
            {nonNovel && (
              <p className="text-xs text-muted-foreground">
                {t("novel.internet.sourceKind.nonNovelLocked.hint")}
              </p>
            )}
          </Field>

          {/* Source — the link itself. Link kinds get a validated single-line
              URL input (red border + FieldError once a non-URL is typed);
              the search kind disables the input (no link needed). */}
          {kind === "search" ?
            <Field>
              <FieldLabel htmlFor="ent-novel-source">
                <span>{t("novel.internet.sourceKind.search.label")}</span>
              </FieldLabel>
              <Input
                id="ent-novel-source"
                disabled
                value=""
                placeholder={t("novel.internet.source.searchDisabled")}
              />
            </Field>
          : <Field data-invalid={sourceTouchedInvalid || undefined}>
              <FieldLabel htmlFor="ent-novel-source">
                <span>{t(`novel.internet.source.label.${kind}`)}</span>
                <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="ent-novel-source"
                type="url"
                inputMode="url"
                value={config.novel.source}
                onChange={(e) => setInternetField("source", e.target.value)}
                placeholder={t(`novel.internet.source.placeholder.${kind}`)}
                aria-invalid={sourceTouchedInvalid}
              />
              {sourceTouchedInvalid ?
                <FieldError>{t("novel.internet.source.urlInvalid")}</FieldError>
              : config.novel.source.trim() === "" ?
                <p className="text-xs text-muted-foreground">
                  {t("novel.internet.source.urlRequired")}
                </p>
              : null}
            </Field>
          }
        </>
      }
      {/* Legal acknowledgment — required to commit (the Upload/Fetch &
          Continue button). UI-only: not sent to the backend or persisted.
          The `agreed` state lives in the wizard so it can keep gating the
          final submit on the options step too. */}
      <div className="rounded-lg border bg-card px-4 py-3">
        <Field orientation="horizontal">
          <Checkbox
            id="ent-terms"
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
          />
          <FieldContent>
            <FieldLabel
              htmlFor="ent-terms"
              className="cursor-pointer text-sm font-medium"
            >
              <span>{t("terms.label")}</span>
              <span className="text-destructive">*</span>
            </FieldLabel>
            <FieldDescription>{t("terms.body")}</FieldDescription>
          </FieldContent>
        </Field>
      </div>
    </div>
  );
};
