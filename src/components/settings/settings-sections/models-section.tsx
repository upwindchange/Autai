import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle, TestTube, Save, Loader2 } from "lucide-react";
import { useSettings } from "../settings-context";
import { ModelConfigCard } from "../model-config-card";
import type { SettingsState } from "@shared/index";
import log from 'electron-log/renderer';

const logger = log.scope('ModelsSection');

interface ModelsSectionProps {
  settings: SettingsState;
}

export function ModelsSection({ settings }: ModelsSectionProps) {
  const { updateSettings } = useSettings();
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  
  // State for model configurations
  const [chatModelConfig, setChatModelConfig] = useState({
    providerId: "",
    providerName: "",
    modelName: "",
    supportsAdvancedUsage: true,
  });

  const [simpleModelConfig, setSimpleModelConfig] = useState({
    providerId: "",
    providerName: "",
    modelName: "",
    supportsAdvancedUsage: true,
  });

  const [complexModelConfig, setComplexModelConfig] = useState({
    providerId: "",
    providerName: "",
    modelName: "",
    supportsAdvancedUsage: true,
  });

  const [useSameModelForAgents, setUseSameModelForAgents] = useState(false);

  // Update state when settings change
  useEffect(() => {
    if (settings?.modelConfigurations?.chat) {
      setChatModelConfig({
        providerId: settings.modelConfigurations.chat.providerId || "",
        providerName: settings.modelConfigurations.chat.providerName || "",
        modelName: settings.modelConfigurations.chat.modelName || "",
        supportsAdvancedUsage: settings.modelConfigurations.chat.supportsAdvancedUsage ?? true,
      });
    }

    if (settings?.modelConfigurations?.simple) {
      setSimpleModelConfig({
        providerId: settings.modelConfigurations.simple.providerId || "",
        providerName: settings.modelConfigurations.simple.providerName || "",
        modelName: settings.modelConfigurations.simple.modelName || "",
        supportsAdvancedUsage: settings.modelConfigurations.simple.supportsAdvancedUsage ?? true,
      });
    }

    if (settings?.modelConfigurations?.complex) {
      setComplexModelConfig({
        providerId: settings.modelConfigurations.complex.providerId || "",
        providerName: settings.modelConfigurations.complex.providerName || "",
        modelName: settings.modelConfigurations.complex.modelName || "",
        supportsAdvancedUsage: settings.modelConfigurations.complex.supportsAdvancedUsage ?? true,
      });
    }

    if (settings?.useSameModelForAgents !== undefined) {
      setUseSameModelForAgents(settings.useSameModelForAgents);
    }
  }, [settings]);

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
    } catch (error) {
      logger.error("failed to save model configurations", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestModels = async () => {
    setIsTesting(true);
    try {
      // TODO: Implement model testing
      logger.info("Testing models...");
    } catch (error) {
      logger.error("failed to test models", error);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Model Configuration</h2>
        <p className="text-muted-foreground mt-1">
          Configure AI models for different use cases
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Default Chat Model</CardTitle>
          <CardDescription>
            The primary model used for general conversation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ModelConfigCard
            title="Default Chat Model"
            tooltip="This model will be used for general conversation and user interactions"
            providerId={chatModelConfig.providerId}
            modelName={chatModelConfig.modelName}
            onProviderChange={(value) => {
              const provider = settings.providers.find(p => p.id === value);
              setChatModelConfig({
                ...chatModelConfig,
                providerId: value,
                providerName: provider?.name || "",
              });
            }}
            onModelNameChange={(value) =>
              setChatModelConfig({
                ...chatModelConfig,
                modelName: value,
              })
            }
            providers={settings?.providers || []}
            showTooltip={false}
          />

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
                    When enabled, all agent tasks will use the chat model.
                    When disabled, you can configure separate models for simple and complex tasks.
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
              Configure separate models for different agent complexity levels
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ModelConfigCard
              title="Simple Agent Model"
              tooltip="This model will be used for straightforward agent tasks"
              providerId={simpleModelConfig.providerId}
              modelName={simpleModelConfig.modelName}
              onProviderChange={(value) => {
                const provider = settings.providers.find(p => p.id === value);
                setSimpleModelConfig({
                  ...simpleModelConfig,
                  providerId: value,
                  providerName: provider?.name || "",
                });
              }}
              onModelNameChange={(value) =>
                setSimpleModelConfig({
                  ...simpleModelConfig,
                  modelName: value,
                })
              }
              providers={settings?.providers || []}
            />

            <ModelConfigCard
              title="Complex Agent Model"
              tooltip="This model will be used for complex agent tasks requiring advanced reasoning"
              providerId={complexModelConfig.providerId}
              modelName={complexModelConfig.modelName}
              onProviderChange={(value) => {
                const provider = settings.providers.find(p => p.id === value);
                setComplexModelConfig({
                  ...complexModelConfig,
                  providerId: value,
                  providerName: provider?.name || "",
                });
              }}
              onModelNameChange={(value) =>
                setComplexModelConfig({
                  ...complexModelConfig,
                  modelName: value,
                })
              }
              providers={settings?.providers || []}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={handleTestModels}
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
        </CardContent>
      </Card>
    </div>
  );
}