import { useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUiStore } from "@/stores/uiStore";

/**
 * Entertainment-mode start form — the only "composer" surface in this mode.
 *
 * Shown on an empty thread. Collects the novel info (title/author/…) and a
 * source (a URL or free-text/search description), then sends to the backend via
 * the existing REST transport by appending a user message to the runtime. This
 * is the same programmatic path the suggestion triggers use
 * (aui.thread().append), which flows through AssistantChatTransport →
 * prepareSendMessagesRequest → POST /entertainment.
 *
 * There is no always-on free-text composer in entertainment mode; later
 * interactions are driven by LLM HITL tool calls (separate ticket).
 */
export const EntertainmentStartForm = () => {
  const { t } = useTranslation("common");
  const aui = useAui();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);

  const [novelInfo, setNovelInfo] = useState("");
  const [source, setSource] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const info = novelInfo.trim();
  const src = source.trim();
  const valid = info.length > 0 && src.length > 0;

  const submit = () => {
    if (!valid || submitted) return;

    // append() does NOT fire the composer.send event the old chat ThreadIdTracker
    // relied on, so sync sessionId from the active thread id ourselves before the
    // transport's headers() reads it. New threads carry a __LOCALID placeholder
    // until they persist, but that placeholder is a valid session id here —
    // useSessionLifecycle activates it and chat syncs it the same way — so we do
    // NOT reject it (rejecting it deadlocks the very first send on a new thread).
    // Zustand set() is synchronous.
    if (mainThreadId) {
      useUiStore.getState().setSessionId(mainThreadId);
    }

    // Readable text part (what the worker + thread-enrichment receive) AND
    // structured metadata (a clean hook for the future real workers).
    const text = `《${info}》\n来源：${src}`;
    aui.thread().append({
      content: [{ type: "text", text }],
      metadata: {
        custom: {
          entertainment: {
            novelInfo: info,
            source: src,
          },
        },
      },
    });

    // Guard the render-window between append() and thread.isEmpty flipping.
    setSubmitted(true);
  };

  const disabled = !valid || submitted;

  return (
    <div className="my-auto mx-auto flex w-full max-w-(--reading-max-width) flex-col gap-6 px-4 pb-10">
      <div className="flex flex-col gap-1">
        <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-2xl duration-200">
          {t("entertainment.start.title")}
        </h1>
        <p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-sm delay-75 duration-200">
          {t("entertainment.start.subtitle")}
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ent-novel-info">
            {t("entertainment.start.novelInfo.label")}
          </Label>
          <Input
            id="ent-novel-info"
            value={novelInfo}
            onChange={(e) => setNovelInfo(e.target.value)}
            placeholder={t("entertainment.start.novelInfo.placeholder")}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ent-source">
            {t("entertainment.start.source.label")}
          </Label>
          <Textarea
            id="ent-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t("entertainment.start.source.placeholder")}
            rows={3}
          />
        </div>
        <Button type="submit" disabled={disabled} className="self-start">
          {t("entertainment.start.submit")}
        </Button>
      </form>
    </div>
  );
};
