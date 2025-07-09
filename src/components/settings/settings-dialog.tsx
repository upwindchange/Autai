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

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [previousVisibleView, setPreviousVisibleView] = useState<string | null>(null);
  const { activeProfile } = useSettings();

  // Hide views when dialog opens, restore when closes
  useEffect(() => {
    const handleViewVisibility = async () => {
      if (open) {
        // Store current visible view
        const visibleView = await window.ipcRenderer.invoke("view:getVisible");
        setPreviousVisibleView(visibleView);
        // Hide all views
        await window.ipcRenderer.invoke("view:hideAll");
      } else if (previousVisibleView) {
        // Restore the previous visible view
        // We need to tell the sidebar to restore the view bounds
        window.ipcRenderer.send("restore-view", previousVisibleView);
        setPreviousVisibleView(null);
      }
    };

    handleViewVisibility();
  }, [open, previousVisibleView]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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