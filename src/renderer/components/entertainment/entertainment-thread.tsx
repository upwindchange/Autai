import { useEffect, useRef, useState, type FC } from "react";
import {
  AuiIf,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import type { ThreadUserMessagePart } from "@assistant-ui/react";
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
import { ReaderControlsButton } from "./reader-settings/ReaderControlsButton";
import { ChapterNav } from "./chapter-nav/ChapterNav";

/**
 * Entertainment thread — a guided novel-reading surface.
 *
 * Unlike the chat thread, there is NO always-on free-text composer. The only
 * send entry point is the wizard (shown on an empty thread); later turns are
 * driven by chapter navigation (next/prev) which appends follow-up turns the
 * stub worker answers. Assistant text renders in a clean CJK-only reading
 * column with no action chrome.
 *
 * The reader is PAGINATED: only one assistant message (chapter) is shown at a
 * time. Chapters still stack in the underlying thread (so they persist), but
 * the message loop returns null for every non-current message.
 */

// --- custom: session tracking ---
// Replaces the chat thread's composer.send-based tracker. aui.thread().append()
// (used by the wizard and chapter navigation) does NOT fire composer.send, and
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

/**
 * Extract the original wizard config from the thread's first config-bearing
 * user message. Used to build a "next chapter" follow-up turn: we re-send the
 * same config (with an `_action` marker) so the stub worker can answer it. The
 * `_action` key is stripped by Zod on the backend (unknown key), so the worker
 * still receives a valid EntertainmentConfig.
 */
function getOriginalConfig(
  messages: ReadonlyArray<{
    role: string;
    parts: ReadonlyArray<{ type: string; text?: string }>;
  }>,
): EntertainmentConfig | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = m.parts.find((p) => p.type === "text")?.text;
    if (typeof text !== "string") continue;
    try {
      const result = EntertainmentConfigSchema.safeParse(JSON.parse(text));
      if (result.success) return result.data;
    } catch {
      // not JSON — skip
    }
  }
  return null;
}

export const EntertainmentThread: FC = () => {
  const settings = useReaderSettings();
  const hasContent = useAuiState((s) => !s.thread.isEmpty);
  const aui = useAui();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  // Paginated reader state. currentChapterId === null ⇒ "follow the latest
  // chapter" (default, and while a freshly-fetched chapter streams in). Pinning
  // to an older id (via Previous) stops following the latest until the user
  // moves forward again.
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const latestAssistantId = assistantMessages[assistantMessages.length - 1]?.id;
  const effectiveId = currentChapterId ?? latestAssistantId;
  const effectiveIndex = effectiveId
    ? assistantMessages.findIndex((m) => m.id === effectiveId)
    : -1;
  const canGoPrev = effectiveIndex > 0;

  // Reset to "follow latest" whenever the active thread changes.
  useEffect(() => {
    setCurrentChapterId(null);
  }, [mainThreadId]);

  // Start each displayed chapter at the top (prev/next/fetch all change it).
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [effectiveId]);

  const handlePrev = () => {
    if (effectiveIndex <= 0) return;
    // Pin to the previous chapter (stops following the latest).
    setCurrentChapterId(assistantMessages[effectiveIndex - 1].id);
  };

  const handleNext = async () => {
    if (isRunning) return;
    // Viewing an older chapter with a loaded one after it → move forward
    // without re-fetching.
    if (
      currentChapterId !== null &&
      effectiveIndex >= 0 &&
      effectiveIndex < assistantMessages.length - 1
    ) {
      const nextMsg = assistantMessages[effectiveIndex + 1];
      setCurrentChapterId(
        nextMsg.id === latestAssistantId ? null : nextMsg.id,
      );
      return;
    }
    // Otherwise (at the latest, or pinned at the end) fetch the next chapter.
    const config = getOriginalConfig(messages);
    if (!config) return;
    setCurrentChapterId(null); // follow the new chapter as it streams in
    if (mainThreadId) {
      // append() does NOT fire composer.send, so sync sessionId ourselves
      // before the transport's headers() reads it (mirrors the wizard).
      useUiStore.getState().setSessionId(mainThreadId);
    }
    const content: ThreadUserMessagePart[] = [
      {
        type: "text",
        text: JSON.stringify({ _action: "next-chapter", ...config }),
      },
    ];
    await aui.thread().append({ content });
  };

  return (
    <ThreadPrimitive.Root
      // `relative` anchors the floating reader-controls button + chapter nav.
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
        ref={viewportRef}
        turnAnchor="top"
        autoScroll={false}
        // Pagination owns scroll position: every chapter starts at the top (see
        // the effectiveId effect). Disable the viewport's auto-to-bottom
        // behaviors so they don't fight it during a fetch or thread switch.
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
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
              {({ message }) =>
                message.role === "assistant" && message.id === effectiveId ?
                  <ThreadMessage />
                : null
              }
            </ThreadPrimitive.Messages>
          </div>
        </div>
      </ThreadPrimitive.Viewport>
      {hasContent && (
        <>
          <ChapterNav
            canGoPrev={canGoPrev}
            fetching={isRunning}
            onPrev={handlePrev}
            onNext={handleNext}
          />
          <ReaderControlsButton />
        </>
      )}
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
  dehydrate: "mode.dehydrate.label",
  interactive: "mode.interactive.label",
};

const BASIC_LABEL_KEY: Record<keyof DehydrateBasic, string> = {
  grammarFix: "options.dehydrate.basic.grammarFix.label",
  webSlangFilter: "options.dehydrate.basic.webSlangFilter.label",
  preachRemoval: "options.dehydrate.basic.preachRemoval.label",
};

/** Compact summary of a submitted wizard config (rendered in the user bubble). */
const MetaCard: FC<{ config: EntertainmentConfig }> = ({ config }) => {
  const { t } = useTranslation("entertainment");
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
          `${t("options.interactive.frequency.label")}: ${config.options.interactionFrequency}`
        : enabledBasic.length > 0 ?
          enabledBasic.map((k) => t(BASIC_LABEL_KEY[k])).join("、")
        : t("options.basic.none")}
      </div>
    </div>
  );
};

const UserMessage: FC = () => {
  // The wizard serializes its config as a JSON text part. Parse it back and
  // render a compact meta card; fall back to raw text if it isn't our JSON
  // (e.g. a legacy thread with the old 《info》/来源 text).
  //
  // NOTE: in the paginated reading view user messages are hidden (the message
  // loop only renders the focused assistant chapter), so this is only reached
  // if the message loop is changed to show user bubbles again.
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
