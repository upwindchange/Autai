import { useEffect, type FC } from "react";
import {
  AuiIf,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useReaderSettings } from "@/stores/readerSettingsStore";
import {
  EntertainmentConfigSchema,
  type DehydrateBasic,
  type EntertainmentConfig,
  type EntertainmentMode,
} from "@shared";
import { NovelText } from "./NovelText";
import { EntertainmentWizard } from "./EntertainmentWizard";
import { buildReaderCssVars } from "./reader-settings/reader-theme";
import { ReaderSettingsButton } from "./reader-settings/ReaderSettingsButton";

/**
 * Entertainment thread — a guided novel-reading surface.
 *
 * Unlike the chat thread, there is NO always-on free-text composer. The only
 * send entry point is the wizard (shown on an empty thread); later turns are
 * driven by LLM HITL tool calls (separate ticket). Assistant text renders in a
 * clean CJK-only reading column with no action chrome.
 */

// --- custom: session tracking ---
// Replaces the chat thread's composer.send-based tracker. aui.thread().append()
// (used by the wizard and suggestion triggers) does NOT fire composer.send, and
// the old tracker never handled thread switching either. Sync sessionId from
// the active thread id whenever it changes.
//
// A brand-new empty thread carries a __LOCALID placeholder id, but that
// placeholder is a valid session id here (useSessionLifecycle activates it and
// chat's tracker syncs it the same way), so we sync it unconditionally —
// rejecting it would deadlock the first send on a new thread.
function ThreadIdTracker() {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  useEffect(() => {
    if (mainThreadId) {
      useUiStore.getState().setSessionId(mainThreadId);
    }
  }, [mainThreadId]);
  return null;
}

export const EntertainmentThread: FC = () => {
  const settings = useReaderSettings();
  const hasContent = useAuiState((s) => !s.thread.isEmpty);

  return (
    <ThreadPrimitive.Root
      // `relative` anchors the floating reader-settings button.
      className="aui-root aui-thread-root @container relative flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "88rem",
        // Reader CSS vars drive the reading surface; --reader-background
        // overrides the bg-background utility above (defaults to --background).
        ...buildReaderCssVars(settings),
        backgroundColor: "var(--reader-background)",
      }}
    >
      <ThreadIdTracker />
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        autoScroll
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <EntertainmentWizard />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-10 flex flex-col gap-y-10 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>
        </div>
      </ThreadPrimitive.Viewport>
      {hasContent && <ReaderSettingsButton />}
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const status = useAuiState((s) => s.message.status?.type);

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative animate-in duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        data-status={status !== "running" ? status : undefined}
        className="wrap-break-word px-2 text-foreground leading-relaxed flex flex-col gap-3"
      >
        {/* Only text parts are rendered — the reading view shows plain CJK
            prose. Reasoning/source/image/file parts are intentionally dropped
            in this mode. */}
        <MessagePrimitive.GroupedParts groupBy={() => null}>
          {({ part }) => (part.type === "text" ? <NovelText /> : null)}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>
    </MessagePrimitive.Root>
  );
};

const MODE_LABEL_KEY: Record<EntertainmentMode, string> = {
  dehydrate: "entertainment.wizard.mode.dehydrate.label",
  interactive: "entertainment.wizard.mode.interactive.label",
};

const BASIC_LABEL_KEY: Record<keyof DehydrateBasic, string> = {
  grammarFix: "entertainment.wizard.options.dehydrate.basic.grammarFix.label",
  webSlangFilter:
    "entertainment.wizard.options.dehydrate.basic.webSlangFilter.label",
  preachRemoval:
    "entertainment.wizard.options.dehydrate.basic.preachRemoval.label",
};

/** Compact summary of a submitted wizard config (rendered in the user bubble). */
const MetaCard: FC<{ config: EntertainmentConfig }> = ({ config }) => {
  const { t } = useTranslation("common");
  const enabledBasic = (
    Object.keys(config.options.basic) as (keyof DehydrateBasic)[]
  ).filter((k) => config.options.basic[k]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="w-fit rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
        {t(MODE_LABEL_KEY[config.mode])}
      </span>
      {config.novel.type === "file" ? (
        <div className="flex items-center gap-1.5">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-foreground">
            {config.novel.filename}
          </span>
        </div>
      ) : (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">
            {config.novel.title}
            {config.novel.author ? ` · ${config.novel.author}` : ""}
          </span>
          <span className="text-xs">{config.novel.source}</span>
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {config.mode === "interactive" ?
          `${t("entertainment.wizard.options.interactive.frequency.label")}: ${config.options.interactionFrequency}`
        : enabledBasic.length > 0 ?
          enabledBasic.map((k) => t(BASIC_LABEL_KEY[k])).join("、")
        : t("entertainment.wizard.options.dehydrate.basic.title")}
      </div>
    </div>
  );
};

const UserMessage: FC = () => {
  // The wizard serializes its config as a JSON text part. Parse it back and
  // render a compact meta card; fall back to raw text if it isn't our JSON
  // (e.g. a legacy thread with the old 《info》/来源 text).
  const parts = useAuiState((s) => s.message.parts);
  const textPart = parts.find((p) => p.type === "text");
  let config: EntertainmentConfig | null = null;
  if (textPart && textPart.type === "text") {
    try {
      const result = EntertainmentConfigSchema.safeParse(
        JSON.parse(textPart.text),
      );
      if (result.success) config = result.data;
    } catch {
      // not JSON — fall through to raw render
    }
  }

  return (
    <MessagePrimitive.Root
      data-slot="aui_entertainment-meta-card"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 animate-in duration-150 mx-auto w-full max-w-(--reading-max-width) px-1"
    >
      <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
        {config ?
          <MetaCard config={config} />
        : <div className="whitespace-pre-line text-muted-foreground">
            <MessagePrimitive.Parts />
          </div>
        }
      </div>
    </MessagePrimitive.Root>
  );
};
