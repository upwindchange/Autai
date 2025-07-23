import "./App.css";
import { SidebarLeft } from "@/components/sidebar-left";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { AssistantChatContainer } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { useAppStore } from "@/store/appStore";
import { useResizeObserverCleanup } from "@/hooks/use-cleanup";
import { InitializationError } from "@/components/InitializationError";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AppHeader } from "@/components/app-header";
import { useState } from "react";

/**
 * Inner app component that uses Zustand store
 */
function AppContent() {
  const {
    activeTaskId,
    showSettings,
    setShowSettings,
  } = useAppStore();
  
  // Ensure proper cleanup of ResizeObserver
  useResizeObserverCleanup();
  
  // Create runtime for the entire app
  const runtime = useChatRuntime({
    api: "http://localhost:3001/api/chat",
  });
  
  // Layout toggle state
  const [showSplitView, setShowSplitView] = useState(false);

  // Get selected page URL from active task/page
  const selectedPageUrl = useAppStore((state) => {
    if (!state.activeTaskId) return null;
    const task = state.tasks.get(state.activeTaskId);
    if (!task || !task.activePageId) return null;
    const page = task.pages.get(task.activePageId);
    return page?.url || null;
  });


  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="w-dvw flex flex-row h-dvh">
        <SidebarProvider>
          <SidebarLeft />
          <SidebarInset className="relative flex-1">
          <AppHeader
            title={showSettings
              ? "Settings"
              : selectedPageUrl || "AI Assistant"}
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
    </AssistantRuntimeProvider>
  );
}

/**
 * Main application component that provides the overall layout structure.
 * Manages the sidebar, main content area, and AI chat interface.
 */
function App() {
  return (
    <SettingsProvider>
      <InitializationError />
      <AppContent />
    </SettingsProvider>
  );
}

export default App;
