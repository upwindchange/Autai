ALTER TABLE `entertainment_configs` ADD `raw_text` text;--> statement-breakpoint
ALTER TABLE `entertainment_configs` ADD `raw_consumed_offset` integer DEFAULT 0 NOT NULL;