<div align="center">

<img src="../build/icon.png" alt="Autai 图标" width="96" />

# Autai

**会说人话、也会干活的 AI 助手。**

你只管说，它负责动手：帮你订票、填表、比价、跑腿；帮你搜网页、读来源、汇总答案；追的书注水了？丢给它「脱水」完再端上来。Key 是你自己的，模型随你挑，全程在你自己的电脑上跑。

[下载](https://github.com/upwindchange/autai/releases) · [功能一览](#功能一览) · [娱乐模式](#-娱乐模式网文脱水器) · [三步上手](#三步上手)

[![Release](https://img.shields.io/github/v/release/upwindchange/autai?include_prereleases&style=flat-square)](https://github.com/upwindchange/autai/releases)
[![License](https://img.shields.io/badge/license-MIT-007EC7?style=flat-square)](../LICENSE)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-999999?style=flat-square)](https://github.com/upwindchange/autai/releases)

</div>

---

## 实际效果

**「帮我把这几样东西加进 Target 购物车。」** 一句话说完，Autai 自己开浏览器、挨个搜索、挨个加购，你在旁边看着就行。

<video src="https://github.com/user-attachments/assets/f8b8d85e-3679-4deb-a5de-8fe64092d161" controls="controls" style="max-width:100%;"></video>

**「2026 年一千块以内有哪些笔记本值得买？」** 别再自己开二十个标签页一个个翻了——Autai 自己搜、自己读、自己汇总，答案直接带着来源回来。

<video src="https://github.com/user-attachments/assets/7ac38b43-3e9c-4034-a7cf-8b8ef081bb13" controls="controls" style="max-width:100%;"></video>

<sub>视频为迁就 GitHub 10MB 限制做了加速，实际速度看你用的模型。</sub>

---

## 功能一览

### 模型随便挑

OpenAI、Anthropic、Google、DeepSeek、Mistral、xAI……100+ 家服务商、4000+ 个模型随便切，本地 Ollama 也行。填上 Key 就能用。[完整目录](https://models.dev/)。

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../docs/screenshots/config-provider.png" alt="配置 AI 服务商" width="100%" />
      <br /><sub><b>填个 Key 就能跑</b>——服务商随便加。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="../docs/screenshots/cofig-models.png" alt="四千多个模型里挑" width="100%" />
      <br /><sub><b>四千多个模型</b>——能搜能筛，一键换。</sub>
    </td>
  </tr>
</table>

### 浏览器替你开

- **两种开法**——「简单」模式你说它就做；「规划」模式先列步骤给你过目，点头了才动手。
- **分屏盯着**——聊天一边、浏览器一边，点哪里、填哪里，全程看得见，没有黑箱。
- **该停就停**——验证码、登录、支付这种事它不碰，直接把方向盘还给你。
- **多开互不耽误**——几个独立会话同时跑，这边查资料，那边让它订酒店。

### 查资料不用自己翻

一个输入框，三档力度：快速搜一下要个事实、标准搜索要个靠谱答案、深度调研直接把问题拆开、逐个子话题搜过去读过去，最后连出处一起写给你。

### 对话自己会整理

聊过的自动起标题、自动打彩色标签。想按类别看就切标签分组视图，全文搜索一句话翻出半个月前的对话，旧账还能批量归档——侧边栏不用你动手收拾。

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="../docs/screenshots/Thread-list.png" alt="对话列表" width="100%" />
      <br /><sub><b>自动命名</b>——每个对话自己起标题。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="../docs/screenshots/tag-grouping.png" alt="标签分组视图" width="100%" />
      <br /><sub><b>标签分组</b>——按类别一屏看全。</sub>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/tag-select.png" alt="打彩色标签" width="100%" />
      <br /><sub><b>彩色标签</b>，扫一眼就分清。</sub>
    </td>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/tag-management-1.png" alt="标签管理" width="100%" />
      <br /><sub><b>标签随手管</b>——改名、换色。</sub>
    </td>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/tag-management-2.png" alt="标签管理" width="100%" />
      <br /><sub><b>每个对话独立打标</b>，随时改。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="../docs/screenshots/search.png" alt="全文搜索" width="100%" />
      <br /><sub><b>全文搜索</b>——每个字都翻得到。</sub>
    </td>
  </tr>
</table>

### 回答不是一坨纯文本

代码带高亮，公式排版像教材，Mermaid 图直接渲染成图，富文本一样不缺。复杂答案回来看着不头疼。

<table>
  <tr>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/code-highlighting.png" alt="代码高亮" width="100%" />
      <br /><sub><b>代码</b>——高亮、一键复制。</sub>
    </td>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/math-equation.png" alt="公式渲染" width="100%" />
      <br /><sub><b>公式</b>——正经排版，不是 ASCII。</sub>
    </td>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/mermaid-rendering.png" alt="Mermaid 图表渲染" width="100%" />
      <br /><sub><b>图表</b>——Mermaid 直接成图。</sub>
    </td>
  </tr>
</table>

### 文件拖进去就能聊

截图、文档、手头有什么拖什么，AI 拿来就能用。

<table>
  <tr>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/attach-image.png" alt="上传图片" width="100%" />
      <br /><sub><b>拖张图</b>——截图也行。</sub>
    </td>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/attach-file.png" alt="上传文件" width="100%" />
      <br /><sub><b>拖个文件</b>——模型认的都行。</sub>
    </td>
    <td width="33%" valign="top">
      <img src="../docs/screenshots/attach-image-conversation.png" alt="图片进入对话" width="100%" />
      <br /><sub><b>进了对话</b>——是拿来讨论的。</sub>
    </td>
  </tr>
</table>

### 还有一些顺手的东西

<details>
<summary><b>展开看全部</b></summary>

- **每个对话单独调参**——模型、温度、最大 token、系统提示词，按对话覆盖。
- **斜杠命令**——不碰鼠标，键盘上就把浏览器、快速搜索、深度调研切来切去。
- **MCP 服务器**——设置里接入外部工具。
- **远程访问**——设个密码把 Autai 挂到局域网，手机浏览器也能用。
- **语音朗读**——回答可以直接读给你听。
- **深色 / 浅色 / 跟随系统**。
- **中文 / English 界面**随时切。

</details>

---

## 📚 娱乐模式：网文脱水器

追更十年，我们都练出一种本事：一目十行。不是想跳，是被逼的。

日更八千，干货两千；这章开头复述上章，下章开头复述这章；设定第三次讲解，功法第四次冲击窍穴；擂台又开打了，群众又倒吸凉气了，反派又觉得「这次他必死」了。书是好书，就是泡在水里。

娱乐模式干的就是拧干这件事：**把书脱水，把故事留下。**

- **一键脱水**——复述、重复讲解、擂台车轮、群体震惊这类水文，遇到就压。一个力度旋钮四档可调，从「轻扫一下」到「别废话赶紧推剧情」。剧情、人物、爽点、伏笔一个字不动，砍掉的只有水。
- **顺手翻新文笔**——错别字、病句、单边引号这类硬伤顺手治；「倒吸一口凉气」「嘴角勾起一抹冷笑」这种被写烂的套话直接重写。也可以反着来：开「文笔扩写」，把干瘪的打斗补成拳拳到肉的名场面——扩的是表现力，不是字数。
- **什么语言的书都能看**——整本翻译成中文、把拗口的音译人名理顺、给省略主语的日轻补上「谁在说话」，都不在话下。嫌选项不够？一句话自定义：「文言文翻成白话文，定场诗判词原样保留」——照办。

书的来源随便给：本地 TXT 拖进来，或者只说个书名——贴链接、提站名、丢几个关键词都行，它自己上网找。天涯长帖、邮件串这种没有章节的连续文本，勾一下「非章节小说」照读不误。

<details>
<summary><b>它认识的水字数套路——16 大类 85 种，逐条可勾</b></summary>
<br />

擂台赛/排名赛循环 · 打小怪刷杂兵 · 战斗拆帧描写（一拳两千字）· 招式名技能说明刷屏 · 战力等级每到新图重新科普 · 假逆风真底牌 · 打了小的来老的 · 群众倒吸凉气 · 群体心理描写 · 路人解说背景 · 弹幕评论论坛体刷屏 · 震惊体媒体报道 · 世界观百科 · 物品宝物档案 · 新城地图导览 · 家族宗门谱系 · 修炼流程复写 · 系统面板整页刷新 · 抽奖签到开盲盒 · 误会不解释拉扯三十章 · 内心戏反复横跳 · 吃醋桥段循环 · 换装妆造描写 · 主角外貌每次重新夸 · 宴会舞会宫宴 · 家长里短亲戚群像 · 反派嘲讽铺垫 · 降智反派反复送人头 · 阴谋全程旁白直播 · 审判对质反转再反转 · 吃饭描写 · 赶路旅行 · 逛街购物打脸 · 做任务刷副本 · 训练学习顿悟 · 车轱辘话 · 明知故问引设定 · 开会轮流表态 · 「真的？」「是真的。」· 高潮前切视角 · 同一件事五视角重播 · 回忆杀 · 梦境幻境试炼 · 秘境遗迹探索 · 拍卖会 · 宗门学院考核 · 反复隐藏实力 · 马甲一层层揭 · 没人认识主角 · 阶段排行榜 · 奖励结算界面 · 真假千金家庭拉扯 · 恶毒女配作妖 · 霸总控制欲日常 · 萌宝助攻撮合 · 综艺直播任务 · 退婚三年之约 · 收小弟纳头便拜 · 后宫角色轮番出场 · 捡漏鉴宝 · 医术救人拜服 · 科技参数说明 · 末世物资清单 · 基地建设流水账 · 副本规则说明书 · 解谜反复试错 · 商战会议 · 公司对赌项目竞争 · 试镜拍戏热搜爆 · 粉圈撕番控评 · 章首复述前情 · 章末强行悬念 · 同义句堆叠 · 形容词连打 · 环境气氛反复渲染 · 数字化堆砌 · 小地图升大地图模板 · 危机解决更大危机 · 准备阶段无限拉长 · 等待结果 · 宫斗请安赏赐规矩 · 宅斗账本嫁妆 · 种田农活流程 · 年代文票证邻里 · 克苏鲁不可名状拖延

每种套路都能单独勾选强制处理；不过多数时候不用动——力度旋钮本身就够聪明，哪类删不干净再回来点名。

</details>

脱完的书装在一个正经阅读器里：11 套主题、字号字距行距段距全可调、目录、书签、沉浸模式，读到哪自动记住，章节随时导出成文件离线存档。

另外，「有声小说」模式开发中：男女主配角分别配音的多人有声剧，或按评书路子讲播，敬请期待。

---

## 三步上手

1. **[下载安装](https://github.com/upwindchange/autai/releases)**——macOS、Windows、Linux 都有。
2. **填个 API Key**——哪家服务商都行，本地 Ollama 也可以。
3. **说人话**——想干嘛直接说，没有配置文件，没有学习成本。

发现问题、想提需求？[开个 Issue](https://github.com/upwindchange/autai/issues)。

---

## 接下来会做

- **电脑操控**——不限于浏览器：终端、整个桌面。
- **有声小说**——多人有声剧与评书体讲播。
- **Flathub 上架与自动更新**。
- **界面语言持续增加**。

---

## 开源协议

[MIT](../LICENSE)——随便用、随便改、随便分享。

---

<div align="center">

**觉得省事了，点个 Star ⭐——让更多人少翻二十个标签页。**

<img width="320" height="180" alt="star" src="https://github.com/user-attachments/assets/ac160fea-7073-4f77-9af7-addaba1708d4" />

</div>
