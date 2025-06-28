import { Trash2 } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
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
  onTaskDelete,
  onPageSelect
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
  onPageSelect?: (taskIndex: number, pageIndex: number) => void
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
                    {task.pages.map((page, pageIndex) => (
                      <SidebarMenuSubItem key={page.name}>
                        <SidebarMenuSubButton
                          asChild
                          onClick={() => onPageSelect?.(index, pageIndex)}
                        >
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
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
