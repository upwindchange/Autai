import React from "react";
import ReactDOM from "react-dom/client";
import "@/i18n";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { AppMessage } from "@shared";
import { X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import log from "electron-log/renderer";
import { SidebarLeft } from "@/components/side-bar/sidebar-left";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Thread } from "@/components/ai-chat";
import { EntertainmentThread } from "@/components/entertainment";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { useUiStore } from "@/stores/uiStore";
import { frontendToolkit } from "@/components/tools";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  WebSpeechSynthesisAdapter,
  useAui,
  useAuiState,
  Tools,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { AppHeader } from "@/components/app-header";
import { useRef, useEffect, useState } from "react";
import { useSessionLifecycle, useThreadListRefresh } from "@/hooks";
import { useZenModeHotkeys } from "@/hooks/useZenModeHotkeys";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useTagStore } from "@/stores/tagStore";
import { useChaptersStore } from "@/stores/chaptersStore";
import { useThreadModelStore } from "@/stores/threadModelStore";
import { useRemoteThreadListRuntime } from "@assistant-ui/react";
import { backendThreadListAdapter } from "@/adapters/backendThreadListAdapter";
import { UniversalFileAttachmentAdapter } from "@/adapters/universalFileAttachmentAdapter";
import { initApiBase, getApiBase } from "@/lib/api";
import { httpClient } from "@/lib/httpClient";
import { isNativeRenderer } from "@/lib/env";
import { serverEvents } from "@/lib/serverEvents";
import { getAuthStatus, AUTH_UNAUTHORIZED_EVENT } from "@/lib/authClient";
import { LoginScreen } from "@/components/auth/LoginScreen";

import "./index.css";

const logger = log.scope("Main");

// Force the Alert's icon column on. The shadcn Alert only reserves an icon
// column when it has a direct <svg> child (has-[>svg]), but DotMatrix wraps its
// svg in a span, so we set the same grid template the component uses itself.
const ALERT_ICON_GRID =
  "relative grid-cols-[calc(var(--spacing)*4)_1fr] gap-x-3";

// Main process message handler
const handleAppMessage = (message: AppMessage) => {
  logger.debug("app message received", {
    type: message.type,
    title: message.title,
  });
  switch (message.type) {
    case "alert":
      // Fatal error — persistent until dismissed.
      toast.custom(
        (t) => (
          <div className="w-full">
            <Alert variant="destructive" className={ALERT_ICON_GRID}>
              <DotMatrix state="error" className="size-4 translate-y-0.5" />
              <AlertTitle>{message.title}</AlertTitle>
              <AlertDescription>{message.description}</AlertDescription>
              <button
                onClick={() => toast.dismiss(t)}
                className="absolute right-3 top-3 text-destructive-foreground/70 hover:text-destructive-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </Alert>
          </div>
        ),
        {
          duration: Infinity, // Never auto-dismiss
        },
      );
      break;
    case "warning":
      // Non-fatal — the workflow continues despite a partial failure.
      toast.custom(() => (
        <div className="w-full">
          <Alert className={ALERT_ICON_GRID}>
            <DotMatrix state="warning" className="size-4 translate-y-0.5" />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        </div>
      ));
      break;
    case "info":
      toast.custom(() => (
        <div className="w-full">
          <Alert className={ALERT_ICON_GRID}>
            <DotMatrix state="info" className="size-4 translate-y-0.5" />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        </div>
      ));
      break;
    case "success":
      toast.custom(() => (
        <div className="w-full">
          <Alert className={ALERT_ICON_GRID}>
            <DotMatrix state="success" className="size-4 translate-y-0.5" />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        </div>
      ));
      break;
  }
};

/**
 * Inner app component that uses thread lifecycle hook.
 * This component must be inside AssistantRuntimeProvider to access the runtime.
 */
function AppContent() {
  const { t } = useTranslation("common");
  const { showSettings, showSplitView, setContainerRef } = useUiStore();
  const appMode = useUiStore((s) => s.appMode);
  const zenMode = useUiStore((s) => s.zenMode);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  // Latest mainThreadId readable inside the appMode subscription callback
  // (which fires outside the render cycle).
  const mainThreadIdRef = useRef(mainThreadId);
  mainThreadIdRef.current = mainThreadId;
  const threadTitle = useTagStore((s) =>
    mainThreadId ?
      (s.threads.find((th) => th.remoteId === mainThreadId)?.title ?? null)
    : null,
  );
  // In entertainment mode, prefer the CURRENT chapter's title over the thread
  // (novel) title in the app header — it updates live as the reader navigates
  // chapters. Falls back to the thread title when no chapter is open, the
  // chapter has no title, or we're outside entertainment mode.
  const chapterTitle = useChaptersStore((s) => {
    const n = s.currentChapterNumber;
    if (!n) return null;
    return s.chapters.find((c) => c.chapterNumber === n)?.title ?? null;
  });

  // Load this thread's saved chat model from the DB once (cached in RAM).
  // Keyed by mainThreadId — the active thread id. (threadListItem.remoteId is
  // undefined here: AppContent is a sibling of the per-thread runtime.)
  useEffect(() => {
    if (!mainThreadId) return;
    void useThreadModelStore.getState().loadFromDb(mainThreadId);
  }, [mainThreadId]);

  // Initialize thread lifecycle management
  useSessionLifecycle();

  // Reload the thread list when the set of threads changes on the backend
  // (create/delete/archive/bulk from any client). The flat thread list reads
  // from assistant-ui's internal cache, which — unlike the grouped list's
  // tagStore (kept live by the metadataUpdated handler in App) — is not
  // otherwise notified, so it needs this reload to see threads created elsewhere.
  const refreshThreads = useThreadListRefresh();
  useEffect(() => {
    return serverEvents.on("threads:listChanged", () => {
      void refreshThreads();
    });
  }, [refreshThreads]);

  // Reload the thread list when the top-level app mode changes (chat <->
  // entertainment). The single adapter is mode-aware, so reload() re-fetches
  // the other mode's threads via the public runtime API. We remember the thread
  // we're leaving and restore the target mode's last-active thread afterwards.
  useEffect(() => {
    return useUiStore.subscribe(
      (s) => s.appMode,
      (newMode, oldMode) => {
        if (!oldMode || newMode === oldMode) return;
        const currentId = mainThreadIdRef.current;
        if (currentId && !currentId.startsWith("__LOCALID")) {
          useUiStore.getState().setLastActiveByMode(oldMode, currentId);
        }
        const target = useUiStore.getState().lastActiveByMode[newMode];
        void refreshThreads({ restoreTarget: target });
      },
    );
  }, [refreshThreads]);

  // Zen mode is entertainment-only: clamp it off whenever the reader isn't the
  // active surface (mode switch or settings open) so it can't linger or snap
  // back unexpectedly. Read via getState() to avoid subscribing to zenMode here.
  useEffect(() => {
    if (appMode !== "entertainment" || showSettings) {
      useUiStore.getState().setZenMode(false);
    }
  }, [appMode, showSettings]);

  // Global F10 (enter) / Esc (exit) zen hotkeys. F11 stays the Electron
  // OS-fullscreen menu accelerator.
  useZenModeHotkeys();

  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSplitView && workspaceRef.current) {
      setContainerRef(workspaceRef.current);

      // Coalesce resize ticks with rAF and POST the latest bounds once per
      // frame — avoids flooding the server with one POST per resize event.
      let rafId = 0;
      const resizeObserver = new ResizeObserver(() => {
        if (!workspaceRef.current) return;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (!workspaceRef.current) return;
          const { width, height, x, y } =
            workspaceRef.current.getBoundingClientRect();
          void httpClient.postCommand("/sessions/container-rect", {
            rect: { x, y, width, height },
          });
        });
      });
      resizeObserver.observe(workspaceRef.current);

      return () => {
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        setContainerRef(null);
        void httpClient.postCommand("/sessions/container-rect", {
          rect: null,
        });
      };
    } else {
      setContainerRef(null);
      return undefined;
    }
  }, [showSplitView, setContainerRef]);

  // Header title priority: settings title (when settings open) → current
  // chapter title (entertainment mode, while reading) → thread/novel title →
  // app default. The chapter title wins only in entertainment mode and only
  // when present, so the wizard/options page still shows the thread title.
  const headerTitle = showSettings ?
    t("header.settings")
  : appMode === "entertainment" && chapterTitle ?
    chapterTitle
  : (threadTitle ?? `${t("app.title")} ${t("header.aiAssistant")}`);
  // Compact form for medium header widths: drop the " AI Assistant" suffix from
  // the default title (chapter/thread/settings titles have no shorter form).
  const headerTitleShort = showSettings ?
    t("header.settings")
  : appMode === "entertainment" && chapterTitle ?
    chapterTitle
  : (threadTitle ?? t("app.title"));

  // Effective zen: hide sidebar + header so the reader fills the window. Only
  // in entertainment mode without settings open.
  const zen = zenMode && appMode === "entertainment" && !showSettings;

  return (
    <SettingsProvider>
      <div className="w-dvw flex flex-row h-dvh">
        <SidebarProvider>
          {zen ?
            null
          : showSettings ?
            <SettingsSidebar />
          : <SidebarLeft />}
          <SidebarInset className="relative flex-1">
            {showSplitView && !zen ?
              <ResizablePanelGroup orientation="horizontal" className="flex-1">
                <ResizablePanel defaultSize={50} minSize={30}>
                  <div className="flex h-full flex-col overflow-hidden">
                    <AppHeader
                      title={headerTitle}
                      shortTitle={headerTitleShort}
                    />
                    <div className="relative flex flex-1 flex-col overflow-hidden min-h-0">
                      {showSettings ?
                        <SettingsView />
                      : appMode === "entertainment" ?
                        <EntertainmentThread />
                      : <Thread />}
                      <div id="chat-panel-portal" />
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={30}>
                  <div ref={workspaceRef} className="h-full" />
                </ResizablePanel>
              </ResizablePanelGroup>
            : <>
                {zen ? null : (
                  <AppHeader
                    title={headerTitle}
                    shortTitle={headerTitleShort}
                  />
                )}
                <div className="relative flex flex-1 flex-col overflow-hidden h-full">
                  {showSettings ?
                    <SettingsView />
                  : appMode === "entertainment" ?
                    <EntertainmentThread />
                  : <Thread />}
                  <div id="chat-panel-portal" />
                </div>
              </>
            }
          </SidebarInset>
        </SidebarProvider>
      </div>
    </SettingsProvider>
  );
}

/**
 * Main application component that provides the overall layout structure.
 * Manages the sidebar, main content area, and AI chat interface.
 */
function App() {
  // Suggestions state — populated via IPC from backend after each AI response
  const [suggestions, setSuggestions] = React.useState<
    readonly { prompt: string }[]
  >([]);

  // NOTE: App() builds the runtime and sits ABOVE AssistantRuntimeProvider, so
  // useAuiState can't be called here. The active thread id is read imperatively
  // from the runtime's thread store instead (runtime.threads.getState()), both
  // reactively (for the suggestions-clear effect below) and inside the
  // transport's async closures (headers / SSE callback) which can't use hooks.

  // runtimeRef lets the transport's async closures (headers / SSE callback)
  // read the active thread id imperatively. App() sits above the runtime
  // provider so useAuiState is unavailable here; the runtime object itself
  // exposes threads.getState().mainThreadId once constructed. The ref is
  // populated immediately after useRemoteThreadListRuntime returns.
  const runtimeRef = useRef<ReturnType<
    typeof useRemoteThreadListRuntime
  > | null>(null);

  // Create runtime with thread list support (persistence via REST backend)
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        transport: new AssistantChatTransport({
          api: `${getApiBase()}/chat`,
          headers: async () => {
            const {
              useBrowser,
              usePlannedBrowser,
              webSearch,
              deepResearch,
              quickSearch,
              enabledMcpServerIds,
            } = useUiStore.getState();
            // The runtime awaits initialize() before any send, so mainThreadId
            // is the stable server UUID by the time a request goes out.
            const sessionId =
              runtimeRef.current?.threads.getState().mainThreadId ?? "";
            return {
              "X-Use-Browser": String(useBrowser),
              "X-Use-Planned-Browser": String(usePlannedBrowser),
              "X-Web-Search": String(webSearch),
              "X-Deep-Research": String(deepResearch),
              "X-Quick-Search": String(quickSearch),
              "X-Session-Id": sessionId,
              "X-Mcp-Servers": enabledMcpServerIds.join(","),
            };
          },
          // The body must be reconstructed here — providing this hook replaces
          // the default body synthesis (which injects messages/trigger/
          // messageId), so we mirror that shape. The per-thread model override
          // (provider/model/params/systemPrompt) is resolved server-side from
          // the thread row — it is NOT injected here. Entertainment mode has no
          // chat composer; it drives the backend through the REST chapter
          // routes (chaptersStore), so every chat send targets /chat.
          prepareSendMessagesRequest: ({
            messages,
            body,
            headers,
            credentials,
            trigger,
            messageId,
          }) => ({
            body: {
              ...body,
              messages,
              trigger,
              messageId,
            },
            headers,
            credentials,
            api: `${getApiBase()}/chat`,
          }),
        }),
        adapters: {
          speech: new WebSpeechSynthesisAdapter(),
          attachments: new CompositeAttachmentAdapter([
            new SimpleImageAttachmentAdapter(),
            new UniversalFileAttachmentAdapter(),
          ]),
        },
        suggestions,
      }),
    adapter: backendThreadListAdapter,
  });
  runtimeRef.current = runtime;

  // Clear suggestions when the active thread changes. App() is above the runtime
  // provider, so subscribe to the runtime's thread store directly instead of
  // using useAuiState.
  useEffect(() => {
    return runtime.threads.subscribe(() => {
      setSuggestions([]);
    });
  }, [runtime]);

  // Listen for backend thread metadata updates and update tagStore directly
  useEffect(() => {
    return serverEvents.on("threads:metadataUpdated", (data) => {
      useTagStore
        .getState()
        .updateThreadTitle(data.threadId, data.title, data.tags);
    });
  }, []);

  // Listen for backend suggestion updates — only apply to the active thread.
  useEffect(() => {
    return serverEvents.on("threads:suggestionsUpdated", (data) => {
      if (data.threadId === runtimeRef.current?.threads.getState().mainThreadId) {
        setSuggestions(data.suggestions);
      }
    });
  }, []);

  // Configure assistant-ui with tools using the new Tools() API
  const aui = useAui({
    tools: Tools({ toolkit: frontendToolkit }),
  });

  return (
    <AssistantRuntimeProvider aui={aui} runtime={runtime}>
      {/* <ApprovalTool /> */}
      <AppContent />
    </AssistantRuntimeProvider>
  );
}

/**
 * Gate that shows the login screen (remote mode, unauthenticated) before the
 * app. In standalone mode, or for the loopback desktop owner, /auth/status
 * reports authenticated and the app renders immediately. The SSE push stream is
 * only opened once authenticated, so an unauthenticated browser doesn't hammer
 * /events with 401s.
 */
function AuthGate() {
  const [phase, setPhase] = useState<"checking" | "login" | "app">("checking");
  const sseStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getAuthStatus()
      .then((s) => {
        if (cancelled) return;
        logger.debug("auth status", s);
        setPhase(s.authRequired && !s.authenticated ? "login" : "app");
      })
      .catch((err) => {
        // Backend unreachable or not remote — let the app render normally.
        logger.warn("auth status check failed", err);
        if (!cancelled) setPhase("app");
      });

    const onUnauthorized = () => setPhase("login");
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (phase === "app" && !sseStarted.current) {
      sseStarted.current = true;
      serverEvents.connect();
    }
  }, [phase]);

  if (phase === "checking") return null;
  if (phase === "login") {
    return <LoginScreen onSuccess={() => setPhase("app")} />;
  }
  return <App />;
}

// Register the message listener once at application startup
serverEvents.on("app:message", handleAppMessage);

// Listen for split view activation from main process (internal link navigation)
serverEvents.on("splitview:activate", () => {
  // SplitView is an Electron-native view that can't exist in a browser page.
  if (!isNativeRenderer()) return;
  useUiStore.getState().setShowSplitView(true);
});

// Resolve the API base synchronously (read from the ?apiPort= search param, or
// fall back to same-origin relative URLs when served by the backend). Then open
// the SSE push stream; on reconnect (e.g. after dev hot-reload) refetch tags so
// any missed push events are reconciled against current server state.
initApiBase();
serverEvents.onReconnect(() => {
  void useTagStore.getState().fetchTags();
});
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthGate />
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>,
);
