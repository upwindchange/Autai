import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuiState } from "@assistant-ui/react";
import { SlidersHorizontal } from "lucide-react";
import log from "electron-log/renderer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2 } from "lucide-react";
import { useThreadModelStore } from "@/stores/threadModelStore";
import { setThreadChatOverride } from "@/lib/tagApi";
import { useSettings } from "@/components/settings";
import { cn } from "@/lib/utils";
import {
  ModelParamsFields,
  type ModelParamsValue,
} from "@/components/settings/settings-sections/model-params-fields";

const logger = log.scope("ThreadChatSettings");

/**
 * Thread-level chat settings: a popover opened from the composer toolbar that
 * lets the active thread override the system-default system prompt + model
 * parameters. The override lives in RAM (threadModelStore) — so the next send
 * picks it up instantly via the transport — and is PATCHed to the backend for
 * the next reload. Backend resolves the system-default fallback, so this UI
 * only ever carries the raw thread-level override (null = use default).
 *
 * draft + apply UX (mirrors configured-provider-card): edits accumulate in a
 * local draft; Apply commits to store + backend + closes; Reset to Default
 * clears the draft; dismissing without Apply discards.
 */
export const ThreadChatSettings: FC = () => {
  const { t } = useTranslation("common");
  const threadId = useAuiState((s) => s.threads.mainThreadId);
  const selection = useThreadModelStore((s) =>
    threadId ? s.map[threadId] : undefined,
  );
  const { settings } = useSettings();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ModelParamsValue>({});
  const [saving, setSaving] = useState(false);

  // Seed the draft from the current store selection when the popover opens.
  useEffect(() => {
    if (open) {
      setDraft({
        systemPrompt: selection?.systemPrompt ?? null,
        params: selection?.params ?? null,
      });
    }
  }, [open, selection]);

  // "Customized" badge: thread has any non-null override.
  const hasOverride =
    !!selection?.systemPrompt || !!selection?.params;

  const handleApply = async () => {
    if (!threadId) return;
    setSaving(true);
    const next = {
      providerId: selection?.providerId ?? null,
      modelId: selection?.modelId ?? null,
      params: draft.params ?? null,
      systemPrompt: draft.systemPrompt ?? null,
    };
    logger.info("Applying thread-level chat settings override", {
      threadId,
      hasSystemPrompt: !!next.systemPrompt,
      hasParams: !!next.params,
      paramKeys: next.params ? Object.keys(next.params) : [],
    });
    // Instant RAM update first (next send picks it up), then persist.
    useThreadModelStore.getState().set(threadId, next);
    try {
      await setThreadChatOverride(threadId, next);
    } catch (err) {
      // swallow — the RAM value is already live; reload may revert.
      logger.warn("Thread chat settings PATCH failed (RAM value still live)", {
        threadId,
        err,
      });
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const handleReset = () => {
    logger.debug("Resetting thread-level draft to defaults", { threadId });
    setDraft({ systemPrompt: null, params: null });
  };

  // System-level defaults shown as placeholders so the user sees what they'd
  // fall back to without it being part of the thread override.
  const defaultPromptPlaceholder =
    settings.systemPrompt || t("threadSettings.systemPromptEmptyDefault");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-8 w-8",
            hasOverride && "text-primary",
          )}
          aria-label={t("threadSettings.title")}
        >
          <SlidersHorizontal className="size-4" />
          {hasOverride && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-4"
        align="start"
        sideOffset={8}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {t("threadSettings.title")}
            </h3>
            {hasOverride && (
              <span className="text-xs text-primary">
                {t("threadSettings.customized")}
              </span>
            )}
          </div>
          {!hasOverride && (
            <p className="text-xs text-muted-foreground">
              {t("threadSettings.usingDefault")}
            </p>
          )}
          <ModelParamsFields
            value={draft}
            onChange={setDraft}
            systemPromptPlaceholder={defaultPromptPlaceholder}
            i18nNamespace="common"
            keyPrefix="threadSettings"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={
                (draft.systemPrompt ?? null) === null &&
                (draft.params ?? null) === null
              }
            >
              {t("threadSettings.resetToDefault")}
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={saving || !threadId}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                t("threadSettings.apply")
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
