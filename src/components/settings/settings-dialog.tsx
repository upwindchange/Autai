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
import { useSettings } from "./settings-context";
import { ViewDebugTools } from "@/components/debug/view-debug-tools";

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const { settings } = useSettings();
  
  // Check if debug tools are enabled
  const isDebugToolsEnabled = () => {
    const saved = localStorage.getItem("debugToolsEnabled");
    return saved ? JSON.parse(saved) : false;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            Configure your AI providers and model settings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4 overflow-y-auto flex-1">
          <SettingsForm
            settings={settings}
            onClose={() => setOpen(false)}
          />
          {isDebugToolsEnabled() && <ViewDebugTools />}
        </div>
      </DialogContent>
    </Dialog>
  );
}