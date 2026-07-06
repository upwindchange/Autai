CREATE TABLE `chapter_outlines` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`outline` text DEFAULT '' NOT NULL,
	`foreshadowing` text DEFAULT '[]' NOT NULL,
	`needs_cross_write` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'outlining' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_chapter_outlines_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_outlines_thread_number_unique` ON `chapter_outlines` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `chapter_outlines_thread_id_idx` ON `chapter_outlines` (`thread_id`);