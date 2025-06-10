import * as React from "react"
import {
  Sidebar,
  SidebarContent,
} from "@/components/ui/sidebar"

export function SidebarRight({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      collapsible="none"
      className="sticky top-0 hidden h-svh border-l lg:flex"
      {...props}
    >
      <SidebarContent>
      </SidebarContent>
    </Sidebar>
  )
}
