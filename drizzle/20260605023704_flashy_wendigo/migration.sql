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
