import "./App.css";
import { SidebarLeft } from "@/components/side-bar/sidebar-left";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AssistantChatContainer } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { useUiStore } from "@/stores/uiStore";
import { useResizeObserverCleanup } from "@/hooks/use-cleanup";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AppHeader } from "@/components/app-header";
import { useState } from "react";

/**
 * Main application component that provides the overall layout structure.
 * Manages the sidebar, main content area, and AI chat interface.
 */
function App() {
  const { showSettings, setShowSettings } = useUiStore();

  // Ensure proper cleanup of ResizeObserver
  useResizeObserverCleanup();

  // Create runtime for the entire app
  const runtime = useChatRuntime({
    api: "http://localhost:3001/chat",
  });

  // Layout toggle state
  const [showSplitView, setShowSplitView] = useState(false);

  // TODO: Get selected page URL from new view system
  const selectedPageUrl = null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SettingsProvider>
        <div className="w-dvw flex flex-row h-dvh">
          <SidebarProvider>
            <SidebarLeft />
            <SidebarInset className="relative flex-1">
              <AppHeader
                title={
                  showSettings ? "Settings" : selectedPageUrl || "AI Assistant"
                }
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
    </AssistantRuntimeProvider>
  );
}

export default App;
