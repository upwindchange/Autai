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
import { useSettings } from "@/components/settings";
import { ModelConfigCard } from "@/components/settings/settings-sections/model-config-card";
import type { SettingsState, ModelConfig } from "@shared";
import log from "electron-log/renderer";

const logger = log.scope("ModelsSection");

interface ModelsSectionProps {
	settings: SettingsState;
}

export function ModelsSection({ settings }: ModelsSectionProps) {
	const { updateSettings } = useSettings();
	const [isLoading, setIsLoading] = useState(false);
	const [isTesting, setIsTesting] = useState(false);

	// Helper function to create model config state
	const createModelConfigState = (): ModelConfig => ({
		providerId: "",
		providerName: "",
		modelName: "",
		supportsAdvancedUsage: true,
	});

	// State for model configurations
	const [chatModelConfig, setChatModelConfig] = useState<ModelConfig>(
		createModelConfigState(),
	);
	const [simpleModelConfig, setSimpleModelConfig] = useState<ModelConfig>(
		createModelConfigState(),
	);
	const [complexModelConfig, setComplexModelConfig] = useState<ModelConfig>(
		createModelConfigState(),
	);
	const [useSameModelForAgents, setUseSameModelForAgents] = useState(false);

	// Helper function to update model config from settings
	const updateModelConfigFromSettings = (
		configKey: "chat" | "simple" | "complex",
		setter: (config: ModelConfig) => void,
	) => {
		if (settings?.modelConfigurations?.[configKey]) {
			const config = settings.modelConfigurations[configKey];
			setter({
				providerId: config.providerId || "",
				providerName: config.providerName || "",
				modelName: config.modelName || "",
				supportsAdvancedUsage: config.supportsAdvancedUsage ?? true,
			});
		}
	};

	// Helper function to create ModelConfigCard props
	const createModelCardProps = (
		config: ModelConfig,
		setter: (config: ModelConfig) => void,
	) => ({
		providerId: config.providerId,
		modelName: config.modelName,
		onProviderChange: (value: string) => {
			const provider = settings.providers.find((p) => p.id === value);
			setter({
				...config,
				providerId: value,
				providerName: provider?.name || "",
			});
		},
		onModelNameChange: (value: string) =>
			setter({
				...config,
				modelName: value,
			}),
		providers: settings?.providers || [],
	});

	// Update state when settings change
	useEffect(() => {
		updateModelConfigFromSettings("chat", setChatModelConfig);
		updateModelConfigFromSettings("simple", setSimpleModelConfig);
		updateModelConfigFromSettings("complex", setComplexModelConfig);

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
			// Test chat model
			if (chatModelConfig.providerId && chatModelConfig.modelName) {
				const chatProvider = settings.providers.find(
					(p) => p.id === chatModelConfig.providerId,
				);
				if (chatProvider) {
					const testConfig = {
						...chatProvider,
						model: chatModelConfig.modelName,
					};
					await window.ipcRenderer.invoke("settings:test", testConfig);
				}
			}

			// Test agent models only if not using same model for agents
			if (!useSameModelForAgents) {
				// Test simple model
				if (simpleModelConfig.providerId && simpleModelConfig.modelName) {
					const simpleProvider = settings.providers.find(
						(p) => p.id === simpleModelConfig.providerId,
					);
					if (simpleProvider) {
						const testConfig = {
							...simpleProvider,
							model: simpleModelConfig.modelName,
						};
						await window.ipcRenderer.invoke("settings:test", testConfig);
					}
				}

				// Test complex model
				if (complexModelConfig.providerId && complexModelConfig.modelName) {
					const complexProvider = settings.providers.find(
						(p) => p.id === complexModelConfig.providerId,
					);
					if (complexProvider) {
						const testConfig = {
							...complexProvider,
							model: complexModelConfig.modelName,
						};
						await window.ipcRenderer.invoke("settings:test", testConfig);
					}
				}
			}
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
						showTooltip={false}
						{...createModelCardProps(chatModelConfig, setChatModelConfig)}
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
										When enabled, all agent tasks will use the chat model. When
										disabled, you can configure separate models for simple and
										complex tasks.
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
							{...createModelCardProps(simpleModelConfig, setSimpleModelConfig)}
						/>

						<ModelConfigCard
							title="Complex Agent Model"
							tooltip="This model will be used for complex agent tasks requiring advanced reasoning"
							{...createModelCardProps(
								complexModelConfig,
								setComplexModelConfig,
							)}
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
							{isTesting ?
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Testing Models...
								</>
							:	<>
									<TestTube className="h-4 w-4 mr-2" />
									Test Models
								</>
							}
						</Button>

						<Button
							onClick={handleSaveModelConfigurations}
							disabled={isLoading}
						>
							{isLoading ?
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Saving...
								</>
							:	<>
									<Save className="h-4 w-4 mr-2" />
									Save Configurations
								</>
							}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
