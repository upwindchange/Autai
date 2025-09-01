import "./App.css";
import { SidebarLeft } from "@/components/side-bar/sidebar-left";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AssistantChatContainer } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { useUiStore } from "@/stores/uiStore";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { AppHeader } from "@/components/app-header";
import { useState, useEffect } from "react";
import { useThreadLifecycle } from "@/hooks/useThreadLifecycle";
import { toast } from "sonner";
import { MainProcessError } from "@shared/index";

/**
 * Inner app component that uses thread lifecycle hook.
 * This component must be inside AssistantRuntimeProvider to access the runtime.
 */
function AppContent() {
  const { showSettings, setShowSettings } = useUiStore();
  const [showSplitView, setShowSplitView] = useState(false);

  // Initialize thread lifecycle management
  useThreadLifecycle();

  // Setup main process error listener
  useEffect(() => {
    const handleMainError = (event: unknown, error: MainProcessError) => {
      toast.custom(
        (t) => (
          <div className="w-full">
            <div className="bg-destructive text-destructive-foreground rounded-lg border border-destructive/50 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-medium mb-1">
                    {error.type === "uncaughtException"
                      ? "Uncaught Exception"
                      : "Unhandled Rejection"}
                  </h4>
                  <p className="text-sm opacity-90">{error.message}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {new Date(error.timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={() => toast.dismiss(t)}
                  className="ml-4 text-destructive-foreground/70 hover:text-destructive-foreground"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ),
        {
          duration: 10000,
        }
      );
    };

    window.ipcRenderer.on("main:error", handleMainError);

    return () => {
      window.ipcRenderer.off("main:error", handleMainError);
    };
  }, []);

  return (
    <SettingsProvider>
      <div className="w-dvw flex flex-row h-dvh">
        <SidebarProvider>
          <SidebarLeft />
          <SidebarInset className="relative flex-1">
            <AppHeader
              title={showSettings ? "Settings" : "AI Assistant"}
              showSplitView={showSplitView}
              onToggleSplitView={() => setShowSplitView(!showSplitView)}
            />
            <div className="relative flex flex-1 flex-col overflow-hidden h-full">
              {showSettings ? (
                <SettingsView onClose={() => setShowSettings(false)} />
              ) : (
                <AssistantChatContainer showSplitView={showSplitView} />
              )}
            </div>
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
  // Create runtime for the entire app using AI SDK v5 with useChatRuntime
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "http://localhost:3001/chat", // Custom API URL with forwarding
    }),
    adapters: {
      attachments: new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
      ]),
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AppContent />
    </AssistantRuntimeProvider>
  );
}

export default App;
