-- Custom SQL migration file, put your code below! --

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_threads_title_trgm ON threads USING gin (title gin_trgm_ops);