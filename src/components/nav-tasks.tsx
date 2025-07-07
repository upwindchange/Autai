import { Trash2 } from "lucide-react";
import { z } from "zod";

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

/**
 * Navigation component that displays tasks as collapsible menu items.
 * Each task can contain multiple pages that can be selected.
 */
export function NavTasks({
  tasks,
  expandedIndex,
  onExpandChange,
  onTaskDelete,
  onPageSelect,
}: {
  tasks: {
    title: string;
    favicon: React.ReactNode;
    pages: {
      title: string;
      favicon: React.ReactNode;
      url: string;
    }[];
  }[];
  expandedIndex: number | null;
  onExpandChange: (index: number | null) => void;
  onTaskDelete: (index: number) => void;
  onPageSelect?: (taskIndex: number, pageIndex: number) => void;
}) {
  /**
   * Validates if a value is a valid URL string for favicon display
   */
  function isValidUrl(value: any): value is string {
    if (typeof value !== "string") return false;
    try {
      return z.string().url().safeParse(value).success;
    } catch {
      return false;
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Tasks</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {tasks.map((task, index) => (
            <Collapsible
              key={index}
              open={index === expandedIndex}
              onOpenChange={(open) => {
                if (open) {
                  onExpandChange(index);
                } else {
                  onExpandChange(null);
                }
              }}
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  onClick={() =>
                    onExpandChange(index === expandedIndex ? null : index)
                  }
                >
                  <a href="#">
                    <span>{task.favicon}</span>
                    <span>{task.title}</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuAction
                  showOnHover
                  onClick={() => onTaskDelete(index)}
                >
                  <Trash2 size={16} />
                </SidebarMenuAction>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {task.pages.map((page, pageIndex) => (
                      <SidebarMenuSubItem key={page.title}>
                        <SidebarMenuSubButton
                          asChild
                          onClick={() => onPageSelect?.(index, pageIndex)}
                        >
                          <a href="#">
                            {isValidUrl(page.favicon) ? (
                              <img
                                src={page.favicon}
                                alt="Favicon"
                                className="w-4 h-4"
                              />
                            ) : (
                              <span>{page.favicon}</span>
                            )}
                            <span>{page.title}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
