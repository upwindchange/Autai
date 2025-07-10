import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Settings2 } from "lucide-react";
import { SettingsForm } from "./settings-form";
import { ProfileSelector } from "./profile-selector";
import { useSettings } from "./settings-context";
import { useTasks } from "@/contexts";

const EMPTY_BOUNDS = { x: 0, y: 0, width: 0, height: 0 } as const;

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const { activeProfile } = useSettings();
  const { containerRef, state, setViewVisibility } = useTasks();
  const { activeViewKey } = state;

  const handleOpenChange = async (newOpen: boolean) => {
    if (!activeViewKey || !containerRef?.current) {
      setOpen(newOpen);
      return;
    }

    if (newOpen) {
      // Mark view as hidden and hide it
      setViewVisibility(true);
      await window.ipcRenderer.invoke("view:setBounds", activeViewKey, EMPTY_BOUNDS);
      setOpen(true);
    } else {
      setOpen(false);
      // Mark view as visible and restore it after dialog animation completes
      setViewVisibility(false);
      setTimeout(() => {
        const rect = containerRef.current!.getBoundingClientRect();
        const bounds = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        window.ipcRenderer.invoke("view:setBounds", activeViewKey, bounds);
      }, 100);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <SidebarMenuButton>
          <Settings2 />
          <span>Settings</span>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI Settings</DialogTitle>
          <DialogDescription>
            Configure your AI model settings and API endpoints.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <ProfileSelector />
          {activeProfile && (
            <SettingsForm
              profile={activeProfile}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}