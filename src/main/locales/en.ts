const en = {
  common: {
    mainWindowTitle: "Autai",
  },
  update: {
    availableTitle: "Update Available",
    availableBody: "Downloading v{{version}} in the background...",
    readyTitle: "Update Ready",
    readyBody: "v{{version}} will be installed after restart.",
    errorTitle: "Update Error",
    notPackaged:
      "In-app updates are not supported with your current installation. Please download the latest version from the same source.",
    networkError: "Network error",
  },
  settings: {
    testingTitle: "Testing Connection",
    testingBody: "Testing {{modelId}}...",
    successTitle: "Connection Successful",
    successBody: "{{modelId}} is working correctly.",
    failedTitle: "Connection Failed",
    failedNoResponse: "{{modelId}} is not responding",
    failedBody: "{{modelId}} connection failed: {{error}}",
  },
  agents: {
    searchingTitle: "Looking up multiple topics at once: {{title}}",
    searchLabel: 'Looking up: "{{query}}"',
    extractingTitle: "Organizing Results",
    extractingDescription:
      "Reading multiple pages at once and organizing content",
    readLabel: "Reading multiple pages at once: {{title}}",
    extractionFailed: "Failed to extract content: {{error}}",
    extractionLlmFailed: "Model failed to extract content",
    extractionGenericFailed: "Extraction failed: {{error}}",
    modelNotConfiguredTitle: "Model Not Configured",
    modelNotConfiguredBody:
      "No {{role}} model assigned yet. Please configure it in settings.",
    providerNotFoundTitle: "Provider Not Found",
    providerNotFoundBody:
      'Provider "{{providerId}}" not found. Please check your settings.',
  },
};

export default en;
