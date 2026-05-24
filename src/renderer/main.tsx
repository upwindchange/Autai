import React from "react";
import ReactDOM from "react-dom/client";
import "@/i18n";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { AppMessage } from "@shared";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import log from "electron-log/renderer";
import { SidebarLeft } from "@/components/side-bar/sidebar-left";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Thread } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { useUiStore } from "@/stores/uiStore";
import { frontendToolkit } from "@/components/tools";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
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
import { useRef, useEffect } from "react";
import { useSessionLifecycle, useTabVisibility } from "@/hooks";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { WorkspaceWelcome } from "@/components/ai-chat/workspace-welcome";
import { useTagStore } from "@/stores/tagStore";
import type { TagRow } from "@shared/tag";
import { useRemoteThreadListRuntime } from "@assistant-ui/react";
import { backendThreadListAdapter } from "@/adapters/backendThreadListAdapter";
import { initApiBase, getApiBase } from "@/lib/api";

import "./index.css";
import "./demos/ipc";

const logger = log.scope("Main");

// Main process message handler
const handleAppMessage = (_event: unknown, message: AppMessage) => {
  logger.debug("app message received", {
    type: message.type,
    title: message.title,
  });
  switch (message.type) {
    case "alert":
      // Persistent alert with dismiss button
      toast.custom(
        (t) => (
          <div className="w-full">
            <Alert variant="destructive" className="relative">
              <AlertCircle className="h-4 w-4" />
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
    case "info":
      toast.custom(() => (
        <div className="w-full">
          <Alert className="relative">
            <Info className="h-4 w-4" />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        </div>
      ));
      break;
    case "success":
      toast.custom(() => (
        <div className="w-full">
          <Alert className="relative">
            <CheckCircle2 className="h-4 w-4" />
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
  const {
    showSettings,
    showSplitView,
    setContainerRef,
    setContainerBounds,
  } = useUiStore();
  const currentRemoteId = useAuiState((s) => s.threadListItem.remoteId);
  const threadTitle = useTagStore((s) =>
    currentRemoteId ?
      (s.threads.find((th) => th.remoteId === currentRemoteId)?.title ?? null)
    : null,
  );

  // Initialize thread lifecycle management
  useSessionLifecycle();

  // Sync tab visibility with container state (moved from Thread)
  useTabVisibility();

  // Switch to settings-session when settings opens, switch back to thread when closed
  const mainTabId = useAuiState(({ threads }) => threads.mainThreadId);
  useEffect(() => {
    if (showSettings) {
      window.ipcRenderer.send("sessiontab:switched", "settings-session");
    } else if (mainTabId) {
      window.ipcRenderer.send("sessiontab:switched", mainTabId);
    }
  }, [showSettings, mainTabId]);

  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSplitView && workspaceRef.current) {
      setContainerRef(workspaceRef.current);

      const resizeObserver = new ResizeObserver(() => {
        if (workspaceRef.current) {
          const { width, height, x, y } =
            workspaceRef.current.getBoundingClientRect();
          setContainerBounds({ width, height, x, y });
        }
      });
      resizeObserver.observe(workspaceRef.current);

      return () => {
        resizeObserver.disconnect();
        setContainerRef(null);
        setContainerBounds(null);
      };
    } else {
      setContainerRef(null);
      setContainerBounds(null);
      return undefined;
    }
  }, [showSplitView, setContainerRef, setContainerBounds]);

  const headerTitle =
    showSettings ?
      t("header.settings")
    : (threadTitle ?? `${t("app.title")} ${t("header.aiAssistant")}`);

  return (
    <SettingsProvider>
      <div className="w-dvw flex flex-row h-dvh">
        <SidebarProvider>
          {showSettings ?
            <SettingsSidebar />
          : <SidebarLeft />}
          <SidebarInset className="relative flex-1">
            {showSplitView ?
              <ResizablePanelGroup orientation="horizontal" className="flex-1">
                <ResizablePanel defaultSize={50} minSize={30}>
                  <div className="flex h-full flex-col overflow-hidden">
                    <AppHeader title={headerTitle} />
                    <div className="relative flex flex-1 flex-col overflow-hidden min-h-0">
                      {showSettings ?
                        <SettingsView />
                      : <Thread />}
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={30}>
                  <div
                    ref={workspaceRef}
                    className="h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground overflow-auto"
                  >
                    <WorkspaceWelcome />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            : <>
                <AppHeader title={headerTitle} />
                <div className="relative flex flex-1 flex-col overflow-hidden h-full">
                  {showSettings ?
                    <SettingsView />
                  : <Thread />}
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
  // Create runtime with thread list support (persistence via REST backend)
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        transport: new AssistantChatTransport({
          api: `${getApiBase()}/chat`,
          headers: async () => {
            const { useBrowser, webSearch, deepResearch, quickSearch, sessionId } = useUiStore.getState();
            return {
              "X-Use-Browser": String(useBrowser),
              "X-Web-Search": String(webSearch),
              "X-Deep-Research": String(deepResearch),
              "X-Quick-Search": String(quickSearch),
              "X-Session-Id": sessionId || "",
            };
          },
        }),
        adapters: {
          speech: new WebSpeechSynthesisAdapter(),
          attachments: new CompositeAttachmentAdapter([
            new SimpleImageAttachmentAdapter(),
            new SimpleTextAttachmentAdapter(),
          ]),
        },
      }),
    adapter: backendThreadListAdapter,
  });

  // Listen for backend thread metadata updates and update tagStore directly
  useEffect(() => {
    const handler = (_event: unknown, ...args: unknown[]) => {
      const data = args[0] as {
        threadId: string;
        title: string;
        tags?: TagRow[];
      };
      useTagStore
        .getState()
        .updateThreadTitle(data.threadId, data.title, data.tags);
    };
    window.ipcRenderer.on("threads:metadataUpdated", handler);
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

// Register the message listener once at application startup
window.ipcRenderer.on("app:message", handleAppMessage);

// Listen for split view activation from main process (internal link navigation)
window.ipcRenderer.on("splitview:activate", () => {
  useUiStore.getState().setShowSplitView(true);
});

initApiBase().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <App />
        <Toaster />
      </ThemeProvider>
    </React.StrictMode>,
  );
});
