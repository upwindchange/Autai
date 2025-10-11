import { LangfuseSpanProcessor, ShouldExportSpan } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { settingsService } from "@/services";
import log from "electron-log/main";

const logger = log.scope("Telemetry");

let tracerProvider: NodeSDK | null = null;
let langfuseSpanProcessor: LangfuseSpanProcessor | null = null;

/**
 * Initialize Langfuse telemetry
 */
export function initializeTelemetry(): void {
  try {
    const settings = settingsService.settings;

    // Check if Langfuse is enabled and configured
    if (!settings.langfuse.enabled) {
      logger.info("Langfuse telemetry disabled in settings");
      return;
    }

    const { publicKey, secretKey, host } = settings.langfuse;

    if (!publicKey || !secretKey || !host) {
      logger.warn(
        "Langfuse not configured correctly, skipping telemetry initialization"
      );
      return;
    }

    const shouldExportSpan: ShouldExportSpan = (span) => {
      return span.otelSpan.instrumentationScope.name !== "express";
    };

    // Create the span processor
    langfuseSpanProcessor = new LangfuseSpanProcessor({
      shouldExportSpan,
      publicKey: publicKey,
      secretKey: secretKey,
      baseUrl: host, // Default to cloud if not specified
      environment: process.env.NODE_ENV ?? "development", // Default to development if not specified
    });

    // Create and configure the tracer provider
    tracerProvider = new NodeSDK({
      spanProcessors: [langfuseSpanProcessor],
    });

    // Register the tracer provider globally
    tracerProvider.start();

    logger.info("Langfuse telemetry initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize Langfuse telemetry", error);
  }
}

/**
 * Shutdown telemetry gracefully
 */
export async function shutdownTelemetry(): Promise<void> {
  if (tracerProvider) {
    try {
      await tracerProvider.shutdown();
      logger.info("Telemetry shutdown complete");
    } catch (error) {
      logger.error("Error shutting down telemetry", error);
    }
  }
}

/**
 * Force flush pending telemetry data
 */
export async function flushTelemetry(): Promise<void> {
  if (langfuseSpanProcessor) {
    try {
      await langfuseSpanProcessor.forceFlush();
      logger.debug("Telemetry data flushed");
    } catch (error) {
      logger.error("Error flushing telemetry", error);
    }
  }
}
