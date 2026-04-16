-- Custom SQL migration file, put your code below! --

CREATE VIRTUAL TABLE IF NOT EXISTS threads_fts USING fts5(
  thread_id UNINDEXED,
  title,
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS threads_fts_insert AFTER INSERT ON threads BEGIN
  INSERT INTO threads_fts(thread_id, title) VALUES (new.id, new.title);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS threads_fts_update AFTER UPDATE ON threads BEGIN
  DELETE FROM threads_fts WHERE thread_id = old.id;
  INSERT INTO threads_fts(thread_id, title) VALUES (new.id, new.title);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS threads_fts_delete AFTER DELETE ON threads BEGIN
  DELETE FROM threads_fts WHERE thread_id = old.id;
END;
