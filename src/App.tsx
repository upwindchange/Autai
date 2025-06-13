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

function App() {
  const viewContainerRef = useRef<HTMLDivElement>(null);
  const viewIdRef = useRef<number | null>(null);

  useEffect(() => {
    const container = viewContainerRef.current;
    if (!container) return;

    const createView = async () => {
      try {
        // Create new view
        const viewId = await window.electronView.createView({
          webPreferences: {},
        });
        viewIdRef.current = viewId;

        // Set initial bounds
        const rect = container.getBoundingClientRect();
        await window.electronView.setViewBounds(viewId, {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });

        // Load URL
        await window.electronView.loadViewUrl(viewId, "https://electronjs.org");
      } catch (error) {
        console.error("Failed to create view:", error);
      }
    };

    createView();

    // Handle resize events
    const resizeObserver = new ResizeObserver(() => {
      if (viewIdRef.current === null) return;

      const rect = container.getBoundingClientRect();
      window.electronView.setViewBounds(viewIdRef.current, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (viewIdRef.current !== null) {
        const electronView = (window as any).electronView;
        if (electronView) {
          electronView.removeView(viewIdRef.current);
        }
      }
    };
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
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem>
                        <BreadcrumbPage className="line-clamp-1">
                          Project Management & Task Tracking
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>
              </header>
              <div
                ref={viewContainerRef}
                className="flex flex-1 flex-col gap-4 p-4 overflow-y-auto h-full"
              ></div>
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
          <div>three</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
