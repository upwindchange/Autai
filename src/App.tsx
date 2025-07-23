import "./App.css";
import { SidebarLeft } from "@/components/sidebar-left";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AssistantChatContainer } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { useAppStore } from "@/store/appStore";
import { useResizeObserverCleanup } from "@/hooks/use-cleanup";
import { InitializationError } from "@/components/InitializationError";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";

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
          <header className="bg-background sticky top-0 flex h-14 shrink-0 items-center gap-2">
            <div className="flex flex-1 items-center gap-2 px-3">
              <SidebarTrigger />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
              <div className="flex-1">
                {showSettings
                  ? "Settings"
                  : selectedPageUrl || "Project Management & Task Tracking"}
              </div>
            </div>
          </header>
          <div className="relative flex flex-1 flex-col overflow-hidden h-full">
            {showSettings ? (
              <SettingsView onClose={() => setShowSettings(false)} />
            ) : (
              <AssistantChatContainer />
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
