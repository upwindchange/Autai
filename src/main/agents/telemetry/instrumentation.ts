import { LangfuseSpanProcessor, ShouldExportSpan } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { settingsService } from "@/services";
import log from "electron-log/main";

const logger = log.scope("Telemetry");

let tracerProvider: NodeTracerProvider | null = null;
let langfuseSpanProcessor: LangfuseSpanProcessor | null = null;

/**
 * Initialize Langfuse telemetry
 */
export function initializeTelemetry(): void {
  try {
    const settings = settingsService.settings;

    // Check if Langfuse is enabled and configured
    if (!settings?.langfuse?.enabled) {
      logger.info("Langfuse telemetry disabled in settings");
      return;
    }

    const { publicKey, secretKey, host } = settings.langfuse;

    if (!publicKey || !secretKey) {
      logger.warn(
        "Langfuse keys not configured, skipping telemetry initialization"
      );
      return;
    }

    // Set environment variables for Langfuse
    process.env.LANGFUSE_PUBLIC_KEY = publicKey;
    process.env.LANGFUSE_SECRET_KEY = secretKey;
    if (host) {
      process.env.LANGFUSE_HOST = host;
    }

    logger.info("Initializing Langfuse telemetry", {
      host: host || "https://cloud.langfuse.com",
    });

    const shouldExportSpan: ShouldExportSpan = (span) => {
      return span.otelSpan.instrumentationScope.name !== "express";
    };

    // Create the span processor
    langfuseSpanProcessor = new LangfuseSpanProcessor({
      shouldExportSpan,
    });

    // Create and configure the tracer provider
    tracerProvider = new NodeTracerProvider({
      spanProcessors: [langfuseSpanProcessor],
    });

    // Register the tracer provider globally
    tracerProvider.register();

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
