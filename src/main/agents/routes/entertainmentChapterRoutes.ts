import { Hono } from "hono";
import { z } from "zod";
import { entertainmentService, threadPersistenceService } from "@/services";
import { runDehydrate } from "@agents/workers/entertainmentWorker/dehydrate/worker";
import { EntertainmentConfigSchema } from "@shared";
import log from "electron-log/main";

const logger = log.scope("ApiServer:EntertainmentChapters");

export const entertainmentChapterRoutes = new Hono();

const GenerateChapterSchema = z.object({
  config: EntertainmentConfigSchema.optional(),
  // Raw novel text for file uploads (dehydrate ingestion). The renderer reads the
  // File as UTF-8 text and sends it inline; present only on the first chapter of
  // a file-novel thread. Omitted for the "generate next chapter" (Next button) path.
  novelText: z.string().optional(),
});

// A safety-net timeout so a detached generation can never hang forever. The
// stub finishes in a couple of seconds; this is well beyond that.
const GENERATION_TIMEOUT_MS = 120_000;

// GET /entertainment/threads/:threadId/chapters — light chapter list (no
// content), ordered by chapterNumber. Drives the table of contents and the
// reader's chapter ordering. Includes `status:'streaming'` rows so a thread's
// "waiting/generating" state is derivable from the list.
entertainmentChapterRoutes.get("/threads/:threadId/chapters", (c) => {
  try {
    const threadId = c.req.param("threadId");
    const chapters = entertainmentService.listChapters(threadId);
    return c.json({ chapters });
  } catch (error) {
    logger.error("Error listing chapters:", error);
    return c.json({ error: "Failed to list chapters" }, 500);
  }
});

// GET /entertainment/threads/:threadId/chapters/:chapterId — single chapter
// incl. its prose `content` (read from disk by the reader on demand).
entertainmentChapterRoutes.get(
  "/threads/:threadId/chapters/:chapterId",
  (c) => {
    try {
      const threadId = c.req.param("threadId");
      const chapterId = c.req.param("chapterId");
      const chapter = entertainmentService.getChapter(threadId, chapterId);
      if (!chapter) return c.json({ error: "Chapter not found" }, 404);
      return c.json({ chapter });
    } catch (error) {
      logger.error("Error getting chapter:", error);
      return c.json({ error: "Failed to get chapter" }, 500);
    }
  },
);

// POST /entertainment/threads/:threadId/chapters — start/continue the dehydrate
// pipeline. Persists config + sets up the thread on the first chapter, then runs
// the (detached) worker. With `novelText` it ingests the file into unprocessed
// chapter rows; otherwise it generates the next chapter. Returns 202 immediately;
// the worker creates rows and emits `entertainment:chapterReady`, which the store
// re-reads from disk. `config` is required on the first chapter.
entertainmentChapterRoutes.post("/threads/:threadId/chapters", async (c) => {
  try {
    const threadId = c.req.param("threadId");
    const body = await c.req.json().catch(() => ({}));
    const parsed = GenerateChapterSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }
    const { config, novelText } = parsed.data;

    // Defensive: make sure the thread row exists (covers assistant-ui
    // materialization timing).
    if (!threadPersistenceService.getThread(threadId)) {
      threadPersistenceService.createThread(threadId, "entertainment");
    }

    const isFirst = !entertainmentService.getEntertainmentConfig(threadId);
    if (isFirst) {
      if (!config) {
        return c.json(
          { error: "config is required when starting the first chapter" },
          400,
        );
      }
      entertainmentService.upsertEntertainmentConfig(threadId, config);
      entertainmentService.setupEntertainmentThread(threadId, config);
    } else if (config) {
      entertainmentService.upsertEntertainmentConfig(threadId, config);
    }

    // Fire-and-forget: the worker owns all parsing/generation and signals the
    // renderer via entertainment:chapterReady. Survives the 202 response.
    void runDehydrate(
      threadId,
      config,
      novelText,
      AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    ).catch((err) =>
      logger.error("dehydrate pipeline failed", { threadId, err }),
    );

    return c.json({ queued: true }, 202);
  } catch (error) {
    logger.error("Error starting chapter generation:", error);
    return c.json({ error: "Failed to start chapter generation" }, 500);
  }
});
