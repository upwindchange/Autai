import { useEffect, useRef } from "react";
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
import { ChatContainer } from "@/components/ai-chat";
import { SettingsProvider } from "@/components/settings";
import { TasksProvider, useTasks } from "@/contexts";

/**
 * Inner app component that uses TasksContext
 */
function AppContent() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { selectedPageUrl, activeTaskId, activeViewKey, setContainerRef } =
    useTasks();

  /**
   * Set the container ref in the TasksContext when it's available
   */
  useEffect(() => {
    setContainerRef(containerRef);
  }, [setContainerRef]);

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
              <div
                ref={containerRef}
                className="relative flex flex-1 flex-col gap-4 p-4 overflow-y-auto h-full"
              />
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
          <ChatContainer taskId={activeTaskId} activeViewKey={activeViewKey} />
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
      <TasksProvider>
        <AppContent />
      </TasksProvider>
    </SettingsProvider>
  );
}

export default App;
