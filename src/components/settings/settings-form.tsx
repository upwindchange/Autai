import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EyeIcon, EyeOffIcon, Save, TestTube } from "lucide-react";
import { useSettings } from "./settings-context";
import { SettingsProfile } from "./types";

interface SettingsFormProps {
  profile: SettingsProfile;
  onClose?: () => void;
}

export function SettingsForm({ profile, onClose }: SettingsFormProps) {
  const { updateProfile } = useSettings();
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    name: profile.name,
    apiUrl: profile.settings.apiUrl,
    apiKey: profile.settings.apiKey,
    complexModel: profile.settings.complexModel,
    simpleModel: profile.settings.simpleModel,
  });

  useEffect(() => {
    setFormData({
      name: profile.name,
      apiUrl: profile.settings.apiUrl,
      apiKey: profile.settings.apiKey,
      complexModel: profile.settings.complexModel,
      simpleModel: profile.settings.simpleModel,
    });
    setTestResult(null);
  }, [profile]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await updateProfile(profile.id, {
        name: formData.name,
        settings: {
          apiUrl: formData.apiUrl,
          apiKey: formData.apiKey,
          complexModel: formData.complexModel,
          simpleModel: formData.simpleModel,
        },
        updatedAt: new Date(),
      });
      onClose?.();
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTest = async () => {
    setIsLoading(true);
    setTestResult(null);
    try {
      const result = await window.ipcRenderer.invoke("settings:test", {
        apiUrl: formData.apiUrl,
        apiKey: formData.apiKey,
        model: formData.simpleModel,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Test failed",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="profile-name">Profile Name</Label>
        <Input
          id="profile-name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Production, Development"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API Configuration</CardTitle>
          <CardDescription>
            Configure your OpenAI-compatible API endpoint and authentication
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-url">API URL</Label>
            <Input
              id="api-url"
              value={formData.apiUrl}
              onChange={(e) =>
                setFormData({ ...formData, apiUrl: e.target.value })
              }
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showApiKey ? "text" : "password"}
                value={formData.apiKey}
                onChange={(e) =>
                  setFormData({ ...formData, apiKey: e.target.value })
                }
                placeholder="sk-..."
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model Selection</CardTitle>
          <CardDescription>
            Choose models for different complexity tasks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="complex-model">
              Complex Model (for sophisticated tasks)
            </Label>
            <Input
              id="complex-model"
              value={formData.complexModel}
              onChange={(e) =>
                setFormData({ ...formData, complexModel: e.target.value })
              }
              placeholder="gpt-4, claude-3-opus, etc."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="simple-model">
              Simple Model (for tool calling, quick responses)
            </Label>
            <Input
              id="simple-model"
              value={formData.simpleModel}
              onChange={(e) =>
                setFormData({ ...formData, simpleModel: e.target.value })
              }
              placeholder="gpt-3.5-turbo, claude-3-haiku, etc."
            />
          </div>
        </CardContent>
      </Card>

      {testResult && (
        <Card className={testResult.success ? "border-green-500" : "border-red-500"}>
          <CardContent className="pt-6">
            <p className={`text-sm ${testResult.success ? "text-green-600" : "text-red-600"}`}>
              {testResult.message}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={isLoading || !formData.apiKey || !formData.apiUrl}
        >
          <TestTube className="h-4 w-4 mr-2" />
          Test Connection
        </Button>
        <Button onClick={handleSave} disabled={isLoading}>
          <Save className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </div>
  );
}