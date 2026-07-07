import { generateText } from "ai";
import log from "electron-log/main";
import { simpleModel } from "@agents/providers";
import { settingsService } from "@/services";
import { TIMEOUTS } from "@agents/utils";

const logger = log.scope("Dehydrate:Outliner:Compressor");

/**
 * Compression ratio target: the merged outline should compress to roughly this
 * fraction of its input length. Used only as guidance in the prompt — the
 * simple model decides the actual brevity. 0.5 keeps the cumulative context
 * from growing linearly across batches while preserving every plot point.
 */
const TARGET_RATIO = 0.5;

/**
 * Compress a merged set of per-chapter outlines into a single consolidated
 * "前情大纲" summary using the simple (cheap) model. Called by the batcher
 * after each batch's outlines land, so the next batch's prior-context prefix
 * stays bounded instead of growing linearly with chapter count.
 *
 * Per the design decision, context length is NOT budgeted here — the simple
 * model is assumed to handle the full merged input. If it ever fails, the
 * caller degrades gracefully (keeps the un-compressed merge).
 *
 * Input is the full list of outline strings accumulated so far (each already
 * prefixed with its chapter number, e.g. "第 12 章：..."). Returns the
 * compressed prose, or `null` on any failure (caller falls back to the
 * un-compressed merge).
 */
export async function compressPriorOutline(
  threadId: string,
  outlines: string[],
): Promise<string | null> {
  if (outlines.length === 0) return "";

  const input = outlines.join("\n");
  const systemPrompt =
    "你是一名小说连载编辑。下面给你一份按章节顺序排列的剧情大纲汇总（每条形如「第 N 章：…」）。" +
    "请把它压缩成一份连贯的前情提要，要求：\n" +
    "- 保留所有推动主线的事件、关键人物决定、不可逆的后果、已埋下的伏笔与承诺；\n" +
    "- 合并重复的套路与同类事件，去掉可由前后文推断的过渡信息；\n" +
    "- 仍按章节顺序组织，但可以多条合并为一句；\n" +
    `- 目标长度约为原文的 ${Math.round(TARGET_RATIO * 100)}%，但宁可多保留关键信息也不要丢失伏笔；\n` +
    "- 只输出压缩后的前情提要正文，不要解释、不要标题、不要复述本指令。";

  try {
    const result = await generateText({
      model: simpleModel().model,
      system: systemPrompt,
      messages: [{ role: "user", content: input }],
      maxRetries: settingsService.settings.maxRetries,
      timeout: TIMEOUTS.chat,
      experimental_telemetry: {
        isEnabled: settingsService.settings.langfuse.enabled,
        functionId: "entertainment-outliner-compress",
        metadata: { threadId, inputChapters: outlines.length },
      },
    });
    const compressed = result.text.trim();
    if (!compressed) {
      logger.warn("compressor returned empty text", {
        threadId,
        inputChapters: outlines.length,
      });
      return null;
    }
    logger.info("compressed prior outline", {
      threadId,
      inputChapters: outlines.length,
      inputLen: input.length,
      outputLen: compressed.length,
    });
    return compressed;
  } catch (err) {
    logger.error("compressor failed", {
      threadId,
      inputChapters: outlines.length,
      err,
    });
    return null;
  }
}
