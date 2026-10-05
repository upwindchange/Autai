# Privacy Policy

_Last updated: 2026-09-24_

Autai ("we", "the developer") is a desktop application that provides AI-driven research and web-novel reading tools. This policy explains how the app handles information when you use it.

**The short version: Autai contains no telemetry, no analytics, no crash reporting, and no developer-operated servers. We never see anything you do in the app. Your data stays on your machine unless you explicitly send it somewhere yourself.**

## Data stored on your device

Autai stores all of its data — chat threads, story library, tags, settings, and provider configurations — in a local SQLite database on your computer. This data:

- never leaves your device as a result of anything Autai does;
- is never transmitted to the developer or any developer-operated service;
- can be deleted at any time with or without uninstalling the Autai app.

## AI provider keys and requests (you choose, we never see)

Autai works with AI services you configure yourself. To use it, you add your own API key for a provider of your choice (for example OpenAI, Anthropic, Google, or any OpenAI-compatible endpoint). This is "bring your own key" (BYOK):

- API keys are stored only in the local database on your device.
- Keys are used solely to send requests **directly from your computer to the provider you configured**, for the AI features you initiate.
- When you send a chat message or run a research task, its content is transmitted to that provider so the AI can process it. That transmission happens between your device and the provider, under the provider's own privacy policy (see the provider's website for their terms).
- We have no access to your keys, your prompts, or the responses, and no technical means to view them.

## Web content fetching

During research and browser-use tasks, Autai fetches web pages and search results **directly on your computer** — the same as if you opened them in your own browser. Requests go from your device straight to the websites you or the AI agent visit. Nothing is routed through developer-operated infrastructure.

## Optional observability (self-hosted, off by default)

Autai includes an optional observability integration. It is **disabled by default** and is not associated with any analytics vendor:

- If enabled, it exports technical traces (which tools ran, timings, token counts) to a host **you fully configure and control** — for example your own self-hosted instance.
- It is never pointed at the developer or any third party by default.
- If you never turn it on, nothing is exported anywhere, ever.

## Update checks

When packaged, the app periodically requests the latest release tag from the public GitHub repository (api.github.com) to tell you when a newer version is available. This request contains no personal data, no identifiers, and no usage information — it is equivalent to opening the releases page in a browser. Nothing is downloaded or installed automatically.

## Local logs

Autai writes diagnostic logs to your computer (electron-log). These logs stay local, can be inspected by you at any time, and are sent nowhere unless you manually copy and share them yourself (for example in a bug report).

## Children

The app is not directed at children under 13 and provides no account system, so we collect nothing from anyone — including children.

## Changes to this policy

Material changes will be reflected by updating this page with a new "last updated" date.

## Contact

- Project homepage: [github.com/upwindchange/Autai](https://github.com/upwindchange/Autai)
- Issues and privacy questions: [github.com/upwindchange/Autai/issues](https://github.com/upwindchange/Autai/issues)
- Email: [zyw@tutamail.com](mailto:zyw@tutamail.com)
