import { ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
} from "@/components/ui/sidebar"

export function NavTasks({
  tasks,
  expandedIndex,
  onExpandChange,
  onTaskDelete
}: {
  tasks: {
    name: string
    emoji: React.ReactNode
    pages: {
      name: string
      emoji: React.ReactNode
    }[]
  }[]
  expandedIndex: number | null
  onExpandChange: (index: number | null) => void
  onTaskDelete: (index: number) => void
}) {
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
                  onExpandChange(index)
                } else {
                  onExpandChange(null)
                }
              }}
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  onClick={() => onExpandChange(index === expandedIndex ? null : index)}
                >
                  <a href="#">
                    <span>{task.emoji}</span>
                    <span>{task.name}</span>
                  </a>
                </SidebarMenuButton>
                <SidebarMenuAction showOnHover onClick={() => onTaskDelete(index)}>
                  <Trash2 size={16} />
                </SidebarMenuAction>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {task.pages.map((page) => (
                      <SidebarMenuSubItem key={page.name}>
                        <SidebarMenuSubButton asChild>
                          <a href="#">
                            <span>{page.emoji}</span>
                            <span>{page.name}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton className="text-sidebar-foreground/70">
              <MoreHorizontal />
              <span>More</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
