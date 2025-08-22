import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EyeIcon, EyeOffIcon, Save, TestTube, Loader2, Plus, Trash2 } from "lucide-react";
import { useSettings } from "./settings-context";
import type { SettingsState } from "@shared/index";

interface SettingsFormProps {
  settings: SettingsState;
  onClose?: () => void;
}

export function SettingsForm({ settings, onClose }: SettingsFormProps) {
  const { updateSettings, addProvider, updateProvider, removeProvider, updateModelConfiguration } = useSettings();
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

  // State for the form data of the provider being edited
  const [editingProvider, setEditingProvider] = useState<any>(null);
  const [isAddingNewProvider, setIsAddingNewProvider] = useState(false);
  
  // State for model configurations
  const [simpleModelConfig, setSimpleModelConfig] = useState({
    providerId: "",
    modelName: ""
  });
  
  const [complexModelConfig, setComplexModelConfig] = useState({
    providerId: "",
    modelName: ""
  });

  // Update state when settings change
  useEffect(() => {
    if (settings?.modelConfigurations?.simple) {
      setSimpleModelConfig({
        providerId: settings.modelConfigurations.simple.providerId || "",
        modelName: settings.modelConfigurations.simple.modelName || ""
      });
    }
    
    if (settings?.modelConfigurations?.complex) {
      setComplexModelConfig({
        providerId: settings.modelConfigurations.complex.providerId || "",
        modelName: settings.modelConfigurations.complex.modelName || ""
      });
    }
  }, [settings]);

  // Simple state for debug tools - independent of providers
  const [debugToolsEnabled, setDebugToolsEnabled] = useState(() => {
    // Load from localStorage or default to false
    const saved = localStorage.getItem("debugToolsEnabled");
    return saved ? JSON.parse(saved) : false;
  });

  const toggleDebugTools = () => {
    const newValue = !debugToolsEnabled;
    setDebugToolsEnabled(newValue);
    localStorage.setItem("debugToolsEnabled", JSON.stringify(newValue));
  };

  const handleAddProvider = () => {
    setIsAddingNewProvider(true);
    setEditingProvider({
      id: `provider-${Date.now()}`,
      name: "New Provider",
      provider: "openai-compatible",
      apiUrl: "https://api.openai.com/v1",
      apiKey: "",
      anthropicApiKey: "",
    });
  };

  const handleSaveProvider = async () => {
    setIsLoading(true);
    try {
      if (isAddingNewProvider) {
        await addProvider(editingProvider);
        setIsAddingNewProvider(false);
      } else {
        await updateProvider(editingProvider.id, editingProvider);
      }
      setEditingProvider(null);
    } catch (error) {
      console.error("Failed to save provider:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTest = async (providerId: string, modelName: string) => {
    const provider = settings.providers.find(p => p.id === providerId);
    if (!provider) return;
    
    setIsTesting(true);
    setTestResult(null);
    
    try {
      let testConfig: any;
      
      if (provider.provider === 'openai-compatible') {
        testConfig = {
          id: provider.id,
          name: provider.name,
          provider: 'openai-compatible',
          apiUrl: (provider as any).apiUrl,
          apiKey: (provider as any).apiKey,
          model: modelName,
        };
      } else if (provider.provider === 'anthropic') {
        testConfig = {
          id: provider.id,
          name: provider.name,
          provider: 'anthropic',
          anthropicApiKey: (provider as any).anthropicApiKey,
          model: modelName,
        };
      } else {
        throw new Error(`Unsupported provider: ${(provider as any).provider}`);
      }

      const result: any = await window.ipcRenderer.invoke("settings:test", testConfig);
      
      setTestResult({
        success: result?.success || false,
        message: result?.success 
          ? "Model tested successfully!" 
          : "Model test failed",
        details: {
          simple: result
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

  const handleSaveModelConfigurations = async () => {
    setIsLoading(true);
    try {
      // Update both configurations at once to avoid race conditions
      const newSettings = {
        ...settings,
        modelConfigurations: {
          simple: simpleModelConfig,
          complex: complexModelConfig
        }
      };
      await updateSettings(newSettings);
      onClose?.();
    } catch (error) {
      console.error("Failed to save model configurations:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (editingProvider || isAddingNewProvider) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="provider-name">Provider Name</Label>
          <Input
            id="provider-name"
            value={editingProvider.name}
            onChange={(e) => setEditingProvider({ ...editingProvider, name: e.target.value })}
            placeholder="e.g., OpenAI Production, Anthropic Dev"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Provider Selection</CardTitle>
            <CardDescription>
              Choose your AI provider
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">AI Provider</Label>
              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant={editingProvider.provider === 'openai-compatible' ? 'default' : 'outline'}
                  onClick={() => setEditingProvider({ 
                    ...editingProvider, 
                    provider: 'openai-compatible',
                    apiUrl: 'https://api.openai.com/v1',
                    apiKey: editingProvider.apiKey || '',
                    anthropicApiKey: ''
                  })}
                  className="h-12"
                >
                  OpenAI Compatible
                </Button>
                <Button
                  variant={editingProvider.provider === 'anthropic' ? 'default' : 'outline'}
                  onClick={() => setEditingProvider({ 
                    ...editingProvider, 
                    provider: 'anthropic',
                    apiUrl: '',
                    apiKey: '',
                    anthropicApiKey: editingProvider.anthropicApiKey || ''
                  })}
                  className="h-12"
                >
                  Anthropic
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API Configuration</CardTitle>
            <CardDescription>
              {editingProvider.provider === 'openai-compatible' 
                ? "Configure your OpenAI-compatible API endpoint and authentication"
                : "Configure your Anthropic API authentication"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingProvider.provider === 'openai-compatible' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="api-url">API URL</Label>
                  <Input
                    id="api-url"
                    value={editingProvider.apiUrl}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, apiUrl: e.target.value })
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
                      value={editingProvider.apiKey}
                      onChange={(e) =>
                        setEditingProvider({ ...editingProvider, apiKey: e.target.value })
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
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="anthropic-api-key">Anthropic API Key</Label>
                <div className="relative">
                  <Input
                    id="anthropic-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={editingProvider.anthropicApiKey}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, anthropicApiKey: e.target.value })
                    }
                    placeholder="sk-ant-..."
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
            )}
          </CardContent>
        </Card>

        {testResult && (
          <Card className={`border-2 ${testResult.success ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-red-500 bg-red-50 dark:bg-red-950/20"}`}>
            <CardContent className="pt-6 space-y-3">
              <p className={`text-sm font-medium ${testResult.success ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                {testResult.success ? "✓ " : "✗ "}{testResult.message}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => handleTest(editingProvider.id, "test-model")}
            disabled={isLoading || isTesting || 
              (editingProvider.provider === 'openai-compatible' && (!editingProvider.apiKey || !editingProvider.apiUrl)) ||
              (editingProvider.provider === 'anthropic' && !editingProvider.anthropicApiKey)}
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
          <Button onClick={handleSaveProvider} disabled={isLoading || isTesting}>
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
          <Button variant="outline" onClick={() => setEditingProvider(null)}>
            Back to List
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
          <CardDescription>
            Manage your AI providers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">Configured Providers</h3>
              <Button onClick={handleAddProvider} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </div>
            
            {(settings?.providers || []).map((provider: any) => (
              <div 
                key={provider.id} 
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
              >
                <div>
                  <div className="font-medium">{provider.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {provider.provider} - {(provider as any).apiUrl || "Anthropic"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      setEditingProvider(provider);
                      setIsAddingNewProvider(false);
                    }}
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
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model Configuration</CardTitle>
          <CardDescription>
            Configure which provider and model to use for different tasks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="simple-model-provider">Simple Model Provider</Label>
              <Select 
                value={simpleModelConfig.providerId} 
                onValueChange={(value) => setSimpleModelConfig({...simpleModelConfig, providerId: value})}
              >
                <SelectTrigger id="simple-model-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {(settings?.providers || []).map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="simple-model-name">Simple Model Name</Label>
              <Input
                id="simple-model-name"
                value={simpleModelConfig.modelName}
                onChange={(e) => setSimpleModelConfig({...simpleModelConfig, modelName: e.target.value})}
                placeholder="e.g., gpt-3.5-turbo, claude-3-haiku-20240307"
              />
            </div>
          </div>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="complex-model-provider">Complex Model Provider</Label>
              <Select 
                value={complexModelConfig.providerId} 
                onValueChange={(value) => setComplexModelConfig({...complexModelConfig, providerId: value})}
              >
                <SelectTrigger id="complex-model-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {(settings?.providers || []).map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="complex-model-name">Complex Model Name</Label>
                <Input
                  id="complex-model-name"
                  value={complexModelConfig.modelName}
                  onChange={(e) => setComplexModelConfig({...complexModelConfig, modelName: e.target.value})}
                  placeholder="e.g., gpt-4, claude-3-sonnet-20240229"
                />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Debug Tools</CardTitle>
          <CardDescription>
            Enable debugging tools for development and troubleshooting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="enable-debug-tools">Enable Debug Tools</Label>
              <p className="text-sm text-muted-foreground">
                Toggle debugging features for development purposes
              </p>
            </div>
            <Button 
              variant={debugToolsEnabled ? "default" : "outline"}
              onClick={toggleDebugTools}
            >
              {debugToolsEnabled ? "Enabled" : "Enable Debug Tools"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSaveModelConfigurations} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Model Configurations
            </>
          )}
        </Button>
      </div>
    </div>
  );
}