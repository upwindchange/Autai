const en = {
  welcome: {
    title: "Welcome to Autai",
    subtitle: "Your AI Browser Assistant",
    description:
      "Tell Autai what you need, and the AI will use your browser for you — it will try to handle most things you'd normally do online.",
    "feature.browse.title": "Browse",
    "feature.browse.description": "Open and navigate websites automatically",
    "feature.automate.title": "Automate",
    "feature.automate.description": "AI uses your browser for you",
    "feature.extract.title": "Organize",
    "feature.extract.description": "Organize information from the web",
    "prompt.suggestion":
      'Try asking me to "Book the cheapest flight from SF to NYC next Friday" or "Fill out and submit this application form"',
  },
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
  tags: {
    coding: "Coding",
    research: "Research",
    creative: "Creative",
    planning: "Planning",
    learning: "Learning",
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
    searchErrorTitle: "Search Error",
    searchErrorBody:
      'Query "{{query}}" was skipped due to a service error (e.g. rate limit): {{error}}',
    extractionErrorTitle: "Extraction Error",
    extractionErrorBody:
      'Page "{{title}}" was skipped due to a service error (e.g. rate limit): {{error}}',
    researchErrorTitle: "Research Error",
    researchErrorBody: "An error occurred during research: {{error}}",
    browserUseErrorTitle: "Browser Agent Error",
    browserUseErrorBody:
      "An error occurred during browser automation: {{error}}",
    taskErrorTitle: "Task Execution Error",
    taskErrorBody: "An error occurred during task execution: {{error}}",
    actionErrorTitle: "Action Error",
    actionErrorBody: 'Subtask "{{label}}" failed: {{error}}',
    deepResearchTitle: "Deep Research: {{title}}",
    preResearchTitle: "Exploring: {{title}}",
    preResearchDescription:
      "Getting a quick overview of the topic before planning",
    noResultsFound:
      "No relevant search results were found for your query. Please try rephrasing your question or using different keywords.",
    timeoutErrorTitle: "Request Timed Out",
    timeoutErrorBody:
      "The request took too long and was cancelled. Please try again.",
  },
};

export default en;
