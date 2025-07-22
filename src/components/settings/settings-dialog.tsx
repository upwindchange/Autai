import { useState } from "react";
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
import { useViewVisibility } from "@/hooks/use-view-visibility";

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const { activeProfile } = useSettings();
  const { hideView, showView, hasActiveView } = useViewVisibility();

  const handleOpenChange = (newOpen: boolean) => {
    if (!hasActiveView) {
      setOpen(newOpen);
      return;
    }

    if (newOpen) {
      // Hide view immediately when dialog opens
      hideView();
      setOpen(true);
    } else {
      setOpen(false);
      // Show view after dialog animation completes
      showView(100);
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>AI Settings</DialogTitle>
          <DialogDescription>
            Configure your AI model settings and API endpoints.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4 overflow-y-auto flex-1">
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