# Shared Description — both stores, both languages

The long **Description** and the initial **What's New / Release notes** copy are
used verbatim by both stores, in both listing languages. They live here, in this
one document — the per-store files hold only store-specific fields.

Where each block pastes:

| Block | Mac App Store (App Store Connect) | Microsoft Store (Partner Center) |
|---|---|---|
| Description | App Store tab → Description (4,000 chars) | Store listings → Description (10,000 chars) |
| Release notes | App Store tab → What's New (4,000 chars) | Store listings → Release notes (1,500 chars) |

Character counts are exact for the fenced text — recount after any edit
(`wc -m` for characters, `wc -c` for bytes).

The en-US and zh-Hans descriptions are deliberately different pieces of
writing: the zh-Hans copy is written for Chinese internet users in their own
voice, not translated from the en-US copy. They share claims and facts (and
must not contradict each other) but nothing else.

Provider/model figures: **225+ providers, 8,000+ models** — recounted 2026-11-17
from `resources/providers/` (225 `provider.toml`, 8,399 `models/*.toml`).
Recount with:

```bash
find resources/providers -name 'provider.toml' | wc -l
find resources/providers -path '*/models/*.toml' | wc -l
```

## Description — English (en-US)

```
Free web research — with a Deep Research mode that writes full, cited reports — plus an AI editor for the books you read. One app, two jobs, both done properly.

RESEARCH — FREE TO SEARCH, DEEP WHEN IT COUNTS
Three depths, one command bar: a quick pass when you just need a fact, standard search when you want a solid answer with sources, and Deep Research when the question deserves a real report.

Deep Research decomposes the question into subtopics, then plans, searches, and reads across the open web — chasing every thread until the picture is complete — and writes the whole thing up as a structured report with references. It's Perplexity-style research built into your chat app, except the searching is free: Autai drives a real browser straight to Google and Bing, so there are no search-API keys, no subscriptions, and no per-query fees. The only meter running is the model you already brought a key for.

STORY MODE — CUT THE WORD COUNT, KEEP THE STORY
Web serials ship a chapter a day and it shows. Fan translations fight grammar to a draw. Some books are 40% story and 60% word count. Story Mode puts an AI editor between you and the rough draft.

• Cut the word count, keep the story. Last chapter recapped again, the magic system re-explained, another tournament round, one more collective gasp from the crowd — compressed on contact. A single dial sets how hard, from light touch to get on with it. The plot, characters, payoffs, and foreshadowing stay exactly where the author left them.
• Fix the prose. Grammar, punctuation, and the clichés every serial leans on — rewritten until they stop being clichés. Or run it the other direction: an expansion pass turns flat fight scenes into set pieces, without padding a single paragraph.
• Read fiction from any language. Translate the whole book, restore the “…,” she said that Japanese light novels drop, or type one custom instruction — keep the poems in verse — and it complies.
• Bring the book from anywhere. Drop in a local TXT, or just say the title — paste a link, name a site, or throw keywords at it and Autai goes and finds it online.
• A proper reader. Eleven themes, typography controls down to letter spacing, a table of contents, bookmarks, zen mode, and it remembers exactly where you stopped. Chapters export as files whenever you want them offline.

A FULL AI WORKBENCH UNDERNEATH
Any provider, any model. OpenAI, Anthropic, Google, DeepSeek, Mistral, xAI — 225+ providers in all, 8,000+ models. Bring your own API key, point it at any self-hosted or local API, and switch whenever you like.

Yours to host. Autai runs on your machine and serves its full interface to any browser on your network — desktop, phone, tablet — with a mobile layout built for the small screen and optional password sign-in. Your keys, your conversations, your books: all local.

Browser automation with you in the loop. The AI plans the steps, then operates a real browser to finish the job — forms, bookings, carts, cross-store comparisons — in a split view where every click and field happens in plain sight. CAPTCHAs, logins, and payment forms pause the agent and hand the wheel back to you.

Conversations that organize themselves. Threads get auto-titled and tagged with color-coded labels; flip to a tag-grouped view, search your history, and bulk-archive the old stuff.

Answers worth reading. Code with syntax highlighting, math typeset like a textbook, Mermaid diagrams rendered right in the conversation.

MORE
• Attach screenshots and files to the conversation
• Per-conversation overrides: model, temperature, max tokens, system prompt
• Slash commands to switch modes without leaving the keyboard
• MCP tool servers
• Spoken answers via built-in speech synthesis
• Dark, light, or system theme

Your API keys, your models, running on your machine. Autai is open source (MIT).

Support: https://github.com/upwindchange/Autai/issues
```

→ 3,904 characters.

## Description — 简体中文（zh-Hans）

```
网文追更追到水到发指？查个资料全是广告和标题党内容农场？Autai 就治这两件事：把书脱水，把资料查穿。顺手还附赠一套跑在你自己机器上的 AI 工作台。

【追网文？把网文作者丢去三体世界脱水，脱水，脱水！】
网文日更八千，水在哪儿大家都懂：复述上一章、设定第三次讲解、围观群众集体震惊、路人解说员上岗、杂兵排队送人头、招式名和战力等级刷屏、车轱辘话来回说。这些水文套路，脱水器内置了 85 种情景——章内脱水 51 种，跨章并写 34 种：前文讲透的设定，后文再提就一笔带过；擂台一轮接一轮、误会拉扯、降智反派反复送人头这种跨章循环，只留最爽的那遍。

剩下的活儿全丢给 AI：选个脱水力度（从「轻扫一下」到「别废话推剧情」），出来的版本水没了、故事还在——人物、爽点、伏笔一个不动。

文笔顺手治。病句错字是基本功，「倒吸一口凉气」这种用烂的梗直接改写；想反着来也行，打斗太干瘪就开扩写，补的是画面感，不是字数。

语言不是障碍。生肉整本翻好，日轻丢掉的「谁在说话」给你补上；嫌不够就加一句自己的规矩——文言文怎么翻、诗词留不留——它照办。

书从哪来都行：TXT 直接拖，或者甩个书名、链接、几个关键词，它自己上网找。天涯长帖、邮件串这种没章节的连续文本，勾一下「非章节小说」照样读。

读的时候是正经阅读器：11 套主题，字号、字距、行距、段距全可调，目录、书签、沉浸模式一个不少，读到哪自动记住，章节随时导出。

【查资料：不收搜索费，查得深还能出报告】
一个命令栏，三档力度：要个事实，快速搜一下；要个靠谱答案，标准搜索，带来源；问题值得认真对待，就上深度调研。

深度调研是真干活：先把问题拆成几个子问题，分头去搜、挨个点开读，线索追到底，最后攒成一篇带引用的完整报告。写方案、做功课、入坑前摸底，省下的都是你开二十个标签页的命。

关于钱：搜索全程免费。它自己开浏览器去 Google、Bing 翻，不走搜索 API、不按次计费，你只花本来就该花的模型 token——Key 还是你自己的。

【自己 host，哪块屏幕都是它的主场】
Autai 跑在你自己的机器上：对话、书、Key 全在本地，隐私全是你自己的。

想躺床上用手机看？开远程访问，手机、平板、电脑直接用——专门的浏览器手机排版，不是把桌面页挤扁糊弄你。想加个密码，登录才能用？没问题。

【模型不设限】
OpenAI、Anthropic、Google、DeepSeek、Mistral、xAI……225+ 家服务商、8000+ 个模型随便切，自建 / 本地 API 也认，填上 Key 就跑。

【用上了就回不去】
• 浏览器跑腿：「把这几样加进购物车」一句话说完，它自己开浏览器干，全程分屏看得见；验证码、登录、支付一出现立刻停手，方向盘还你
• 对话自动起标题、打彩色标签，标签分组一屏看完；半个月前聊的搜一下就出来，旧账批量归档
• 代码高亮、公式排版像教材、流程图和图表直接在对话里成图
• 截图、文档拖进来就能聊；每个对话单独调参：模型、温度、token 上限、系统提示词
• 斜杠命令切模式，手不离键盘；MCP 工具服务器；回答能读给你听；深浅色跟系统

开源（MIT）。提需求、报 bug 来 GitHub：https://github.com/upwindchange/Autai/issues
```

→ 1,397 字符（3,697 字节）。

## What's New / Release notes — English (en-US)

```
Initial release.

• Free web research — quick, standard, and Deep Research that writes full reports with references
• Story Mode: AI editing for web serials and fan translations — cut the filler, keep the story, read in a proper reader
• Self-host it: use it from any browser on your network — mobile layout included — with optional password sign-in
• 225+ providers, 8,000+ models — bring your own API key, self-hosted and local APIs included
• AI browser automation with a split view and human-in-the-loop pauses
```

→ 514 characters.

## 新功能 / 发行说明 — 简体中文（zh-Hans）

```
首发版本。

• 免费调研：快速、标准、深度三档，深度调研产出带引用的完整报告
• 故事模式：网文、生肉翻译丢进来，拧干水分、留下故事，装进正经阅读器
• 自己 host：手机、平板、电脑打开浏览器即用，手机专属排版，可设密码
• 225+ 家服务商、8000+ 个模型，自带 Key，自建 / 本地 API 也支持
• 浏览器替你跑腿：全程分屏可见，验证码、登录、支付自动交还方向盘
```

→ 192 字符（498 字节）。
