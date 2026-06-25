import { Hono } from "hono";
import { z } from "zod";
import { entertainmentService } from "@/services";
import { EntertainmentConfigSchema } from "@shared";
import log from "electron-log/main";

const logger = log.scope("ApiServer:EntertainmentChapters");

export const entertainmentChapterRoutes = new Hono();

const GenerateChapterSchema = z.object({
  config: EntertainmentConfigSchema.optional(),
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

// POST /entertainment/threads/:threadId/chapters — start/continue generation.
// Inserts an in-progress chapter row, returns 202 immediately, and runs the
// (detached) stub generation which writes the complete row + fires
// `entertainment:chapterReady`. `config` is required on the first chapter.
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

    const existing = entertainmentService.getEntertainmentConfig(threadId);
    const isFirst = !existing;
    if (isFirst && !parsed.data.config) {
      return c.json(
        { error: "config is required when starting the first chapter" },
        400,
      );
    }

    const { chapterId, chapterNumber, title } = entertainmentService.beginChapter(
      threadId,
      parsed.data.config,
    );

    // Fire-and-forget: survives the 202 response. On completion (or abort) it
    // writes the row and emits entertainment:chapterReady.
    void entertainmentService
      .generateChapter(
        threadId,
        chapterId,
        chapterNumber,
        AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      )
      .catch((err) =>
        logger.error("chapter generation failed", { threadId, chapterId, err }),
      );

    return c.json({ chapterId, chapterNumber, title }, 202);
  } catch (error) {
    logger.error("Error starting chapter generation:", error);
    return c.json({ error: "Failed to start chapter generation" }, 500);
  }
});
