import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EyeIcon, EyeOffIcon, Save, TestTube, Loader2 } from "lucide-react";
import { useSettings } from "./settings-context";
import type { SettingsProfile } from "@shared/index";

interface SettingsFormProps {
  profile: SettingsProfile;
  onClose?: () => void;
}

export function SettingsForm({ profile, onClose }: SettingsFormProps) {
  const { updateProfile } = useSettings();
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: {
      complex?: { success: boolean; message: string; error?: string };
      simple?: { success: boolean; message: string; error?: string };
    };
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
    setIsTesting(true);
    setTestResult(null);
    
    try {
      // Test both models
      const [simpleResult, complexResult] = await Promise.all([
        window.ipcRenderer.invoke("settings:test", {
          apiUrl: formData.apiUrl,
          apiKey: formData.apiKey,
          model: formData.simpleModel,
        }),
        window.ipcRenderer.invoke("settings:test", {
          apiUrl: formData.apiUrl,
          apiKey: formData.apiKey,
          model: formData.complexModel,
        })
      ]);
      
      const bothSuccessful = simpleResult?.success && complexResult?.success;
      
      setTestResult({
        success: bothSuccessful,
        message: bothSuccessful 
          ? "Both models tested successfully!" 
          : "One or more models failed to connect",
        details: {
          simple: simpleResult,
          complex: complexResult
        }
      });
    } catch (error) {
      console.error("Test connection error:", error);
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Test failed",
      });
    } finally {
      setIsTesting(false);
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
        <Card className={`border-2 ${testResult.success ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-red-500 bg-red-50 dark:bg-red-950/20"}`}>
          <CardContent className="pt-6 space-y-3">
            <p className={`text-sm font-medium ${testResult.success ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
              {testResult.success ? "✓ " : "✗ "}{testResult.message}
            </p>
            
            {testResult.details && (
              <div className="space-y-2 text-xs">
                <div className={`flex items-center gap-2 ${testResult.details.simple?.success ? "text-green-600" : "text-red-600"}`}>
                  <span className="font-medium">Simple Model ({formData.simpleModel}):</span>
                  <span>{testResult.details.simple?.success ? "✓" : "✗"}</span>
                  <span>{testResult.details.simple?.message}</span>
                </div>
                
                <div className={`flex items-center gap-2 ${testResult.details.complex?.success ? "text-green-600" : "text-red-600"}`}>
                  <span className="font-medium">Complex Model ({formData.complexModel}):</span>
                  <span>{testResult.details.complex?.success ? "✓" : "✗"}</span>
                  <span>{testResult.details.complex?.message}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={isLoading || isTesting || !formData.apiKey || !formData.apiUrl}
        >
          {isTesting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <TestTube className="h-4 w-4 mr-2" />
              Test Connection
            </>
          )}
        </Button>
        <Button onClick={handleSave} disabled={isLoading || isTesting}>
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}