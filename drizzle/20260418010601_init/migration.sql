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
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL UNIQUE,
	`sort_order` integer DEFAULT 0 NOT NULL,
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
