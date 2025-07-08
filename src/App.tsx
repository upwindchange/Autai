import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";
import { SidebarLeft } from "@/components/sidebar-left";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
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
import { ChatInterface } from "@/components/ai";
import { ChatContainer } from "@/components/ai-chat";
import { SettingsProvider } from "@/components/settings";

/**
 * Main application component that provides the overall layout structure.
 * Manages the sidebar, main content area, and AI chat interface.
 */
function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewCleanupRefs = useRef<Record<string, () => void>>({});
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [selectedPageUrl, setSelectedPageUrl] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeViewKey, setActiveViewKey] = useState<string | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  /**
   * Calculates the bounds of the main content container for WebContentsView positioning
   */
  const getContainerBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0, width: 0, height: 0 };

    const rect = container.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, []);

  /**
   * Track active task ID based on expanded index
   */
  useEffect(() => {
    if (expandedIndex !== null && tasks[expandedIndex]) {
      setActiveTaskId(tasks[expandedIndex].id);
    } else {
      setActiveTaskId(null);
    }
  }, [expandedIndex, tasks]);

  /**
   * Listen for active view changes
   */
  useEffect(() => {
    const handleActiveViewChanged = (_event: any, viewKey: string) => {
      setActiveViewKey(viewKey);
    };

    window.ipcRenderer.on('active-view-changed', handleActiveViewChanged);
    
    return () => {
      window.ipcRenderer.off('active-view-changed', handleActiveViewChanged);
    };
  }, []);

  /**
   * Cleanup all WebContentsViews when the app unmounts
   */
  useEffect(() => {
    return () => {
      Object.values(viewCleanupRefs.current || {}).forEach((cleanupFn) =>
        cleanupFn()
      );
    };
  }, []);

  return (
    <SettingsProvider>
      <div className="w-dvw flex flex-row h-dvh">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={70}>
            <SidebarProvider>
              <SidebarLeft
                expandedIndex={expandedIndex}
                setExpandedIndex={setExpandedIndex}
                getContainerBounds={getContainerBounds}
                containerRef={containerRef}
                onPageSelect={setSelectedPageUrl}
                onTasksChange={setTasks}
              />
              <SidebarInset className="relative">
                <header className="bg-background sticky top-0 flex h-14 shrink-0 items-center gap-2">
                  <div className="flex flex-1 items-center gap-2 px-3">
                    <SidebarTrigger />
                    <Separator
                      orientation="vertical"
                      className="mr-2 data-[orientation=vertical]:h-4"
                    />
                    <Breadcrumb>
                      <BreadcrumbList>
                        <BreadcrumbItem>
                          <BreadcrumbPage className="line-clamp-1">
                            {selectedPageUrl ||
                              "Project Management & Task Tracking"}
                          </BreadcrumbPage>
                        </BreadcrumbItem>
                      </BreadcrumbList>
                    </Breadcrumb>
                  </div>
                </header>
                <div ref={containerRef} className="relative flex flex-1 flex-col gap-4 p-4 overflow-y-auto h-full" />
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
            <ChatContainer 
              taskId={activeTaskId}
              activeViewKey={activeViewKey}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </SettingsProvider>
  );
}

export default App;
