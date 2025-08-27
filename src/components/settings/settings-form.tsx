import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  EyeIcon,
  EyeOffIcon,
  Save,
  TestTube,
  Loader2,
  Plus,
  Trash2,
  HelpCircle,
} from "lucide-react";
import { useSettings } from "./settings-context";
import type {
  SettingsState,
  TestConnectionConfig,
  OpenAICompatibleProviderConfig,
  AnthropicProviderConfig,
  TestConnectionResult,
} from "@shared/index";

interface SettingsFormProps {
  settings: SettingsState;
  onClose?: () => void;
}

export function SettingsForm({ settings, onClose }: SettingsFormProps) {
  const { updateSettings, addProvider, updateProvider, removeProvider } =
    useSettings();
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: {
      chat?: { success: boolean; message: string; error?: string };
      complex?: { success: boolean; message: string; error?: string };
      simple?: { success: boolean; message: string; error?: string };
    };
  } | null>(null);

  // Type guards for provider types
  const isOpenAIProvider = (
    provider: EditingProvider | null
  ): provider is OpenAICompatibleProviderConfig & { isNew?: boolean } => {
    return provider !== null && provider.provider === "openai-compatible";
  };

  const isAnthropicProvider = (
    provider: EditingProvider | null
  ): provider is AnthropicProviderConfig & { isNew?: boolean } => {
    return provider !== null && provider.provider === "anthropic";
  };

  // State for the form data of the provider being edited
  type EditingProvider =
    | (OpenAICompatibleProviderConfig & { isNew?: boolean })
    | (AnthropicProviderConfig & { isNew?: boolean });

  const [editingProvider, setEditingProvider] =
    useState<EditingProvider | null>(null);
  const [isAddingNewProvider, setIsAddingNewProvider] = useState(false);

  // State for model configurations
  const [chatModelConfig, setChatModelConfig] = useState({
    providerId: "",
    modelName: "",
  });

  const [simpleModelConfig, setSimpleModelConfig] = useState({
    providerId: "",
    modelName: "",
  });

  const [complexModelConfig, setComplexModelConfig] = useState({
    providerId: "",
    modelName: "",
  });

  const [useSameModelForAgents, setUseSameModelForAgents] = useState(false);

  // Update state when settings change
  useEffect(() => {
    if (settings?.modelConfigurations?.chat) {
      setChatModelConfig({
        providerId: settings.modelConfigurations.chat.providerId || "",
        modelName: settings.modelConfigurations.chat.modelName || "",
      });
    }

    if (settings?.modelConfigurations?.simple) {
      setSimpleModelConfig({
        providerId: settings.modelConfigurations.simple.providerId || "",
        modelName: settings.modelConfigurations.simple.modelName || "",
      });
    }

    if (settings?.modelConfigurations?.complex) {
      setComplexModelConfig({
        providerId: settings.modelConfigurations.complex.providerId || "",
        modelName: settings.modelConfigurations.complex.modelName || "",
      });
    }

    if (settings?.useSameModelForAgents !== undefined) {
      setUseSameModelForAgents(settings.useSameModelForAgents);
    }
  }, [settings]);

  const handleAddProvider = () => {
    setIsAddingNewProvider(true);
    setEditingProvider({
      id: `provider-${Date.now()}`,
      name: "New Provider",
      provider: "openai-compatible",
      apiUrl: "https://api.openai.com/v1",
      apiKey: "",
      isNew: true,
    } as EditingProvider);
  };

  const handleSaveProvider = async () => {
    if (!editingProvider) return;

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

  const handleTestAllModels = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const results: {
        chat?: TestConnectionResult;
        simple?: TestConnectionResult;
        complex?: TestConnectionResult;
      } = {};

      // Test chat model
      if (chatModelConfig.providerId && chatModelConfig.modelName) {
        const chatProvider = settings.providers.find(
          (p) => p.id === chatModelConfig.providerId
        );
        if (chatProvider) {
          const testConfig: TestConnectionConfig = {
            ...chatProvider,
            model: chatModelConfig.modelName,
          };
          results.chat = await window.ipcRenderer.invoke(
            "settings:test",
            testConfig
          );
        }
      }

      // Test agent models only if not using same model for agents
      if (!useSameModelForAgents) {
        // Test simple model
        if (simpleModelConfig.providerId && simpleModelConfig.modelName) {
          const simpleProvider = settings.providers.find(
            (p) => p.id === simpleModelConfig.providerId
          );
          if (simpleProvider) {
            const testConfig: TestConnectionConfig = {
              ...simpleProvider,
              model: simpleModelConfig.modelName,
            };
            results.simple = await window.ipcRenderer.invoke(
              "settings:test",
              testConfig
            );
          }
        }

        // Test complex model
        if (complexModelConfig.providerId && complexModelConfig.modelName) {
          const complexProvider = settings.providers.find(
            (p) => p.id === complexModelConfig.providerId
          );
          if (complexProvider) {
            const testConfig: TestConnectionConfig = {
              ...complexProvider,
              model: complexModelConfig.modelName,
            };
            results.complex = await window.ipcRenderer.invoke(
              "settings:test",
              testConfig
            );
          }
        }
      }

      const allSuccess = Object.values(results).every(
        (result) => result?.success
      );
      const anySuccess = Object.values(results).some(
        (result) => result?.success
      );

      setTestResult({
        success: allSuccess,
        message: allSuccess
          ? "All models tested successfully!"
          : anySuccess
          ? "Some models failed testing"
          : "All models failed testing",
        details: results,
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
      const newSettings = {
        ...settings,
        modelConfigurations: {
          chat: chatModelConfig,
          simple: simpleModelConfig,
          complex: complexModelConfig,
        },
        useSameModelForAgents,
      };
      await updateSettings(newSettings);
      onClose?.();
    } catch (error) {
      console.error("Failed to save model configurations:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if ((editingProvider || isAddingNewProvider) && editingProvider) {
    return (
      <div className="space-y-6">
        {editingProvider && (
          <div className="space-y-2">
            <Label htmlFor="provider-name">Provider Name</Label>
            <Input
              id="provider-name"
              value={editingProvider.name}
              onChange={(e) => {
                // Create a new object with the updated name, preserving the provider type
                if (isOpenAIProvider(editingProvider)) {
                  setEditingProvider({
                    ...editingProvider,
                    name: e.target.value,
                  });
                } else if (isAnthropicProvider(editingProvider)) {
                  setEditingProvider({
                    ...editingProvider,
                    name: e.target.value,
                  });
                }
              }}
              placeholder="e.g., OpenAI Production, Anthropic Dev"
            />
          </div>
        )}

        {editingProvider && (
          <Card>
            <CardHeader>
              <CardTitle>Provider Selection</CardTitle>
              <CardDescription>Choose your AI provider</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="provider-type">AI Provider</Label>
                <Select
                  value={editingProvider.provider}
                  onValueChange={(value: "openai-compatible" | "anthropic") => {
                    if (value === "openai-compatible") {
                      setEditingProvider({
                        id: editingProvider.id,
                        name: editingProvider.name,
                        provider: "openai-compatible",
                        apiUrl: "https://api.openai.com/v1",
                        apiKey: isOpenAIProvider(editingProvider)
                          ? editingProvider.apiKey || ""
                          : "",
                      });
                    } else if (value === "anthropic") {
                      setEditingProvider({
                        id: editingProvider.id,
                        name: editingProvider.name,
                        provider: "anthropic",
                        anthropicApiKey: isAnthropicProvider(editingProvider)
                          ? editingProvider.anthropicApiKey || ""
                          : "",
                      });
                    }
                  }}
                >
                  <SelectTrigger id="provider-type">
                    <SelectValue placeholder="Select a provider type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-compatible">
                      OpenAI Compatible
                    </SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>API Configuration</CardTitle>
            <CardDescription>
              {isOpenAIProvider(editingProvider)
                ? "Configure your OpenAI-compatible API endpoint and authentication"
                : "Configure your Anthropic API authentication"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isOpenAIProvider(editingProvider) && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="api-url">API URL</Label>
                  <Input
                    id="api-url"
                    value={editingProvider.apiUrl}
                    onChange={(e) => {
                      const updated = {
                        ...editingProvider,
                        apiUrl: e.target.value,
                      };
                      // Type guard to ensure we're working with the correct type
                      if (updated.provider === "openai-compatible") {
                        setEditingProvider(updated);
                      }
                    }}
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
                      onChange={(e) => {
                        const updated = {
                          ...editingProvider,
                          apiKey: e.target.value,
                        };
                        // Type guard to ensure we're working with the correct type
                        if (updated.provider === "openai-compatible") {
                          setEditingProvider(updated);
                        }
                      }}
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
            )}
            {isAnthropicProvider(editingProvider) && (
              <div className="space-y-2">
                <Label htmlFor="anthropic-api-key">Anthropic API Key</Label>
                <div className="relative">
                  <Input
                    id="anthropic-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={editingProvider.anthropicApiKey}
                    onChange={(e) => {
                      const updated = {
                        ...editingProvider,
                        anthropicApiKey: e.target.value,
                      };
                      // Type guard to ensure we're working with the correct type
                      if (updated.provider === "anthropic") {
                        setEditingProvider(updated);
                      }
                    }}
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

        <div className="flex justify-end gap-2">
          <Button onClick={handleSaveProvider} disabled={isLoading}>
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
          <CardDescription>Manage your AI providers</CardDescription>
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

            {(settings?.providers || []).map((provider) => (
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
          <CardTitle>Default Chat Model</CardTitle>
          <CardDescription>
            Configure the primary model used for general conversation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div className="w-[200px] min-w-[200px] max-w-[300px]">
                <Label htmlFor="chat-model-provider">Provider</Label>
                <Select
                  value={chatModelConfig.providerId}
                  onValueChange={(value) =>
                    setChatModelConfig({
                      ...chatModelConfig,
                      providerId: value,
                    })
                  }
                >
                  <SelectTrigger id="chat-model-provider">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(settings?.providers || []).map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-0 max-w-[400px]">
                <Label htmlFor="chat-model-name">Model Name</Label>
                <Input
                  id="chat-model-name"
                  value={chatModelConfig.modelName}
                  onChange={(e) =>
                    setChatModelConfig({
                      ...chatModelConfig,
                      modelName: e.target.value,
                    })
                  }
                  placeholder="e.g., gpt-4, claude-3-sonnet-20240229"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="use-same-model"
              checked={useSameModelForAgents}
              onCheckedChange={(checked) =>
                setUseSameModelForAgents(checked === true)
              }
            />
            <Label htmlFor="use-same-model" className="text-sm font-medium">
              Use the same model for agents
            </Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    When enabled, agents will use the chat model instead of
                    separate agent models. This simplifies configuration but may
                    not be optimal for specialized agent tasks.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      {!useSameModelForAgents && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Models</CardTitle>
            <CardDescription>
              Configure specialized models for different agent tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Label className="text-base">Simple Agent Model</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <HelpCircle className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        This model will be used for simple agent tasks like text
                        generation, basic analysis, and straightforward queries
                        that don't require complex reasoning or multi-step
                        processing.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="w-[200px] min-w-[200px] max-w-[300px]">
                  <Label htmlFor="simple-model-provider">Provider</Label>
                  <Select
                    value={simpleModelConfig.providerId}
                    onValueChange={(value) =>
                      setSimpleModelConfig({
                        ...simpleModelConfig,
                        providerId: value,
                      })
                    }
                  >
                    <SelectTrigger id="simple-model-provider">
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {(settings?.providers || []).map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1 min-w-0 max-w-[400px]">
                  <Label htmlFor="simple-model-name">Model Name</Label>
                  <Input
                    id="simple-model-name"
                    value={simpleModelConfig.modelName}
                    onChange={(e) =>
                      setSimpleModelConfig({
                        ...simpleModelConfig,
                        modelName: e.target.value,
                      })
                    }
                    placeholder="e.g., gpt-3.5-turbo, claude-3-haiku-20240307"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Label className="text-base">Complex Agent Model</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <HelpCircle className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        This model will be used for complex agent tasks
                        requiring advanced reasoning, multi-step problem
                        solving, creative writing, and sophisticated analysis
                        that benefits from more powerful AI capabilities.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="w-[200px] min-w-[200px] max-w-[300px]">
                  <Label htmlFor="complex-model-provider">Provider</Label>
                  <Select
                    value={complexModelConfig.providerId}
                    onValueChange={(value) =>
                      setComplexModelConfig({
                        ...complexModelConfig,
                        providerId: value,
                      })
                    }
                  >
                    <SelectTrigger id="complex-model-provider">
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {(settings?.providers || []).map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1 min-w-0 max-w-[400px]">
                  <Label htmlFor="complex-model-name">Model Name</Label>
                  <Input
                    id="complex-model-name"
                    value={complexModelConfig.modelName}
                    onChange={(e) =>
                      setComplexModelConfig({
                        ...complexModelConfig,
                        modelName: e.target.value,
                      })
                    }
                    placeholder="e.g., gpt-4, claude-3-sonnet-20240229"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={handleTestAllModels}
              disabled={
                isTesting ||
                !chatModelConfig.providerId ||
                (!useSameModelForAgents &&
                  !simpleModelConfig.providerId &&
                  !complexModelConfig.providerId)
              }
            >
              {isTesting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing Models...
                </>
              ) : (
                <>
                  <TestTube className="h-4 w-4 mr-2" />
                  Test Models
                </>
              )}
            </Button>

            <Button
              onClick={handleSaveModelConfigurations}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Configurations
                </>
              )}
            </Button>
          </div>

          {testResult && (
            <Card
              className={`mt-4 border-2 ${
                testResult.success
                  ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                  : "border-red-500 bg-red-50 dark:bg-red-950/20"
              }`}
            >
              <CardContent className="space-y-3">
                <p
                  className={`text-sm font-medium ${
                    testResult.success
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-700 dark:text-red-400"
                  }`}
                >
                  {testResult.success ? "✓ " : "✗ "}
                  {testResult.message}
                </p>
                {testResult.details?.chat && (
                  <p className="text-sm text-muted-foreground">
                    Chat Model: {testResult.details.chat.success ? "✓ " : "✗ "}
                    {testResult.details.chat.message}
                    {testResult.details.chat.error &&
                      ` (${testResult.details.chat.error})`}
                  </p>
                )}
                {testResult.details?.simple && (
                  <p className="text-sm text-muted-foreground">
                    Simple Agent Model:{" "}
                    {testResult.details.simple.success ? "✓ " : "✗ "}
                    {testResult.details.simple.message}
                    {testResult.details.simple.error &&
                      ` (${testResult.details.simple.error})`}
                  </p>
                )}
                {testResult.details?.complex && (
                  <p className="text-sm text-muted-foreground">
                    Complex Agent Model:{" "}
                    {testResult.details.complex.success ? "✓ " : "✗ "}
                    {testResult.details.complex.message}
                    {testResult.details.complex.error &&
                      ` (${testResult.details.complex.error})`}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
