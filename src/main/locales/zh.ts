const zh = {
  welcome: {
    title: "欢迎使用Autai",
    subtitle: "你的AI浏览器助手",
    description:
      "告诉Autai你想做什么，AI会替你操作浏览器——你平时上网做的绝大部分事情，它都会尝试帮你完成。",
    "feature.browse.title": "浏览",
    "feature.browse.description": "自动打开和浏览网站",
    "feature.automate.title": "自动化",
    "feature.automate.description": "让AI替你操作浏览器",
    "feature.extract.title": "整理",
    "feature.extract.description": "帮你整理网上的信息",
    "prompt.suggestion":
      '试着让我"帮我订一张下周五从旧金山到纽约的最便宜机票"或"帮我填写并提交这份申请表"',
  },
  common: {
    mainWindowTitle: "Autai",
  },
  menu: {
    option: "选项",
    resetToLocalMode: "重置为本地模式",
    view: "视图",
    reload: "重新加载",
    forceReload: "强制重新加载",
    toggleDevTools: "切换开发者工具",
    actualSize: "实际大小",
    zoomIn: "放大",
    zoomOut: "缩小",
    toggleFullScreen: "切换全屏",
  },
  update: {
    availableTitle: "发现新版本",
    availableBody: "正在后台下载 v{{version}}...",
    readyTitle: "可以更新了",
    readyBody: "v{{version}} 会在重启后自动安装。",
    errorTitle: "更新出错",
    notPackaged:
      "当前安装方式不支持应用内更新，请从原来的下载渠道获取最新版本。",
    networkError: "网络错误",
  },
  settings: {
    testingTitle: "测试连接",
    testingBody: "正在测试 {{modelId}}...",
    successTitle: "连接成功",
    successBody: "{{modelId}} 连接正常。",
    failedTitle: "连接失败",
    failedNoResponse: "{{modelId}} 没有响应",
    failedBody: "{{modelId}} 连接失败：{{error}}",
  },
  tags: {
    coding: "编程",
    research: "研究",
    creative: "创意",
    planning: "规划",
    learning: "学习",
  },
  entertainment: {
    // Short mode labels — double as the deterministic thread-title suffix and
    // the seeded entertainment tag names (重写 / 互动).
    dehydrate: "重写",
    interactive: "互动",
  },
  agents: {
    searchingTitle: "同步查找多个话题：{{title}}",
    searchLabel: '查找："{{query}}"',
    extractingTitle: "整理结果",
    extractingDescription: "正在同步阅读多个网页并整理内容",
    readLabel: "同步阅读：{{title}}",
    extractionFailed: "提取内容失败：{{error}}",
    extractionLlmFailed: "模型无法提取内容",
    extractionGenericFailed: "提取失败：{{error}}",
    modelNotConfiguredTitle: "模型未配置",
    modelNotConfiguredBody: "还没设置{{role}}模型，请先去设置里配置。",
    providerNotFoundTitle: "找不到提供商",
    providerNotFoundBody: "找不到{{providerId}}，请检查设置。",
    modelUnavailableTitle: "保存的模型已不可用",
    modelUnavailableBody: "该会话保存的聊天模型已不再配置，将回退到默认模型。",
    searchErrorTitle: "搜索错误",
    searchErrorBody:
      '查询"{{query}}"因服务商错误（如频率限制）被跳过：{{error}}',
    extractionErrorTitle: "提取错误",
    extractionErrorBody:
      '页面"{{title}}"因服务商错误（如频率限制）被跳过：{{error}}',
    researchErrorTitle: "研究错误",
    researchErrorBody: "研究过程中发生错误：{{error}}",
    browserUseErrorTitle: "浏览器代理错误",
    browserUseErrorBody: "浏览器自动化过程中发生错误：{{error}}",
    taskErrorTitle: "任务执行错误",
    taskErrorBody: "任务执行过程中发生错误：{{error}}",
    actionErrorTitle: "操作错误",
    actionErrorBody: '子任务"{{label}}"失败：{{error}}',
    deepResearchTitle: "深度研究：{{title}}",
    preResearchTitle: "背景调研",
    preResearchDescription: "正在快速调研",
    preResearchScanning: "正在扫描网页获取项目背景",
    noResultsFound:
      "未找到与您查询相关的搜索结果，请尝试换个说法或使用不同的关键词。",
    timeoutErrorTitle: "请求超时",
    timeoutErrorBody: "请求耗时过长已自动取消，请重试。",
  },
};

export default zh;
