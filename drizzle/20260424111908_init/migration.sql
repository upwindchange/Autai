CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
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
	CONSTRAINT `fk_bookmarks_chapter_id_rewritten_chapters_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `rewritten_chapters`(`id`) ON DELETE CASCADE
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
	CONSTRAINT `fk_chapter_meta_chapter_id_rewritten_chapters_id_fk` FOREIGN KEY (`chapter_id`) REFERENCES `rewritten_chapters`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `entertainment_configs` (
	`thread_id` text PRIMARY KEY,
	`mode` text NOT NULL,
	`options` text NOT NULL,
	`novel_source` text,
	`last_read_chapter_number` integer,
	`final_chapter_number` integer,
	`raw_text` text,
	`raw_consumed_offset` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_entertainment_configs_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`transport_type` text NOT NULL,
	`connection_config` text NOT NULL,
	`enabled` text DEFAULT 'true' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_messages_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `model_assignments` (
	`role` text PRIMARY KEY,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`params` text,
	CONSTRAINT `fk_model_assignments_provider_id_user_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `user_providers`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
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
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_chapters` (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`chapter_number` integer NOT NULL,
	`title` text,
	`content` text,
	`url` text,
	`status` text DEFAULT 'fetching' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `fk_source_chapters_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL UNIQUE,
	`emoji` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'chat' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_tags` (
	`thread_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	CONSTRAINT `thread_tags_pk` PRIMARY KEY(`thread_id`, `tag_id`),
	CONSTRAINT `fk_thread_tags_thread_id_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY,
	`title` text DEFAULT 'New Chat' NOT NULL,
	`status` text DEFAULT 'regular' NOT NULL,
	`mode` text DEFAULT 'chat' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`chat_provider_id` text,
	`chat_model_id` text,
	`chat_model_params` text,
	`chat_system_prompt` text,
	CONSTRAINT `fk_threads_chat_provider_id_user_providers_id_fk` FOREIGN KEY (`chat_provider_id`) REFERENCES `user_providers`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `user_providers` (
	`id` text PRIMARY KEY,
	`provider_dir` text NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`api_url_override` text,
	`npm` text NOT NULL,
	`default_api_url` text
);
--> statement-breakpoint
CREATE INDEX `bookmarks_thread_id_idx` ON `bookmarks` (`thread_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_chapter_id_idx` ON `bookmarks` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `chapter_meta_chapter_kind_idx` ON `chapter_meta` (`chapter_id`,`kind`);--> statement-breakpoint
CREATE INDEX `chapter_meta_thread_kind_idx` ON `chapter_meta` (`thread_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `rewritten_chapters_thread_number_unique` ON `rewritten_chapters` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `rewritten_chapters_thread_id_idx` ON `rewritten_chapters` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `source_chapters_thread_number_unique` ON `source_chapters` (`thread_id`,`chapter_number`);--> statement-breakpoint
CREATE INDEX `source_chapters_thread_id_idx` ON `source_chapters` (`thread_id`);