import "./App.css";
import { SidebarLeft } from "@/components/side-bar/sidebar-left";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AssistantChatContainer } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
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
import { useState } from "react";
import { useThreadLifecycle } from "@/hooks/useThreadLifecycle";

/**
 * Inner app component that uses thread lifecycle hook.
 * This component must be inside AssistantRuntimeProvider to access the runtime.
 */
function AppContent() {
  const { showSettings, setShowSettings } = useUiStore();
  const [showSplitView, setShowSplitView] = useState(false);

  // Initialize thread lifecycle management
  useThreadLifecycle();


  return (
    <SettingsProvider>
      <div className="w-dvw flex flex-row h-dvh">
        <SidebarProvider>
          {showSettings ? <SettingsSidebar /> : <SidebarLeft />}
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
