import { app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { generateText } from "ai";
import { createProvider } from "@agents/providers";
import { sendSuccess, sendAlert, sendInfo } from "@/utils/messageUtils";
import log from "electron-log/main";
import type {
	SettingsState,
	TestConnectionConfig,
	ProviderConfig,
} from "@shared";
import { SettingsStateSchema } from "@shared";

class SettingsService {
	private _settings: SettingsState;
	private settingsPath: string;
	private logger = log.scope("SettingsService");

	constructor() {
		const userDataPath = app.getPath("userData");
		this.settingsPath = path.join(userDataPath, "settings.json");
		// Initialize with default settings from schema
		this._settings = SettingsStateSchema.parse({});
	}

	// Override settings getter to return effective model configurations
	public get settings(): SettingsState {
		if (this._settings.useSameModelForAgents) {
			// When useSameModelForAgents is enabled, override simple and complex with chat config
			return {
				...this._settings,
				modelConfigurations: {
					...this._settings.modelConfigurations,
					simple: this._settings.modelConfigurations.chat,
					complex: this._settings.modelConfigurations.chat,
				},
			};
		} else {
			return this._settings;
		}
	}

	// Private setter for internal use
	private set settings(value: SettingsState) {
		this._settings = value;
	}

	async initialize() {
		await this.loadSettings();
	}

	async loadSettings(): Promise<SettingsState> {
		try {
			const data = await fs.readFile(this.settingsPath, "utf-8");
			const parsedData = JSON.parse(data, (_key, value) => {
				// Example post processing
				// if (_key === "createdAt" || _key === "updatedAt") {
				//   return new Date(value);
				// }
				return value;
			});
			// Parse and validate with schema, which will apply defaults
			this._settings = SettingsStateSchema.parse(parsedData);
		} catch (_error) {
			// If file doesn't exist or is invalid, use existing settings (which already have defaults)
			this.logger.info("Settings file not found or invalid, using defaults");
		}
		return this.settings;
	}

	async saveSettings(settings: SettingsState): Promise<void> {
		// Sync provider names in model configurations before saving
		const updatedSettings = this.syncProviderNames(settings);
		this._settings = updatedSettings;
		await fs.writeFile(
			this.settingsPath,
			JSON.stringify(updatedSettings, null, 2),
			"utf-8",
		);
	}

	// Sync provider names in model configurations to ensure they match current providers
	private syncProviderNames(settings: SettingsState): SettingsState {
		if (!settings.modelConfigurations || !settings.providers) return settings;

		const updatedModelConfigurations = { ...settings.modelConfigurations };

		// Update provider names for all model types
		(
			Object.keys(updatedModelConfigurations) as Array<
				keyof typeof updatedModelConfigurations
			>
		).forEach((modelType) => {
			const modelConfig = updatedModelConfigurations[modelType];
			const provider = settings.providers.find(
				(p) => p.id === modelConfig.providerId,
			);
			if (provider) {
				updatedModelConfigurations[modelType] = {
					...modelConfig,
					providerName: provider.name,
				};
			}
		});

		return {
			...settings,
			modelConfigurations: updatedModelConfigurations,
		};
	}

	async testConnection(config: TestConnectionConfig): Promise<void> {
		try {
			this.logger.info("testing connection", {
				config,
			});

			// Send initial test message
			sendInfo("Testing Connection", `Testing ${config.model} connection...`);

			// Extract base provider config from test config - unified properties
			const baseConfig = {
				id: config.id || "test-provider",
				name: config.name || "Test Provider",
				provider: config.provider,
				apiKey: config.apiKey,
				...(config.apiUrl && { apiUrl: config.apiUrl }),
			};

			// Create provider instance
			const provider = createProvider(baseConfig as ProviderConfig);
			const languageModel = provider.createLanguageModel(config.model);

			// Try a simple completion to test the connection
			this.logger.debug("testing basic connection with Hi prompt");
			const response = await generateText({
				model: languageModel,
				prompt: "reply only one word",
				temperature: 0,
			});

			if (response && response.text) {
				this.logger.info("basic connection test successful", {
					responseLength: response.text.length,
					usage: response.usage,
				});

				// Connection successful - show immediate success message
				sendSuccess(
					"Connection Successful",
					`${config.model} connected successfully! API is working correctly.`,
				);
			} else {
				this.logger.error("basic connection test failed - no response");
				sendAlert(
					"Connection Failed",
					`${config.model} connection failed: No response from API`,
				);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			this.logger.error("connection test failed", { error: errorMessage });
			sendAlert(
				"Connection Failed",
				`${config.model} connection failed: ${errorMessage}`,
			);
		}
	}

	// Utility method to check if settings are configured
	isConfigured(): boolean {
		if (!this._settings || !this._settings.providers) return false;

		// Check if we have model configurations
		if (!this._settings.modelConfigurations) return false;

		// Check if the chat model is configured
		const chatConfig = this._settings.modelConfigurations.chat;
		const chatProvider = this._settings.providers.find(
			(p) => p.id === chatConfig.providerId,
		);

		if (!chatProvider) return false;

		// Check chat provider configuration
		const providerInstance = createProvider(chatProvider);
		const chatConfigured = providerInstance.isConfigured();

		if (!chatConfigured) return false;

		// If useSameModelForAgents is enabled, only chat model needs to be configured
		if (this._settings.useSameModelForAgents) {
			return true;
		}

		// Otherwise, check both simple and complex models
		const simpleConfig = this._settings.modelConfigurations.simple;
		const complexConfig = this._settings.modelConfigurations.complex;

		// Check if both models use the same provider as chat (common case)
		if (
			simpleConfig.providerId === chatConfig.providerId &&
			complexConfig.providerId === chatConfig.providerId
		) {
			return true; // Same provider, already validated above
		}

		const simpleProvider = this._settings.providers.find(
			(p) => p.id === simpleConfig.providerId,
		);
		const complexProvider = this._settings.providers.find(
			(p) => p.id === complexConfig.providerId,
		);

		if (!simpleProvider || !complexProvider) return false;

		// Check simple provider configuration
		const simpleProviderInstance = createProvider(simpleProvider);
		const simpleConfigured = simpleProviderInstance.isConfigured();

		// Check complex provider configuration (if different from simple)
		if (complexConfig.providerId !== simpleConfig.providerId) {
			const complexProviderInstance = createProvider(complexProvider);
			const complexConfigured = complexProviderInstance.isConfigured();
			return simpleConfigured && complexConfigured;
		}

		return simpleConfigured;
	}

	// Update model advanced capability setting
	async updateModelAdvancedCapability(
		modelType: keyof SettingsState["modelConfigurations"],
		supportsAdvancedUsage: boolean,
	): Promise<void> {
		if (!this._settings.modelConfigurations) return;

		this._settings.modelConfigurations[modelType].supportsAdvancedUsage =
			supportsAdvancedUsage;
		await this.saveSettings(this._settings);
	}
}

export const settingsService = new SettingsService();
