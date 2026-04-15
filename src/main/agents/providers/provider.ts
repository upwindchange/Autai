/**
 * Single Provider class — replaces AnthropicProvider, OpenAICompatibleProvider,
 * DeepInfraProvider, and BaseProvider. Dispatches to the correct AI SDK based
 * on the `npm` field from the provider's TOML definition.
 */

import type { LanguageModel } from "ai";
import type {
  ProviderDefinition,
  UserProviderConfig,
} from "@shared";
import { sendAlert } from "@/utils/messageUtils";

export class Provider {
  constructor(
    private config: UserProviderConfig,
    private definition: ProviderDefinition,
  ) {}

  createLanguageModel(modelName: string): LanguageModel {
    if (!this.isConfigured()) {
      sendAlert(
        "Provider Not Configured",
        `Provider "${this.definition.name}" is missing API key. Please configure it in settings.`,
      );
      throw new Error(
        `Provider ${this.definition.name} is not properly configured. API key is required.`,
      );
    }

    const apiKey = this.config.apiKey;
    const baseURL =
      this.config.apiUrlOverride || this.definition.api || undefined;
    const sdkNpm = this.definition.npm;

    switch (sdkNpm) {
      case "@ai-sdk/openai": {
        const { createOpenAI } = require("@ai-sdk/openai") as {
          createOpenAI: (opts: {
            apiKey: string;
            baseURL?: string;
          }) => (model: string) => LanguageModel;
        };
        return createOpenAI({
          apiKey,
          ...(baseURL && { baseURL }),
        })(modelName);
      }

      case "@ai-sdk/anthropic": {
        const { createAnthropic } = require("@ai-sdk/anthropic") as {
          createAnthropic: (opts: {
            apiKey: string;
            baseURL?: string;
          }) => (model: string) => LanguageModel;
        };
        return createAnthropic({
          apiKey,
          ...(baseURL && { baseURL }),
        })(modelName);
      }

      case "@ai-sdk/deepinfra": {
        const { createDeepInfra } = require("@ai-sdk/deepinfra") as {
          createDeepInfra: (opts: {
            apiKey: string;
            baseURL?: string;
          }) => (model: string) => LanguageModel;
        };
        return createDeepInfra({
          apiKey,
          ...(baseURL && { baseURL }),
        })(modelName);
      }

      case "@ai-sdk/openai-compatible": {
        const { createOpenAICompatible } = require("@ai-sdk/openai-compatible") as {
          createOpenAICompatible: (opts: {
            name: string;
            apiKey: string;
            baseURL: string;
          }) => (model: string) => LanguageModel;
        };
        return createOpenAICompatible({
          name: this.definition.name,
          apiKey,
          baseURL: baseURL || "https://api.openai.com/v1",
        })(modelName);
      }

      default: {
        throw new Error(
          `Unsupported provider SDK: ${sdkNpm}. Install it with: pnpm add ${sdkNpm}`,
        );
      }
    }
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.apiKey.trim().length > 0);
  }
}
