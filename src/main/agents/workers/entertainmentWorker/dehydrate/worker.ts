import type { EntertainmentConfig } from "@shared";
import log from "electron-log/main";
import { entertainmentService } from "@/services";
import { eventBus } from "@/utils/eventBus";
import { getSampleChapter } from "../sample-novel";
import { parseChapters } from "./chapterParser";

const logger = log.scope("EntertainmentWorker:Dehydrate");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 网文脱水 (web-novel dehydrate) pipeline — event-driven and DB-backed, NOT a
 * streaming/AI-SDK worker. The REST chapter route
 * (`POST /entertainment/threads/:id/chapters`) triggers this fire-and-forget;
 * results reach the renderer through the existing `entertainment:chapterReady`
 * SSE event, which the chapters store re-reads from disk. There is no
 * AssistantChatTransport / UIMessage stream on this path.
 *
 * Two phases:
 *
 *   - Ingestion — when the renderer supplies the file's text and the thread has
 *     no chapters yet: parse the headings (`parseChapters`) and create one
 *     `unprocessed` row per detected chapter, each carrying its raw
 *     `originalContent`. This populates the table of contents; dehydrating each
 *     chapter's prose is a later, explicit step.
 *
 *   - Generation — otherwise: produce the next chapter. Currently a placeholder
 *     that assembles the sample chapter, so the reader's existing "Next" path
 *     keeps working until the real LLM dehydrate lands.
 */
export async function runDehydrate(
  threadId: string,
  config: EntertainmentConfig | undefined,
  novelText: string | undefined, // present only for file uploads
  signal?: AbortSignal,
): Promise<void> {
  logger.info("dehydrate invoked", {
    threadId,
    mode: config?.mode,
    hasNovelText: !!novelText,
  });

  const hasChapters = entertainmentService.listChapters(threadId).length > 0;

  // --- Ingestion: parse the uploaded novel into unprocessed chapter rows -----
  if (novelText && !hasChapters) {
    const parsed = parseChapters(novelText);
    parsed.forEach((chapter, i) => {
      entertainmentService.createChapter({
        threadId,
        chapterNumber: i + 1, // ordinal position, per the parser contract
        title: chapter.title,
        status: "unprocessed",
        originalContent: chapter.originalContent,
      });
    });
    entertainmentService.touchThread(threadId);
    logger.info("ingested chapters from file", {
      threadId,
      count: parsed.length,
    });
    // One event after the bulk insert; the store reloads the whole list.
    eventBus.emitEvent("entertainment:chapterReady", { threadId });
    return;
  }

  // --- Generation: assemble the next chapter (sample stub for now) ----------
  const chapterNumber = entertainmentService.nextChapterNumber(threadId);
  const sample = getSampleChapter(chapterNumber);
  const row = entertainmentService.createChapter({
    threadId,
    chapterNumber,
    title: sample.title,
    status: "streaming",
  });

  // Simulate generation (so the "waiting" state is observable); bail on abort.
  const accumulated: string[] = [];
  for (const paragraph of sample.paragraphs) {
    if (signal?.aborted) break;
    accumulated.push(paragraph);
    await delay(250);
  }

  if (signal?.aborted) {
    entertainmentService.updateChapter(row.id, { status: "error" });
    logger.warn("chapter generation aborted", { threadId, chapterId: row.id });
  } else {
    entertainmentService.updateChapter(row.id, {
      status: "complete",
      content: accumulated.join("\n\n"),
    });
    entertainmentService.touchThread(threadId);
    logger.info("chapter ready", {
      threadId,
      chapterId: row.id,
      chapterNumber,
    });
  }

  eventBus.emitEvent("entertainment:chapterReady", {
    threadId,
    chapterId: row.id,
  });
}
