import { generateText, tool } from "ai";
import { z } from "zod";
import { simpleModel } from "@agents/providers";
import { settingsService, threadPersistenceService } from "@/services";
import log from "electron-log/main";
import { BrowserWindow } from "electron";

const logger = log.scope("ThreadIntelligenceService");

const DEFAULT_TAGS = [
  "General",
  "Coding",
  "Research",
  "Creative",
  "Planning",
  "Learning",
];

class ThreadIntelligenceService {
  initialize(): void {
    this.seedDefaultTags();
  }

  private seedDefaultTags(): void {
    try {
      const existingTags = threadPersistenceService.listTags();
      if (existingTags.length === 0) {
        for (let i = 0; i < DEFAULT_TAGS.length; i++) {
          threadPersistenceService.createTag(DEFAULT_TAGS[i]!, i);
        }
        logger.info("Seeded default tags:", DEFAULT_TAGS);
      }
    } catch (error) {
      logger.error("Failed to seed default tags:", error);
    }
  }

  async enrichThread(
    threadId: string,
    firstUserMessage: string,
  ): Promise<void> {
    try {
      logger.info("Enriching thread", {
        threadId,
        messageLength: firstUserMessage.length,
      });

      const settings = settingsService.settings;
      const existingTags = threadPersistenceService.listTags();
      const tagNames = existingTags.map((t) => t.name);

      const tagInstruction =
        settings.autoTagEnabled ?
          settings.autoTagCreationEnabled ?
            `Pick the most appropriate tag from the existing tags list, or suggest a new short tag name (1-2 words) if none of the existing tags fit well.`
          : `Pick the most appropriate tag from the existing tags list. You MUST use one of the existing tags.`
        : `You can put "none" for the tag.`;

      const systemPrompt = `You are a conversation categorization assistant. Given the first user message of a conversation, generate a concise title and assign the most appropriate tag.

EXISTING TAGS: ${tagNames.length > 0 ? tagNames.join(", ") : "None"}

INSTRUCTIONS:
- Generate a concise title (3-6 words) that summarizes the user's intent
- ${tagInstruction}
- Always respond by calling the setThreadMeta tool`;

      const result = await generateText({
        model: simpleModel(),
        system: systemPrompt,
        prompt: `First user message: "${firstUserMessage}"`,
        toolChoice: "required",
        tools: {
          setThreadMeta: tool({
            description: "Set the title and category tag for a conversation",
            inputSchema: z.object({
              title: z
                .string()
                .describe(
                  "A concise 3-6 word title summarizing the conversation",
                ),
              tag: z.string().describe("The most appropriate tag name"),
            }),
          }),
        },
      });

      // Extract tool call result
      const toolCall = result.toolCalls[0];
      if (!toolCall || toolCall.toolName !== "setThreadMeta") {
        logger.warn(
          "No setThreadMeta tool call in response, skipping enrichment",
        );
        return;
      }

      const args = toolCall.input as { title: string; tag: string };

      // Always rename the thread
      threadPersistenceService.renameThread(threadId, args.title);
      logger.info("Renamed thread", { threadId, title: args.title });

      // Tag the thread if auto-tag is enabled
      if (
        settings.autoTagEnabled &&
        args.tag &&
        args.tag.toLowerCase() !== "none"
      ) {
        const matchedTag = existingTags.find(
          (t) => t.name.toLowerCase() === args.tag.toLowerCase(),
        );

        if (matchedTag) {
          threadPersistenceService.addTagToThread(threadId, matchedTag.id);
          logger.info("Tagged thread with existing tag", {
            threadId,
            tag: matchedTag.name,
          });
        } else if (settings.autoTagCreationEnabled) {
          const newTag = threadPersistenceService.createTag(args.tag);
          threadPersistenceService.addTagToThread(threadId, newTag.id);
          logger.info("Created and tagged thread with new tag", {
            threadId,
            tag: args.tag,
          });
        }
      }

      // Notify renderer to refresh thread metadata
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("threads:metadataUpdated", { threadId });
      });
    } catch (error) {
      logger.error("Failed to enrich thread:", error);
    }
  }
}

export const threadIntelligenceService = new ThreadIntelligenceService();
