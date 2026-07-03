import log from "electron-log/main";
import type { InternetNovel } from "@shared";

const logger = log.scope("Dehydrate:InternetFetch");

/**
 * Hard-wired final chapter for the internet-fetch STUB only — lets the
 * end-of-book path be exercised e2e. The `/setup` route persists this as the
 * thread's `finalChapterNumber`. A real fetcher will set that number itself
 * when it discovers the book's end.
 */
export const INTERNET_STUB_FINAL_CHAPTER = 40;

/** Per-step stub work duration (simulates network acquisition latency). */
const STUB_DELAY_MS = 2500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// CJK filler sentences cycled so each generated paragraph reads a little
// differently. Throwaway — only used to give the reader long 原文 prose to
// scroll and page through until the real internet fetcher lands.
const FILLER_SENTENCES: readonly string[] = [
  "山间的薄雾尚未散去，露珠挂在草叶上，映着初升的日光，闪烁着细碎的光。",
  "少年握紧了腰间那柄尚未开锋的剑，沿着山道一路向东走去，风从谷底升起，吹动他的衣袂。",
  "酒旗在风中猎猎作响，野店里烟气混着酒香，几个行脚商低声说着青锋山庄与那把剑的传说。",
  "师父临终前的话又在耳边响起——剑是用来守护的，不是用来逞强的；江湖很大，大到能让人忘记最初为何出发。",
  "演武场上钟声悠长，黑袍老者周身寒意森然，白衣女子剑法轻灵，号称一剑光寒，令人不敢逼视。",
  "他把这句话记在心里，深吸一口气，踏入了那扇沉重的朱漆大门，前路漫漫，恩怨未明。",
];

/**
 * Build a long, multi-section CJK body for one chapter so the reader has plenty
 * of 原文 to scroll / page through. Stub-only — the real internet fetcher
 * replaces this. The length is intentionally "very long" (many screens) so the
 * reader's scroll + page-down behaviour is easy to exercise during development.
 */
function buildLongSourceStub(chapterNumber: number): string {
  const sections = 14;
  const parasPerSection = 6;
  const lines: string[] = [
    `第 ${chapterNumber} 章 · 网络获取的原始章节内容（stub 占位）`,
    "",
  ];
  for (let s = 1; s <= sections; s++) {
    lines.push(`## 第 ${s} 节 阅读器滚动测试段落 ${s}`);
    for (let p = 0; p < parasPerSection; p++) {
      const idx = (s * 5 + p * 2) % FILLER_SENTENCES.length;
      const sentence = FILLER_SENTENCES[idx];
      // Repeat the sentence a few times so each paragraph is a hefty block.
      lines.push(`（第 ${s} 节 · 第 ${p + 1} 段）${sentence}${sentence}${sentence}`);
    }
  }
  lines.push("", "（占位长文本结束；实际网络获取逻辑待实现。）");
  return lines.join("\n\n");
}

/**
 * STUB internet source acquisition. Logs the real wizard-configured novel
 * values (title/author/source — persisted on the thread's entertainment config)
 * so the e2e test can confirm they flow through, then produces a long stub
 * chapter body after a short delay. Real network-fetch logic lands later.
 */
export async function fetchInternetChapter(
  novel: InternetNovel,
  chapterNumber: number,
): Promise<string> {
  logger.info("internet fetch", {
    title: novel.title,
    author: novel.author,
    source: novel.source,
    chapterNumber,
  });
  await delay(STUB_DELAY_MS);
  return buildLongSourceStub(chapterNumber);
}
