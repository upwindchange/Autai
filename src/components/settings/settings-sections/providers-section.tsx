import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useSettings } from "../settings-context";
import type { SettingsState } from "@shared/index";
import type { EditingProvider } from "../types";

interface ProvidersSectionProps {
  settings: SettingsState;
  editingProvider: EditingProvider | null;
  setEditingProvider: (provider: EditingProvider | null) => void;
}

export function ProvidersSection({ 
  settings, 
  editingProvider, 
  setEditingProvider 
}: ProvidersSectionProps) {
  const { removeProvider } = useSettings();

  const handleAddProvider = () => {
    setEditingProvider({
      id: `provider-${Date.now()}`,
      name: "New Provider",
      provider: "openai-compatible",
      apiUrl: "https://api.openai.com/v1",
      apiKey: "",
      isNew: true,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">AI Providers</h2>
        <p className="text-muted-foreground mt-1">
          Manage your AI provider configurations
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Configured Providers</CardTitle>
              <CardDescription>
                Add and manage AI providers for your models
              </CardDescription>
            </div>
            <Button onClick={handleAddProvider} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Provider
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {(settings?.providers || []).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No providers configured. Add your first provider to get started.
            </div>
          ) : (
            (settings?.providers || []).map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
              >
                <div>
                  <div className="font-medium">{provider.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {provider.provider} -{" "}
                    {"apiUrl" in provider ? provider.apiUrl : "Anthropic"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingProvider({ ...provider, isNew: false })}
                  >
                    Edit
                  </Button>
                  {(settings?.providers?.length || 0) > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeProvider(provider.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider Configuration Tips</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• OpenAI Compatible: Works with OpenAI, Azure OpenAI, and compatible APIs</p>
          <p>• Anthropic: For Claude models (claude-3-opus, claude-3-sonnet, etc.)</p>
          <p>• Keep your API keys secure and never share them</p>
          <p>• Test your configuration after adding or modifying providers</p>
        </CardContent>
      </Card>
    </div>
  );
}