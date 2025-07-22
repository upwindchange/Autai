import { useEffect, useRef } from "react";
import "./App.css";
import { SidebarLeft } from "@/components/sidebar-left";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { AssistantChatContainer } from "@/components/ai-chat";
import { SettingsProvider, SettingsView } from "@/components/settings";
import { useAppStore } from "@/store/appStore";
import { useResizeObserverCleanup } from "@/hooks/use-cleanup";
import { InitializationError } from "@/components/InitializationError";

/**
 * Inner app component that uses Zustand store
 */
function AppContent() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const {
    activeTaskId,
    setContainerRef,
    showSettings,
    setShowSettings,
  } = useAppStore();
  
  // Ensure proper cleanup of ResizeObserver
  useResizeObserverCleanup();

  // Get selected page URL from active task/page
  const selectedPageUrl = useAppStore((state) => {
    if (!state.activeTaskId) return null;
    const task = state.tasks.get(state.activeTaskId);
    if (!task || !task.activePageId) return null;
    const page = task.pages.get(task.activePageId);
    return page?.url || null;
  });

  /**
   * Set the container ref in the store when it's available
   */
  useEffect(() => {
    setContainerRef(containerRef);
  }, [setContainerRef]);
  
  /**
   * Force update bounds when container is mounted
   */
  useEffect(() => {
    // Small delay to ensure DOM is fully rendered
    const timer = setTimeout(() => {
      if (containerRef.current) {
        useAppStore.getState().updateContainerBounds();
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-dvw flex flex-row h-dvh">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={70}>
          <SidebarProvider>
            <SidebarLeft />
            <SidebarInset className="relative">
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
              <div
                ref={containerRef}
                className="relative flex flex-1 flex-col overflow-hidden h-full"
              >
                {showSettings && (
                  <SettingsView onClose={() => setShowSettings(false)} />
                )}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          defaultSize={30}
          minSize={15}
          maxSize={75}
          className="h-full overflow-hidden"
        >
          <AssistantChatContainer taskId={activeTaskId} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
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
