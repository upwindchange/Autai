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
import GenAI from "@/components/genai/genai";

// Define task interfaces for App state
export interface PageItem {
  title: string;
  url: string;
  favicon: React.ReactNode;
}

export interface TaskItem {
  title: string;
  favicon: React.ReactNode;
  pages: PageItem[];
}

function App() {
  const viewContainerRef = useRef<HTMLDivElement>(null);
  const [activeViewKey, setActiveViewKey] = useState<string | null>(null);
  const viewCleanupRefs = useRef<Record<string, () => void>>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Get container bounds with proper coordinates
  const getContainerBounds = useCallback(() => {
    const container = viewContainerRef.current;
    if (!container) return { x: 0, y: 0, width: 0, height: 0 };
    
    const rect = container.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, []);

  // Handle view creation and bounds update
  const createView = useCallback(async (key: string, url: string) => {
    const container = viewContainerRef.current;
    if (!container) return;

    try {
      console.log(`Creating view for key: ${key}`);
      await window.ipcRenderer.invoke("view:create", key, {
        webPreferences: {},
      });

      // Set initial bounds
      await window.ipcRenderer.invoke("view:setBounds", key, getContainerBounds());
      
      // Load URL
      await window.ipcRenderer.invoke("nav:loadURL", key, url);
      
      // Setup resize observer
      const resizeObserver = new ResizeObserver(() => {
        window.ipcRenderer.invoke("view:setBounds", key, getContainerBounds());
      });
      resizeObserver.observe(container);

      // Store cleanup function
      viewCleanupRefs.current[key] = () => {
        resizeObserver.disconnect();
        window.ipcRenderer.invoke("view:remove", key);
      };

      console.log(`Created view for key: ${key}`);
    } catch (error) {
      console.error(`Failed to create view ${key}:`, error);
    }
  }, [getContainerBounds]);

  // Handle page selection
  const handlePageSelect = useCallback(async (taskIndex: number, pageIndex: number) => {
    const key = `${taskIndex}-${pageIndex}`;
    
    // Ensure view exists (should be pre-created)
    if (!viewCleanupRefs.current[key]) {
      console.error(`View ${key} not found!`);
      return;
    }

    // Hide all views except the active one
    Object.keys(viewCleanupRefs.current || {}).forEach(viewKey => {
      if (viewKey !== key) {
        window.ipcRenderer.invoke("view:setBounds", viewKey, {
          x: 0,
          y: 0,
          width: 0,
          height: 0
        });
      }
    });

    // Show active view with proper coordinates
    window.ipcRenderer.invoke("view:setBounds", key, getContainerBounds());

    setActiveViewKey(key);
  }, []);

  // Create views for all pages when tasks change
  useEffect(() => {
    const createAllViews = async () => {
      const promises = [];
      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
        const task = tasks[taskIndex];
        for (let pageIndex = 0; pageIndex < task.pages.length; pageIndex++) {
          const page = task.pages[pageIndex];
          const key = `${taskIndex}-${pageIndex}`;
          if (!viewCleanupRefs.current[key]) {
            promises.push(createView(key, page.url));
          }
        }
      }
      await Promise.all(promises);
    };

    createAllViews();
  }, [tasks, createView]);

  // Cleanup all views on unmount
  useEffect(() => {
    return () => {
      Object.values(viewCleanupRefs.current || {}).forEach(cleanupFn => cleanupFn());
    };
  }, []);

  const handleTaskDelete = useCallback((index: number) => {
    // Clean up views for this task
    tasks[index].pages.forEach((_, pageIndex) => {
      const key = `${index}-${pageIndex}`;
      window.ipcRenderer?.invoke("view:remove", key);
    });
    
    setTasks(prev => prev.filter((_, i) => i !== index));
    
    // Update expanded index
    if (expandedIndex === index) {
      setExpandedIndex(null);
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  }, [tasks, expandedIndex]);

  return (
    <div className="w-dvw flex flex-row h-dvh">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={70}>
          <SidebarProvider>
            <SidebarLeft
              tasks={tasks}
              setTasks={setTasks}
              expandedIndex={expandedIndex}
              setExpandedIndex={setExpandedIndex}
              onTaskDelete={handleTaskDelete}
              onPageSelect={handlePageSelect}
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
              />
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
