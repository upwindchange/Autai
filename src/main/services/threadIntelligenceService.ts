import { generateText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { simpleModel } from "@agents/providers";
import { settingsService, threadPersistenceService } from "@/services";
import { i18n } from "@/i18n";
import log from "electron-log/main";
import { eventBus } from "@/utils/eventBus";
import type { ThreadMode } from "@shared/tag";
import { ENTERTAINMENT_DEFAULT_TAGS } from "./entertainmentDefaultTags";

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

// Fixed entertainment tags (重写 / 有声小说). Seeded mode-scoped so the chat
// sidebar never sees them. Translated at seed time — same locale-at-creation
// behavior as the chat tags above.
const ENTERTAINMENT_TAG_KEYS = [
  "entertainment.dehydrate",
  "entertainment.audiobook",
];

const ENTERTAINMENT_TAG_COLORS = ["#F28E2B", "#E15759"];

// Orphaned translated tag names from before the audiobook mode was named.
// Seeded at creation in existing DBs; the mode was never selectable, so no
// thread carries them — deletion is safe and idempotent. Purged every launch
// until gone.
const STALE_ENTERTAINMENT_TAG_NAMES = ["互动", "Interactive"];

// Hidden one-shot marker (raw settings KV, never surfaced to the renderer) that
// records whether the Chinese entertainment genre tags have been auto-seeded.
// Once set, the auto-seed never re-runs — users may freely edit/delete the
// seeded tags. The manual "Reset to default" action backfills independently of
// this flag.
const CHINESE_TAGS_POPULATED_FLAG = "chinese_entertainment_tags_populated";

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
    this.populateChineseEntertainmentTagsIfPending();
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
      const tags = threadPersistenceService.listTagsByMode("entertainment");
      const taken = new Set(tags.map((t) => t.name));
      this.backfillTags(
        ENTERTAINMENT_TAG_KEYS,
        ENTERTAINMENT_TAG_COLORS,
        "entertainment",
        taken,
      );
      // Purge the orphaned pre-rename tag name (best-effort; a no-op once
      // gone).
      for (const stale of STALE_ENTERTAINMENT_TAG_NAMES) {
        const row = tags.find((t) => t.name === stale);
        if (row) threadPersistenceService.deleteTag(row.id);
      }
    } catch (error) {
      logger.error("Failed to seed entertainment tags:", error);
    }
  }

  // Insert the i18n-translated default tags for a mode, skipping any name that
  // already exists. `taken` is the set of names already present (across all
  // modes — `tags.name` is globally unique and createTag throws on conflict) and
  // is mutated to include newly inserted names so callers can chain backfills.
  private backfillTags(
    keys: string[],
    colors: string[],
    mode: ThreadMode,
    taken: Set<string>,
  ): void {
    for (let i = 0; i < keys.length; i++) {
      const name = i18n.t(keys[i]!);
      if (taken.has(name)) continue;
      threadPersistenceService.createTag(name, colors[i]!, i, mode);
      taken.add(name);
    }
  }

  // Insert the CJK genre/trope vocabulary that isn't already present, each with
  // a random palette color. No language gate and no flag interaction — callers
  // decide whether the user is Chinese and whether the one-shot flag applies.
  private backfillChineseGenreTags(taken: Set<string>): void {
    // Start after the fixed 重写/互动 tags so they stay pinned at the top.
    let sortOrder = ENTERTAINMENT_TAG_KEYS.length;
    for (const name of ENTERTAINMENT_DEFAULT_TAGS) {
      if (taken.has(name)) continue;
      threadPersistenceService.createTag(
        name,
        getRandomPaletteColor(),
        sortOrder++,
        "entertainment",
      );
      taken.add(name);
    }
  }

  // One-shot auto-seed of the Chinese entertainment genre tags. Fires on startup
  // and when the user switches the UI language to Chinese. Gated on the resolved
  // language being Chinese (these labels are meaningless to English readers) and
  // on the hidden flag — once it has run, it never runs again, so users can
  // freely edit or delete the seeded tags. Re-runs are a manual "Reset to
  // default" action (see resetTagsToDefault), which does not touch this flag.
  populateChineseEntertainmentTagsIfPending(): void {
    if (!(i18n.language ?? "en").startsWith("zh")) return;
    if (settingsService.getRawSetting(CHINESE_TAGS_POPULATED_FLAG) === "1")
      return;
    try {
      this.backfillChineseGenreTags(
        new Set(threadPersistenceService.listTags().map((t) => t.name)),
      );
      settingsService.setRawSetting(CHINESE_TAGS_POPULATED_FLAG, "1");
      logger.info("Seeded Chinese entertainment tags", {
        count: ENTERTAINMENT_DEFAULT_TAGS.length,
      });
    } catch (error) {
      logger.error("Failed to seed Chinese entertainment tags:", error);
    }
  }

  // Manual "Reset to default" backfill for the settings page. Re-adds any
  // missing default tags for the given mode (additive — does not undo user
  // renames/edits). Independent of the one-shot flag. The CJK genre set is only
  // backfilled when the UI language is Chinese.
  resetTagsToDefault(mode: ThreadMode): void {
    const taken = new Set(
      threadPersistenceService.listTags().map((t) => t.name),
    );
    if (mode === "chat") {
      this.backfillTags(DEFAULT_TAG_KEYS, DEFAULT_TAG_COLORS, "chat", taken);
    } else {
      this.backfillTags(
        ENTERTAINMENT_TAG_KEYS,
        ENTERTAINMENT_TAG_COLORS,
        "entertainment",
        taken,
      );
      if ((i18n.language ?? "en").startsWith("zh")) {
        this.backfillChineseGenreTags(taken);
      }
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
        model: simpleModel().model,
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
        model: simpleModel().model,
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
