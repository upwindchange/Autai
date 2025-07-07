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
import { SettingsProvider } from "@/components/settings";

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewCleanupRefs = useRef<Record<string, () => void>>({});
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [selectedPageUrl, setSelectedPageUrl] = useState<string | null>(null);

  // Get container bounds with proper coordinates
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

  // Cleanup all views on unmount
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
            className="h-dvh sticky top-0"
          >
            <ChatInterface />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </SettingsProvider>
  );
}

export default App;
