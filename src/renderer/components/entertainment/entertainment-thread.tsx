import { useEffect, type FC } from "react";
import {
  AuiIf,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useUiStore } from "@/stores/uiStore";
import { NovelText } from "./NovelText";
import { EntertainmentStartForm } from "./EntertainmentStartForm";

/**
 * Entertainment thread — a guided novel-reading surface.
 *
 * Unlike the chat thread, there is NO always-on free-text composer. The only
 * send entry point is the start form (shown on an empty thread); later turns
 * are driven by LLM HITL tool calls (separate ticket). Assistant text renders
 * in a clean CJK-only reading column with no action chrome.
 */

// --- custom: session tracking ---
// Replaces the chat thread's composer.send-based tracker. aui.thread().append()
// (used by the start form and suggestion triggers) does NOT fire composer.send,
// and the old tracker never handled thread switching either. Sync sessionId
// from the active thread id whenever it changes.
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
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "88rem",
        ["--reading-max-width" as string]: "42rem",
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
            <EntertainmentStartForm />
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

const UserMessage: FC = () => {
  // The start-form input (novel info + source) renders as a compact meta card,
  // not a chat bubble. No edit action, attachments, or quote-reply in this mode.
  return (
    <MessagePrimitive.Root
      data-slot="aui_entertainment-meta-card"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 animate-in duration-150 mx-auto w-full max-w-(--reading-max-width) px-1"
    >
      <div className="wrap-break-word whitespace-pre-line rounded-xl border bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
};
