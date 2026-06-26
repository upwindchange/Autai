import { generateText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { simpleModel } from "@agents/providers";
import { settingsService, threadPersistenceService } from "@/services";
import { i18n } from "@/i18n";
import log from "electron-log/main";
import { eventBus } from "@/utils/eventBus";

const logger = log.scope("ThreadIntelligenceService");

function extractTextFromUIMessage(msg: UIMessage): string {
  if (!msg.parts) return "";
  return msg.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

const DEFAULT_TAG_KEYS = [
  "tags.coding",
  "tags.research",
  "tags.creative",
  "tags.planning",
  "tags.learning",
];

const DEFAULT_TAG_COLORS = [
  "#4E79A7",
  "#59A14F",
  "#B07AA1",
  "#EDC948",
  "#76B7B2",
];

// Fixed entertainment tags (重写 / 互动). Seeded mode-scoped so the chat
// sidebar never sees them. Translated at seed time — same locale-at-creation
// behavior as the chat tags above.
const ENTERTAINMENT_TAG_KEYS = [
  "entertainment.dehydrate",
  "entertainment.interactive",
];

const ENTERTAINMENT_TAG_COLORS = ["#F28E2B", "#E15759"];

/** All 16 palette colors (shared with renderer's tagColors.ts). */
const PALETTE = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
  "#1B9E77",
  "#D95F02",
  "#7570B3",
  "#E7298A",
  "#66A61E",
  "#E6AB02",
];

function getRandomPaletteColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
}

class ThreadIntelligenceService {
  initialize(): void {
    this.seedDefaultTags();
    this.seedEntertainmentTags();
  }

  private seedDefaultTags(): void {
    try {
      const existingTags = threadPersistenceService.listTags();
      if (existingTags.length === 0) {
        for (let i = 0; i < DEFAULT_TAG_KEYS.length; i++) {
          threadPersistenceService.createTag(
            i18n.t(DEFAULT_TAG_KEYS[i]!),
            DEFAULT_TAG_COLORS[i]!,
            i,
          );
        }
        logger.info("Seeded default tags");
      }
    } catch (error) {
      logger.error("Failed to seed default tags:", error);
    }
  }

  // Entertainment tags (重写 / 互动) are fixed, so this is idempotent and runs
  // every launch — unlike seedDefaultTags (which only fires on an empty table),
  // this also backfills existing DBs that already have the chat tags.
  private seedEntertainmentTags(): void {
    try {
      const existing = threadPersistenceService.listTagsByMode("entertainment");
      for (let i = 0; i < ENTERTAINMENT_TAG_KEYS.length; i++) {
        const name = i18n.t(ENTERTAINMENT_TAG_KEYS[i]!);
        if (!existing.some((t) => t.name === name)) {
          threadPersistenceService.createTag(
            name,
            ENTERTAINMENT_TAG_COLORS[i]!,
            i,
            "entertainment",
          );
        }
      }
    } catch (error) {
      logger.error("Failed to seed entertainment tags:", error);
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
      // Chat threads only ever see chat-scoped tags — entertainment tags
      // (重写/互动) are invisible to the LLM tagger.
      const existingTags = threadPersistenceService.listTagsByMode("chat");
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
          const newTag = threadPersistenceService.createTag(
            args.tag,
            getRandomPaletteColor(),
          );
          threadPersistenceService.addTagToThread(threadId, newTag.id);
          logger.info("Created and tagged thread with new tag", {
            threadId,
            tag: args.tag,
          });
        }
      }

      // Notify renderer to refresh thread metadata.
      // DB `color` is nullable but the shared TagRow contract (and renderer)
      // expects a string; null is coerced to "" so getTagChipStyle's muted
      // fallback still applies.
      const updatedTags = threadPersistenceService
        .getTagsForThread(threadId)
        .map((t) => ({ ...t, color: t.color ?? "" }));
      eventBus.emitEvent("threads:metadataUpdated", {
        threadId,
        title: args.title,
        tags: updatedTags,
      });
    } catch (error) {
      logger.error("Failed to enrich thread:", error);
    }
  }

  async generateSuggestions(
    threadId: string,
    messages: UIMessage[],
  ): Promise<void> {
    try {
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      const lastAssistantMsg = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");

      if (!lastUserMsg || !lastAssistantMsg) return;

      const userText = extractTextFromUIMessage(lastUserMsg);
      const assistantText = extractTextFromUIMessage(lastAssistantMsg).slice(
        0,
        2000,
      );

      const result = await generateText({
        model: simpleModel(),
        system: `You are a follow-up suggestion generator. Given the conversation so far, generate exactly 3 concise follow-up prompts the user might want to ask next. Each prompt should be a short, natural question or request (under 15 words). Make the suggestions diverse — cover different angles of the topic. Always respond by calling the setFollowUpSuggestions tool.`,
        prompt: `Last user message: "${userText}"\n\nLast assistant response: "${assistantText}"`,
        toolChoice: "required",
        tools: {
          setFollowUpSuggestions: tool({
            description: "Set follow-up suggestions for the conversation",
            inputSchema: z.object({
              suggestions: z
                .array(
                  z.object({
                    prompt: z
                      .string()
                      .describe("A short follow-up prompt (under 15 words)"),
                  }),
                )
                .describe("3 follow-up suggestions"),
            }),
          }),
        },
      });

      const toolCall = result.toolCalls[0];
      if (!toolCall || toolCall.toolName !== "setFollowUpSuggestions") {
        logger.warn("No setFollowUpSuggestions tool call in response");
        return;
      }

      const { suggestions } = toolCall.input as {
        suggestions: { prompt: string }[];
      };

      eventBus.emitEvent("threads:suggestionsUpdated", {
        threadId,
        suggestions,
      });
    } catch (error) {
      logger.error("Failed to generate suggestions:", error);
    }
  }
}

export const threadIntelligenceService = new ThreadIntelligenceService();
