/**
 * Single Provider class — creates LanguageModel instances using runtime config
 * sourced from the database. No TOML file reads needed.
 *
 * SDK dispatch is split into two layers:
 *  - STANDARD_PROVIDERS: SDKs whose creator accepts only { apiKey?, baseURL? } and
 *    is callable as (modelId). One generic path covers them.
 *  - the switch below: genuine outliers needing a different option shape
 *    (openai-compatible needs `name`; gitlab wants `instanceUrl`; bedrock/vertex
 *    read region/project/location from env vars; etc.).
 */

import type { LanguageModel } from "ai";
import type { ProviderRuntimeConfig, UserProviderConfig } from "@shared";
import { sendAlert } from "@/utils/messageUtils";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import { createCohere } from "@ai-sdk/cohere";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVercel } from "@ai-sdk/vercel";
// NOTE: @ai-sdk/gateway (Vercel AI Gateway) is unrelated to the `ai-gateway-provider`
// (Cloudflare) outlier handled below — do not confuse the two.
import { createGatewayProvider } from "@ai-sdk/gateway";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createAihubmix } from "@aihubmix/ai-sdk-provider";
import { createVenice } from "venice-ai-sdk-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAzure } from "@ai-sdk/azure";
import { createGitLab } from "gitlab-ai-provider";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";

/** A creator that takes { apiKey, baseURL } and returns a (modelId) => LanguageModel. */
type StandardCreator = (opts: {
  apiKey?: string;
  baseURL?: string;
}) => (model: string) => LanguageModel;

/** SDKs whose creator accepts only { apiKey?, baseURL? } — one generic dispatch. */
const STANDARD_PROVIDERS: Record<string, StandardCreator> = {
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/deepinfra": createDeepInfra,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/xai": createXai,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/cerebras": createCerebras,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/vercel": createVercel,
  "@ai-sdk/gateway": createGatewayProvider,
  "@openrouter/ai-sdk-provider": createOpenRouter,
  "@aihubmix/ai-sdk-provider": createAihubmix,
  "venice-ai-sdk-provider": createVenice,
};

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
      throw new Error(
        "Provider is not properly configured. API key is required.",
      );
    }

    const apiKey = this.config.apiKey;
    const baseURL =
      this.config.apiUrlOverride ||
      this.runtimeConfig.defaultApiUrl ||
      undefined;
    const sdkNpm = this.runtimeConfig.npm;

    // 1. Standard { apiKey, baseURL } SDKs — data-driven.
    const create = STANDARD_PROVIDERS[sdkNpm];
    if (create) {
      return create({ apiKey, ...(baseURL && { baseURL }) })(modelName);
    }

    // 2. Genuine outliers — explicit handling.
    switch (sdkNpm) {
      // Requires `name` and a non-optional baseURL.
      case "@ai-sdk/openai-compatible": {
        return createOpenAICompatible({
          name: this.runtimeConfig.name,
          apiKey,
          baseURL: baseURL || "https://api.openai.com/v1",
        })(modelName);
      }

      // apiKey + baseURL; uses deployment ids as model names.
      case "@ai-sdk/azure": {
        return createAzure({ apiKey, ...(baseURL && { baseURL }) })(modelName);
      }

      // Wants `instanceUrl` rather than `baseURL`.
      case "gitlab-ai-provider": {
        return createGitLab({
          apiKey,
          ...(baseURL && { instanceUrl: baseURL }),
        })(modelName);
      }

      // region/AWS credentials are read from env vars (AWS_REGION,
      // AWS_BEARER_TOKEN_BEDROCK, …), documented in the provider TOML.
      case "@ai-sdk/amazon-bedrock": {
        return createAmazonBedrock({ apiKey, ...(baseURL && { baseURL }) })(
          modelName,
        );
      }

      // project/location are read from env vars (GOOGLE_VERTEX_PROJECT/
      // GOOGLE_VERTEX_LOCATION), documented in the provider TOML.
      case "@ai-sdk/google-vertex": {
        return createVertex({ apiKey })(modelName);
      }

      // Subpath import. Auth is Google-only (ADC / googleAuthOptions / env), so
      // there is no apiKey to pass; project/location still come from env vars.
      case "@ai-sdk/google-vertex/anthropic": {
        return createVertexAnthropic()(modelName);
      }

      default: {
        throw new Error(
          `Provider "${sdkNpm}" cannot be used yet: it needs configuration the ` +
            `app does not collect (e.g. a service binding, or gateway+accountId). ` +
            `It is installed but not wired up for runtime use.`,
        );
      }
    }
  }

  isConfigured(): boolean {
    return !!(this.config.apiKey && this.config.apiKey.trim().length > 0);
  }
}
