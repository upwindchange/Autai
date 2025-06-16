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
import GenAI from "@/components/genai/genai";

function App() {
  const viewContainerRef = useRef<HTMLDivElement>(null);
  const viewIdRef = useRef<number | null>(null);

  useEffect(() => {
    console.log("Running useEffect for view creation");
    const container = viewContainerRef.current;
    if (!container) return;

    const createView = async () => {
      try {
        console.log("Creating new WebContentsView");
        const viewId = await window.ipcRenderer.invoke("view:create", {
          webPreferences: {},
        });
        viewIdRef.current = viewId;
        console.log(`Created view with ID: ${viewId}`);

        const updateBounds = () => {
          const rect = container.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        };

        // Set initial bounds
        await window.ipcRenderer.invoke(
          "view:setBounds",
          viewId,
          updateBounds()
        );
        console.log("Set initial bounds for view");

        // Load URL using IPC
        await window.ipcRenderer.invoke(
          "nav:loadURL",
          viewId,
          "https://electronjs.org"
        );
        console.log("Loaded URL in view");

        // Setup resize observer
        const resizeObserver = new ResizeObserver(() => {
          window.ipcRenderer.invoke("view:setBounds", viewId, updateBounds());
        });
        resizeObserver.observe(container);

        return () => {
          console.log("Running view cleanup");
          resizeObserver.disconnect();
          window.ipcRenderer.invoke("view:remove", viewId);
          console.log(`Removed view with ID: ${viewId}`);
        };
      } catch (error) {
        console.error("Failed to create view:", error);
      }
    };

    const viewCleanup = createView();

    return () => {
      console.log("Running useEffect cleanup");
      viewCleanup.then((cleanupFn) => cleanupFn?.());
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
          <GenAI />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
