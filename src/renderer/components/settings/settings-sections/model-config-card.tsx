import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { HelpCircle, RefreshCw, Check } from "lucide-react";
import type { ProviderConfig } from "@shared";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import log from 'electron-log/renderer';

const logger = log.scope('ModelConfigCard');
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Type for OpenAI API model response
interface OpenAIModel {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

interface ModelConfigCardProps {
  title: string;
  tooltip: string;
  providerId: string;
  modelName: string;
  onProviderChange: (providerId: string) => void;
  onModelNameChange: (modelName: string) => void;
  providers: ProviderConfig[];
  showTooltip?: boolean;
}

export function ModelConfigCard({
  title,
  tooltip,
  providerId,
  modelName,
  onProviderChange,
  onModelNameChange,
  providers,
  showTooltip = true,
}: ModelConfigCardProps) {
  const [open, setOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch models when provider changes or on initial load
  useEffect(() => {
    if (providerId) {
      fetchModels();
    } else {
      setAvailableModels([]);
    }
  }, [providerId]);

  const fetchModels = async () => {
    if (!providerId) return;

    setIsLoading(true);
    try {
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) {
        throw new Error("Provider not found");
      }

      let models: string[] = [];

      if (provider.provider === "openai-compatible" || provider.provider === "deepinfra") {
        // OpenAI-compatible API
        const response = await fetch(`${provider.apiUrl}/models`, {
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `API error: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        models = (data.data as OpenAIModel[])
          .filter((model) => model.id)
          .map((model) => model.id)
          .sort();
      } else if (provider.provider === "anthropic") {
        // Anthropic API - allow free-form text input for model names
        // Return empty array to enable manual input
        models = [];
      }

      setAvailableModels(models);
    } catch (error) {
      logger.error("failed to fetch models", error);
      setAvailableModels([]);
      // Keep the current model name even if fetch fails
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    await fetchModels();
  };

  const handleModelSelect = (selectedModel: string) => {
    onModelNameChange(selectedModel);
    setOpen(false);
    setSearchValue("");
  };

  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    if (open) {
      // When popover opens, set search value to current model name
      setSearchValue(modelName);
    }
  }, [open, modelName]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Label className="text-base">{title}</Label>
        {showTooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end">
        <div className="flex items-end">
          <div className="max-w-[300px]">
            <Label
              htmlFor={`${title.toLowerCase().replace(/\s+/g, "-")}-provider`}
            >
              Provider
            </Label>
            <Select value={providerId} onValueChange={onProviderChange}>
              <SelectTrigger
                id={`${title.toLowerCase().replace(/\s+/g, "-")}-provider`}
              >
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleRefresh}
                  disabled={isLoading || !providerId}
                  className="h-9 w-9"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", isLoading && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh available models</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex-1 min-w-0 max-w-[400px] pl-4">
          <Label
            htmlFor={`${title.toLowerCase().replace(/\s+/g, "-")}-model-name`}
          >
            Model Name
          </Label>
          <div className="flex">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <input
                  type="text"
                  value={modelName}
                  placeholder="Select model..."
                  readOnly
                  className={
                    "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed transition-all duration-200"
                  }
                  onClick={() => setOpen(true)}
                  id={`${title.toLowerCase().replace(/\s+/g, "-")}-model-name`}
                />
              </PopoverTrigger>
              <PopoverContent
                className="w-full p-0"
                align="start"
                style={{ width: "var(--radix-popover-trigger-width)" }}
              >
                <Command>
                  <CommandInput
                    placeholder="Search model..."
                    className="h-9"
                    value={searchValue}
                    onValueChange={setSearchValue}
                    onKeyDown={(e) => {
                      // Only allow custom model names when no models are available
                      if (
                        e.key === "Enter" &&
                        searchValue.trim() &&
                        availableModels.length === 0
                      ) {
                        handleModelSelect(searchValue.trim());
                        e.preventDefault();
                      }
                    }}
                    autoFocus
                  />
                  <CommandList>
                    <CommandEmpty>
                      {availableModels.length === 0 && searchValue.trim()
                        ? `Press Enter to use "${searchValue}"`
                        : "No model found."}
                    </CommandEmpty>
                    <CommandGroup>
                      {availableModels.map((model) => (
                        <CommandItem
                          key={model}
                          value={model}
                          onSelect={() => handleModelSelect(model)}
                          className="flex items-center justify-between"
                        >
                          {model}
                          <Check
                            className={cn(
                              "ml-2 h-4 w-4",
                              modelName === model ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}
