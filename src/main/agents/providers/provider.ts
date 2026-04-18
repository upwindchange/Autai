/**
 * Single Provider class — creates LanguageModel instances using runtime config
 * sourced from the database. No TOML file reads needed.
 */

import type { LanguageModel } from "ai";
import type { ProviderRuntimeConfig, UserProviderConfig } from "@shared";
import { sendAlert } from "@/utils/messageUtils";

export class Provider {
  constructor(
    private config: UserProviderConfig,
    private runtimeConfig: ProviderRuntimeConfig,
  ) {}

  createLanguageModel(modelName: string): LanguageModel {
    if (!this.isConfigured()) {
      sendAlert(
        "Provider Not Configured",
        `Provider is missing API key. Please configure it in settings.`,
      );
      throw new Error("Provider is not properly configured. API key is required.");
    }

    const apiKey = this.config.apiKey;
    const baseURL =
      this.config.apiUrlOverride || this.runtimeConfig.defaultApiUrl || undefined;
    const sdkNpm = this.runtimeConfig.npm;

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
        const { createOpenAICompatible } =
          require("@ai-sdk/openai-compatible") as {
            createOpenAICompatible: (opts: {
              name: string;
              apiKey: string;
              baseURL: string;
            }) => (model: string) => LanguageModel;
          };
        return createOpenAICompatible({
          name: this.runtimeConfig.name,
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
