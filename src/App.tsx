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
import { AppMessage } from "@shared/index";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Inner app component that uses thread lifecycle hook.
 * This component must be inside AssistantRuntimeProvider to access the runtime.
 */
function AppContent() {
  const { showSettings, setShowSettings } = useUiStore();
  const [showSplitView, setShowSplitView] = useState(false);

  // Initialize thread lifecycle management
  useThreadLifecycle();

  // Setup main process message listener
  useEffect(() => {
    const handleAppMessage = (event: unknown, message: AppMessage) => {
      console.log(message);
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
                    ×
                  </button>
                </Alert>
              </div>
            ),
            {
              duration: Infinity, // Never auto-dismiss
            }
          );
          break;
        case "info":
          toast.custom(
            (t) => (
              <div className="w-full">
                <Alert className="relative">
                  <Info className="h-4 w-4" />
                  <AlertTitle>{message.title}</AlertTitle>
                  <AlertDescription>{message.description}</AlertDescription>
                </Alert>
              </div>
            )
          );
          break;
        case "success":
          toast.custom(
            (t) => (
              <div className="w-full">
                <Alert className="relative">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>{message.title}</AlertTitle>
                  <AlertDescription>{message.description}</AlertDescription>
                </Alert>
              </div>
            )
          );
          break;
      }
    };

    window.ipcRenderer.on("app:message", handleAppMessage);

    return () => {
      window.ipcRenderer.off("app:message", handleAppMessage);
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
