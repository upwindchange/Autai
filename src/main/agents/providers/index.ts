import { settingsService } from "@/services";
import type { LanguageModel } from "ai";
import type { ProviderConfig } from "@shared";
import { BaseProvider } from "@agents/providers/BaseProvider";
import { OpenAICompatibleProvider } from "@agents/providers/OpenAICompatibleProvider";
import { AnthropicProvider } from "@agents/providers/AnthropicProvider";
import { DeepInfraProvider } from "@agents/providers/DeepInfraProvider";
import { sendAlert } from "@/utils/messageUtils";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Creates a provider instance based on the configuration type
 * @param config - Provider configuration
 * @returns BaseProvider instance of the appropriate type
 */
export function createProvider(config: ProviderConfig): BaseProvider {
	switch (config.provider) {
		case "openai-compatible":
			return new OpenAICompatibleProvider(config);

		case "anthropic":
			return new AnthropicProvider(config);

		case "deepinfra":
			return new DeepInfraProvider(config);
	}
}

/**
 * Creates a language model based on the active settings for the specified model type
 * @param modelType - The type of model to use ('chat', 'simple' or 'complex')
 * @returns LanguageModel instance
 */
function createModel(
	modelType: "chat" | "simple" | "complex" = "simple",
): LanguageModel {
	// Get settings
	const settings = settingsService.settings;
	if (!settings || !settings.providers || settings.providers.length === 0) {
		sendAlert(
			"No Providers Configured",
			"Please configure at least one provider in settings before using AI features.",
		);
		throw new Error("No providers configured");
	}

	// If useSameModelForAgents is enabled and requesting simple/complex model,
	// use the chat model configuration instead
	let effectiveModelType = modelType;
	if (settings.useSameModelForAgents && modelType !== "chat") {
		effectiveModelType = "chat";
	}

	// Get the model configuration for the effective model type
	const modelConfig = settings.modelConfigurations?.[effectiveModelType];
	if (!modelConfig) {
		sendAlert(
			"Model Not Configured",
			`No configuration found for ${effectiveModelType} model. Please configure it in settings.`,
		);
		throw new Error(
			`No model configuration found for ${effectiveModelType} model`,
		);
	}

	// Find the provider configuration
	const providerConfig = settings.providers.find(
		(p) => p.id === modelConfig.providerId,
	);
	if (!providerConfig) {
		sendAlert(
			"Provider Not Found",
			`Provider "${modelConfig.providerName}" (ID: ${modelConfig.providerId}) not found. Please check your settings.`,
		);
		throw new Error(`Provider with ID ${modelConfig.providerId} not found`);
	}

	// Create provider instance
	const provider: BaseProvider = createProvider(providerConfig);

	// Create and return the language model
	return provider.createLanguageModel(modelConfig.modelName);
}

/**
 * Creates a LangChain model based on the active settings for the specified model type
 * @param modelType - The type of model to use ('chat', 'simple' or 'complex')
 * @returns LangChain model instance
 */
function createLangchainModel(
	modelType: "chat" | "simple" | "complex" = "simple",
) {
	// Get settings
	const settings = settingsService.settings;
	if (!settings || !settings.providers || settings.providers.length === 0) {
		sendAlert(
			"No Providers Configured",
			"Please configure at least one provider in settings before using AI features.",
		);
		throw new Error("No providers configured");
	}

	// If useSameModelForAgents is enabled and requesting simple/complex model,
	// use the chat model configuration instead
	let effectiveModelType = modelType;
	if (settings.useSameModelForAgents && modelType !== "chat") {
		effectiveModelType = "chat";
	}

	// Get the model configuration for the effective model type
	const modelConfig = settings.modelConfigurations?.[effectiveModelType];
	if (!modelConfig) {
		sendAlert(
			"Model Not Configured",
			`No configuration found for ${effectiveModelType} model. Please configure it in settings.`,
		);
		throw new Error(
			`No model configuration found for ${effectiveModelType} model`,
		);
	}

	// Find the provider configuration
	const providerConfig = settings.providers.find(
		(p) => p.id === modelConfig.providerId,
	);
	if (!providerConfig) {
		sendAlert(
			"Provider Not Found",
			`Provider "${modelConfig.providerName}" (ID: ${modelConfig.providerId}) not found. Please check your settings.`,
		);
		throw new Error(`Provider with ID ${modelConfig.providerId} not found`);
	}

	// Create provider instance
	const provider: BaseProvider = createProvider(providerConfig);

	// Create and return the LangChain model
	return provider.createLangchainModel(modelConfig.modelName);
}

// Singleton instances (created on first access)
let _chatModel: LanguageModel | null = null;
let _simpleModel: LanguageModel | null = null;
let _complexModel: LanguageModel | null = null;
let _simpleLangchainModel: BaseChatModel | null = null;
let _complexLangchainModel: BaseChatModel | null = null;

// Export arrow functions with singleton pattern
export const chatModel = (): LanguageModel => {
	if (!_chatModel) {
		_chatModel = createModel("chat");
	}
	return _chatModel;
};

export const simpleModel = (): LanguageModel => {
	if (!_simpleModel) {
		_simpleModel = createModel("simple");
	}
	return _simpleModel;
};

export const complexModel = (): LanguageModel => {
	if (!_complexModel) {
		_complexModel = createModel("complex");
	}
	return _complexModel;
};

export const simpleLangchainModel = () => {
	if (!_simpleLangchainModel) {
		_simpleLangchainModel = createLangchainModel("simple");
	}
	return _simpleLangchainModel;
};

export const complexLangchainModel = () => {
	if (!_complexLangchainModel) {
		_complexLangchainModel = createLangchainModel("complex");
	}
	return _complexLangchainModel;
};
