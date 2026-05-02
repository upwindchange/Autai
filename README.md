<div align="center">

<h1><img src="build/icon.png" alt="Autai" width="64" valign="middle" /> Autai</h1>

### Your AI Browser Assistant

Tell Autai what you need, and the AI will use your browser for you — booking flights, filling out forms, comparing prices, researching topics, and anything else you'd normally do online. We're also working on expanding beyond the browser to full computer use — stay tuned.

[Download](https://github.com/upwindchange/autai/releases) · [Features](#features) · [How It Works](#how-it-works) · [中文文档](docs/README.zh-CN.md)

---

If you like Autai, please consider giving it a star ⭐ — it helps others discover the project!

<!-- Add your star GIF below -->
<img width="320" height="180" alt="star" src="https://github.com/user-attachments/assets/ac160fea-7073-4f77-9af7-addaba1708d4" />

</div align="center">

---

## Watch It in Action

### Browser Automation

Just say _"Add the following shopping list to my Target shopping cart"_ — Autai opens the browser, searches for items and add the to your shopping cart.

<video src="https://github.com/user-attachments/assets/f8b8d85e-3679-4deb-a5de-8fe64092d161" controls="controls" style="max-width:100%;"></video>

Videos are sped up due to GitHub's 10MB file size limit. Actual speed depends on your LLM provider.

### Research Anything

Switch to Research Mode and ask _"What are the best laptops under $1000 in 2026?"_ — Autai searches the web, reads multiple sources, and synthesizes the answer for you.

<video src="[https://github.com/user/autai/assets/demo-research-mode.mp4](https://github.com/user-attachments/assets/7ac38b43-3e9c-4034-a7cf-8b8ef081bb13)" controls="controls" style="max-width:100%;"></video>

---

## Features

### 100+ AI Providers. 4,000+ Models.

Autai supports every major AI provider — OpenAI, Anthropic, Google, DeepSeek, Mistral, xAI, and 100+ more. Use any model from any provider, or even run models locally with Ollama. Bring your own API key, pick your favorite model, and go. See [full list here: models.dev](https://models.dev/).

<p align="center">
  <img src="docs/screenshots/config-provider.png" alt="Configure AI providers" width="45%" />
  <img src="docs/screenshots/cofig-models.png" alt="Browse 4,000+ models" width="45%" />
</p>

### Two Powerful Modes

**Browser Automation** — The AI plans out a task, then controls a real browser to get it done. Book flights, fill out applications, add items to your cart, compare products across stores — anything you can do in a browser, Autai can attempt for you.

**Research Mode** — Need information? Autai searches the web, reads through multiple pages, and brings back a clear, synthesized answer. No more opening 20 tabs and skimming them yourself.

### Smart Conversation Organization

Autai automatically tags and rename your conversations with color-coded labels so you can find them later. Browse your history in a clean list, or switch to a tag-grouped view to see everything by category. Search by keyword, filter by tag, and bulk-archive old threads. Your sidebar stays tidy without any effort.

<p align="center">
  <img src="docs/screenshots/Thread-list.png" alt="Thread list" width="45%" />
  <img src="docs/screenshots/tag-grouping.png" alt="Tag-grouped view" width="45%" />
</p>
<p align="center">
  <img src="docs/screenshots/tag-select.png" alt="Tag selection" width="30%" />
  <img src="docs/screenshots/tag-management-1.png" alt="Tag management" width="30%" />
  <img src="docs/screenshots/tag-management-2.png" alt="Tag management" width="30%" />
</p>
<p align="center">
  <img src="docs/screenshots/search.png" alt="Search conversations" width="45%" />
</p>

### Beautiful AI Responses

AI answers aren't just plain text. Autai renders code with syntax highlighting, math formulas beautifully typeset, Mermaid diagrams as interactive charts, and full rich-text formatting — so complex answers are actually pleasant to read.

<p align="center">
  <img src="docs/screenshots/code-highlighting.png" alt="Code syntax highlighting" width="30%" />
  <img src="docs/screenshots/math-equation.png" alt="Math equation rendering" width="30%" />
  <img src="docs/screenshots/mermaid-rendering.png" alt="Mermaid diagram rendering" width="30%" />
</p>

### Image and file attachments

Upload a screenshot, a document, or any file, and the AI will incorporate it into the conversation.

<p align="center">
  <img src="docs/screenshots/attach-image.png" alt="Attach an image" width="30%" />
  <img src="docs/screenshots/attach-file.png" alt="Attach a file" width="30%" />
  <img src="docs/screenshots/attach-image-conversation.png" alt="Image in conversation" width="30%" />
</p>

### More Highlights

- **Multi-session browsing** — Run multiple independent browser sessions at the same time. Research one topic while the AI books your hotel in another window.
- **You stay in control** — When the AI hits something it shouldn't handle on its own — a CAPTCHA, a login screen, or a payment form — it pauses and hands it back to you. Split-view mode puts the chat on one side and the browser on the other, so you can watch every click, every scroll, every form field as the AI fills it in. You're always in the loop.
- **Spoken responses** — Let the AI read its answers out loud with built-in speech synthesis.
- **Dark mode, light mode, or follow your system** — Pick whatever suits your eyes.
- **English and Chinese UI** — Use the app in either language, with more languages on the way.

---

## How It Works

1. **Download and install** Autai on your computer.
2. **Add your AI provider key** — grab an API key from OpenAI, Anthropic, or any supported provider and paste it into settings.
3. **Tell it what to do** — type in plain language, just like talking to a friend.

That's it. No manual configuration files, no learning curve.

---

## Roadmap

- **alpha 1** — Initial proof of concept
- **alpha 2** — Deep research mode, improved research agent, input focus fixes
- **alpha 3** — Simple browser use mode, improved browser agent, tool fixes
- **alpha 4** — Tag color editing, improved research agent UI, attachment improvement
- **alpha 5** — MCP tools support
- **alpha 6** — Custom system prompts and profiles for browser use agent
- **alpha 7** — Per-conversation model and tool selection
- **alpha 8** — Full-text search across conversations
- **alpha 9** — Computer use proof of concept (terminal use)
- **alpha 10** — CI/CD pipeline, code signing for macOS, Windows, and Flathub
- **beta 1** — Public issue tracker, community-driven bug fixes

---

## Project Status

Autai is currently in **active alpha development**. The software is functional and evolving rapidly. GitHub issues and pull requests will be open to the public once we enter the beta phase.

---

## License

[MIT](LICENSE) — free to use, modify, and share.

---

If you like Autai, please consider giving it a star ⭐ — it helps others discover the project!

<!-- Add your star GIF below -->
<img width="320" height="180" alt="star" src="https://github.com/user-attachments/assets/ac160fea-7073-4f77-9af7-addaba1708d4" />

</div align="center">
