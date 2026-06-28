CREATE TABLE `rewritten_chapters` (
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
CREATE TABLE `source_chapters` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`title` text,
	`content` text,
	`status` text DEFAULT 'fetching' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_source_chapters_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `entertainment_configs` ADD `last_chapter_number` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bookmarks` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`anchor` text,
	`label` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_bookmarks_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bookmarks_chapter_id_rewritten_chapters_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `rewritten_chapters`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_bookmarks`(`id`, `thread_id`, `chapter_id`, `anchor`, `label`, `note`, `created_at`, `updated_at`) SELECT `id`, `thread_id`, `chapter_id`, `anchor`, `label`, `note`, `created_at`, `updated_at` FROM `bookmarks`;--> statement-breakpoint
DROP TABLE `bookmarks`;--> statement-breakpoint
ALTER TABLE `__new_bookmarks` RENAME TO `bookmarks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chapter_meta` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_chapter_meta_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chapter_meta_chapter_id_rewritten_chapters_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `rewritten_chapters`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_chapter_meta`(`id`, `thread_id`, `chapter_id`, `kind`, `payload`, `sort_order`, `created_at`, `updated_at`) SELECT `id`, `thread_id`, `chapter_id`, `kind`, `payload`, `sort_order`, `created_at`, `updated_at` FROM `chapter_meta`;--> statement-breakpoint
DROP TABLE `chapter_meta`;--> statement-breakpoint
ALTER TABLE `__new_chapter_meta` RENAME TO `chapter_meta`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `chapters_thread_number_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `chapters_thread_id_idx`;--> statement-breakpoint
CREATE INDEX `bookmarks_thread_id_idx` ON `bookmarks` (`thread_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_chapter_id_idx` ON `bookmarks` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `chapter_meta_chapter_kind_idx` ON `chapter_meta` (`chapter_id`,`kind`);--> statement-breakpoint
CREATE INDEX `chapter_meta_thread_kind_idx` ON `chapter_meta` (`thread_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `rewritten_chapters_thread_number_unique` ON `rewritten_chapters` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `rewritten_chapters_thread_id_idx` ON `rewritten_chapters` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_chapters_thread_number_unique` ON `source_chapters` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `source_chapters_thread_id_idx` ON `source_chapters` (`thread_id`);--> statement-breakpoint
DROP TABLE `chapters`;