CREATE TABLE `outlines` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`outline` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_outlines_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_outlines_thread_id_chapter_number_rewritten_chapters_thread_id_chapter_number_fk` FOREIGN KEY (`thread_id`,`chapter_number`) REFERENCES `rewritten_chapters`(`thread_id`,`chapter_number`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rewritten_chapters` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`content` text,
	`status` text DEFAULT 'rewriting' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_rewritten_chapters_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_rewritten_chapters`(`id`, `thread_id`, `chapter_number`, `content`, `status`, `created_at`, `updated_at`) SELECT `id`, `thread_id`, `chapter_number`, `content`, `status`, `created_at`, `updated_at` FROM `rewritten_chapters`;--> statement-breakpoint
DROP TABLE `rewritten_chapters`;--> statement-breakpoint
ALTER TABLE `__new_rewritten_chapters` RENAME TO `rewritten_chapters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `rewritten_chapters_thread_number_unique` ON `rewritten_chapters` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `rewritten_chapters_thread_id_idx` ON `rewritten_chapters` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `outlines_thread_number_unique` ON `outlines` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `outlines_thread_id_idx` ON `outlines` (`thread_id`);--> statement-breakpoint
ALTER TABLE `source_chapters` DROP COLUMN `outline`;--> statement-breakpoint
ALTER TABLE `source_chapters` DROP COLUMN `foreshadowing`;--> statement-breakpoint
ALTER TABLE `source_chapters` DROP COLUMN `outline_status`;