const zh = {
  common: {
    mainWindowTitle: "Autai",
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
    providerNotFoundBody: "找不到「{{providerId}}」，请检查设置。",
  },
};

export default zh;
