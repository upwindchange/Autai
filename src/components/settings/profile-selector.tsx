import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useSettings } from "./settings-context";
import type { AISettings } from "@shared/settings";

export function ProfileSelector() {
  const {
    profiles,
    activeProfile,
    createProfile,
    deleteProfile,
    setActiveProfile,
  } = useSettings();
  const [isCreating, setIsCreating] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;

    const defaultSettings: AISettings = {
      apiUrl: "https://api.openai.com/v1",
      apiKey: "",
      complexModel: "gpt-4",
      simpleModel: "gpt-3.5-turbo",
    };

    await createProfile(newProfileName.trim(), defaultSettings);
    setNewProfileName("");
    setIsCreating(false);
  };

  const canDelete = profiles.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium mb-2 block">
            Settings Profile
          </label>
          <Select value={activeProfile?.id} onValueChange={setActiveProfile}>
            <SelectTrigger>
              <SelectValue placeholder="Select a profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Profiles</SelectLabel>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {!isCreating && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsCreating(true)}
            className="mt-6"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}

        {activeProfile && canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="mt-6">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Profile</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{activeProfile.name}"? This
                  action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteProfile(activeProfile.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {isCreating && (
        <div className="flex gap-2">
          <Input
            placeholder="New profile name"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateProfile();
              if (e.key === "Escape") {
                setIsCreating(false);
                setNewProfileName("");
              }
            }}
            autoFocus
          />
          <Button onClick={handleCreateProfile} size="sm">
            Create
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsCreating(false);
              setNewProfileName("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
