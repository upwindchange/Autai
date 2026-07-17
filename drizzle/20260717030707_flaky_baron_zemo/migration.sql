ALTER TABLE `rewritten_chapters` ADD `source_chapter_id` text REFERENCES source_chapters(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `source_chapters` ADD `outline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_chapters` ADD `foreshadowing` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_chapters` ADD `outline_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `chapter_outlines_thread_number_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `chapter_outlines_thread_id_idx`;--> statement-breakpoint
DROP TABLE `chapter_outlines`;--> statement-breakpoint
ALTER TABLE `rewritten_chapters` DROP COLUMN `source_chapter_start`;--> statement-breakpoint
ALTER TABLE `rewritten_chapters` DROP COLUMN `source_chapter_end`;