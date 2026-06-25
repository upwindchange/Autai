CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`anchor` text,
	`label` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_bookmarks_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bookmarks_chapter_id_chapters_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `chapter_meta` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_chapter_meta_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chapter_meta_chapter_id_chapters_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`title` text,
	`status` text DEFAULT 'streaming' NOT NULL,
	`content` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_chapters_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `entertainment_configs` (
	`thread_id` text PRIMARY KEY,
	`mode` text NOT NULL,
	`options` text NOT NULL,
	`novel_source` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_entertainment_configs_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `bookmarks_thread_id_idx` ON `bookmarks` (`thread_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_chapter_id_idx` ON `bookmarks` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `chapter_meta_chapter_kind_idx` ON `chapter_meta` (`chapter_id`,`kind`);--> statement-breakpoint
CREATE INDEX `chapter_meta_thread_kind_idx` ON `chapter_meta` (`thread_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_thread_number_unique` ON `chapters` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `chapters_thread_id_idx` ON `chapters` (`thread_id`);