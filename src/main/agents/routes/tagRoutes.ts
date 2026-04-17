import { Hono } from "hono";
import { threadPersistenceService } from "@/services";
import { CreateTagSchema, UpdateTagSchema } from "../schemas/apiSchemas";
import log from "electron-log/main";

const logger = log.scope("ApiServer:Tags");
export const tagRoutes = new Hono();

// GET /tags - list all tags
tagRoutes.get("/", async (c) => {
  try {
    const tags = await threadPersistenceService.listTags();
    return c.json({ tags });
  } catch (error) {
    logger.error("Error listing tags:", error);
    return c.json({ error: "Failed to list tags" }, 500);
  }
});

// POST /tags - create tag
tagRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CreateTagSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid tag data", details: parsed.error.issues },
        400,
      );
    }
    const tag = await threadPersistenceService.createTag(
      parsed.data.name,
      parsed.data.sortOrder,
    );
    return c.json({ tag }, 201);
  } catch (error) {
    logger.error("Error creating tag:", error);
    return c.json({ error: "Failed to create tag" }, 500);
  }
});

// PATCH /tags/:id - rename tag
tagRoutes.patch("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const parsed = UpdateTagSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid tag data", details: parsed.error.issues },
        400,
      );
    }
    await threadPersistenceService.renameTag(id, parsed.data.name);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error renaming tag:", error);
    return c.json({ error: "Failed to rename tag" }, 500);
  }
});

// DELETE /tags/:id - delete tag
tagRoutes.delete("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    await threadPersistenceService.deleteTag(id);
    return c.json({ success: true });
  } catch (error) {
    logger.error("Error deleting tag:", error);
    return c.json({ error: "Failed to delete tag" }, 500);
  }
});
