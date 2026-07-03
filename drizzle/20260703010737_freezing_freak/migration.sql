ALTER TABLE `entertainment_configs` RENAME COLUMN `last_chapter_number` TO `last_read_chapter_number`;--> statement-breakpoint
ALTER TABLE `entertainment_configs` ADD `final_chapter_number` integer;